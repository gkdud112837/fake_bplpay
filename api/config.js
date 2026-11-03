import { KAKAO_JS_KEY, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, SOURCE_NAME } from '../lib/env.js';
import { agentEnabled } from '../lib/agent.js';

// 브라우저에 넘기는 값은 모두 공개돼도 되는 키다 (카카오 JS 키는 도메인 제한, Supabase 공개 키는 RLS로 보호)
export function GET() {
  return Response.json({
    kakaoJsKey: KAKAO_JS_KEY,
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_PUBLISHABLE_KEY,
    sourceName: SOURCE_NAME,
    agent: agentEnabled,
    // 화면의 지역 칩
    regions: ['반월당', '중앙로', '동성로', '종로', '교동'],
  });
}
