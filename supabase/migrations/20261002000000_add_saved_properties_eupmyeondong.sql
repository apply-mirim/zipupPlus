-- 저장된 매물도 읍면동 단위로 실거래가를 좁혀 찾을 수 있도록 eupmyeondong을 추가한다.
-- resolve-address가 돌려주는 값을 그대로 저장한다(없을 수도 있어 nullable). 이 컬럼 추가
-- 이전에 저장된 매물은 전부 null이 되는데, 이 경우 get-recent-transactions가 기존과 동일하게
-- 시군구 전체 범위로 조회한다(eupmyeondong 없으면 동 필터링 자체를 안 함).
alter table public.saved_properties
  add column if not exists eupmyeondong text;
