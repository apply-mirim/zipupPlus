import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { PropertyType } from './contractChecklist'

export type TransactionDealType = '매매' | '전세' | '월세'

export interface Transaction {
  buildingName: string
  exclusiveArea: number | null
  dealYearMonth: string
  dealType: TransactionDealType
  price: number | null
  monthlyRent: number | null
}

export interface RecentTransactionsResponse {
  sigunguCode: string
  propertyType: PropertyType
  transactions: Transaction[]
  /** true면 eupmyeondong 범위에 거래가 너무 적어 시군구 전체로 넓혀서 반환했다는 뜻. */
  expandedToSigungu: boolean
  /** 실제로 MOLIT에 조회한 기간(YYYYMM, 포함). */
  fromYm?: string
  toYm?: string
  /** includeLast30DaysCount: true로 요청했을 때만 채워진다. transactions는 최대 20건으로
   * 잘리지만 이 값은 상한 없이 오늘(KST) 기준 정확히 최근 30일 이내 거래를 전부 센 것이다. */
  last30DaysCount?: number
  last30DaysCaveat?: string
  note?: string
}

async function unwrapFunctionsError(error: NonNullable<Awaited<ReturnType<typeof supabase.functions.invoke>>['error']>): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const parsed = await error.context.json().catch(() => null)
    return new Error(parsed?.error ?? error.message)
  }
  return new Error(error.message)
}

export interface FetchRecentTransactionsOptions {
  eupmyeondong?: string | null
  /** true면 서버가 20건 상한과 무관하게 정확한 "최근 30일" 거래 건수(last30DaysCount)도 같이
   * 계산해서 돌려준다 — 비교 화면처럼 그 값이 꼭 필요할 때만 켠다(MOLIT 호출이 늘어남). */
  includeLast30DaysCount?: boolean
}

/** get-recent-transactions Edge Function을 거쳐 시군구+매물유형의 최근 실거래 개별 건을
 * 최신순으로 가져온다(최대 20건). eupmyeondong을 넘기면 먼저 그 동으로 좁혀서 찾고, 거래가
 * 너무 적으면 서버가 시군구 전체로 넓혀서 반환한다(그 경우 expandedToSigungu: true). */
export async function fetchRecentTransactions(
  sigunguCode: string,
  propertyType: PropertyType,
  options: FetchRecentTransactionsOptions = {},
): Promise<RecentTransactionsResponse> {
  const { data, error } = await supabase.functions.invoke('get-recent-transactions', {
    body: {
      sigunguCode,
      propertyType,
      eupmyeondong: options.eupmyeondong ?? undefined,
      includeLast30DaysCount: options.includeLast30DaysCount ?? undefined,
    },
  })
  if (error) throw await unwrapFunctionsError(error)
  return data as RecentTransactionsResponse
}
