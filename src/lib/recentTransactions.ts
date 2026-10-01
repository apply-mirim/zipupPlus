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
  note?: string
}

async function unwrapFunctionsError(error: NonNullable<Awaited<ReturnType<typeof supabase.functions.invoke>>['error']>): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const parsed = await error.context.json().catch(() => null)
    return new Error(parsed?.error ?? error.message)
  }
  return new Error(error.message)
}

/** get-recent-transactions Edge Function을 거쳐 시군구+매물유형의 최근 실거래 개별 건을
 * 최신순으로 가져온다(최대 20건). */
export async function fetchRecentTransactions(sigunguCode: string, propertyType: PropertyType): Promise<RecentTransactionsResponse> {
  const { data, error } = await supabase.functions.invoke('get-recent-transactions', {
    body: { sigunguCode, propertyType },
  })
  if (error) throw await unwrapFunctionsError(error)
  return data as RecentTransactionsResponse
}
