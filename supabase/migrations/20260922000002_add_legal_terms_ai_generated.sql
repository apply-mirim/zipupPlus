-- search-legal-terms 재설계(legal_terms/legal_provisions DB + Gemini 기반 용어 검색)를 위해,
-- 이 함수가 스스로 생성해 캐싱한 항목과 사람이 직접 시드한 항목(20260903000000/20260906000000)을
-- 구분하는 컬럼을 추가한다. 프론트가 "AI가 생성한 설명이에요" 배지를 표시할 때 이 값을 쓴다.
alter table public.legal_terms
  add column if not exists ai_generated boolean not null default false;

comment on column public.legal_terms.ai_generated is
  '이 행이 search-legal-terms 함수가 Gemini로 생성해 자동 저장한 것이면 true. 사람이 직접 시드한 기존 21개 용어는 false(기본값).';
