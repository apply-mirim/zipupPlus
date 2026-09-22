import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface LiveLegalTermResult {
  query: string
  term: string
  officialDefinition: string | null
  plainExplanation: string | null
  category: string | null
  source: string | null
  relatedProvisionId: number | null
  aiGenerated: boolean
}

export interface LiveLegalTermIrrelevant {
  query: string
  irrelevant: true
  message: string
}

export type LawSearchResponse = LiveLegalTermResult | LiveLegalTermIrrelevant

const CACHE_KEY = 'zipup:lawSearchCache'

function readCache(): Record<string, LawSearchResponse> {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function writeCache(cache: Record<string, LawSearchResponse>) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // storage full/unavailable — caching is just an optimization, safe to skip
  }
}

async function unwrapFunctionsError(error: NonNullable<Awaited<ReturnType<typeof supabase.functions.invoke>>['error']>): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const parsed = await error.context.json().catch(() => null)
    return new Error(parsed?.error ?? error.message)
  }
  return new Error(error.message)
}

/** search-legal-terms Edge Function을 거쳐 legal_terms/legal_provisions DB + Gemini로 용어를
 * 검색한다(2026-09 재설계 — 법제처 API 호출은 더 이상 하지 않는다, 함수 파일 하단 주석 참고).
 * 같은 검색어는 세션 내에서(sessionStorage) 캐싱해 반복 호출을 피한다. */
export async function searchLegalTermsLive(query: string): Promise<LawSearchResponse> {
  const cache = readCache()
  if (cache[query]) return cache[query]

  const { data, error } = await supabase.functions.invoke('search-legal-terms', { body: { query } })
  if (error) throw await unwrapFunctionsError(error)

  const result = data as LawSearchResponse
  cache[query] = result
  writeCache(cache)
  return result
}
