-- legal_provisions 원문이 실제 법 개정을 못 따라가는 문제를 감지하기 위한 컬럼 추가.
-- sync-legal-terms 함수(매달 1회 pg_cron)가 법제처 lawjosub API로 원문을 다시 조회해
-- DB의 content와 다르면 needs_review를 true로 표시한다. content 자체를 자동으로 덮어쓰지는
-- 않는다 — 관리자가 원문을 직접 확인한 뒤 수동으로 갱신하고 needs_review를 다시 false로
-- 내리는 것을 전제로 한다.
alter table public.legal_provisions
  add column if not exists needs_review boolean not null default false,
  add column if not exists last_checked_at timestamptz,
  add column if not exists law_id text;

comment on column public.legal_provisions.needs_review is
  '법제처 API 원문과 content가 달라 개정이 의심되는 상태. 관리자 확인 후 수동으로 false로 되돌린다.';
comment on column public.legal_provisions.last_checked_at is
  'sync-legal-terms가 이 조문을 마지막으로 법제처 API에 실제로 조회 시도한 시각(성공/실패 무관). law_id가 없어 스킵된 경우는 갱신되지 않는다.';
comment on column public.legal_provisions.law_id is
  '법제처 법령 ID(예: 건축법=001823). 비어있으면 sync-legal-terms가 해당 행을 스킵한다 — 아직 lawSearch API로 채워 넣지 않았기 때문.';
