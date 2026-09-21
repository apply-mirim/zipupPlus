-- [zipupPlus] 이번 피벗으로 계약서 스캔(analyze-contract)과 마음 상담/심리가드
-- (가스라이팅 탐지, analyze-chat) 기능을 완전히 제거하면서, 두 기능 전용 테이블을 삭제한다.
-- legal_provisions/legal_terms는 용어집(glossary) 기능이 계속 쓰므로 삭제 대상에서 제외한다.

-- pattern_legal_provisions는 contract_risk_patterns/legal_provisions를 참조하는 연결 테이블이라
-- 먼저 삭제한다(cascade로도 안전하지만 의도를 명확히 하기 위해 순서를 맞춘다).
drop table if exists public.pattern_legal_provisions cascade;
drop table if exists public.contract_risk_patterns cascade;
drop table if exists public.pattern_sources cascade;
drop table if exists public.analyses cascade;
drop table if exists public.gaslighting_checks cascade;
