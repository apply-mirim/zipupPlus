// Supabase Edge Function: resolve-address
// 사용자가 검색 후보 중 최종 선택한 주소 1건을 브이월드(Vworld) 지오코더로 좌표 + 법정동코드로
// 변환한다. VWORLD_API_KEY는 Supabase Secrets에만 저장하고 프론트엔드에는 절대 넘기지 않는다.
//
// 동작 순서:
//   1. resolved_addresses에서 input_address로 캐시 조회 — 있으면 API 호출 없이 즉시 반환.
//   2. 없으면 브이월드 지오코더를 type=road(도로명)로 먼저 시도하고, 실패하면 type=parcel(지번)로
//      재시도한다 — 도로명 주소가 없는 오래된 건물/지번만 있는 주소를 위한 폴백.
//   3. 성공하면 resolved_addresses에 insert(다음 조회부터 캐시 히트)하고 결과를 반환한다.
//   4. 둘 다 실패하면 404.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const VWORLD_API_KEY = Deno.env.get('VWORLD_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// resolved_addresses는 anon/authenticated에게 insert 권한이 없으므로(RLS) service_role로만 쓴다.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const VWORLD_GEOCODE_ENDPOINT = 'https://api.vworld.kr/req/address'

type VworldAddressType = 'road' | 'parcel'

interface ResolveRequest {
  address?: string
}

interface ResolvedAddressRow {
  input_address: string
  lat: number
  lng: number
  admin_code: string
  sido: string | null
  sigungu: string | null
  eupmyeondong: string | null
}

interface ResolveResponse {
  input_address: string
  lat: number
  lng: number
  admin_code: string
  sido: string | null
  sigungu: string | null
  eupmyeondong: string | null
}

interface VworldGeocodeResult {
  lat: number
  lng: number
  adminCode: string
  sido: string | null
  sigungu: string | null
  eupmyeondong: string | null
}

function toResponse(row: ResolvedAddressRow): ResolveResponse {
  return {
    input_address: row.input_address,
    lat: row.lat,
    lng: row.lng,
    admin_code: row.admin_code,
    sido: row.sido,
    sigungu: row.sigungu,
    eupmyeondong: row.eupmyeondong,
  }
}

/** 브이월드 getcoord API를 호출한다. 주소를 찾지 못했거나(status !== 'OK') 응답 형식이
 *  기대와 다르면 null을 반환한다(폴백 재시도를 위해 예외 대신 null로 처리). */
async function geocodeWithVworld(address: string, type: VworldAddressType): Promise<VworldGeocodeResult | null> {
  const params = new URLSearchParams({
    service: 'address',
    request: 'getcoord',
    address,
    type,
    format: 'json',
    key: VWORLD_API_KEY!,
  })

  const res = await fetch(`${VWORLD_GEOCODE_ENDPOINT}?${params.toString()}`)
  if (!res.ok) {
    console.error(`Vworld geocoder HTTP ${res.status} (type=${type})`)
    return null
  }

  const json = await res.json()
  const status = json?.response?.status
  if (status !== 'OK') {
    return null
  }

  const point = json?.response?.result?.point
  const structure = json?.response?.refined?.structure
  const lat = point?.y != null ? Number(point.y) : null
  const lng = point?.x != null ? Number(point.x) : null
  // level4L은 도로명(예: "테헤란로")이고, 실제 법정동코드는 level4AC에 들어있다.
  const adminCode = structure?.level4AC

  if (lat == null || !Number.isFinite(lat) || lng == null || !Number.isFinite(lng) || !adminCode) {
    console.error(`Vworld geocoder OK but missing point/admin code (type=${type})`, JSON.stringify(json).slice(0, 300))
    return null
  }

  return {
    lat,
    lng,
    adminCode,
    sido: structure?.level1 ?? null,
    sigungu: structure?.level2 ?? null,
    eupmyeondong: structure?.level4A ?? null,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  if (!VWORLD_API_KEY) {
    console.error('VWORLD_API_KEY is not set in Supabase Secrets')
    return jsonResponse({ error: '주소 변환 기능이 설정되지 않았습니다. 관리자에게 문의하세요.' }, 500)
  }

  let body: ResolveRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  const address = body.address?.trim()
  if (!address) return jsonResponse({ error: '주소가 필요합니다.' }, 400)

  try {
    const { data: cached, error: cacheError } = await supabase
      .from('resolved_addresses')
      .select('input_address, lat, lng, admin_code, sido, sigungu, eupmyeondong')
      .eq('input_address', address)
      .maybeSingle()
    if (cacheError) throw cacheError

    if (cached) {
      return jsonResponse(toResponse(cached as ResolvedAddressRow))
    }

    // 도로명(road) 우선 시도 → 실패하면 지번(parcel)으로 재시도.
    let result = await geocodeWithVworld(address, 'road')
    if (!result) {
      result = await geocodeWithVworld(address, 'parcel')
    }

    if (!result) {
      return jsonResponse({ error: '주소를 찾을 수 없습니다.' }, 404)
    }

    const newRow: ResolvedAddressRow = {
      input_address: address,
      lat: result.lat,
      lng: result.lng,
      admin_code: result.adminCode,
      sido: result.sido,
      sigungu: result.sigungu,
      eupmyeondong: result.eupmyeondong,
    }

    const { error: insertError } = await supabase.from('resolved_addresses').insert(newRow)
    if (insertError) console.error('resolved_addresses insert error', insertError)

    return jsonResponse(toResponse(newRow))
  } catch (err) {
    console.error('resolve-address failed', err)
    return jsonResponse({ error: '주소 변환 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, 502)
  }
})
