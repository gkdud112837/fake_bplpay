-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.

create table if not exists public.bplpay_status (
  place_id   text primary key,               -- 식당 ID (상가정보 bizesId 앞에 's')
  status     text not null check (status in ('yes', 'no')),
  name       text,
  address    text,
  lat        double precision,
  lng        double precision,
  updated_at timestamptz not null default now()
);

create index if not exists bplpay_status_lat_lng on public.bplpay_status (lat, lng);

-- 누구나 읽기만 가능 (지도 표시 + 실시간 반영용). 쓰기는 서버(secret 키)만 한다.
alter table public.bplpay_status enable row level security;

drop policy if exists "public read" on public.bplpay_status;
create policy "public read" on public.bplpay_status
  for select to anon, authenticated using (true);

-- 변경 기록 (로그인 없이 쓰는 대신 최소한의 기록만). 공개 읽기 정책 없음 → 대시보드에서만 조회
create table if not exists public.bplpay_log (
  id         bigint generated always as identity primary key,
  place_id   text not null,
  place_name text,
  status     text not null,                  -- yes / no / reset
  client_id  text,                           -- 브라우저별 익명 ID
  ip_hash    text,                           -- IP 해시 앞 16자리 (원본 IP 저장 안 함)
  created_at timestamptz not null default now()
);
create index if not exists bplpay_log_place on public.bplpay_log (place_id, created_at desc);
alter table public.bplpay_log enable row level security;

-- 다른 사용자가 누른 결과가 새로고침 없이 바로 보이도록 실시간 변경 알림 켜기
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bplpay_status'
  ) then
    alter publication supabase_realtime add table public.bplpay_status;
  end if;
end $$;
