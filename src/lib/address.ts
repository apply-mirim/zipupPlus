import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface AddressSearchResponse {
  query: string
  candidates: string[]
}

export interface ResolvedAddress {
  input_address: string
  lat: number
  lng: number
  admin_code: string
  sido: string | null
  sigungu: string | null
  eupmyeondong: string | null
}

async function unwrapFunctionsError(error: NonNullable<Awaited<ReturnType<typeof supabase.functions.invoke>>['error']>): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const parsed = await error.context.json().catch(() => null)
    return new Error(parsed?.error ?? error.message)
  }
  return new Error(error.message)
}

/** search-address Edge Function을 거쳐 브이월드 주소 검색(자동완성) 결과를 가져온다.
 * 브이월드 API 키는 함수 안에만 있고 프론트엔드에는 노출되지 않는다. */
export async function searchAddress(query: string): Promise<AddressSearchResponse> {
  const { data, error } = await supabase.functions.invoke('search-address', { body: { query } })
  if (error) throw await unwrapFunctionsError(error)
  return data as AddressSearchResponse
}

/** resolve-address Edge Function을 거쳐 최종 선택된 주소 1건을 좌표 + 법정동코드로 변환한다.
 * resolved_addresses 캐시에 있으면 브이월드 API 호출 없이 즉시 반환된다. */
export async function resolveAddress(address: string): Promise<ResolvedAddress> {
  const { data, error } = await supabase.functions.invoke('resolve-address', { body: { address } })
  if (error) throw await unwrapFunctionsError(error)
  return data as ResolvedAddress
}
