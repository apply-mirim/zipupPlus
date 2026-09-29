-- resolve-address Edge Function이 브이월드(Vworld) 지오코더 API 호출 결과를 캐싱하는 테이블.
-- 같은 주소를 다시 조회할 때 API 호출 없이 바로 반환하기 위함(속도 + 브이월드 호출량 절약).
create table if not exists public.resolved_addresses (
  id uuid primary key default gen_random_uuid(),
  -- resolve-address가 upsert 없이 "캐시 조회 → 없으면 insert" 순서로 동작하므로 유니크 제약이
  -- 동시 요청 시 중복 insert를 막아준다(원할 시 온컨플릭트 처리도 가능).
  input_address text not null unique,
  lat numeric not null,
  lng numeric not null,
  admin_code text not null,
  sido text,
  sigungu text,
  eupmyeondong text,
  resolved_at timestamptz default now()
);

alter table public.resolved_addresses enable row level security;

-- 좌표/법정동코드 자체는 민감하지 않으므로 legal_terms/legal_provisions와 동일하게 읽기는 공개.
create policy "Anyone can read resolved addresses"
  on public.resolved_addresses
  for select
  to anon, authenticated
  using (true);

-- 쓰기는 resolve-address Edge Function이 service_role로만 수행한다.
revoke insert, update, delete, truncate on public.resolved_addresses from anon, authenticated;
