-- sync-legal-terms(법 조문 개정 감지)를 매달 1회 pg_cron으로 등록한다.
-- URL/시크릿 처리 방식은 기존 배치 cron(20260914021910_fix_cron_urls_for_zipup_plus.sql)의
-- zipupPlus 프로젝트 URL + Vault의 cron_secret 재사용 패턴을 그대로 따른다.
--
-- 스케줄 시각 참고: pg_cron의 day-of-month 필드는 Postgres 서버 타임존(UTC) 기준이다.
-- "매달 1일 KST 새벽"을 그대로 맞추려고 UTC 전날 18시대(다른 배치들이 KST 03~05시를
-- 표현할 때 쓰는 방식)를 쓰면, 그 시각은 "전달의 마지막 날" UTC 날짜라서 day-of-month=1로
-- 지정할 수 없다(마지막 날짜는 28~31일로 매달 다름). 그래서 이 job만 UTC 00:10(=KST 09:10,
-- 여전히 1일 안에 들어옴)에 실행되도록 한다 — "새벽"보다는 늦지만 매달 정확히 1일에
-- 실행된다는 보장이 더 중요하다고 판단했다.
select cron.schedule(
  'sync-legal-terms',
  '10 0 1 * *',
  $$
  select net.http_post(
    url := 'https://skfnfrljlyraamdrwtuy.supabase.co/functions/v1/sync-legal-terms',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
