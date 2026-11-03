# 비플페이 맛집 지도 (대구 중구)

동 이름·지명·자연어("교동에서 국밥 찾고싶어")를 입력하면 해당 **법정동 구획(폴리곤)** 을 지도에 표시하고,
그 안의 식당을 불러옵니다. 식당을 눌러 **비플페이 가능 / 불가능** 을 기록하면 모든 사용자 지도에 즉시 반영됩니다.

- 가능: 형광 연두 테두리로 빛나는 핀
- 불가능: 회색 핀
- 미확인: 주황 핀
- 같은 식당은 **마지막으로 누른 값**이 남습니다.

## 구성

| 경로 | 역할 |
|---|---|
| `public/` | 화면 (카카오 지도, 키 없으면 OpenStreetMap) |
| `api/` | Vercel 서버리스 함수 (`config`, `search`, `status`) |
| `lib/` | 구획 해석, 식당 수집(소상공인 상가정보), 상태 저장(Supabase), AI 검색 해석(Gemini), 변경 로그 |
| `data/dongs.geojson` | 대구 중구 법정동 57개 경계 (지오서비스 2023-07 배포본, 국가 법정동 경계 기반) |
| `data/areas.json` | 지명 → 법정동 묶음 (예: 중앙로 = 덕산동·남일동·사일동…). 자유롭게 수정 가능 |
| `supabase/schema.sql` | Supabase 테이블·권한·실시간 설정 |
| `server.js` | 로컬 개발 서버 (Vercel과 같은 `api/` 코드 실행) |

## 로컬 실행

```bash
npm install
cp .env.example .env   # 값 채우기
npm run dev            # http://localhost:3000
```

Supabase 값이 비어 있으면 `data/bplpay.json` 에 저장합니다(로컬 전용).

## 1. Supabase 설정

1. [supabase.com](https://supabase.com) 에서 프로젝트 생성
2. **SQL Editor** 에 `supabase/schema.sql` 내용을 붙여넣고 실행
3. **Project Settings → API** 에서 아래 값을 `.env` 와 Vercel 환경변수에 등록
   - `SUPABASE_URL` — Project URL
   - `SUPABASE_PUBLISHABLE_KEY` — Publishable key (또는 기존 anon key)
   - `SUPABASE_SECRET_KEY` — Secret key (또는 기존 service_role key). **절대 공개 금지**

## 2. Vercel 배포

1. 이 저장소를 GitHub에 올리고 Vercel에서 **Import Project** (Framework Preset: Other, 빌드 설정은 `vercel.json` 이 처리)
2. **Settings → Environment Variables** 에 `.env.example` 의 항목을 모두 등록
3. 배포 후 카카오 개발자 콘솔의 **JavaScript SDK 도메인**에 Vercel 주소(`https://<프로젝트>.vercel.app`) 추가

## 환경변수

| 이름 | 필수 | 설명 |
|---|---|---|
| `SBIZ_API_KEY` | ✅ | 공공데이터포털 소상공인 상가(상권)정보 인증키 |
| `KAKAO_JS_KEY` | 지도 | 카카오 JavaScript 키 (도메인 등록 + 카카오맵 사용 설정 필요) |
| `KAKAO_REST_API_KEY` | 선택 | 목록에 없는 지명 위치 검색 |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` | 배포 시 ✅ | 상태 공유 저장 + 실시간 반영 |
| `GEMINI_API_KEY` | 선택 | 자연어 검색 (Google AI Studio 무료 키). 없으면 동네·지명·가게 이름 검색만 동작 |
| `GEMINI_MODEL` | 선택 | 기본 `gemini-3.5-flash-lite` |
| `LOG_SALT` | 권장 | 로그의 IP 해시용 임의 문자열 |

## 변경 로그

로그인 없이 쓰는 대신, 가능/불가능을 누를 때마다 `bplpay_log` 테이블에 가게·상태·익명 기기 ID·IP 해시·시각만 남깁니다(원본 IP 저장 안 함).
장난 입력이 있으면 Supabase 대시보드에서 `client_id` / `ip_hash` 로 찾아 되돌릴 수 있습니다. 로컬에서는 `data/bplpay-log.jsonl` 에 쌓입니다.
