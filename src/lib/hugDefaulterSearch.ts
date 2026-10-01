import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface DefaulterMatch {
  name: string
  sigunguName: string | null
  age: number | null
}

export interface HugDefaulterSearchResult {
  matchCount: number
  matches: DefaulterMatch[]
  warning: string
}

async function unwrapFunctionsError(error: NonNullable<Awaited<ReturnType<typeof supabase.functions.invoke>>['error']>): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const parsed = await error.context.json().catch(() => null)
    return new Error(parsed?.error ?? error.message)
  }
  return new Error(error.message)
}

/** search-hug-defaulter-by-name Edge Function을 거쳐 임대인 이름을 HUG 상습채무불이행자
 * 명단과 대조한다. 응답은 어디에도 저장하지 않고 화면에만 표시한다(동명이인 위험 — 함수
 * 자체 주석 참고). */
export async function searchHugDefaulterByName(name: string): Promise<HugDefaulterSearchResult> {
  const { data, error } = await supabase.functions.invoke('search-hug-defaulter-by-name', {
    body: { name },
  })
  if (error) throw await unwrapFunctionsError(error)
  return data as HugDefaulterSearchResult
}
