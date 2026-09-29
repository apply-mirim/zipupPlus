// Supabase Edge Function: calculate-jeonse-ratio
// 시군구(법정동코드 앞 5자리, LAWD_CD) 단위로 아파트/빌라(연립다세대) 전세가율을 계산한다.
// 원본 zipup의 위험도 공식(전세가율 50% + HUG 채무불이행자 밀도 30% + 뉴스 언급 20%) 중
// 전세가율 부분만 담당한다. resolve-address가 반환하는 admin_code(법정동코드) 앞 5자리를
// 프론트엔드가 잘라 sigunguCode로 넘기고, sigunguName은 resolve-address의 sigungu 필드를
// 그대로 넘겨받는다 — MOLIT 실거래가 API는 시군구명을 응답에 포함하지 않으므로 DB에 저장할
// 이름은 호출자가 제공해야 한다.
//
// MOLIT API 4종(아파트 매매/전월세, 연립다세대 매매/전월세)은 이 프로젝트의 fetch-market-data
// 함수가 이미 프로덕션에서 사용 중인 것과 동일한 엔드포인트/파라미터를 그대로 재사용한다
// (data.go.kr 공공데이터포털의 국토교통부_아파트매매/전월세 실거래가, 연립다세대매매/전월세
// 실거래가 API — LAWD_CD + DEAL_YMD 조회, XML→JSON 게이트웨이 응답 형식 동일).
//
// 표본 확보 전략: 최근 3개월치를 우선 조회하고, 원시 레코드 합계가 너무 적으면(신도시/소규모
// 시군구 등) 최근 6개월로 기간을 늘려 재시도한다. 캐시는 시군구당 24시간 유지.
//
// 전세가율 계산: 매매 표본과 전세 표본을 단순히 통째로 평균 내 나누면, 두 표본의 평형 구성이
// 다를 때 왜곡된다(예: 서초구에서 매매는 대형 평형이, 전세는 소형 평형이 더 많이 거래되면
// 실제보다 전세가율이 낮게 나온다 — 실측 로그로 확인된 문제). 그래서 전용면적(excluUseAr)
// 기준 3개 구간(60㎡ 이하 / 60~85㎡ / 85㎡ 초과)으로 나눠 구간별로 전세가율을 구하고,
// 구간별 표본 수(매매+전세 건수)를 가중치로 가중평균해 최종 ratio를 낸다. 구간 표본이 너무
// 적으면(매매·전세 각 5건 미만) 그 구간은 가중평균에서 제외한다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const MOLIT_API_KEY = Deno.env.get('MOLIT_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// district_jeonse_ratios는 anon/authenticated에게 insert/update 권한이 없으므로(RLS)
// service_role로만 쓴다.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const APT_TRADE_ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade'
const APT_RENT_ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent'
const VILLA_TRADE_ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade'
const VILLA_RENT_ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
// 면적 구간별 매매/전세 각각 이 건수 미만이면 그 구간은 신뢰도가 낮다고 보고 가중평균에서
// 제외한다(sample_count는 구간과 무관하게 전체 건수를 그대로 채워 반환한다).
const MIN_SAMPLES_FOR_RATIO = 5
// 1차 조회(최근 3개월) 원시 레코드 합계가 이 값 미만이면 6개월로 기간을 늘려 재조회한다.
const MIN_RAW_RECORDS_BEFORE_EXTEND = 20
const INITIAL_LOOKBACK_MONTHS = 3
const EXTENDED_LOOKBACK_MONTHS = 6

// 전용면적(㎡) 구간 — 매매/전세 표본의 평형 구성 차이로 인한 왜곡을 줄이기 위해 구간별로
// 전세가율을 계산한 뒤 가중평균한다. 경계값은 "이하/초과" 기준 그대로: 60㎡는 첫 구간,
// 85㎡는 둘째 구간에 포함된다.
const AREA_BUCKETS: { label: string; max: number }[] = [
  { label: '60㎡ 이하', max: 60 },
  { label: '60㎡ 초과 85㎡ 이하', max: 85 },
  { label: '85㎡ 초과', max: Infinity },
]

function areaBucketIndex(area: number): number {
  if (area <= 60) return 0
  if (area <= 85) return 1
  return 2
}

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

/** 이번 달 i개월 전(previousMonth 기준 1부터 시작)의 YYYYMM. i=1이면 지난달, i=2면 지지난달. */
function monthsAgoYYYYMM(i: number): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const target = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - i, 1))
  const yyyy = target.getUTCFullYear()
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0')
  return `${yyyy}${mm}`
}

/** 이번 달은 신고 건수가 안정되지 않았으므로 "지난달"부터 거꾸로 n개월치를 반환한다. */
function recentMonths(n: number): string[] {
  return Array.from({ length: n }, (_, idx) => monthsAgoYYYYMM(idx + 1))
}

function parseAmount(raw: unknown): number | null {
  if (raw == null) return null
  const cleaned = String(raw).replace(/,/g, '').trim()
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** data.go.kr의 XML→JSON 게이트웨이는 결과를 response.body.items.item으로 감싸며, 단일
 *  객체/배열 차이와 결과 없을 때 빈 문자열이 되는 특이 케이스를 흡수해준다. */
async function fetchItems(endpoint: string, lawdCd: string, dealYmd: string): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    serviceKey: MOLIT_API_KEY!,
    LAWD_CD: lawdCd,
    DEAL_YMD: dealYmd,
    numOfRows: '1000',
    pageNo: '1',
    _type: 'json',
  })

  const res = await fetch(`${endpoint}?${params.toString()}`)
  const rawText = await res.text()

  if (!res.ok) {
    throw new Error(`MOLIT API HTTP ${res.status}: ${rawText.slice(0, 200)}`)
  }

  let json: Record<string, any>
  try {
    json = JSON.parse(rawText)
  } catch {
    throw new Error(`MOLIT API non-JSON response: ${rawText.slice(0, 200)}`)
  }
  // 성공 코드가 '00'이 아니라 '000'인 경우도 있다(다른 data.go.kr API와 다른 체계).
  const resultCode = json?.response?.header?.resultCode
  if (resultCode && !['00', '000'].includes(resultCode)) {
    throw new Error(`MOLIT API error ${resultCode}: ${json?.response?.header?.resultMsg}`)
  }

  const items = json?.response?.body?.items
  if (!items || typeof items === 'string') return []

  const item = items.item
  if (!item) return []
  return Array.isArray(item) ? item : [item]
}

/** 여러 개월치를 한 endpoint에 대해 병렬로 조회해 하나의 배열로 합친다. 한두 달 조회가
 *  실패해도(일시적 오류 등) 나머지 달의 데이터는 살리기 위해 개별 실패를 흡수한다. */
async function fetchItemsForMonths(endpoint: string, lawdCd: string, months: string[]): Promise<Record<string, unknown>[]> {
  const results = await Promise.allSettled(months.map((month) => fetchItems(endpoint, lawdCd, month)))
  const items: Record<string, unknown>[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      items.push(...result.value)
    } else {
      console.error(`calculate-jeonse-ratio: month fetch failed`, result.reason)
    }
  }
  return items
}

interface HousingTypeData {
  trade: Record<string, unknown>[]
  rent: Record<string, unknown>[]
}

async function fetchHousingType(tradeEndpoint: string, rentEndpoint: string, lawdCd: string, months: string[]): Promise<HousingTypeData> {
  const [trade, rent] = await Promise.all([
    fetchItemsForMonths(tradeEndpoint, lawdCd, months),
    fetchItemsForMonths(rentEndpoint, lawdCd, months),
  ])
  return { trade, rent }
}

interface TypeSummary {
  ratio: number | null
  saleCount: number
  jeonseCount: number
}

/** 매매가/전세 보증금을 전용면적 구간별로 나눠 구간별 전세가율을 구하고, 구간별 표본 수
 *  (매매+전세 건수)를 가중치로 가중평균한 최종 ratio를 반환한다. 매매/전세 표본의 평형
 *  구성이 서로 다를 때(예: 매매는 대형, 전세는 소형 위주) 단순 전체 평균으로는 왜곡되는
 *  문제를 줄이기 위함이다. 구간 표본이 매매·전세 각각 MIN_SAMPLES_FOR_RATIO 미만이면 그
 *  구간은 가중평균에서 제외한다. */
function summarizeType(tradeItems: Record<string, unknown>[], rentItems: Record<string, unknown>[]): TypeSummary {
  const salesByBucket: number[][] = AREA_BUCKETS.map(() => [])
  const jeonsesByBucket: number[][] = AREA_BUCKETS.map(() => [])

  for (const item of tradeItems) {
    const price = parseAmount(item.dealAmount)
    const area = parseAmount(item.excluUseAr)
    if (price == null || area == null) continue
    salesByBucket[areaBucketIndex(area)].push(price)
  }

  for (const item of rentItems) {
    if ((parseAmount(item.monthlyRent) ?? 0) !== 0) continue
    const deposit = parseAmount(item.deposit)
    const area = parseAmount(item.excluUseAr)
    if (deposit == null || area == null) continue
    jeonsesByBucket[areaBucketIndex(area)].push(deposit)
  }

  let weightedRatioSum = 0
  let weightTotal = 0
  let saleCount = 0
  let jeonseCount = 0

  for (let i = 0; i < AREA_BUCKETS.length; i++) {
    const sales = salesByBucket[i]
    const jeonses = jeonsesByBucket[i]
    saleCount += sales.length
    jeonseCount += jeonses.length

    const avgSale = mean(sales)
    const avgJeonse = mean(jeonses)
    const qualifies = sales.length >= MIN_SAMPLES_FOR_RATIO && jeonses.length >= MIN_SAMPLES_FOR_RATIO
    const bucketRatio = qualifies && avgSale && avgJeonse ? (avgJeonse / avgSale) * 100 : null

    if (bucketRatio != null) {
      const weight = sales.length + jeonses.length
      weightedRatioSum += bucketRatio * weight
      weightTotal += weight
    }
  }

  const ratio = weightTotal > 0 ? weightedRatioSum / weightTotal : null

  return { ratio, saleCount, jeonseCount }
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

    let months = recentMonths(INITIAL_LOOKBACK_MONTHS)
    let [apt, villa] = await Promise.all([
      fetchHousingType(APT_TRADE_ENDPOINT, APT_RENT_ENDPOINT, sigunguCode, months),
      fetchHousingType(VILLA_TRADE_ENDPOINT, VILLA_RENT_ENDPOINT, sigunguCode, months),
    ])

    let totalRaw = apt.trade.length + apt.rent.length + villa.trade.length + villa.rent.length
    if (totalRaw < MIN_RAW_RECORDS_BEFORE_EXTEND) {
      // 이미 조회한 최근 3개월은 다시 부르지 않고, 그 이전 3개월(4~6개월 전)만 추가로 조회해 합친다.
      const extraMonths = recentMonths(EXTENDED_LOOKBACK_MONTHS).slice(INITIAL_LOOKBACK_MONTHS)
      const [extraApt, extraVilla] = await Promise.all([
        fetchHousingType(APT_TRADE_ENDPOINT, APT_RENT_ENDPOINT, sigunguCode, extraMonths),
        fetchHousingType(VILLA_TRADE_ENDPOINT, VILLA_RENT_ENDPOINT, sigunguCode, extraMonths),
      ])
      apt = { trade: apt.trade.concat(extraApt.trade), rent: apt.rent.concat(extraApt.rent) }
      villa = { trade: villa.trade.concat(extraVilla.trade), rent: villa.rent.concat(extraVilla.rent) }
      months = months.concat(extraMonths)
      totalRaw = apt.trade.length + apt.rent.length + villa.trade.length + villa.rent.length
    }

    if (totalRaw === 0) {
      // 원시 레코드가 하나도 없으면 API 호출 자체가 전부 실패했을 가능성이 높다(월별 실패는
      // fetchItemsForMonths 안에서 삼켜지므로 여기서는 "결과 없음"과 "전부 실패"를 구분하지
      // 않고 사용자에게는 동일하게 안내한다).
      return jsonResponse({ error: '국토교통부 실거래가 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해주세요.' }, 502)
    }

    const aptSummary = summarizeType(apt.trade, apt.rent)
    const villaSummary = summarizeType(villa.trade, villa.rent)
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
