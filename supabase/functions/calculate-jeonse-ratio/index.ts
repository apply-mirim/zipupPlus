// Supabase Edge Function: calculate-jeonse-ratio
// 시군구(법정동코드 앞 5자리, LAWD_CD) 단위로 아파트/빌라(연립다세대) 전세가율을 계산한다.
// 원본 zipup의 위험도 공식(전세가율 50% + HUG 채무불이행자 밀도 30% + 뉴스 언급 20%) 중
// 전세가율 부분만 담당한다. resolve-address가 반환하는 admin_code(법정동코드) 앞 5자리를
// 프론트엔드가 잘라 sigunguCode로 넘기고, sigunguName은 resolve-address의 sigungu 필드를
// 그대로 넘겨받는다 — MOLIT 실거래가 API는 시군구명을 응답에 포함하지 않으므로 DB에 저장할
// 이름은 호출자가 제공해야 한다.
//
// 실거래가 조회/전세가율 계산(전용면적 구간별 가중평균, 3개월→6개월 폴백) 로직은
// _shared/jeonseRatio.ts에 있다 — fetch-market-data(전국 배치 갱신)와 동일한 로직을 공유한다.
// 여기서는 캐시(district_jeonse_ratios, 24시간 TTL) 조회/저장만 다룬다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { fetchRegionMarketData, summarizeAreaWeightedRatio } from '../_shared/jeonseRatio.ts'

const MOLIT_API_KEY = Deno.env.get('MOLIT_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// district_jeonse_ratios는 anon/authenticated에게 insert/update 권한이 없으므로(RLS)
// service_role로만 쓴다.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const CACHE_TTL_MS = 24 * 60 * 60 * 1000

interface CalculateRequest {
  sigunguCode?: string
  sigunguName?: string
}

interface DistrictRow {
  sigungu_code: string
  sigungu_name: string
  apartment_ratio: number | null
  villa_ratio: number | null
  sample_count: number | null
  updated_at: string
}

interface CalculateResponse {
  sigungu_code: string
  sigungu_name: string
  apartment_ratio: number | null
  villa_ratio: number | null
  sample_count: number | null
  updated_at: string
}

function toResponse(row: DistrictRow): CalculateResponse {
  return {
    sigungu_code: row.sigungu_code,
    sigungu_name: row.sigungu_name,
    apartment_ratio: row.apartment_ratio,
    villa_ratio: row.villa_ratio,
    sample_count: row.sample_count,
    updated_at: row.updated_at,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  if (!MOLIT_API_KEY) {
    console.error('MOLIT_API_KEY is not set in Supabase Secrets')
    return jsonResponse({ error: '전세가율 계산 기능이 설정되지 않았습니다. 관리자에게 문의하세요.' }, 500)
  }

  let body: CalculateRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  const sigunguCode = body.sigunguCode?.trim()
  const sigunguName = body.sigunguName?.trim()

  if (!sigunguCode || !/^\d{5}$/.test(sigunguCode)) {
    return jsonResponse({ error: '5자리 시군구 법정동코드(sigunguCode)가 필요합니다.' }, 400)
  }

  try {
    const { data: cached, error: cacheError } = await supabase
      .from('district_jeonse_ratios')
      .select('sigungu_code, sigungu_name, apartment_ratio, villa_ratio, sample_count, updated_at')
      .eq('sigungu_code', sigunguCode)
      .maybeSingle()
    if (cacheError) throw cacheError

    if (cached) {
      const ageMs = Date.now() - new Date(cached.updated_at).getTime()
      if (ageMs < CACHE_TTL_MS) {
        return jsonResponse(toResponse(cached as DistrictRow))
      }
    }

    // 캐시가 없거나(최초 조회) 오래됐으면 새로 계산한다 — 이 경우 DB에 upsert할 이름이 필요하다.
    if (!sigunguName) {
      return jsonResponse({ error: '캐시가 없어 새로 계산해야 하는데 시군구명(sigunguName)이 없습니다.' }, 400)
    }

    const { apt, villa } = await fetchRegionMarketData(sigunguCode, MOLIT_API_KEY, 'calculate-jeonse-ratio')
    const totalRaw = apt.trade.length + apt.rent.length + villa.trade.length + villa.rent.length

    if (totalRaw === 0) {
      // 원시 레코드가 하나도 없으면 API 호출 자체가 전부 실패했을 가능성이 높다(월별 실패는
      // fetchItemsForMonths 안에서 삼켜지므로 여기서는 "결과 없음"과 "전부 실패"를 구분하지
      // 않고 사용자에게는 동일하게 안내한다).
      return jsonResponse({ error: '국토교통부 실거래가 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.' }, 502)
    }

    const aptSummary = summarizeAreaWeightedRatio(apt.trade, apt.rent)
    const villaSummary = summarizeAreaWeightedRatio(villa.trade, villa.rent)
    const sampleCount = aptSummary.saleCount + aptSummary.jeonseCount + villaSummary.saleCount + villaSummary.jeonseCount

    const newRow: DistrictRow = {
      sigungu_code: sigunguCode,
      sigungu_name: sigunguName,
      apartment_ratio: aptSummary.ratio,
      villa_ratio: villaSummary.ratio,
      sample_count: sampleCount,
      updated_at: new Date().toISOString(),
    }

    const { error: upsertError } = await supabase
      .from('district_jeonse_ratios')
      .upsert(newRow, { onConflict: 'sigungu_code' })
    if (upsertError) console.error('district_jeonse_ratios upsert error', upsertError)

    return jsonResponse(toResponse(newRow))
  } catch (err) {
    console.error('calculate-jeonse-ratio failed', err)
    return jsonResponse({ error: '전세가율 계산 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, 502)
  }
})
