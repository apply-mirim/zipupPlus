// Supabase Edge Function: fetch-market-data
// Pulls 아파트 AND 연립다세대(빌라) 매매(trade)/전월세(rent) real-transaction data from the
// MOLIT (국토교통부) API for a batch of regions from `_shared/regions.ts` (전국 252개 지역),
// computes 평균 매매가/전세가/전세가율 for each housing type, and upserts the results into
// `region_stats`. 빌라는 시세가 불투명해 실제 전세사기 위험이 훨씬 크므로, risk_score 계산에서는
// 아파트보다 빌라 전세가율에 더 큰 가중치를 준다 — see _shared/riskScore.ts.
//
// 실거래가 조회/전세가율 계산은 _shared/jeonseRatio.ts를 쓴다 — calculate-jeonse-ratio와 동일한
// 로직(전용면적 구간별 가중평균, 최근 3개월→표본 부족 시 6개월 폴백)을 공유한다. 예전에는 이
// 함수만 지난달 한 달치를 단순 평균 내서 매매/전세 표본의 평형 구성이 다를 때(예: 매매는 대형,
// 전세는 소형 위주) 전세가율이 왜곡되는 문제가 있었다(서초구에서 실측 확인).
//
// 252개 지역을 한 번에 순회하면 Edge Function 실행 시간 제한(150초)을 넘기므로, 매 호출마다
// region_sync_cursor에 저장된 위치부터 BATCH_SIZE개만 처리한다 — see _shared/regionBatch.ts.
// pg_cron이 18~20시(UTC) 사이 20분 간격으로 하루 9번 호출해 전체를 순회한다 — see
// supabase/migrations/*_batch_region_stats_cron.sql. Not called from the frontend.
//
// IMPORTANT: 지역당 API 호출량이 예전(1개월×4엔드포인트=4콜)보다 최대 6배(6개월×4엔드포인트=
// 24콜, 표본 부족해 6개월로 폴백되는 지역)까지 늘었다 — BATCH_SIZE를 30에서 크게 낮췄다
// (_shared/regionBatch.ts 참고). 실제 실행 시간은 매 실행마다 이 함수가 반환/기록하는
// durationMs로 확인할 수 있으니, 150초에 여유가 있으면 BATCH_SIZE를 다시 올려도 된다.
//
// IMPORTANT: MOLIT_API_KEY must be the "일반 인증키 (디코딩)" value from data.go.kr, NOT the
// already-URL-encoded one — this code URL-encodes it itself via URLSearchParams.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireCronSecret } from '../_shared/cronAuth.ts'
import { recordJobRun } from '../_shared/jobStatus.ts'
import { fetchRegionMarketData, summarizeAreaWeightedRatio } from '../_shared/jeonseRatio.ts'
import { ALL_REGIONS } from '../_shared/regions.ts'
import { takeNextBatch } from '../_shared/regionBatch.ts'
import { recalculateAllRiskScores } from '../_shared/riskScore.ts'

const JOB_NAME = 'fetch-market-data'

const MOLIT_API_KEY = Deno.env.get('MOLIT_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authError = requireCronSecret(req)
  if (authError) return authError

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  if (!MOLIT_API_KEY) {
    console.error('MOLIT_API_KEY is not set in Supabase Secrets')
    await recordJobRun(supabase, JOB_NAME, { success: false, error: '국토교통부 API 키가 설정되지 않았습니다.' })
    return jsonResponse({ error: '국토교통부 API 키가 설정되지 않았습니다.' }, 500)
  }

  const startedAt = Date.now()

  try {
    const { regions, batchStartIndex, totalRegions } = await takeNextBatch(supabase, 'fetch-market-data', ALL_REGIONS)

    let updated = 0
    let failed = 0
    let villaFailed = 0
    const sampleErrors: { region: string; message: string }[] = []
    const villaSampleErrors: { region: string; message: string }[] = []

    for (const region of regions) {
      try {
        // TODO(debug): "아파트/빌라 실거래 데이터를 가져오지 못함"으로 뭉뚱그려지던 실패 사유를
        // 실제 HTTP 상태/MOLIT API 에러 메시지까지 보이게 하기 위한 임시 수집 — 원인 파악되면
        // errorSink 인자와 아래 상세 로그를 제거할 것.
        const regionErrors: string[] = []
        const { apt, villa } = await fetchRegionMarketData(region.code, MOLIT_API_KEY, 'fetch-market-data', regionErrors)

        const aptRawCount = apt.trade.length + apt.rent.length
        const villaRawCount = villa.trade.length + villa.rent.length

        if (aptRawCount === 0 && villaRawCount === 0) {
          // 아파트/빌라 모두 원시 레코드가 전혀 없으면(6개월 폴백까지 포함) API 자체가 이번엔
          // 응답하지 않았을 가능성이 높다고 보고, 기존에 저장된 값을 null로 덮어쓰지 않도록
          // upsert를 건너뛴다.
          const detail = regionErrors.length > 0 ? regionErrors.join(' | ') : '(에러 없이 빈 결과만 반환됨)'
          console.error(`fetch-market-data: no data at all for ${region.name} (${region.code}) — ${detail}`)
          // TODO(debug): 원인 파악 전까지 표본 개수를 3 → 10으로 늘려 더 많은 실패 사례를 본다.
          if (sampleErrors.length < 10) {
            sampleErrors.push({ region: region.name, message: detail })
          }
          failed++
          continue
        }

        const aptSummary = summarizeAreaWeightedRatio(apt.trade, apt.rent)
        const villaSummary = summarizeAreaWeightedRatio(villa.trade, villa.rent)

        if (villaRawCount === 0) {
          villaFailed++
          if (villaSampleErrors.length < 3) {
            villaSampleErrors.push({ region: region.name, message: '연립다세대 실거래 데이터 없음(6개월 폴백 포함)' })
          }
        }

        const { error } = await supabase
          .from('region_stats')
          .upsert(
            {
              region_code: region.code,
              region_name: region.name,
              avg_sale_price: aptSummary.avgSalePrice,
              avg_jeonse_price: aptSummary.avgJeonsePrice,
              jeonse_ratio: aptSummary.ratio,
              villa_avg_sale_price: villaSummary.avgSalePrice,
              villa_avg_jeonse_price: villaSummary.avgJeonsePrice,
              villa_jeonse_ratio: villaSummary.ratio,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'region_code' },
          )

        if (error) throw error
        updated++
      } catch (err) {
        console.error(`fetch-market-data: failed for ${region.name} (${region.code})`, err)
        if (sampleErrors.length < 3) {
          sampleErrors.push({ region: region.name, message: err instanceof Error ? err.message : String(err) })
        }
        failed++
      }

      // 공공데이터포털 호출량 제한을 배려한 짧은 텀
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    await recalculateAllRiskScores(supabase)

    const summary = {
      batchStartIndex,
      batchSize: regions.length,
      totalRegions,
      updated,
      failed,
      sampleErrors,
      villaFailed,
      villaSampleErrors,
      durationMs: Date.now() - startedAt,
    }
    await recordJobRun(supabase, JOB_NAME, { success: true, result: summary })
    return jsonResponse(summary)
  } catch (err) {
    console.error('fetch-market-data: batch failed', err)
    await recordJobRun(supabase, JOB_NAME, { success: false, error: err instanceof Error ? err.message : String(err) })
    return jsonResponse({ error: '지역 시세 데이터 갱신 중 오류가 발생했습니다.' }, 500)
  }
})
