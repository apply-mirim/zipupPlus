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

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { fetchRegionMarketData, parseAmount } from '../_shared/jeonseRatio.ts'

const MOLIT_API_KEY = Deno.env.get('MOLIT_API_KEY')

const VALID_PROPERTY_TYPES = ['apartment', 'villa', 'officetel', 'oneroom'] as const
type PropertyType = (typeof VALID_PROPERTY_TYPES)[number]

const MAX_TRANSACTIONS = 20

interface TransactionsRequest {
  sigunguCode?: string
  adminCode?: string
  propertyType?: string
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
  note?: string
}

function dealDateKey(item: Record<string, unknown>): string {
  const year = String(item.dealYear ?? '0000').padStart(4, '0')
  const month = String(item.dealMonth ?? '00').padStart(2, '0')
  const day = String(item.dealDay ?? '01').padStart(2, '0')
  return `${year}${month}${day}`
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
      note: '오피스텔 실거래가는 아직 지원하지 않습니다(국토교통부 오피스텔 전용 API 미연동).',
    } satisfies TransactionsResponse)
  }

  try {
    const { apt, villa } = await fetchRegionMarketData(sigunguCode, MOLIT_API_KEY, 'get-recent-transactions')
    // oneroom(원룸)은 MOLIT에 별도 카테고리가 없어 연립다세대(빌라) API로 근사한다.
    const housing = propertyType === 'apartment' ? apt : villa
    const buildingNameField = propertyType === 'apartment' ? 'aptNm' : 'mhouseNm'

    const withKeys = [
      ...housing.trade.map((item) => ({ item, key: dealDateKey(item), kind: '매매' as const })),
      ...housing.rent.map((item) => ({ item, key: dealDateKey(item), kind: '전월세' as const })),
    ]
    withKeys.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0)) // 최신순(내림차순)

    const topTransactions = withKeys
      .slice(0, MAX_TRANSACTIONS)
      .map(({ item, kind }) => toTransaction(item, buildingNameField, kind))

    const response: TransactionsResponse = {
      sigunguCode,
      propertyType,
      transactions: topTransactions,
    }
    if (topTransactions.length === 0) {
      response.note = '최근 6개월간 조회된 실거래가가 없습니다.'
    }
    return jsonResponse(response)
  } catch (err) {
    console.error('get-recent-transactions failed', err)
    return jsonResponse({ error: '실거래가 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, 502)
  }
})
