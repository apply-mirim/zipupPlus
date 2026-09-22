// Supabase Edge Function: sync-legal-terms
// legal_provisions 테이블(법령명+조번호+원문)을 매달 한 번 법제처 국가법령정보 공동활용
// API(lawService.do, target=lawjosub)로 다시 조회해, DB에 저장된 content와 실제 법 조문이
// 달라졌으면 needs_review=true로 표시한다. content 자체는 자동으로 덮어쓰지 않는다 —
// 관리자가 원문을 직접 확인한 뒤 수동으로 갱신하는 것을 전제로 한다(plain_explanation
// 재생성은 다음 단계, 이 함수의 범위가 아님).
//
// ⚠️ 2026-09 기준: 법제처 오픈API는 호출 서버 IP를 화이트리스트로 등록해야 하는데, Supabase
// Edge Function은 고정 아웃바운드 IP가 없어(search-legal-terms/index.ts 참고) 이 함수의 실제
// API 호출은 화이트리스트(또는 고정 IP 프록시)가 붙기 전까지 항상 실패한다. 그 실패를 조용히
// 삼키지 않고 행마다 로그로 남기되, 한 행이 실패해도 나머지 행은 계속 처리한다 — 화이트리스트
// 문제가 풀리는 순간 코드 변경 없이 그대로 동작하도록 하는 게 목표.
//
// ⚠️ 응답 구조("법령" > "조문" 래핑, JosubResponse/JosubDetail)는 실제 API 호출을 성공시켜
// 보지 못한 상태에서 다른 law.go.kr JSON API들의 관례를 참고해 추정한 것이다 — 화이트리스트가
// 풀리고 첫 성공 응답을 받으면 fetchProvisionDetail()을 실제 필드명에 맞게 조정해야 한다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { requireCronSecret } from '../_shared/cronAuth.ts'
import { recordJobRun } from '../_shared/jobStatus.ts'

const JOB_NAME = 'sync-legal-terms'

const OC = Deno.env.get('MOLEG_API_OC')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

interface LegalProvisionRow {
  id: number
  law_name: string
  article: string
  content: string
  law_id: string | null
}

interface JosubDetail {
  조문내용?: string
  조문시행일자?: string
  조문변경여부?: string
}

// 법제처 API는 인증/입력 오류일 때 정상 응답과 다른 모양({result, msg})으로 내려온다
// (search-legal-terms에서 이미 확인된 패턴) — 이걸 놓치면 진짜 오류가 "본문 없음"으로
// 조용히 둔갑한다.
interface JosubResponse {
  법령?: { 조문?: JosubDetail }
  result?: string
  msg?: string
}

// "제3조" → "000300", "제3조의2" → "000302" (조번호 4자리 + 가지번호 2자리).
function encodeArticleToJo(article: string): string | null {
  const match = article.match(/^제(\d+)조(?:의(\d+))?$/)
  if (!match) return null
  const [, num, sub] = match
  return num.padStart(4, '0') + (sub ?? '0').padStart(2, '0')
}

async function fetchJson(path: string): Promise<unknown> {
  let lastErr: unknown
  for (const scheme of ['http', 'https']) {
    try {
      const res = await fetch(`${scheme}://www.law.go.kr${path}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

async function fetchProvisionDetail(lawId: string, jo: string): Promise<JosubDetail> {
  const path = `/DRF/lawService.do?OC=${OC}&target=lawjosub&type=JSON&ID=${lawId}&JO=${jo}`
  const json = (await fetchJson(path)) as JosubResponse

  const detail = json?.법령?.조문
  if (!detail) {
    throw new Error(`법제처 API 응답 이상 — result="${json?.result}" msg="${json?.msg}"`)
  }
  return detail
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const authError = requireCronSecret(req)
  if (authError) return authError

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  if (!OC) {
    console.error('MOLEG_API_OC is not set in Supabase Secrets')
    await recordJobRun(supabase, JOB_NAME, { success: false, error: '법제처 API 키(MOLEG_API_OC)가 설정되지 않았습니다.' })
    return jsonResponse({ error: '법제처 API 키가 설정되지 않았습니다.' }, 500)
  }

  try {
    const { data: rows, error: fetchError } = await supabase
      .from('legal_provisions')
      .select('id, law_name, article, content, law_id')

    if (fetchError) throw fetchError

    let checked = 0
    let skipped = 0
    let failed = 0
    let revised = 0

    for (const row of (rows ?? []) as LegalProvisionRow[]) {
      const label = `${row.law_name} ${row.article} (id=${row.id})`

      if (!row.law_id) {
        console.log(`sync-legal-terms: skip ${label} — law_id 미등록`)
        skipped++
        continue
      }

      const jo = encodeArticleToJo(row.article)
      if (!jo) {
        console.log(`sync-legal-terms: skip ${label} — article 형식을 JO 코드로 변환 불가`)
        skipped++
        continue
      }

      const now = new Date().toISOString()
      try {
        const detail = await fetchProvisionDetail(row.law_id, jo)
        const apiContent = detail.조문내용?.trim()
        const needsReview = apiContent != null && apiContent !== row.content.trim()

        const update: Record<string, unknown> = { last_checked_at: now }
        if (needsReview) update.needs_review = true

        const { error: updateError } = await supabase.from('legal_provisions').update(update).eq('id', row.id)
        if (updateError) throw updateError

        checked++
        if (needsReview) {
          revised++
          console.log(`sync-legal-terms: 개정 감지 — ${label}`)
        }
      } catch (err) {
        console.error(`sync-legal-terms: API 호출 실패 — ${label}`, err)
        failed++
        // 실패해도 "지금 확인을 시도했다"는 사실은 남긴다 — needs_review는 건드리지 않는다.
        await supabase.from('legal_provisions').update({ last_checked_at: now }).eq('id', row.id)
      }

      // 정부 API 호출량을 배려한 짧은 텀.
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    const summary = { total: rows?.length ?? 0, checked, skipped, failed, revised }
    await recordJobRun(supabase, JOB_NAME, { success: true, result: summary })
    return jsonResponse(summary)
  } catch (err) {
    console.error('sync-legal-terms: batch failed', err)
    await recordJobRun(supabase, JOB_NAME, { success: false, error: err instanceof Error ? err.message : String(err) })
    return jsonResponse({ error: '법 조문 개정 감지 중 오류가 발생했습니다.' }, 500)
  }
})
