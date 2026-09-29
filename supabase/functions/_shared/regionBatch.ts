// fetch-market-data / fetch-region-buzz가 ALL_REGIONS(전국 252개 지역)를 한 번의 호출로 전부
// 순회하면 Edge Function 실행 시간 제한(150초)을 넘길 수 있어, region_sync_cursor 테이블에
// 진행 위치를 저장해두고 호출될 때마다 다음 BATCH_SIZE개만 처리한다.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Region } from './regions.ts'

// fetch-market-data가 아파트에 더해 연립다세대(빌라) 매매/전월세까지 조회하게 되면서 지역당
// 실측 처리 시간이 ~0.3초 → ~2.7초로 늘었다(빌라 API 응답이 아파트보다 느림). 50개 기준으로는
// 150초 실행 제한에 거의 다 채워 위험했던 것을 실측 후 30개로 낮춰 여유를 확보했었다.
//
// 이후 전세가율 계산을 calculate-jeonse-ratio와 동일한 로직으로 통일하면서(_shared/
// jeonseRatio.ts), 지역당 MOLIT API 호출 수가 4콜(1개월×4엔드포인트)에서 최대 24콜(6개월×
// 4엔드포인트, 표본 부족으로 6개월 폴백되는 지역)까지 늘 수 있어 30 → 10으로 보수적으로
// 낮췄었다. 이후 BATCH_SIZE=10으로 4회 실측한 durationMs가 11558~16661ms — 최악값 기준으로도
// 지역당 ~1,666ms이다.
//
// 실제 실행 경로(pg_cron)의 진짜 상한은 Edge Function 자체 실행 제한(150초)이 아니라, cron
// job이 net.http_post에 준 timeout_milliseconds=120000(120초)이다 — 이 안에 응답이 안 오면
// 함수가 끝까지 돌아도 pg_cron 쪽에서는 실패로 기록된다(20260914021910_fix_cron_urls_for_
// zipup_plus.sql 참고). 그래서 여유는 150초가 아니라 120초 기준으로 잡아야 한다.
//
// 최악값(1,666ms/지역)을 그대로 선형 확장하면 50개 = 83,305ms(~83.3초) — 120초 대비 약 36.7초
// (30%) 여유가 남는다고 보고 30 → 50으로 올렸었다.
//
// 그런데 BATCH_SIZE=50 실전 실행에서 MOLIT API가 LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_
// SECOND_EXCEEDS_ERROR(429)를 대량 반환해 지역당 최대 24콜(4엔드포인트×6개월)이 짧은 시간에
// 몰린 게 원인으로 드러났다 — _shared/jeonseRatio.ts에 전역 스로틀(동시 3콜, 요청 간 최소
// 150ms)과 429 1회 재시도를 추가했다. 스로틀 적용 후 같은 BATCH_SIZE=50(140~189 구간)으로
// 재실측한 durationMs가 146,924ms(~147초) — 120초 한도를 이미 초과했다. 스로틀링 자체가
// 지역당 처리 시간을 늘렸기 때문에(위 83.3초 추정치는 스로틀링 없는 상태 기준이라 무효),
// 50 → 20으로 다시 낮춘다.
//
// 평균 2,938ms/지역(146,924ms ÷ 50)으로 계산하면 20개 ≈ 58,760ms(~58.8초) — 120초 대비 약
// 61.2초(51%) 여유. 이번 실측치도 표본이 1회뿐이고, 같은 재테스트에서 "에러 없이 빈 결과만
// 반환"되던 게이트웨이 레벨 오류를 제대로 던지도록 고쳤기 때문에(위 fetchItemsOnce의
// response 형태 체크 참고) 앞으로는 재시도 대기(1.5초)가 더 자주 끼어들어 지역당 시간이 더
// 늘어날 수도 있다. durationMs를 몇 번 더 확인하고 나서 조정할 것 — 지금은 안전 마진을
// 넉넉히 두는 쪽을 택한다.
export const BATCH_SIZE = 20

export interface RegionBatch {
  regions: Region[]
  batchStartIndex: number
  totalRegions: number
}

/**
 * region_sync_cursor에서 syncName의 진행 위치를 읽어 다음 배치를 반환하고, 커서를 그만큼
 * 전진시킨다. cycle_date가 오늘(UTC)과 다르면 next_index를 0으로 리셋해 새로 처음부터
 * 순회를 시작한다. 이미 오늘 순회가 끝났다면(next_index >= 전체 지역 수) 빈 배치를 반환하므로
 * 남은 호출들은 그냥 아무 일도 하지 않고 끝난다.
 */
export async function takeNextBatch(
  supabase: SupabaseClient,
  syncName: string,
  allRegions: Region[],
): Promise<RegionBatch> {
  const today = new Date().toISOString().slice(0, 10) // pg_cron 스케줄과 동일한 UTC 기준 날짜

  const { data: cursor, error } = await supabase
    .from('region_sync_cursor')
    .select('next_index, cycle_date')
    .eq('sync_name', syncName)
    .maybeSingle()

  if (error) throw error

  const isNewCycle = !cursor || cursor.cycle_date !== today
  const startIndex = isNewCycle ? 0 : cursor.next_index
  const batch = allRegions.slice(startIndex, startIndex + BATCH_SIZE)
  const nextIndex = startIndex + batch.length

  const { error: upsertError } = await supabase
    .from('region_sync_cursor')
    .upsert({ sync_name: syncName, next_index: nextIndex, cycle_date: today }, { onConflict: 'sync_name' })

  if (upsertError) throw upsertError

  return { regions: batch, batchStartIndex: startIndex, totalRegions: allRegions.length }
}
