import { supabase } from './supabase'

export type RiskLevel = '위험' | '주의' | '안전'

export interface RegionStat {
  region_code: string
  region_name: string
  avg_sale_price: number | null
  avg_jeonse_price: number | null
  jeonse_ratio: number | null
  villa_avg_sale_price: number | null
  villa_avg_jeonse_price: number | null
  villa_jeonse_ratio: number | null
  news_mentions: number | null
  hug_defaulter_count: number | null
  risk_score: number | null
  risk_level: RiskLevel | null
  updated_at: string
}

export async function fetchRegionStats(): Promise<RegionStat[]> {
  const { data, error } = await supabase
    .from('region_stats')
    .select(
      'region_code, region_name, avg_sale_price, avg_jeonse_price, jeonse_ratio, villa_avg_sale_price, villa_avg_jeonse_price, villa_jeonse_ratio, news_mentions, hug_defaulter_count, risk_score, risk_level, updated_at',
    )

  if (error) throw new Error(error.message)
  return data ?? []
}

/** 매물 탐색 리포트의 안심 시그널 뱃지 + 전세가율 비교 기준(avg_sale_price)에 쓴다. 행이 아직
 * 없는 지역(배치 순회가 거기까지 안 간 경우)이면 null. */
export async function fetchRegionStat(regionCode: string): Promise<RegionStat | null> {
  const { data, error } = await supabase
    .from('region_stats')
    .select(
      'region_code, region_name, avg_sale_price, avg_jeonse_price, jeonse_ratio, villa_avg_sale_price, villa_avg_jeonse_price, villa_jeonse_ratio, news_mentions, hug_defaulter_count, risk_score, risk_level, updated_at',
    )
    .eq('region_code', regionCode)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data ?? null
}
