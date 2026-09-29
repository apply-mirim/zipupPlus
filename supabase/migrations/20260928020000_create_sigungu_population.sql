-- 행정안전부 도로명별 주민등록 인구 API가 Supabase Edge Function(Deno Deploy) 환경에서는 응답을
-- 주지 않는 문제(법제처 API 때와 동일한 IP 기반 접근 제한으로 추정 — 브라우저/로컬 등 일반 ISP
-- IP에서는 정상 응답)가 확인되어, calculate-hug-density가 실시간으로 그 API를 호출하는 대신
-- 로컬에서 미리 채워 넣은 이 테이블을 조회하는 방식으로 바꿨다. 데이터는
-- scripts/populate-sigungu-population.mjs로 채운다(로컬/GitHub Actions에서 실행).
create table if not exists public.sigungu_population (
  id uuid primary key default gen_random_uuid(),
  sigungu_code text not null unique,
  sigungu_name text,
  population int,
  updated_at timestamptz default now()
);

alter table public.sigungu_population enable row level security;

-- 인구수 자체는 민감하지 않으므로 다른 캐시 테이블들과 동일하게 읽기는 공개.
create policy "Anyone can read sigungu population"
  on public.sigungu_population
  for select
  to anon, authenticated
  using (true);

-- 쓰기는 populate-sigungu-population.mjs가 service_role로만 수행한다.
revoke insert, update, delete, truncate on public.sigungu_population from anon, authenticated;
