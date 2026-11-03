import { GEMINI_KEY, GEMINI_MODEL } from './env.js';
import { areaNames } from './areas.js';

// 자연어 검색어("교동에서 비플페이 되는 국밥집 찾고싶어")를 구획·키워드·상태 필터로 해석한다 (Google Gemini)
export const agentEnabled = Boolean(GEMINI_KEY);

const SYSTEM = `당신은 대구 중구 가게 지도 서비스의 검색 해석기입니다.
사용자의 한국어 문장을 읽고 지도에 띄울 구획과 가게 필터를 JSON으로 돌려줍니다.

[구획 이름 목록 — area는 가능하면 이 중 하나를 그대로 고르세요]
${areaNames().join(', ')}

규칙:
- area: 위 목록에서 사용자가 말한 곳에 가장 맞는 이름. 행정동(성내1동, 남산2동 등)이나 목록에 없는 지명·건물·가게 이름이면 그 이름을 그대로 적습니다. 장소를 전혀 말하지 않았으면 빈 문자열(그러면 중구 전체에서 찾습니다).
- keywords: 사용자가 원하는 음식·업종을 식당 이름이나 업종명에 들어 있을 만한 짧은 단어로 1~5개. 업종명 예: 한식, 백반/한정식, 국/탕/찌개, 김밥/만두/분식, 치킨, 피자, 햄버거, 중식, 일식, 회/스시, 서양식, 카페, 빵/도넛, 주점. 예) 국밥 → ["국밥", "국/탕", "순대"]. 음식 종류를 말하지 않았으면 빈 배열.
- status: 비플페이 "되는/가능한" 곳만 원하면 "yes", "안 되는/불가능한" 곳이면 "no", "아직 확인 안 된" 곳이면 "none", 언급이 없으면 "all".
- kind: 음식점을 찾으면 "food", 카페·커피·디저트면 "cafe", 술집·호프·포차·이자카야 등 주점이면 "bar", 그 밖의 가게(미용실, 옷가게, 약국 등)면 "etc", 정할 수 없으면 "all".
- reply: 무엇을 찾는지 한 문장으로 요약한 친근한 안내 (예: "교동에서 국밥집을 찾아볼게요."). 장소를 알 수 없으면 어느 동네인지 되묻는 문장.`;

// Gemini responseSchema (OpenAPI 스키마 형식)
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    area: { type: 'STRING' },
    keywords: { type: 'ARRAY', items: { type: 'STRING' } },
    status: { type: 'STRING', enum: ['all', 'yes', 'no', 'none'] },
    kind: { type: 'STRING', enum: ['all', 'food', 'cafe', 'bar', 'etc'] },
    reply: { type: 'STRING' },
  },
  required: ['area', 'keywords', 'status', 'kind', 'reply'],
};

export async function interpret(text) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 1024 },
    }),
    signal: AbortSignal.timeout(15000),
  });
  // 무료 한도 초과(429) 등은 호출한 쪽에서 규칙 기반 검색으로 넘어간다
  if (!res.ok) throw new Error(`Gemini API 오류 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const out = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!out) return null;
  const parsed = JSON.parse(out);
  return {
    area: String(parsed.area ?? ''),
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 5) : [],
    status: ['all', 'yes', 'no', 'none'].includes(parsed.status) ? parsed.status : 'all',
    kind: ['all', 'food', 'cafe', 'bar', 'etc'].includes(parsed.kind) ? parsed.kind : 'all',
    reply: String(parsed.reply ?? '').slice(0, 200),
  };
}
