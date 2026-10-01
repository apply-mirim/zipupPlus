// Supabase Edge Function: get-recent-transactions
// "매물 탐색" 종합 리포트의 "최근 실거래가" 섹션용 — 시군구(법정동코드 앞 5자리) + 매물 유형의
// 개별 실거래 건(건물명/전용면적/거래연월/가격/거래유형)을 최신순으로 반환한다.
//
// MOLIT 호출/월별 폴백(최근 3개월→표본 부족 시 6개월) 로직은 전부 calculate-jeonse-ratio와
// 동일하게 _shared/jeonseRatio.ts의 fetchRegionMarketData를 그대로 재사용한다 — 그 함수가
// 이미 아파트+빌라 매매/전월세 원시 항목을 들고 있는데 calculate-jeonse-ratio는 평균/가중치
// 계산에만 쓰고 버렸던 것을, 여기서는 개별 항목 그대로 꺼내 쓴다(별도 API 재호출 없음).
//
// 건물명 필드는 아파트/연립다세대가 서로 다르다(aptNm vs mhouseNm) — 공식 문서를 못 보고
// 실제 공개 구현 사례로 확인한 값이라 혹시 바뀌면 이 부분부터 의심할 것.
//
// 오피스텔/원룸은 이 프로젝트가 MOLIT 오피스텔 전용 API(아파트/연립다세대와 별도 API 패밀리)를
// 아직 연동하지 않아 지원하지 않는다 — officetel은 빈 배열 + note로 명확히 안내하고, oneroom은
// 연립다세대(빌라) API로 근사한다(원룸이 보통 이 카테고리로 신고되는 경우가 많음).
//
// 읍면동 필터링: 시군구(LAWD_CD) 단위로만 조회하면 속초시처럼 시 전체가 "주변 매물"이라기엔
// 너무 넓게 나온다. MOLIT 응답의 umdNm(법정동명, 아파트/연립다세대 매매·전월세 공통 필드 —
// 공개 구현 사례로 확인)이 resolve-address가 돌려주는 eupmyeondong과 일치하는 건만 먼저
// 추려서 우선 반환하고, 그 동 안에 거래가 MIN_DONG_TRANSACTIONS 미만이면 시군구 전체로
// 되돌아간다(폴백) — 이때 expandedToSigungu를 true로 반환해 프론트가 "범위를 넓혔다"고
// 안내할 수 있게 한다.
//
// last30DaysCount(includeLast30DaysCount: true일 때만 계산): dealDay(계약일, 매매·전월세
// 공통 필드 — 공개 구현 사례로 확인)로 오늘(KST)로부터 정확히 최근 30일 이내 거래만 20건
// 상한 없이 센다. fetchRegionMarketData는 "지난달"부터 조회해 이번 달은 아예 포함하지
// 않으므로(신고 지연 때문에 의도적으로 뺀 설계), 이 집계만을 위해 이번 달 + 30일 전이 속한
// 달을 별도로(narrow) 조회한다 — see countLast30Days. 다만 MOLIT 실거래 신고가 계약 후 30일
// 이내 의무라, 최근 1~2주 거래는 아직 신고가 안 돼 실제보다 적게 집계되는 건 데이터 자체의
// 구조적 지연이라 구현으로 해결할 수 없다 — 프론트에 안내 문구로 노출한다.

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import {
  APT_RENT_ENDPOINT,
  APT_TRADE_ENDPOINT,
  VILLA_RENT_ENDPOINT,
  VILLA_TRADE_ENDPOINT,
  fetchHousingType,
  fetchRegionMarketData,
  parseAmount,
} from '../_shared/jeonseRatio.ts'

const MOLIT_API_KEY = Deno.env.get('MOLIT_API_KEY')

const VALID_PROPERTY_TYPES = ['apartment', 'villa', 'officetel', 'oneroom'] as const
type PropertyType = (typeof VALID_PROPERTY_TYPES)[number]

const MAX_TRANSACTIONS = 20
// 동 단위로 추린 거래가 이 건수 미만이면 "너무 좁다"고 보고 시군구 전체로 폴백한다.
const MIN_DONG_TRANSACTIONS = 5
const LAST_30_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const LAST_30_DAYS_CAVEAT =
  '부동산 실거래는 계약 후 30일 이내 신고 의무가 있어, 최근 1~2주 거래는 아직 신고되지 않아 실제보다 적게 집계될 수 있어요.'

interface TransactionsRequest {
  sigunguCode?: string
  adminCode?: string
  propertyType?: string
  eupmyeondong?: string
  includeLast30DaysCount?: boolean
}

type DealType = '매매' | '전세' | '월세'

interface Transaction {
  buildingName: string
  exclusiveArea: number | null
  dealYearMonth: string
  dealType: DealType
  price: number | null
  monthlyRent: number | null
}

interface TransactionsResponse {
  sigunguCode: string
  propertyType: PropertyType
  transactions: Transaction[]
  /** true면 eupmyeondong 범위에 거래가 너무 적어 시군구 전체로 넓혀서 반환했다는 뜻. */
  expandedToSigungu: boolean
  /** 실제로 MOLIT에 조회를 건 기간(YYYYMM) — fetchRegionMarketData가 3개월 또는(표본 부족 시)
   *  6개월까지 늘려 조회한 그 범위 그대로다. officetel처럼 조회 자체를 안 한 경우는 없다. */
  fromYm?: string
  toYm?: string
  /** includeLast30DaysCount: true로 요청했을 때만 채워진다. 20건 상한과 무관하게, 오늘(KST)
   *  기준 정확히 최근 30일 이내 거래 건수를 전부 센 값 — transactions.length와는 다른 수치다. */
  last30DaysCount?: number
  last30DaysCaveat?: string
  note?: string
}

function dealDateKey(item: Record<string, unknown>): string {
  const year = String(item.dealYear ?? '0000').padStart(4, '0')
  const month = String(item.dealMonth ?? '00').padStart(2, '0')
  const day = String(item.dealDay ?? '01').padStart(2, '0')
  return `${year}${month}${day}`
}

function kstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
}

function yyyymm(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** item의 dealYear/dealMonth/dealDay로 실제 날짜를 만든다. 셋 중 하나라도 숫자가 아니면 null
 *  (이론상 거의 없음 — dealDay는 매매/전월세 공통 필드로 확인됨). */
function dealDate(item: Record<string, unknown>): Date | null {
  const year = Number(item.dealYear)
  const month = Number(item.dealMonth)
  const day = Number(item.dealDay)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return new Date(Date.UTC(year, month - 1, day))
}

/** 오늘(KST)로부터 정확히 최근 30일 이내 거래 건수를 MAX_TRANSACTIONS 상한 없이 센다.
 *  fetchRegionMarketData는 이번 달을 아예 조회하지 않으므로(파일 상단 주석 참고), 이 집계만을
 *  위해 이번 달 + 30일 전이 속한 달을 별도로(narrow) 조회한다.
 *
 *  scopeEupmyeondong: 메인 목록(transactions)에서 이미 결정된 범위 그대로 써야 한다 — null이면
 *  (eupmyeondong이 애초에 없었거나, 있었지만 표본이 적어 시군구 전체로 확장된 경우) 시군구
 *  전체로 세고, 값이 있으면 그 동으로만 좁혀 센다. 호출부에서 독립적으로 다시 판단하게 하면
 *  "최근 20건은 동 단위인데 최근 30일 건수는 구 전체" 같은 범위 불일치가 생길 수 있어서,
 *  스코프 결정은 한 곳(메인 목록 필터링)에서만 하고 여기는 그 결정을 그대로 받는다. */
async function countLast30Days(
  propertyType: 'apartment' | 'villa' | 'oneroom',
  sigunguCode: string,
  apiKey: string,
  scopeEupmyeondong: string | null,
): Promise<number> {
  const now = kstNow()
  const thirtyDaysAgo = new Date(now.getTime() - LAST_30_DAYS_MS)
  const months = Array.from(new Set([yyyymm(now), yyyymm(thirtyDaysAgo)]))

  const [tradeEndpoint, rentEndpoint] =
    propertyType === 'apartment' ? [APT_TRADE_ENDPOINT, APT_RENT_ENDPOINT] : [VILLA_TRADE_ENDPOINT, VILLA_RENT_ENDPOINT]

  const { trade, rent } = await fetchHousingType(
    tradeEndpoint,
    rentEndpoint,
    sigunguCode,
    months,
    apiKey,
    'get-recent-transactions:last30d',
  )

  const scopedTrade = scopeEupmyeondong ? trade.filter((item) => item.umdNm === scopeEupmyeondong) : trade
  const scopedRent = scopeEupmyeondong ? rent.filter((item) => item.umdNm === scopeEupmyeondong) : rent

  const cutoff = new Date(Date.UTC(thirtyDaysAgo.getUTCFullYear(), thirtyDaysAgo.getUTCMonth(), thirtyDaysAgo.getUTCDate()))
  const todayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  let count = 0
  for (const item of [...scopedTrade, ...scopedRent]) {
    const date = dealDate(item)
    if (date && date >= cutoff && date <= todayEnd) count++
  }
  return count
}

function toTransaction(item: Record<string, unknown>, buildingNameField: string, dealType: '매매' | '전월세'): Transaction {
  const exclusiveArea = parseAmount(item.excluUseAr)
  const year = String(item.dealYear ?? '').padStart(4, '0')
  const month = String(item.dealMonth ?? '').padStart(2, '0')
  const buildingName = (item[buildingNameField] as string | undefined)?.trim() || '건물명 미제공'

  if (dealType === '매매') {
    return {
      buildingName,
      exclusiveArea,
      dealYearMonth: `${year}-${month}`,
      dealType: '매매',
      price: parseAmount(item.dealAmount),
      monthlyRent: null,
    }
  }

  const monthlyRent = parseAmount(item.monthlyRent) ?? 0
  return {
    buildingName,
    exclusiveArea,
    dealYearMonth: `${year}-${month}`,
    dealType: monthlyRent === 0 ? '전세' : '월세',
    price: parseAmount(item.deposit),
    monthlyRent: monthlyRent === 0 ? null : monthlyRent,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  if (!MOLIT_API_KEY) {
    console.error('MOLIT_API_KEY is not set in Supabase Secrets')
    return jsonResponse({ error: '실거래가 조회 기능이 설정되지 않았습니다. 관리자에게 문의하세요.' }, 500)
  }

  let body: TransactionsRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  const sigunguCode = (body.sigunguCode ?? body.adminCode)?.trim().slice(0, 5)
  const propertyType = body.propertyType as PropertyType | undefined
  const eupmyeondong = body.eupmyeondong?.trim() || null

  if (!sigunguCode || !/^\d{5}$/.test(sigunguCode)) {
    return jsonResponse({ error: '5자리 시군구 법정동코드(sigunguCode 또는 adminCode)가 필요합니다.' }, 400)
  }
  if (!propertyType || !VALID_PROPERTY_TYPES.includes(propertyType)) {
    return jsonResponse({ error: `propertyType은 ${VALID_PROPERTY_TYPES.join(', ')} 중 하나여야 합니다.` }, 400)
  }

  if (propertyType === 'officetel') {
    return jsonResponse({
      sigunguCode,
      propertyType,
      transactions: [],
      expandedToSigungu: false,
      note: '오피스텔 실거래가는 아직 지원하지 않습니다(국토교통부 오피스텔 전용 API 미연동).',
    } satisfies TransactionsResponse)
  }

  try {
    const { apt, villa, months } = await fetchRegionMarketData(sigunguCode, MOLIT_API_KEY, 'get-recent-transactions')
    // months는 "1개월 전, 2개월 전, ..." 순으로 생성되므로(jeonseRatio.ts의 recentMonths) 맨
    // 앞이 가장 최신 달, 맨 뒤가 가장 오래된 달이다 — 폴백으로 6개월까지 늘어도 그 순서가 유지된다.
    const toYm = months[0]
    const fromYm = months[months.length - 1]
    // oneroom(원룸)은 MOLIT에 별도 카테고리가 없어 연립다세대(빌라) API로 근사한다.
    const housing = propertyType === 'apartment' ? apt : villa
    const buildingNameField = propertyType === 'apartment' ? 'aptNm' : 'mhouseNm'

    let trade = housing.trade
    let rent = housing.rent
    let expandedToSigungu = false

    if (eupmyeondong) {
      const dongTrade = trade.filter((item) => item.umdNm === eupmyeondong)
      const dongRent = rent.filter((item) => item.umdNm === eupmyeondong)
      if (dongTrade.length + dongRent.length >= MIN_DONG_TRANSACTIONS) {
        trade = dongTrade
        rent = dongRent
      } else {
        // 동 범위에 거래가 너무 적다 — 시군구 전체(기존 trade/rent)로 그대로 둔다.
        expandedToSigungu = true
      }
    }

    // last30DaysCount도 반드시 같은 스코프 결정을 따른다(위에서 이미 정해진 expandedToSigungu
    // 그대로) — 메인 목록은 동 단위인데 30일 건수만 구 전체인 범위 불일치를 막기 위함.
    const last30DaysCount = body.includeLast30DaysCount
      ? await countLast30Days(propertyType, sigunguCode, MOLIT_API_KEY, expandedToSigungu ? null : eupmyeondong)
      : undefined

    const withKeys = [
      ...trade.map((item) => ({ item, key: dealDateKey(item), kind: '매매' as const })),
      ...rent.map((item) => ({ item, key: dealDateKey(item), kind: '전월세' as const })),
    ]
    withKeys.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0)) // 최신순(내림차순)

    const topTransactions = withKeys
      .slice(0, MAX_TRANSACTIONS)
      .map(({ item, kind }) => toTransaction(item, buildingNameField, kind))

    const response: TransactionsResponse = {
      sigunguCode,
      propertyType,
      transactions: topTransactions,
      expandedToSigungu,
      fromYm,
      toYm,
    }
    if (last30DaysCount != null) {
      response.last30DaysCount = last30DaysCount
      response.last30DaysCaveat = LAST_30_DAYS_CAVEAT
    }
    if (expandedToSigungu) {
      response.note = `${eupmyeondong} 기준으로는 거래가 적어 시군구 전체 범위로 확장했습니다.`
    } else if (topTransactions.length === 0) {
      response.note = '최근 6개월간 조회된 실거래가가 없습니다.'
    }
    return jsonResponse(response)
  } catch (err) {
    console.error('get-recent-transactions failed', err)
    return jsonResponse({ error: '실거래가 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, 502)
  }
})
