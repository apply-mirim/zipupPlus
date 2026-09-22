// Supabase Edge Function: search-legal-terms
// /law-search 페이지("용어 검색")가 쓰는 함수. 법제처 lstrm(법령용어사전) API만 호출하던 이전
// 버전은 IP 화이트리스트 문제로 항상 실패했고(파일 하단 주석 참고), 우리 DB(legal_terms)도
// 전혀 활용하지 않았다. 2026-09 재설계로 법제처 API 의존을 완전히 제거하고, 아래 순서로
// 동작한다 — 이 경로들은 법제처 API를 전혀 타지 않으므로 화이트리스트 문제와 무관하게 지금
// 바로 정상 동작한다:
//
//   1. legal_terms를 term ILIKE로 먼저 찾아본다 — 있으면 그대로 반환(캐시 히트).
//   2. 없으면 legal_provisions(검증된 법 조문 원문)에서 관련 조문을 찾아, 그 원문을 Gemini에게
//      주고 쉬운 설명만 생성한다 — official_definition/source는 조문 원문에서 그대로 가져오므로
//      "환각"이 아니라 검증된 원문에 근거한다.
//   3. 그마저 없으면 Gemini에게 순수하게 물어본다. 이때 같은 호출에서 "이 검색어가 부동산
//      임대차/매물 탐색과 관련 있는지"도 함께 판단하게 해서(응답 스키마의 isRelevant), 무관한
//      질문(예: "안녕", "날씨")에 대해 별도 호출 없이 걸러낸다.
//   2/3번 결과는 다음 검색부터 1번에서 바로 히트하도록 legal_terms에 캐싱(insert)한다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
// analyze-contract/analyze-chat과 동일한 이유로 "-latest" 별칭 사용(핀 고정 모델은 계속 폐지됨).
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-flash-latest'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// legal_terms는 anon/authenticated에게 insert/update 권한이 없으므로(RLS) service_role로만
// 쓴다 — 조회도 이 클라이언트로 통일해 왕복을 줄인다.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface SearchRequest {
  query?: string
}

interface LegalTermRow {
  term: string
  official_definition: string | null
  plain_explanation: string | null
  category: string | null
  source: string | null
  related_provision_id: number | null
  ai_generated: boolean
}

interface SearchResponse {
  query: string
  term: string
  officialDefinition: string | null
  plainExplanation: string | null
  category: string | null
  source: string | null
  relatedProvisionId: number | null
  aiGenerated: boolean
}

interface IrrelevantResponse {
  query: string
  irrelevant: true
  message: string
}

const IRRELEVANT_MESSAGE = '이 서비스는 부동산 임대차/매물 탐색 관련 용어만 검색할 수 있어요.'
const AI_ONLY_SOURCE_NOTE = 'AI 생성 — 법령상 공식 출처 확인 안 됨'

function toResponse(query: string, row: LegalTermRow): SearchResponse {
  return {
    query,
    term: row.term,
    officialDefinition: row.official_definition,
    plainExplanation: row.plain_explanation,
    category: row.category,
    source: row.source,
    relatedProvisionId: row.related_provision_id,
    aiGenerated: row.ai_generated,
  }
}

/** PostgREST의 `.or()` 필터는 콤마로 조건을 구분하는 자체 미니 문법이라, 사용자 입력에 콤마/괄호/
 *  따옴표가 그대로 들어가면 필터 구문이 깨질 수 있다 — 값을 큰따옴표로 감싸 그 문제를 막는다. */
function quoteOrValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

// 429(RESOURCE_EXHAUSTED)/503(UNAVAILABLE)는 일시적 과부하일 가능성이 높아 재시도한다.
// analyze-chat과 동일한 재시도 정책(1초, 3초 지수 백오프, 최대 3회 시도).
const GEMINI_RETRYABLE_STATUSES = new Set([429, 503])
const GEMINI_RETRY_DELAYS_MS = [1000, 3000]

interface GeminiCallResult {
  ok: boolean
  status: number
  bodyText: string
}

async function callGeminiWithRetry(requestBody: unknown, timeoutMs: number): Promise<GeminiCallResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

  for (let attempt = 0; ; attempt++) {
    const isLastAttempt = attempt >= GEMINI_RETRY_DELAYS_MS.length
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      if (!isTimeout || isLastAttempt) throw err
      const delayMs = GEMINI_RETRY_DELAYS_MS[attempt]
      console.error(`Gemini API timed out after ${timeoutMs}ms, retrying in ${delayMs}ms`)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      continue
    }
    clearTimeout(timer)

    if (res.ok || !GEMINI_RETRYABLE_STATUSES.has(res.status) || isLastAttempt) {
      const bodyText = await res.text()
      return { ok: res.ok, status: res.status, bodyText }
    }

    const delayMs = GEMINI_RETRY_DELAYS_MS[attempt]
    console.error(`Gemini API ${res.status}, retrying in ${delayMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}

/** Gemini를 responseSchema로 호출해 JSON을 파싱해서 돌려준다. 실패하면 에러를 던진다
 *  (호출부가 502로 변환) — 이 함수 안에서 사용자 대면 에러 메시지를 만들지 않는다. */
async function callGeminiJson<T>(prompt: string, schema: Record<string, unknown>): Promise<T> {
  const { ok, status, bodyText } = await callGeminiWithRetry(
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema },
    },
    28000,
  )

  if (!ok) {
    throw new Error(`Gemini API error ${status}: ${bodyText.slice(0, 500)}`)
  }

  const geminiJson = JSON.parse(bodyText)
  const text: string | undefined = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error(`Gemini API가 빈 응답을 반환했습니다: ${JSON.stringify(geminiJson).slice(0, 500)}`)
  }

  return JSON.parse(text) as T
}

interface ProvisionExplanationResult {
  plainExplanation: string
}

const PROVISION_EXPLANATION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    plainExplanation: { type: 'STRING', description: '조문 원문을 근거로 한, 일반인이 이해하기 쉬운 2~3문장 설명' },
  },
  required: ['plainExplanation'],
}

async function explainTermFromProvision(query: string, provisionContent: string): Promise<ProvisionExplanationResult> {
  const prompt = `당신은 한국 부동산 임대차 법률을 일반인에게 쉽게 설명하는 도우미입니다.
아래 법 조문 원문을 참고해서, "${query}"라는 용어를 일반인이 이해하기 쉽게 2~3문장으로 설명하세요.
전문 용어를 풀어 쓰고, 구체적인 예시가 있으면 도움이 됩니다.

법 조문 원문:
"""
${provisionContent}
"""

반드시 지정된 JSON 스키마 형식으로만 응답하세요.`

  return callGeminiJson<ProvisionExplanationResult>(prompt, PROVISION_EXPLANATION_SCHEMA)
}

interface StandaloneTermResult {
  isRelevant: boolean
  hasOfficialDefinition: boolean
  officialDefinition: string | null
  plainExplanation: string
}

const STANDALONE_TERM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isRelevant: { type: 'BOOLEAN', description: '이 검색어가 한국 부동산 임대차/매물 탐색 상황과 관련 있는 용어인지 여부' },
    hasOfficialDefinition: { type: 'BOOLEAN', description: '법령이 이 용어를 명시적으로 정의하고 있는지 여부(관련은 있지만 법령상 정의는 없는 통상 용어라면 false)' },
    officialDefinition: { type: 'STRING', description: 'hasOfficialDefinition이 true일 때만 채우는 법령상 공식 정의. false면 빈 문자열.' },
    plainExplanation: { type: 'STRING', description: '일반인이 이해하기 쉬운 2~3문장 설명. isRelevant가 false면 빈 문자열.' },
  },
  required: ['isRelevant', 'hasOfficialDefinition', 'officialDefinition', 'plainExplanation'],
}

async function explainStandaloneTerm(query: string): Promise<StandaloneTermResult> {
  const prompt = `당신은 한국 부동산 임대차/매물 탐색 서비스의 용어 사전 도우미입니다.
사용자가 "${query}"를 검색했습니다.

지침:
1. 먼저 이 검색어가 한국 부동산 임대차(전월세 계약, 등기, 경매 등) 또는 매물 탐색 상황에서 실제로
   쓰이는 용어인지 판단하세요. 인사말, 잡담, 완전히 무관한 주제(예: "안녕", "날씨", "점심 메뉴")라면
   isRelevant를 false로 하고 나머지 필드는 빈 문자열로 두세요.
2. 관련 있는 용어라면 isRelevant를 true로 하세요.
3. 법령(민법, 주택임대차보호법 등)이 이 용어를 명시적으로 정의하고 있는지 판단하세요. 명시적 정의가
   있다면 hasOfficialDefinition을 true로 하고 officialDefinition에 그 정의를 적으세요. 법령상
   정의는 없고 실무·시사 용어로만 쓰인다면(예: "깡통전세", "갭투자") hasOfficialDefinition을
   false로 하고 officialDefinition은 빈 문자열로 두세요.
4. plainExplanation에는 일반인이 이해하기 쉬운 2~3문장 설명을 적으세요.
5. 반드시 지정된 JSON 스키마 형식으로만 응답하세요.`

  return callGeminiJson<StandaloneTermResult>(prompt, STANDALONE_TERM_SCHEMA)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set in Supabase Secrets')
    return jsonResponse({ error: '용어 검색 기능이 설정되지 않았습니다. 관리자에게 문의하세요.' }, 500)
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
    // 1. 캐시 히트(사람이 시드했거나 이전에 AI가 생성해 저장한 항목) 확인.
    const { data: cached, error: cacheError } = await supabase
      .from('legal_terms')
      .select('term, official_definition, plain_explanation, category, source, related_provision_id, ai_generated')
      .ilike('term', `%${query}%`)
      .limit(1)
      .maybeSingle()
    if (cacheError) throw cacheError

    if (cached) {
      return jsonResponse(toResponse(query, cached as LegalTermRow))
    }

    // 2. 관련 법 조문이 있으면 그 원문을 근거로 쉬운 설명만 Gemini에게 맡긴다.
    const orFilter = `content.ilike.${quoteOrValue(`%${query}%`)},plain_explanation.ilike.${quoteOrValue(`%${query}%`)}`
    const { data: provision, error: provisionError } = await supabase
      .from('legal_provisions')
      .select('id, law_name, article, content')
      .or(orFilter)
      .limit(1)
      .maybeSingle()
    if (provisionError) throw provisionError

    if (provision) {
      const { plainExplanation } = await explainTermFromProvision(query, provision.content)

      const newRow: LegalTermRow = {
        term: query,
        official_definition: provision.content,
        plain_explanation: plainExplanation,
        category: null,
        source: `${provision.law_name} ${provision.article}`,
        related_provision_id: provision.id,
        ai_generated: true,
      }
      const { error: insertError } = await supabase.from('legal_terms').insert(newRow)
      if (insertError) console.error('legal_terms insert error (provision-based)', insertError)

      return jsonResponse(toResponse(query, newRow))
    }

    // 3. 관련 조문도 없으면 Gemini에게 순수하게 물어보되, 같은 호출에서 관련성도 함께 판단한다.
    const standalone = await explainStandaloneTerm(query)

    if (!standalone.isRelevant) {
      const irrelevant: IrrelevantResponse = { query, irrelevant: true, message: IRRELEVANT_MESSAGE }
      return jsonResponse(irrelevant)
    }

    const newRow: LegalTermRow = {
      term: query,
      official_definition: standalone.hasOfficialDefinition ? standalone.officialDefinition : null,
      plain_explanation: standalone.plainExplanation,
      category: null,
      source: AI_ONLY_SOURCE_NOTE,
      related_provision_id: null,
      ai_generated: true,
    }
    const { error: insertError } = await supabase.from('legal_terms').insert(newRow)
    if (insertError) console.error('legal_terms insert error (standalone)', insertError)

    return jsonResponse(toResponse(query, newRow))
  } catch (err) {
    console.error('search-legal-terms failed', err)
    return jsonResponse({ error: '용어 검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, 502)
  }
})

// ---------------------------------------------------------------------------
// 이전 버전(법제처 lstrm 법령용어사전 API 직접 호출) — 화이트리스트 문제로 항상 실패했다.
// 화이트리스트(또는 고정 IP 프록시)가 풀리면 이 로직을 참고해 "법제처 원문도 함께 보여주는"
// 보조 경로로 재활용할 수 있어 삭제하지 않고 남겨둔다.
// ---------------------------------------------------------------------------
//
// const OC = Deno.env.get("MOLEG_API_OC");
// const MAX_DETAIL_LOOKUPS = 15;
// const DICTIONARY_LABELS: Record<string, string> = {
//   "011402": "법령정의사전",
//   "011403": "법령한영사전",
// };
//
// interface LstrmSearchEntry {
//   법령용어명: string;
//   법령용어ID: string;
//   사전구분코드: string;
//   법령용어상세검색: string;
// }
//
// interface LstrmServiceDetail {
//   법령용어코드?: string;
//   법령용어정의?: string;
//   출처?: string;
// }
//
// async function fetchLawGoKrJson(path: string): Promise<unknown> {
//   let lastErr: unknown;
//   for (const scheme of ["http", "https"]) {
//     try {
//       const res = await fetch(`${scheme}://www.law.go.kr${path}`, { signal: AbortSignal.timeout(10000) });
//       if (!res.ok) throw new Error(`HTTP ${res.status}`);
//       return await res.json();
//     } catch (err) {
//       lastErr = err;
//     }
//   }
//   throw lastErr;
// }
//
// async function searchLstrmTerm(query: string): Promise<{ entries: LstrmSearchEntry[]; totalCnt: number }> {
//   const path = `/DRF/lawSearch.do?OC=${OC}&target=lstrm&type=JSON&display=30&query=${encodeURIComponent(query)}`;
//   const json = (await fetchLawGoKrJson(path)) as {
//     LsTrmSearch?: { lstrm?: LstrmSearchEntry | LstrmSearchEntry[]; totalCnt?: string };
//     result?: string;
//     msg?: string;
//   };
//
//   // 법제처 API는 인증/입력 오류일 때 LsTrmSearch가 아예 없는 다른 모양({result, msg})으로
//   // 응답한다(IP 미등록 시 "사용자 정보 검증에 실패" 등). 이걸 놓치면 진짜 오류가 "검색 결과
//   // 0건"으로 조용히 둔갑해 버린다 — 실제로 배포 후 재현되어 이 방어 코드를 추가함.
//   if (!json?.LsTrmSearch) {
//     throw new Error(`법제처 API 응답 이상 — result="${json?.result}" msg="${json?.msg}"`);
//   }
//
//   const raw = json.LsTrmSearch.lstrm;
//   const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
//   return { entries, totalCnt: Number(json.LsTrmSearch.totalCnt ?? entries.length) };
// }
//
// async function fetchLstrmDetail(trmSeq: string): Promise<LstrmServiceDetail | null> {
//   const path = `/DRF/lawService.do?OC=${OC}&target=lstrm&type=JSON&trmSeqs=${trmSeq}`;
//   const json = (await fetchLawGoKrJson(path)) as { LsTrmService?: LstrmServiceDetail };
//   return json?.LsTrmService ?? null;
// }
//
// async function searchViaLstrmApi(query: string) {
//   const { entries, totalCnt } = await searchLstrmTerm(query);
//   const toLookup = entries.slice(0, MAX_DETAIL_LOOKUPS);
//   const results = await Promise.all(
//     toLookup.map(async (entry) => {
//       const firstId = String(entry["법령용어ID"] ?? "").split(",")[0]?.trim();
//       const detail = firstId ? await fetchLstrmDetail(firstId).catch(() => null) : null;
//       const code = detail?.["법령용어코드"] ?? entry["사전구분코드"]?.split(",")[0];
//       return {
//         term: entry["법령용어명"],
//         definition: detail?.["법령용어정의"]?.trim() || null,
//         dictionaryCode: code ?? null,
//         dictionaryLabel: code ? (DICTIONARY_LABELS[code] ?? "기타 사전") : null,
//         source: detail?.["출처"] ?? null,
//         detailUrl: `https://www.law.go.kr${entry["법령용어상세검색"]}`,
//       };
//     }),
//   );
//   return { query, totalCnt, truncated: entries.length > MAX_DETAIL_LOOKUPS, results };
// }
