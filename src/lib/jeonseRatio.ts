import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface DistrictJeonseRatio {
  sigungu_code: string
  sigungu_name: string
  apartment_ratio: number | null
  villa_ratio: number | null
  sample_count: number | null
  updated_at: string
}

async function unwrapFunctionsError(error: NonNullable<Awaited<ReturnType<typeof supabase.functions.invoke>>['error']>): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const parsed = await error.context.json().catch(() => null)
    return new Error(parsed?.error ?? error.message)
  }
  return new Error(error.message)
}

/** calculate-jeonse-ratio Edge Function을 거쳐 시군구의 아파트/빌라 전세가율을 가져온다
 * (24시간 캐시, 캐시 미스면 MOLIT 실거래가를 새로 계산). */
export async function fetchDistrictJeonseRatio(sigunguCode: string, sigunguName: string): Promise<DistrictJeonseRatio> {
  const { data, error } = await supabase.functions.invoke('calculate-jeonse-ratio', {
    body: { sigunguCode, sigunguName },
  })
  if (error) throw await unwrapFunctionsError(error)
  return data as DistrictJeonseRatio
}
