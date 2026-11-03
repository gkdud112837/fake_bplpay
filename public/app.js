const CENTER = [35.8685, 128.595];
const STATUS_TEXT = { yes: '비플페이 가능', no: '비플페이 불가능', none: '미확인' };
// 구획 밖만 회색으로 덮어 구획을 강조한다 (테두리 선 없음)
const AREA_STYLE = { mask: '#4b5563', maskOpacity: 0.45 };
const state = { places: [], byId: new Map(), markers: new Map(), filter: 'all', area: null, sourceName: '', popupFor: null };
const $ = (sel) => document.querySelector(sel);

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 3000);
}

// GeoJSON(MultiPolygon/Polygon) → [[[lat, lng], ...] 링들] 폴리곤 목록
function polygonsLatLng(geojson) {
  const out = [];
  for (const f of geojson.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of polys) out.push(p.map((ring) => ring.map(([lng, lat]) => [lat, lng])));
  }
  return out;
}

// 평면 핀 — 색은 가게 종류(식당 빨강·카페 초록·주점 노랑·기타 파랑),
// 비플페이 가능은 밝은 연둣빛 형광, 불가능은 회색. SVG 이미지라 수천 개도 가볍다
const KIND_COLOR = { food: '#ef4444', cafe: '#10b981', bar: '#f5c518', etc: '#3b82f6' };
const NO_COLOR = '#9ca3af';
const NEON = '#b6ff2e';
// 핀 그림 36×44, 끝은 (18, 39). 형광 핀(가능)만 빛이 퍼질 여백 14px를 더 둔다
// — 모든 핀에 여백을 주면 클릭 영역이 커져 몰린 곳에서 옆 핀이 눌린다
const PIN = { w: 36, h: 44, tipX: 18, tipY: 39 };
const GLOW_PAD = 14;
const pinBox = (status) => {
  const pad = status === 'yes' ? GLOW_PAD : 0;
  return { pad, w: PIN.w + pad * 2, h: PIN.h + pad * 2, tipX: PIN.tipX + pad, tipY: PIN.tipY + pad };
};
const PIN_PATH = 'M18 5C11.4 5 6 10.2 6 16.6 6 25.2 18 39 18 39S30 25.2 30 16.6C30 10.2 24.6 5 18 5Z';
const pinCache = new Map();
function pinUrl(kind, status) {
  const key = `${kind}:${status}`;
  if (!pinCache.has(key)) {
    const fill = status === 'no' ? NO_COLOR : (KIND_COLOR[kind] ?? KIND_COLOR.food);
    const glow =
      status === 'yes'
        ? `<defs><filter id="g" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="6.5"/></filter></defs>
           <path d="${PIN_PATH}" fill="${NEON}" stroke="${NEON}" stroke-width="14" filter="url(#g)"/>
           <path d="${PIN_PATH}" fill="none" stroke="${NEON}" stroke-width="5"/>`
        : '';
    const { pad, w, h } = pinBox(status);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g transform="translate(${pad} ${pad})">${glow}
      <path d="${PIN_PATH}" fill="${fill}" stroke="#fff" stroke-width="2"/>
      <circle cx="18" cy="16.6" r="4.6" fill="#fff"/></g></svg>`;
    pinCache.set(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  }
  return pinCache.get(key);
}
// 멀리서 볼 때 묶음 원 크기 (가게 수 기준)
const clusterSize = (n) => (n < 20 ? 38 : n < 100 ? 46 : 54);

// ---------- 지도 어댑터: 카카오 지도 / Leaflet(OSM) 공통 인터페이스 ----------

function leafletMap() {
  // 확대/축소 버튼은 왼쪽 패널과 겹치지 않게 오른쪽에
  const map = L.map('map', { zoomControl: false }).setView(CENTER, 16);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  map.on('popupclose', () => (state.popupFor = null));

  const pinIcon = (p, status) =>
    L.icon({ iconUrl: pinUrl(p.kind, status), iconSize: [pinBox(status).w, pinBox(status).h], iconAnchor: [pinBox(status).tipX, pinBox(status).tipY] });
  // 멀리서는 원과 숫자로 묶고, 충분히 확대하면 낱개 핀
  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    disableClusteringAtZoom: 18,
    maxClusterRadius: 50,
    iconCreateFunction: (c) => {
      const n = c.getChildCount();
      const size = clusterSize(n);
      return L.divIcon({ html: `<div class="cluster">${n}</div>`, className: '', iconSize: [size, size] });
    },
  }).addTo(map);
  let areaLayers = [];
  const clearArea = () => {
    for (const l of areaLayers) l.remove();
    areaLayers = [];
  };

  return {
    setArea(area) {
      clearArea();
      const polys = polygonsLatLng(area.geojson);
      const world = [[-85, -180], [-85, 180], [85, 180], [85, -180]];
      const mask = L.polygon([world, ...polys.map((rings) => rings[0])], {
        stroke: false, fillColor: AREA_STYLE.mask, fillOpacity: AREA_STYLE.maskOpacity, interactive: false,
      });
      areaLayers = [mask.addTo(map)];
      // 구획에 맞춰 부드럽게 확대
      map.flyToBounds(L.latLngBounds(polys.flatMap((rings) => rings[0])), { padding: [24, 24], duration: 0.9 });
    },
    showPoints(places) {
      clearArea();
      if (!places.length) return;
      map.flyToBounds(L.latLngBounds(places.map((p) => [p.lat, p.lng])), { padding: [48, 48], maxZoom: 17, duration: 0.9 });
    },
    createMarker(p, onClick) {
      const m = L.marker([p.lat, p.lng], { icon: pinIcon(p, p.status), zIndexOffset: p.status === 'yes' ? 1000 : 0 });
      m.bindTooltip(p.name, { direction: 'top', offset: [0, -10] });
      m.on('click', onClick);
      return {
        raw: m,
        setStatus(s) {
          m.setIcon(pinIcon(p, s));
          m.setZIndexOffset(s === 'yes' ? 1000 : 0);
        },
      };
    },
    showMarkers(raws) {
      cluster.clearLayers();
      cluster.addLayers(raws);
    },
    openPopup(p, el) {
      L.popup({ minWidth: 220, offset: [0, -PIN.tipY + 8] }).setLatLng([p.lat, p.lng]).setContent(el).openOn(map);
      state.popupFor = p.id;
    },
    focus(p) {
      map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17));
    },
  };
}

function kakaoMap() {
  const k = kakao.maps;
  const map = new k.Map($('#map'), { center: new k.LatLng(...CENTER), level: 4 });
  map.addControl(new k.ZoomControl(), k.ControlPosition.RIGHT);
  let areaShapes = [];
  let popup = null;

  const closePopup = () => {
    popup?.setMap(null);
    popup = null;
    state.popupFor = null;
  };
  k.event.addListener(map, 'click', closePopup);

  // 멀리서(레벨 4 이상)는 원과 숫자로 묶고, 가까이서는 낱개 핀
  const clusterStyle = (size) => ({
    width: `${size}px`,
    height: `${size}px`,
    lineHeight: `${size - 4}px`,
    borderRadius: '50%',
    textAlign: 'center',
    color: '#fff',
    fontWeight: '800',
    fontSize: '14px',
    background: 'rgba(99, 102, 241, 0.82)',
    border: '2px solid rgba(255, 255, 255, 0.85)',
    boxShadow: '0 4px 14px rgba(79, 70, 229, 0.35)',
  });
  const clusterer = new k.MarkerClusterer({
    map,
    averageCenter: true,
    minLevel: 4,
    gridSize: 60,
    calculator: [20, 100],
    styles: [clusterStyle(clusterSize(1)), clusterStyle(clusterSize(20)), clusterStyle(clusterSize(100))],
  });

  const clearArea = () => {
    for (const s of areaShapes) s.setMap(null);
    areaShapes = [];
  };
  // 한 단계 멀리서 부드럽게 확대해 들어간다
  const zoomInto = (bounds) => {
    map.setBounds(bounds, 40, 40, 40, 40);
    const level = map.getLevel();
    map.setLevel(level + 1);
    setTimeout(() => map.setLevel(level, { animate: { duration: 500 } }), 60);
  };

  return {
    setArea(area) {
      clearArea();
      const toPath = (ring) => ring.map(([lat, lng]) => new k.LatLng(lat, lng));
      const polys = polygonsLatLng(area.geojson);
      const bounds = new k.LatLngBounds();
      for (const rings of polys) for (const [lat, lng] of rings[0]) bounds.extend(new k.LatLng(lat, lng));
      // 한반도를 덮는 사각형에 구획 모양으로 구멍을 뚫는다
      const korea = toPath([[32, 123], [32, 132.5], [39.5, 132.5], [39.5, 123]]);
      const mask = new k.Polygon({
        path: [korea, ...polys.map((rings) => toPath(rings[0]))],
        strokeWeight: 0, strokeOpacity: 0, fillColor: AREA_STYLE.mask, fillOpacity: AREA_STYLE.maskOpacity,
      });
      areaShapes = [mask];
      for (const s of areaShapes) s.setMap(map);
      zoomInto(bounds);
    },
    showPoints(places) {
      clearArea();
      if (!places.length) return;
      if (places.length === 1) {
        map.setLevel(3);
        map.setCenter(new k.LatLng(places[0].lat, places[0].lng));
        return;
      }
      const bounds = new k.LatLngBounds();
      for (const p of places) bounds.extend(new k.LatLng(p.lat, p.lng));
      zoomInto(bounds);
    },
    createMarker(p, onClick) {
      // 핀 끝(아래 꼭짓점)이 가게 위치에 오도록
      const image = (s) => {
        const b = pinBox(s);
        return new k.MarkerImage(pinUrl(p.kind, s), new k.Size(b.w, b.h), { offset: new k.Point(b.tipX, b.tipY) });
      };
      const m = new k.Marker({ position: new k.LatLng(p.lat, p.lng), image: image(p.status), title: p.name, zIndex: p.status === 'yes' ? 3 : 1 });
      k.event.addListener(m, 'click', onClick);
      return {
        raw: m,
        setStatus(s) {
          m.setImage(image(s));
          m.setZIndex(s === 'yes' ? 3 : 1);
        },
      };
    },
    showMarkers(raws) {
      clusterer.clear();
      clusterer.addMarkers(raws);
    },
    openPopup(p, el) {
      closePopup();
      const box = document.createElement('div');
      box.className = 'kpopup';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'kpopup-close';
      close.textContent = '×';
      close.onclick = closePopup;
      box.append(close, el);
      popup = new k.CustomOverlay({ position: new k.LatLng(p.lat, p.lng), content: box, xAnchor: 0.5, yAnchor: 1, zIndex: 10, clickable: true });
      popup.setMap(map);
      state.popupFor = p.id;
    },
    focus(p) {
      if (map.getLevel() > 3) map.setLevel(3);
      map.setCenter(new k.LatLng(p.lat, p.lng));
    },
  };
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
    document.head.append(s);
  });
}

async function initMap(kakaoJsKey) {
  if (kakaoJsKey) {
    try {
      await loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(kakaoJsKey)}&libraries=clusterer&autoload=false`);
      if (!window.kakao?.maps) throw new Error('카카오 SDK 초기화 실패');
      await new Promise((resolve) => kakao.maps.load(resolve));
      return kakaoMap();
    } catch {
      toast('카카오 지도를 불러오지 못해 OpenStreetMap으로 표시합니다. (JavaScript 키·도메인 등록 확인)');
    }
  }
  return leafletMap();
}

const config = await fetch('/api/config').then((r) => r.json()).catch(() => ({ areas: [] }));
const mapApi = await initMap(config.kakaoJsKey);

// ---------- 팝업 / 상태 ----------

function popupContent(p) {
  const el = document.createElement('div');
  el.className = 'popup';
  el.innerHTML = `
    <strong class="name"></strong>
    <div class="cat"></div>
    <div class="addr"></div>
    <div class="phone"></div>
    <div class="status"></div>
    <div class="btns">
      <button type="button" class="b-yes">가능</button>
      <button type="button" class="b-no">불가능</button>
    </div>
    <div class="foot"><a target="_blank" rel="noopener">상세 정보 ↗</a><button type="button" class="b-reset">초기화</button></div>`;
  el.querySelector('.name').textContent = p.name;
  el.querySelector('.cat').textContent = p.category || '';
  el.querySelector('.addr').textContent = p.address || '';
  el.querySelector('.phone').textContent = p.phone || '';
  const st = el.querySelector('.status');
  st.textContent = STATUS_TEXT[p.status || 'none'];
  st.dataset.s = p.status || 'none';
  el.querySelector('a').href = p.url;
  el.querySelector('.b-yes').classList.toggle('active', p.status === 'yes');
  el.querySelector('.b-no').classList.toggle('active', p.status === 'no');
  el.querySelector('.b-yes').onclick = () => saveStatus(p, 'yes');
  el.querySelector('.b-no').onclick = () => saveStatus(p, 'no');
  el.querySelector('.b-reset').onclick = () => saveStatus(p, null);
  return el;
}

// 화면에 상태 반영 (내가 누른 것이든, 다른 사용자가 누른 것이든)
function applyStatus(id, status) {
  const p = state.byId.get(id);
  if (!p || p.status === status) return;
  p.status = status;
  state.markers.get(id)?.setStatus(status);
  if (state.popupFor === id) mapApi.openPopup(p, popupContent(p));
  render();
}

// 로그인 대신 쓰는 익명 기기 ID (변경 기록용)
const clientId = (() => {
  try {
    let id = localStorage.getItem('bplpay-client-id');
    if (!id) localStorage.setItem('bplpay-client-id', (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

async function saveStatus(p, status) {
  const res = await fetch('/api/status', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId },
    body: JSON.stringify({ id: p.id, status, place: { name: p.name, address: p.address, lat: p.lat, lng: p.lng } }),
  });
  if (!res.ok) return toast((await res.json().catch(() => ({}))).error || '저장에 실패했습니다.');
  applyStatus(p.id, status);
  toast(`${p.name}: ${STATUS_TEXT[status || 'none']}`);
}

// 다른 사용자가 누른 결과를 새로고침 없이 반영 (Supabase Realtime)
async function subscribeRealtime() {
  if (!config.supabaseUrl || !config.supabaseKey) return;
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js');
    const client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
    client
      .channel('bplpay_status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bplpay_status' }, ({ eventType, new: row, old }) => {
        if (eventType === 'DELETE') applyStatus(old.place_id, null);
        else applyStatus(row.place_id, row.status);
      })
      .subscribe();
  } catch (err) {
    console.warn('실시간 연결 실패:', err);
  }
}
subscribeRealtime();

// ---------- 목록 / 검색 ----------

// 종류(식당·카페·기타) 칩 — 아무것도 안 고르면 전체
const KIND_TEXT = { food: '식당', cafe: '카페', bar: '주점', etc: '기타' };
state.kind = 'all';
const kindOk = (p) => state.kind === 'all' || (p.kind || 'food') === state.kind;
const visible = (p) => kindOk(p) && (state.filter === 'all' || (p.status || 'none') === state.filter);

function setFilter(filter) {
  state.filter = filter;
  const buttons = [...document.querySelectorAll('.filters button')];
  buttons.forEach((b) => b.classList.toggle('on', b.dataset.filter === filter));
  // 슬라이딩 필: 선택된 탭 위치로 배경을 옮긴다
  const i = Math.max(0, buttons.findIndex((b) => b.dataset.filter === filter));
  $('.filters .pill').style.transform = `translateX(${i * 100}%)`;
}

function setKind(kind) {
  state.kind = kind;
  document.querySelectorAll('#kind-chips button').forEach((b) => b.classList.toggle('on', b.dataset.kind === kind));
}

function render() {
  const shown = state.places.filter(kindOk);
  const counts = { yes: 0, no: 0, none: 0 };
  for (const p of shown) counts[p.status || 'none']++;

  $('#summary-title').textContent = state.area.name;
  const label = state.kind === 'all' ? '가게' : KIND_TEXT[state.kind];
  $('#summary-meta').textContent = `${label} ${shown.length}곳 · 가능 ${counts.yes} · 불가능 ${counts.no} · 미확인 ${counts.none}`;
  const where = state.area.matched === 'store' ? '가게 이름 검색' : `구획: ${state.area.dongs.join(', ')}`;
  $('#summary-dongs').textContent = `${where} · 출처: ${state.sourceName}`;

  // 핀은 처음 보여줄 때 만들고, 지금 필터에 맞는 핀만 지도(클러스터)에 올린다
  mapApi.showMarkers(state.places.filter(visible).map((p) => markerOf(p).raw));

  // 목록은 앞부분만 그리고 '더 보기'로 늘린다
  const list = $('#list');
  const items = state.places.filter(visible);
  const frag = document.createDocumentFragment();
  for (const p of items.slice(0, state.listLimit)) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="dot"></span><div><div class="n"></div><div class="c"></div></div>';
    li.querySelector('.dot').dataset.s = p.status || 'none';
    li.querySelector('.dot').dataset.k = p.kind || 'food';
    li.querySelector('.n').textContent = p.name;
    li.querySelector('.c').textContent = p.category || '';
    li.onclick = () => {
      mapApi.focus(p);
      mapApi.openPopup(p, popupContent(p));
    };
    frag.append(li);
  }
  if (items.length > state.listLimit) {
    const more = document.createElement('li');
    more.className = 'more';
    more.textContent = `더 보기 (${items.length - state.listLimit}곳 남음)`;
    more.onclick = () => {
      state.listLimit += LIST_PAGE;
      render();
    };
    frag.append(more);
  }
  list.replaceChildren(frag);
}

const LIST_PAGE = 200;
state.listLimit = LIST_PAGE;

function markerOf(p) {
  let m = state.markers.get(p.id);
  if (!m) {
    m = mapApi.createMarker(p, () => mapApi.openPopup(p, popupContent(p)));
    state.markers.set(p.id, m);
  }
  return m;
}

function setReply(text) {
  $('#reply').textContent = text || '';
  $('#reply').hidden = !text;
}

async function search(q) {
  q = q.trim();
  if (!q) return;
  setReply(config.agent && q.length > 6 ? '찾는 중이에요…' : '');
  $('#summary-title').textContent = `'${q}' 가게 정보를 수집하는 중…`;
  $('#summary-meta').textContent = '';
  $('#summary-dongs').textContent = '';
  $('#list').innerHTML = '';
  const params = new URLSearchParams({ q });
  let data;
  try {
    const res = await fetch(`/api/search?${params}`);
    const text = await res.text();
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`서버 응답 오류 (${res.status}). 잠시 후 다시 시도해 주세요.`);
    }
    if (!res.ok) throw new Error(data.error);
  } catch (err) {
    setReply('');
    $('#summary-title').textContent = err.message || '검색에 실패했습니다.';
    return;
  }

  mapApi.showMarkers([]);
  state.markers.clear();

  state.area = data.area;
  state.sourceName = data.sourceName;
  state.places = data.places;
  state.byId = new Map(data.places.map((p) => [p.id, p]));
  setReply(data.intent.reply);
  setFilter(data.intent.status || 'all');
  // AI가 종류를 정했으면 그걸로, 아니면 사용자가 고른 종류 칩을 유지
  if (data.intent.kind && data.intent.kind !== 'all') setKind(data.intent.kind);

  // 가게 이름으로 찾았으면 구획 없이 가게들만 보여준다
  if (data.area.matched === 'store') mapApi.showPoints(state.places);
  else mapApi.setArea(data.area);
  state.listLimit = LIST_PAGE;
  render();
  if (!state.places.length) toast('이 구획에서 가게를 찾지 못했습니다.');

  // 가게 이름으로 하나만 찾았으면 구획 확대가 끝난 뒤 그 가게를 연다
  const focus = state.byId.get(data.focusId);
  if (focus) {
    setTimeout(() => {
      mapApi.focus(focus);
      mapApi.openPopup(focus, popupContent(focus));
    }, 1000);
  }
}

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  search($('#q').value);
});

document.querySelectorAll('.filters button').forEach((btn) => {
  btn.onclick = () => {
    setFilter(btn.dataset.filter);
    if (state.area) render();
  };
});

if (config.agent) $('#q').placeholder = '예: 교동에서 국밥 찾고싶어, 성내2동, 스타벅스';
// 지역 칩 — 나머지 동네는 검색창에 입력
for (const name of config.regions ?? []) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.textContent = name;
  chip.onclick = () => {
    $('#q').value = name;
    search(name);
  };
  $('#region-chips').append(chip);
}

// 종류 칩 — 다시 누르면 해제(전체)
document.querySelectorAll('#kind-chips button').forEach((btn) => {
  btn.onclick = () => {
    setKind(state.kind === btn.dataset.kind ? 'all' : btn.dataset.kind);
    if (state.area) render();
  };
});

// 주소에 ?q=교동 처럼 붙이면 바로 검색 (링크 공유용)
const initialQuery = new URLSearchParams(location.search).get('q');
if (initialQuery) {
  $('#q').value = initialQuery;
  search(initialQuery);
}
