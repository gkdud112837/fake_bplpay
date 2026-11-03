import { adminArea, areaFromDongs, candidates, dongOf, exactArea, geocodeArea, looseArea } from '../lib/areas.js';
import { allStores } from '../lib/stores.js';
import { agentEnabled, interpret } from '../lib/agent.js';
import { placesIn } from '../lib/places.js';
import { statusesIn } from '../lib/status.js';
import { SOURCE_NAME } from '../lib/env.js';

const error = (status, message) => Response.json({ error: message }, { status });
const norm = (s) => s.replace(/\s+/g, '');

// 찾은 가게들이 있는 법정동을 구획으로 삼는다
const areaAround = (name, desc, stores) =>
  areaFromDongs(name, stores.map((p) => dongOf(p.lat, p.lng)).filter(Boolean), desc, 'store');

// 가게 이름에 검색어가 들어간 곳
function storesByName(text, all) {
  for (const c of candidates(text)) {
    if (c.length < 2) continue;
    const hits = all.filter((p) => norm(p.name).includes(c));
    if (hits.length) return hits;
  }
  return [];
}

const storesByKeywords = (keywords, all) => {
  const kws = keywords.map(norm).filter(Boolean);
  return all.filter((p) => kws.some((k) => norm(`${p.name}${p.category}`).includes(k)));
};

// 구획 이름 → 행정동 → 가게 이름 순서로 찾는다
function resolveName(text, all) {
  const area = exactArea(text) ?? adminArea(text, all);
  if (area) return { area };
  const stores = storesByName(text, all);
  if (stores.length) return { area: areaAround(`'${text.trim()}' 가게 검색`, `가게 이름에 '${text.trim()}'이(가) 들어간 곳`, stores), stores };
  return null;
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const q = (params.get('q') || '').trim().slice(0, 200);
  if (!q) return error(400, '동네, 지명, 가게 이름이나 찾고 싶은 것을 입력하세요.');

  let intent = { area: '', keywords: [], status: 'all', kind: 'all', reply: '' };
  // 중구 전체 가게 색인 — 가게 이름·행정동 검색용
  let all = null;
  const loadAll = async () => (all ??= await allStores());

  // 1) 구획 이름을 정확히 입력했으면 바로 (가장 빠름)
  let found = exactArea(q) ? { area: exactArea(q) } : null;
  // 2) 행정동·가게 이름
  found ??= resolveName(q, await loadAll());

  // 3) 문장이면 AI 에이전트가 해석
  if (!found && agentEnabled) {
    try {
      intent = (await interpret(q)) ?? intent;
    } catch (err) {
      console.error('agent error:', err);
    }
    if (intent.area) {
      found = resolveName(intent.area, await loadAll()) ?? (looseArea(intent.area) && { area: looseArea(intent.area) });
    } else if (intent.keywords.length) {
      const stores = storesByKeywords(intent.keywords, await loadAll());
      if (stores.length) found = { area: areaAround(`중구 전체 '${intent.keywords[0]}'`, '대구 중구 전체 검색', stores), stores };
    }
    if (!found && !intent.area) return error(404, intent.reply || '어느 동네에서 찾을지 알려주세요. 예: "교동에서 국밥 찾고싶어"');
  }

  // 4) 부분 일치 → 지명 위치 검색
  const target = intent.area || q;
  if (!found) {
    const area = looseArea(target) ?? (await geocodeArea(target)) ?? (await geocodeArea(candidates(target).at(-1)));
    if (area) found = { area };
  }
  if (!found) return error(404, `'${target}'을(를) 대구 중구에서 찾지 못했습니다. 동네, 지명, 가게 이름으로 다시 입력해 보세요.`);

  const { area } = found;
  const [places, statuses] = await Promise.all([
    found.stores ?? placesIn(area),
    // 상태 DB가 잠시 안 돼도 가게 검색은 보여준다
    statusesIn(area.bbox).catch((err) => {
      console.error('status load error:', err.message);
      return {};
    }),
  ]);

  let matched = places;
  let note = '';
  if (!found.stores && intent.keywords.length) {
    matched = storesByKeywords(intent.keywords, places);
    if (!matched.length) {
      matched = places;
      note = `'${intent.keywords.join(', ')}'에 맞는 가게가 없어 전체 가게를 보여드려요.`;
    }
  }
  if (found.stores && !intent.reply) note = `가게 ${found.stores.length}곳을 찾았어요.`;

  return Response.json({
    query: q,
    sourceName: SOURCE_NAME,
    area,
    // 가게가 하나만 나오면 지도에서 바로 그 가게를 열어준다
    focusId: matched.length === 1 ? matched[0].id : null,
    intent: { keywords: intent.keywords, status: intent.status, kind: intent.kind, reply: [intent.reply, note].filter(Boolean).join(' ') },
    places: matched.map(({ ldong, adong, ...p }) => ({ ...p, status: statuses[p.id] ?? null })),
  });
}
