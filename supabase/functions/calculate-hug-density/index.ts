// Supabase Edge Function: calculate-hug-density
// 원본 zipup 위험도 공식(전세가율 50% + HUG 채무불이행자 밀도 30% + 뉴스 언급 20%) 중 "HUG
// 채무불이행자 밀도" 부분을 담당한다. hug_defaulters에서 이 시군구에 해당하는 등록 건수를 세고,
// sigungu_population 테이블에서 그 시군구의 총인구수를 조회해 인구 10만명당 등록 건수로
// 정규화한다.
//
// 인구는 행정안전부 도로명별 주민등록 인구 API를 이 함수가 직접 실시간 호출하지 않는다 —
// 그 API가 Supabase Edge Function(Deno Deploy 클라우드 IP) 환경에서는 응답을 주지 않는 문제를
// 확인했다(법제처 API 때와 동일한 IP 기반 접근 제한으로 추정 — 브라우저/로컬 등 일반 ISP IP에서는
// 정상 응답). 그래서 scripts/populate-sigungu-population.mjs를 로컬에서 실행해 전국 시군구
// 인구를 sigungu_population에 미리 채워두고, 이 함수는 그 테이블만 조회한다. 값이 없는
// 시군구는 population을 null로 반환한다(에러를 던지지 않음).
//
// 채무불이행자 카운트는 단순 address ILIKE '%시군구명%'을 쓰지 않는다 — 20260721000003
// 마이그레이션이 지적하듯 "동구" 검색에 "남동구" 주소가 걸리는 식의 부분 문자열 오매칭이
// 생기기 때문. 대신 그 마이그레이션이 만든 hug_defaulter_region_counts() DB 함수(한글 단어
// 경계 정규식으로 이 문제를 이미 막아둔 검증된 로직)를 RPC로 그대로 재사용한다. 시군구코드를
// 특정 못 할 때만(이름이 여러 시/도에 겹칠 때) 같은 단어 경계 기법을 쓰는 정규식 폴백으로 센다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { ALL_REGIONS } from '../_shared/regions.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface HugDensityRequest {
  sigunguName?: string
  // 선택값 — "중구"처럼 여러 시/도에 동일한 시군구명이 있어 이름만으로 지역을 특정할 수
  // 없을 때 명시적으로 넘긴다(5자리 법정동코드 앞자리, calculate-jeonse-ratio의 sigunguCode와 동일).
  sigunguCode?: string
}

interface HugDensityResponse {
  sigungu_name: string
  defaulter_count: number
  population: number | null
  density_per_100k: number | null
}

/** sigunguName만으로 _shared/regions.ts(전국 법정동코드 목록)에서 5자리 시군구코드를 찾는다.
 *  겹치는 이름(중구, 서구 등)은 시/도 접두어가 붙은 이름으로만 구분되므로 이름만으로는 특정할
 *  수 없어 null을 반환한다 — 이 경우 호출자가 sigunguCode를 직접 넘겨야 한다. */
function findUniqueSigunguCode(sigunguName: string): string | null {
  const matches = ALL_REGIONS.filter((r) => r.name === sigunguName || r.name.endsWith(` ${sigunguName}`))
  return matches.length === 1 ? matches[0].code : null
}

/** sigungu_population 캐시 테이블에서 인구를 조회한다. 행이 없으면(아직 populate 스크립트를
 *  안 돌렸거나 그 시군구가 최근 몇 달치 데이터가 없어 스크립트가 건너뛴 경우) null. */
async function fetchSigunguPopulation(sigunguCode: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('sigungu_population')
    .select('population')
    .eq('sigungu_code', sigunguCode)
    .maybeSingle()
  if (error) throw error
  return data?.population ?? null
}

interface RegionDefaulterCount {
  region_code: string
  defaulter_count: number
}

/** hug_defaulters에서 이 시군구에 해당하는 등록 건수를 센다.
 *
 *  sigunguCode가 있으면 이미 검증된 hug_defaulter_region_counts() DB 함수(20260721000003
 *  마이그레이션)를 그대로 재사용한다 — 이 함수는 "동구" 검색에 "남동구" 주소가 잘못 걸리는 것
 *  같은 부분 문자열 오매칭을 한글 단어 경계 정규식으로 막아주는, 이미 검증된 로직이라 여기서
 *  다시 구현하지 않는다.
 *
 *  sigunguCode를 특정할 수 없을 때만(이름이 여러 시/도에 겹쳐서) 같은 단어 경계 기법을 직접
 *  적용한 정규식 폴백을 쓴다. */
async function countDefaultersForSigungu(sigunguCode: string | null, sigunguName: string): Promise<number> {
  if (sigunguCode) {
    const { data, error } = await supabase.rpc('hug_defaulter_region_counts')
    if (error) throw error
    const row = (data as RegionDefaulterCount[] | null)?.find((r) => r.region_code === sigunguCode)
    return row?.defaulter_count ?? 0
  }

  const escaped = sigunguName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = `(^|[^가-힣])${escaped}([^가-힣]|$)`
  const { count, error } = await supabase
    .from('hug_defaulters')
    .select('id', { count: 'exact', head: true })
    .filter('address', 'match', pattern)
  if (error) throw error
  return count ?? 0
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  let body: HugDensityRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  const sigunguName = body.sigunguName?.trim()
  const sigunguCodeInput = body.sigunguCode?.trim()

  if (!sigunguName) {
    return jsonResponse({ error: '시군구명(sigunguName)이 필요합니다.' }, 400)
  }
  if (sigunguCodeInput && !/^\d{5}$/.test(sigunguCodeInput)) {
    return jsonResponse({ error: '5자리 시군구 법정동코드(sigunguCode)가 올바르지 않습니다.' }, 400)
  }

  try {
    // 인구 조회뿐 아니라 채무불이행자 카운트(hug_defaulter_region_counts RPC)에도 쓰이므로
    // 먼저 해석해둔다. 이름이 여러 시/도에 겹쳐 특정 못 하면 null — 이 경우 두 조회 모두
    // 이름 기반 정규식 폴백으로 넘어간다(sigunguCode 자체가 없어도 요청은 계속 처리한다).
    const sigunguCode = sigunguCodeInput ?? findUniqueSigunguCode(sigunguName)
    if (!sigunguCode) {
      console.error(`calculate-hug-density: "${sigunguName}"에 대응하는 시군구코드를 특정할 수 없음(이름 중복 가능성) — 정확도를 높이려면 sigunguCode를 함께 넘겨주세요.`)
    }

    const defaulterCount = await countDefaultersForSigungu(sigunguCode, sigunguName)

    let population: number | null = null
    if (!sigunguCode) {
      // 인구 캐시 테이블도 시군구코드로 조회하므로, 코드를 특정 못 하면 인구는 조회하지 않고
      // defaulter_count만 반환한다.
    } else {
      try {
        population = await fetchSigunguPopulation(sigunguCode)
      } catch (err) {
        // 인구 조회 실패는 전체 요청을 실패시키지 않는다 — defaulter_count만이라도 반환한다.
        console.error('calculate-hug-density: population fetch failed', err)
      }
    }

    const densityPer100k = population && population > 0 ? (defaulterCount / population) * 100000 : null

    const response: HugDensityResponse = {
      sigungu_name: sigunguName,
      defaulter_count: defaulterCount,
      population,
      density_per_100k: densityPer100k,
    }
    return jsonResponse(response)
  } catch (err) {
    console.error('calculate-hug-density failed', err)
    return jsonResponse({ error: 'HUG 위험 시그널 계산 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, 502)
  }
})
