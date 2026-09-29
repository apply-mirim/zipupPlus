// Supabase Edge Function: search-address
// 사용자가 검색창에 타이핑할 때 쓰는 주소 자동완성 함수. 브이월드(Vworld) 검색 API(주소 검색,
// type=address)를 이 함수를 통해서만 호출하게 해서 프론트엔드에 VWORLD_API_KEY가 노출되지
// 않도록 한다. 좌표 변환은 하지 않는다 — 사용자가 후보 중 하나를 고르면 resolve-address가
// 그 최종 주소를 좌표/법정동코드로 변환한다.

import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const VWORLD_API_KEY = Deno.env.get('VWORLD_API_KEY')

const VWORLD_SEARCH_ENDPOINT = 'https://api.vworld.kr/req/search'

interface SearchRequest {
  query?: string
}

interface SearchResponse {
  query: string
  candidates: string[]
}

/** 브이월드 검색 API(type=address, category=road)를 호출해 도로명 주소 후보만 반환한다.
 *  지번(parcel) 주소는 자동완성 후보로는 잘 쓰이지 않아 road만 조회한다. */
async function searchVworldAddresses(query: string): Promise<string[]> {
  const params = new URLSearchParams({
    service: 'search',
    request: 'search',
    version: '2.0',
    crs: 'EPSG:4326',
    size: '10',
    page: '1',
    query,
    type: 'address',
    category: 'road',
    format: 'json',
    errorformat: 'json',
    key: VWORLD_API_KEY!,
  })

  const res = await fetch(`${VWORLD_SEARCH_ENDPOINT}?${params.toString()}`)
  if (!res.ok) {
    throw new Error(`Vworld search API HTTP ${res.status}`)
  }

  const json = await res.json()
  const status = json?.response?.status
  // NOT_FOUND는 그냥 "결과 없음"이지 오류가 아니다.
  if (status === 'NOT_FOUND') return []
  if (status !== 'OK') {
    throw new Error(`Vworld search API status ${status}: ${JSON.stringify(json?.response?.error ?? {}).slice(0, 200)}`)
  }

  const items: Record<string, any>[] = json?.response?.result?.items ?? []
  return items
    .map((item) => item?.address?.road || item?.address?.parcel)
    .filter((addr): addr is string => typeof addr === 'string' && addr.length > 0)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  if (!VWORLD_API_KEY) {
    console.error('VWORLD_API_KEY is not set in Supabase Secrets')
    return jsonResponse({ error: '주소 검색 기능이 설정되지 않았습니다. 관리자에게 문의하세요.' }, 500)
  }

  let body: SearchRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  const query = body.query?.trim()
  if (!query) return jsonResponse({ error: '검색어가 필요합니다.' }, 400)

  try {
    const candidates = await searchVworldAddresses(query)
    const response: SearchResponse = { query, candidates }
    return jsonResponse(response)
  } catch (err) {
    console.error('search-address failed', err)
    return jsonResponse({ error: '주소 검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, 502)
  }
})
