// Supabase Edge Function: search-hug-defaulter-by-name
// "매물 탐색" 종합 리포트의 "임대인 대조" 섹션용 — 사용자가 입력한 임대인 이름을 HUG
// 상습채무불이행자 명단과 대조한다.
//
// 개인정보 처리 관련 의도: 이 함수의 응답(동명이인 매치 목록 등)은 어떤 테이블에도 저장하지
// 않는다 — 호출한 프론트엔드 화면에 그 순간 표시되고 끝이다. 이름 하나만으로는 신원을 확정할
// 수 없어(동명이인 위험) 이 조회 결과를 영구 저장/누적하면 실제로는 무관한 사람에게 누명을
// 씌우는 기록이 쌓일 위험이 있다. 같은 이유로 상세 주소도 반환하지 않고 시군구(구) 단위로만
// 추려서 돌려준다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const SIDO_SUFFIXES = ['특별자치시', '특별자치도', '특별시', '광역시', '도']

interface SearchRequest {
  name?: string
}

interface DefaulterMatch {
  name: string
  sigunguName: string | null
  age: number | null
}

interface SearchResponse {
  matchCount: number
  matches: DefaulterMatch[]
  warning: string
}

interface DefaulterRow {
  name: string
  address: string | null
  age: number | null
}

/** "서울특별시 강남구 ..." / "경기도 수원시 장안구 ..." 같은 주소에서 시/도를 건너뛰고
 *  시군구(구가 있는 시는 "시 구" 묶음까지)만 추출한다. hug_defaulter_region_counts()
 *  마이그레이션의 역방향 버전 — 거기는 지역명으로 주소를 찾고, 여기는 주소에서 지역명을 뽑는다. */
function extractSigunguName(address: string): string | null {
  const tokens = address.trim().split(/\s+/).filter(Boolean)
  let i = 0
  if (tokens[0] && SIDO_SUFFIXES.some((suffix) => tokens[0].endsWith(suffix))) {
    i = 1
  }

  const first = tokens[i]
  if (!first) return null

  if (first.endsWith('시') && tokens[i + 1]?.endsWith('구')) {
    return `${first} ${tokens[i + 1]}`
  }
  if (first.endsWith('시') || first.endsWith('군') || first.endsWith('구')) {
    return first
  }
  return null
}

/** 이름 글자 사이에 공백이 있든 없든 매치되도록(예: "홍 길동" ↔ "홍길동") 글자 사이에 \s*를
 *  끼운 정규식을 만든다. ^...$로 전체 일치만 허용해 다른 사람 이름 안에 우연히 포함되는
 *  부분 일치(예: "민수"가 "김민수현"에 걸리는 경우)를 막는다. */
function buildSpacingTolerantPattern(name: string): string {
  const chars = name.replace(/\s+/g, '').split('')
  const escaped = chars.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return `^${escaped.join('\\s*')}$`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  let body: SearchRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  const name = body.name?.trim()
  if (!name) return jsonResponse({ error: '이름이 필요합니다.' }, 400)

  try {
    // 1차: 공백 차이만 무시한 정확 일치(전체 일치).
    const { data: exactRows, error: exactError } = await supabase
      .from('hug_defaulters')
      .select('name, address, age')
      .filter('name', 'match', buildSpacingTolerantPattern(name))
    if (exactError) throw exactError

    let rows: DefaulterRow[] = exactRows ?? []

    // 정확 일치가 하나도 없을 때만 더 느슨한 부분 일치(흔한 표기 변형 등)로 한 번 더 찾는다 —
    // 처음부터 느슨하게 찾으면 동명이인 노이즈가 불필요하게 커진다.
    if (rows.length === 0) {
      const { data: fuzzyRows, error: fuzzyError } = await supabase
        .from('hug_defaulters')
        .select('name, address, age')
        .ilike('name', `%${name.replace(/\s+/g, '%')}%`)
      if (fuzzyError) throw fuzzyError
      rows = fuzzyRows ?? []
    }

    const matches: DefaulterMatch[] = rows.map((row) => ({
      name: row.name,
      sigunguName: extractSigunguName(row.address ?? ''),
      age: row.age ?? null,
    }))

    const response: SearchResponse = {
      matchCount: matches.length,
      matches,
      warning:
        matches.length > 0
          ? '동명이인일 수 있습니다. 이름만으로는 신원을 확정할 수 없으니 참고용으로만 활용하세요.'
          : '일치하는 기록이 없습니다.',
    }
    return jsonResponse(response)
  } catch (err) {
    console.error('search-hug-defaulter-by-name failed', err)
    return jsonResponse({ error: '조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, 502)
  }
})
