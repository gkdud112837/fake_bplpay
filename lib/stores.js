import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { wholeArea } from './areas.js';
import { placesIn } from './places.js';

// 중구 전체 가게 — scripts/build-store-index.mjs 로 만든 색인을 쓰고, 없으면 실시간으로 받는다(느림)
const FILE = path.join(process.cwd(), 'data', 'stores.json');
let snapshot = null;
let builtAt = null;

// 화면에 보여줄 데이터 출처 (색인을 쓰면 색인 기준일 포함)
export const indexSourceName = () =>
  existsSync(FILE) && builtAt ? `소상공인시장진흥공단 상가(상권)정보 (${builtAt.slice(0, 10)} 기준)` : null;

export async function allStores() {
  if (snapshot) return snapshot;
  if (!existsSync(FILE)) return placesIn(wholeArea());
  const data = JSON.parse(readFileSync(FILE, 'utf8'));
  builtAt = data.builtAt;
  const { rows } = data;
  snapshot = rows.map(([id, name, kind, category, address, lat, lng, ldong, adong]) => ({
    id,
    name,
    kind,
    category,
    address,
    phone: '',
    lat,
    lng,
    url: `https://map.kakao.com/?q=${encodeURIComponent(`${name} ${address}`)}`,
    ldong,
    adong,
  }));
  return snapshot;
}

// 구획 안의 가게. 색인이 있으면 가게 주소의 법정동 이름으로 바로 거르고(1ms 내외),
// 없으면 상가정보 API를 실시간으로 부른다(수 초, 해외 서버에서는 더 느림)
export async function storesIn(area) {
  if (!existsSync(FILE)) return placesIn(area);
  const dongs = new Set(area.dongs);
  return (await allStores()).filter((p) => dongs.has(p.ldong));
}
