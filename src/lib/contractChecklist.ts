import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export const PROPERTY_TYPES = ['apartment', 'villa', 'officetel', 'oneroom'] as const
export type PropertyType = (typeof PROPERTY_TYPES)[number]

export const DEAL_TYPES = ['jeonse', 'wolse', 'maemae'] as const
export type DealType = (typeof DEAL_TYPES)[number]

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  apartment: '아파트',
  villa: '빌라/연립다세대',
  officetel: '오피스텔',
  oneroom: '원룸/다가구',
}

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  jeonse: '전세',
  wolse: '월세',
  maemae: '매매',
}

export interface ChecklistRelatedTerm {
  term: string
  officialDefinition: string | null
  plainExplanation: string | null
}

export interface ChecklistItem {
  order: number
  title: string
  description: string
  relatedTerm: ChecklistRelatedTerm | null
}

export interface ContractChecklist {
  propertyType: PropertyType
  dealType: DealType
  items: ChecklistItem[]
}

async function unwrapFunctionsError(error: NonNullable<Awaited<ReturnType<typeof supabase.functions.invoke>>['error']>): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const parsed = await error.context.json().catch(() => null)
    return new Error(parsed?.error ?? error.message)
  }
  return new Error(error.message)
}

/** get-contract-checklist Edge Function을 거쳐 매물/거래 유형 조합의 계약 체크리스트를 가져온다. */
export async function fetchContractChecklist(propertyType: PropertyType, dealType: DealType): Promise<ContractChecklist> {
  const { data, error } = await supabase.functions.invoke('get-contract-checklist', {
    body: { propertyType, dealType },
  })
  if (error) throw await unwrapFunctionsError(error)
  return data as ContractChecklist
}
