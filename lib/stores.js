import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { wholeArea } from './areas.js';
import { placesIn } from './places.js';

// 중구 전체 가게 — scripts/build-store-index.mjs 로 만든 색인을 쓰고, 없으면 실시간으로 받는다(느림)
const FILE = path.join(process.cwd(), 'data', 'stores.json');
let snapshot = null;

export async function allStores() {
  if (snapshot) return snapshot;
  if (!existsSync(FILE)) return placesIn(wholeArea());
  const { rows } = JSON.parse(readFileSync(FILE, 'utf8'));
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
