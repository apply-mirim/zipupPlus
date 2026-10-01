-- "매물 탐색" 종합 리포트에서 사용자가 저장한 매물("내 매물함"). 비교 화면에서 2~3건을 다시
-- 분석(전세가율/안심시그널/실거래가)해서 나란히 보여줄 때 쓴다.
--
-- 중요: 임대인 이름은 개인정보 보호를 위해 이 테이블에 의도적으로 저장하지 않는다(실수로
-- 빠뜨린 게 아님) — 리포트 화면에서 search-hug-defaulter-by-name으로 조회만 하고 끝나며,
-- "이 매물 저장하기" 버튼은 그 조회에 쓰인 임대인 이름을 절대 함께 저장하지 않는다.
create table if not exists public.saved_properties (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  address text not null,
  lat numeric not null,
  lng numeric not null,
  admin_code text not null,
  sigungu_name text not null,
  property_type text not null,
  deal_type text not null,
  deposit_amount bigint,
  monthly_rent bigint,
  created_at timestamptz default now()
);

create index if not exists saved_properties_user_id_idx on public.saved_properties (user_id);

alter table public.saved_properties enable row level security;

-- 본인 소유 행만 조회/추가/삭제 가능 (수정은 요구사항에 없어 정책을 따로 만들지 않음 — update는
-- 기본적으로 막혀 있다).
create policy "Users can read their own saved properties"
  on public.saved_properties
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own saved properties"
  on public.saved_properties
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can delete their own saved properties"
  on public.saved_properties
  for delete
  to authenticated
  using (auth.uid() = user_id);
