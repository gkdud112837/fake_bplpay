// 중구 전체 가게 색인(data/stores.json)을 만든다 — 가게 이름·행정동 검색용
// 상가정보 API로 중구 전체를 받는 데 30초 이상 걸려서 요청마다 받을 수 없다. 주기적으로 다시 실행하세요.
//   npm run index
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { wholeArea } from '../lib/areas.js';
import { placesIn } from '../lib/places.js';
import { SOURCE } from '../lib/env.js';

if (SOURCE !== 'sbiz') {
  console.error('SBIZ_API_KEY가 필요합니다.');
  process.exit(1);
}

const t = Date.now();
const places = await placesIn(wholeArea());
// 용량을 줄이려고 배열로 저장: [id, name, kind, category, address, lat, lng, ldong, adong]
const rows = places.map((p) => [p.id, p.name, p.kind, p.category, p.address, p.lat, p.lng, p.ldong, p.adong]);
const file = path.join(process.cwd(), 'data', 'stores.json');
writeFileSync(file, JSON.stringify({ builtAt: new Date().toISOString(), rows }));
console.log(`${rows.length}곳 저장 → ${file} (${((Date.now() - t) / 1000).toFixed(1)}초)`);
