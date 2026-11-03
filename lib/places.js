import { distance, inFeature } from './geo.js';
import { KAKAO_KEY, SBIZ_KEY, SOURCE, UA } from './env.js';

const CACHE_TTL = 30 * 60 * 1000;
const cache = new Map();

// ---------- 소상공인 상가정보: 전 업종. 대분류 I2 = 음식 — 그중 중분류 I212 = 카페, 중분류명 '주점' = 주점 ----------

const sbizKind = (d) => {
  if (d.indsLclsCd !== 'I2') return 'etc';
  if (d.indsMclsCd === 'I212') return 'cafe';
  return d.indsMclsNm === '주점' ? 'bar' : 'food';
};

// 상가정보 API는 초당 10건 제한 — 요청 사이 간격을 두고, 429가 오면 잠시 쉬었다 다시 보낸다
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SBIZ_GAP_MS = 150;
let sbizQueue = Promise.resolve();
let sbizLast = 0;
const sbizTurn = () =>
  (sbizQueue = sbizQueue.then(async () => {
    const wait = sbizLast + SBIZ_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    sbizLast = Date.now();
  }));

async function sbizPage(params, pageNo) {
  const url = new URL('https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius');
  url.search = new URLSearchParams({ serviceKey: SBIZ_KEY, ...params, numOfRows: 1000, pageNo, type: 'json' });
  let res;
  for (let attempt = 0; ; attempt++) {
    await sbizTurn();
    res = await fetch(url);
    if (res.status !== 429 || attempt >= 4) break;
    await sleep(1000 * (attempt + 1));
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`상가정보 API 오류 ${res.status}: ${text.slice(0, 200)}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // 키 미승인·오류 시 XML 오류 메시지가 온다
    throw new Error(`상가정보 API 오류 ${res.status}: ${text.slice(0, 200)}`);
  }
  const code = data.header?.resultCode;
  if (code === '03') return { items: [], total: 0 }; // 데이터 없음
  if (code && code !== '00') throw new Error(`상가정보 API 오류 ${code}: ${data.header.resultMsg}`);
  return { items: data.body?.items ?? [], total: data.body?.totalCount ?? 0 };
}

async function sbizPlaces([minLng, minLat, maxLng, maxLat]) {
  const cy = (minLat + maxLat) / 2;
  const cx = (minLng + maxLng) / 2;
  // 경계 상자를 덮는 원 — API 최대 반경이 2000m라 넘으면 4등분해서 모은다
  const radius = Math.ceil(distance(cy, cx, maxLat, maxLng)) + 20;
  if (radius > 2000) {
    const parts = await Promise.all([
      [minLng, minLat, cx, cy], [cx, minLat, maxLng, cy], [minLng, cy, cx, maxLat], [cx, cy, maxLng, maxLat],
    ].map((b) => sbizPlaces(b)));
    return [...new Map(parts.flat().map((p) => [p.id, p])).values()];
  }
  // 첫 페이지로 전체 건수를 알고 나머지 페이지는 동시에 받는다
  const params = { radius, cx, cy };
  const first = await sbizPage(params, 1);
  const pages = Math.ceil(first.total / 1000);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => sbizPage(params, i + 2)));
  return [first, ...rest]
    .flatMap((p) => p.items)
    .map((d) => {
      const name = d.brchNm ? `${d.bizesNm} ${d.brchNm}` : d.bizesNm;
      const address = d.rdnmAdr || d.lnoAdr || '';
      return {
        id: `s${d.bizesId}`,
        name,
        kind: sbizKind(d),
        category: [d.indsMclsNm, d.indsSclsNm].filter(Boolean).join(' > '),
        address: d.flrNo ? `${address} ${d.flrNo}층` : address,
        phone: '',
        lat: +d.lat,
        lng: +d.lon,
        url: `https://map.kakao.com/?q=${encodeURIComponent(`${name} ${address}`)}`,
        ldong: d.ldongNm,
        adong: d.adongNm,
      };
    });
}

// ---------- 카카오 로컬 ----------

async function kakaoCategory(code, rect, page) {
  const url = new URL('https://dapi.kakao.com/v2/local/search/category.json');
  url.search = new URLSearchParams({ category_group_code: code, rect: rect.join(','), page, size: 15 });
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
  if (!res.ok) throw new Error(`카카오 API 오류 ${res.status}: ${await res.text()}`);
  return res.json();
}

// 카카오는 한 검색당 최대 45건만 주므로, 결과가 넘치면 사각형을 4등분해서 다시 검색한다
async function kakaoCollect(code, rect, acc, depth = 0) {
  const first = await kakaoCategory(code, rect, 1);
  if (first.meta.total_count > 45 && depth < 4) {
    const [x1, y1, x2, y2] = rect;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    for (const r of [[x1, y1, mx, my], [mx, y1, x2, my], [x1, my, mx, y2], [mx, my, x2, y2]]) {
      await kakaoCollect(code, r, acc, depth + 1);
    }
    return;
  }
  let data = first;
  for (let page = 1; ; ) {
    for (const d of data.documents) acc.set(d.id, d);
    if (data.meta.is_end || page >= 3) break;
    data = await kakaoCategory(code, rect, ++page);
  }
}

async function kakaoPlaces(bbox) {
  const acc = new Map();
  for (const code of ['FD6', 'CE7']) await kakaoCollect(code, bbox, acc);
  return [...acc.values()].map((d) => ({
    id: `k${d.id}`,
    name: d.place_name,
    kind: d.category_group_code === 'CE7' ? 'cafe' : d.category_name.includes('술집') ? 'bar' : 'food',
    category: d.category_name.split(' > ').slice(1).join(' > '),
    address: d.road_address_name || d.address_name,
    phone: d.phone,
    lat: +d.y,
    lng: +d.x,
    url: d.place_url,
  }));
}

// ---------- OpenStreetMap (키 없을 때) ----------

async function osmPlaces([minLng, minLat, maxLng, maxLat]) {
  const q = `[out:json][timeout:25];nwr["amenity"~"^(restaurant|fast_food|food_court|cafe)$"](${minLat},${minLng},${maxLat},${maxLng});out center tags;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: `data=${encodeURIComponent(q)}`,
  });
  if (!res.ok) throw new Error(`Overpass API 오류 ${res.status}`);
  const { elements } = await res.json();
  return elements
    .filter((e) => e.tags?.name)
    .map((e) => ({
      id: `o${e.type[0]}${e.id}`,
      name: e.tags['name:ko'] || e.tags.name,
      kind: e.tags.amenity === 'cafe' ? 'cafe' : 'food',
      category: [e.tags.amenity, e.tags.cuisine].filter(Boolean).join(' · '),
      address: [e.tags['addr:street'], e.tags['addr:housenumber']].filter(Boolean).join(' '),
      phone: e.tags.phone || '',
      lat: e.lat ?? e.center.lat,
      lng: e.lon ?? e.center.lon,
      url: `https://www.openstreetmap.org/${e.type}/${e.id}`,
    }));
}

const fetchers = { sbiz: sbizPlaces, kakao: kakaoPlaces, osm: osmPlaces };

// 구획(법정동 폴리곤) 안에 있는 가게만 돌려준다. kind: food(식당) / cafe(카페) / bar(주점) / etc(기타)
export async function placesIn(area) {
  const key = `${SOURCE}:${area.dongs.join(',')}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.places;
  const raw = await fetchers[SOURCE](area.bbox);
  const features = area.geojson.features;
  const places = raw
    .filter((p) => features.some((f) => inFeature(p.lng, p.lat, f)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  cache.set(key, { at: Date.now(), places });
  return places;
}
