export const UA = 'fake-bplpay-map/0.2';

export const KAKAO_KEY = process.env.KAKAO_REST_API_KEY || '';
export const KAKAO_JS_KEY = process.env.KAKAO_JS_KEY || '';
export const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
// 무료 등급에서 쓸 수 있는 Flash-Lite 계열을 기본으로 (https://aistudio.google.com/docs/models)
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
// 로그의 IP는 이 값을 섞어 해시로만 저장한다
export const LOG_SALT = process.env.LOG_SALT || 'bplpay';

// data.go.kr 인증키 — 인코딩 키를 붙여넣어도 동작하도록 한 번 디코딩한다
export const SBIZ_KEY = (() => {
  const k = process.env.SBIZ_API_KEY || '';
  try {
    return k.includes('%') ? decodeURIComponent(k) : k;
  } catch {
    return k;
  }
})();

export const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
// 신규 키(sb_secret_/sb_publishable_)와 기존 키(service_role/anon) 모두 받는다
export const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';

export const SOURCE = SBIZ_KEY ? 'sbiz' : KAKAO_KEY ? 'kakao' : 'osm';
export const SOURCE_NAME = { sbiz: '소상공인시장진흥공단 상가(상권)정보', kakao: '카카오 로컬', osm: 'OpenStreetMap' }[SOURCE];
