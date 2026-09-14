-- [zipupPlus 포크] fetch-market-data-batch / fetch-region-buzz-batch / sync-news cron job을
-- zipupPlus 프로젝트(skfnfrljlyraamdrwtuy) URL로 재등록한다. 원본 프로젝트
-- (yksrvkofbxordjagazzi) URL이 하드코딩되어 있던 문제를 수정.
--
-- cron.schedule은 동일 job 이름으로 재호출 시 upsert되므로 unschedule은 생략한다.
-- job 이름/스케줄/헤더 구조는 원격(zipup) DB의 cron.job에 실제 등록되어 있던 최종 상태를
-- 그대로 따른다:
--   - fetch-market-data-batch / fetch-region-buzz-batch: 20260717205700_expand_batch_cron_for_villa.sql
--     에서 18-19시(2시간)에서 18-20시(3시간, 9회)로 확장된 스케줄
--   - sync-news: 20260818140000_fix_sync_news_auth.sql에서 x-cron-secret 헤더가 추가된 버전
--     (헤더 없이 배포됐을 때 2026-07-20 이후 6시간마다 401로 조용히 실패했던 이력이 있음)

select cron.schedule(
  'fetch-market-data-batch',
  '*/20 18-20 * * *',
  $$
  select net.http_post(
    url := 'https://skfnfrljlyraamdrwtuy.supabase.co/functions/v1/fetch-market-data',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'fetch-region-buzz-batch',
  '10-50/20 18-20 * * *',
  $$
  select net.http_post(
    url := 'https://skfnfrljlyraamdrwtuy.supabase.co/functions/v1/fetch-region-buzz',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

select cron.schedule(
  'sync-news',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://skfnfrljlyraamdrwtuy.supabase.co/functions/v1/sync-news',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
