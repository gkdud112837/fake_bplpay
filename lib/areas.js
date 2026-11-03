import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bboxOf, inFeature } from './geo.js';
import { KAKAO_KEY, UA } from './env.js';

// Vercel에서는 vercel.json의 includeFiles로 data/가 함수에 함께 배포된다
const DATA_DIR = path.join(process.cwd(), 'data');
const dongs = JSON.parse(readFileSync(path.join(DATA_DIR, 'dongs.geojson'), 'utf8')).features;
const presets = JSON.parse(readFileSync(path.join(DATA_DIR, 'areas.json'), 'utf8'));

const dongByName = new Map(dongs.map((f) => [f.properties.name, f]));
for (const p of presets) {
  for (const d of p.dongs) if (!dongByName.has(d)) throw new Error(`areas.json: '${p.name}'의 '${d}'는 법정동 경계에 없습니다`);
}

// 지명 묶음 + 법정동 하나하나를 모두 검색 대상으로
const entries = [
  ...presets,
  ...dongs
    .filter((f) => !presets.some((p) => p.name === f.properties.name))
    .map((f) => ({ name: f.properties.name, aliases: [], desc: '법정동', dongs: [f.properties.name] })),
];

const norm = (s) => s.replace(/\s+/g, '').replace(/[.!?~,]/g, '');
const keysOf = (e) => [e.name, ...e.aliases].map(norm);

// "교동으로 가줘" → ["교동으로가줘", "교동으로", "교동"]
const SUFFIXES = ['가줘', '가자', '보여줘', '검색', '으로', '로', '에서', '에', '쪽', '근처', '일대', '주변', '동네'];

export function candidates(input) {
  let s = norm(input);
  const out = [s];
  for (let changed = true; changed; ) {
    changed = false;
    for (const suf of SUFFIXES) {
      if (s.length > suf.length + 1 && s.endsWith(suf)) {
        s = s.slice(0, -suf.length);
        out.push(s);
        changed = true;
        break;
      }
    }
  }
  return out;
}

function build(entry, matched) {
  const features = entry.dongs.map((d) => dongByName.get(d));
  return {
    name: entry.name,
    desc: entry.desc,
    dongs: entry.dongs,
    matched,
    bbox: bboxOf(features),
    geojson: { type: 'FeatureCollection', features },
  };
}

// 정확히 일치하는 이름만 — 자연어 문장은 여기서 걸러져 AI 에이전트로 넘어간다
export function exactArea(input) {
  for (const c of candidates(input)) {
    const e = entries.find((e) => keysOf(e).includes(c));
    if (e) return build(e, 'exact');
  }
  return null;
}

export function looseArea(input) {
  const exact = exactArea(input);
  if (exact) return exact;
  for (const c of candidates(input)) {
    if (c.length < 2) continue;
    const e = entries.find((e) => keysOf(e).some((k) => k.startsWith(c) || c.startsWith(k)));
    if (e) return build(e, 'prefix');
  }
  return null;
}

async function geocode(name) {
  if (KAKAO_KEY) {
    const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
    url.search = new URLSearchParams({ query: `대구 중구 ${name}`, size: 1 });
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } });
    if (res.ok) {
      const doc = (await res.json()).documents[0];
      if (doc) return { lat: +doc.y, lng: +doc.x };
    }
  }
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q: `대구 중구 ${name}`, format: 'json', limit: 1, countrycodes: 'kr' });
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko' } });
  if (!res.ok) return null;
  const hit = (await res.json())[0];
  return hit ? { lat: +hit.lat, lng: +hit.lon } : null;
}

// 목록에 없는 지명(가게·건물 이름 등)은 위치를 찾아 그 위치가 속한 법정동으로 보여준다
export async function geocodeArea(name) {
  const pos = await geocode(name);
  if (!pos) return null;
  const dong = dongs.find((f) => inFeature(pos.lng, pos.lat, f));
  if (!dong) return null;
  const dongName = dong.properties.name;
  return { ...build({ name: `${name} (${dongName})`, aliases: [], desc: `'${name}'이(가) 있는 법정동`, dongs: [dongName] }, 'geocode'), point: pos };
}

export const dongOf = (lat, lng) => dongs.find((f) => inFeature(lng, lat, f))?.properties.name ?? null;

export const areaFromDongs = (name, dongNames, desc, matched) =>
  build({ name, aliases: [], desc, dongs: [...new Set(dongNames)] }, matched);

// 가게 이름·행정동 검색용: 중구 법정동 전체
export const wholeArea = () => areaFromDongs('대구 중구 전체', dongs.map((f) => f.properties.name), '대구 중구 전체', 'whole');

// 행정동(성내1동, 남산2동…) → 그 행정동에 속한 법정동 묶음.
// 공식 대응표 대신 상가정보의 가게별 행정동·법정동 기록으로 계산한다.
export function adminArea(input, places) {
  const counts = new Map(); // 행정동 → Map(법정동 → 가게 수)
  for (const p of places) {
    if (!p.adong || !p.ldong || !dongByName.has(p.ldong)) continue;
    if (!counts.has(p.adong)) counts.set(p.adong, new Map());
    const m = counts.get(p.adong);
    m.set(p.ldong, (m.get(p.ldong) ?? 0) + 1);
  }
  for (const c of candidates(input)) {
    // "성내2동"은 그 동만, "성내동"은 성내1·2·3동 전체
    const names = [...counts.keys()].filter((a) => a === c || a.replace(/\d+/g, '') === c);
    if (!names.length) continue;
    const ldongs = names.flatMap((a) => [...counts.get(a)].filter(([, n]) => n >= 3).map(([d]) => d));
    if (ldongs.length) return areaFromDongs(c, ldongs, `행정동 ${names.join('·')}`, 'admin');
  }
  return null;
}

export const areaNames = () => entries.map((e) => e.name);
