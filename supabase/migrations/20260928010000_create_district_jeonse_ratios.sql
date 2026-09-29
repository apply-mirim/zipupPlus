-- calculate-jeonse-ratio Edge Function이 시군구 단위로 계산한 전세가율을 캐싱하는 테이블.
-- 법정동 단위는 표본(실거래 건수)이 너무 적어 시군구(법정동코드 앞 5자리, LAWD_CD) 단위로
-- 넓게 집계한다. updated_at 기준 24시간 이내면 재계산 없이 그대로 재사용한다.
create table if not exists public.district_jeonse_ratios (
  id uuid primary key default gen_random_uuid(),
  sigungu_code text not null unique,
  sigungu_name text not null,
  apartment_ratio numeric,
  villa_ratio numeric,
  sample_count int,
  updated_at timestamptz default now()
);

alter table public.district_jeonse_ratios enable row level security;

-- 전세가율 자체는 민감하지 않으므로 resolved_addresses/legal_terms와 동일하게 읽기는 공개.
create policy "Anyone can read district jeonse ratios"
  on public.district_jeonse_ratios
  for select
  to anon, authenticated
  using (true);

-- 쓰기는 calculate-jeonse-ratio Edge Function이 service_role로만 수행한다.
revoke insert, update, delete, truncate on public.district_jeonse_ratios from anon, authenticated;
