// Supabase Edge Function: get-contract-checklist
// "내 계약 체크리스트" 기능 — 매물 유형(propertyType) × 거래 유형(dealType) 조합에 맞는
// 체크리스트 항목을 contract_checklists에서 item_order 순으로 조회한다. 각 항목에
// related_term이 있으면 legal_terms에서 같은 term을 찾아 공식 정의/쉬운 설명을 같이 붙여
// 반환한다 — search-legal-terms와 달리 여기서는 Gemini 호출이나 새 행 insert를 하지 않고
// 순수 조회만 한다(없으면 relatedTerm은 텍스트만 있고 링크는 null).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const VALID_PROPERTY_TYPES = ['apartment', 'villa', 'officetel', 'oneroom'] as const
const VALID_DEAL_TYPES = ['jeonse', 'wolse', 'maemae'] as const

type PropertyType = (typeof VALID_PROPERTY_TYPES)[number]
type DealType = (typeof VALID_DEAL_TYPES)[number]

interface ChecklistRequest {
  propertyType?: string
  dealType?: string
}

interface ChecklistItemRow {
  item_order: number
  item_title: string
  item_description: string
  related_term: string | null
}

interface LegalTermRow {
  term: string
  official_definition: string | null
  plain_explanation: string | null
}

interface RelatedTermResponse {
  term: string
  officialDefinition: string | null
  plainExplanation: string | null
}

interface ChecklistItemResponse {
  order: number
  title: string
  description: string
  relatedTerm: RelatedTermResponse | null
}

interface ChecklistResponse {
  propertyType: PropertyType
  dealType: DealType
  items: ChecklistItemResponse[]
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  let body: ChecklistRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: '요청 형식이 올바르지 않습니다.' }, 400)
  }

  const propertyType = body.propertyType?.trim()
  const dealType = body.dealType?.trim()

  if (!propertyType || !VALID_PROPERTY_TYPES.includes(propertyType as PropertyType)) {
    return jsonResponse({ error: `propertyType은 ${VALID_PROPERTY_TYPES.join(', ')} 중 하나여야 합니다.` }, 400)
  }
  if (!dealType || !VALID_DEAL_TYPES.includes(dealType as DealType)) {
    return jsonResponse({ error: `dealType은 ${VALID_DEAL_TYPES.join(', ')} 중 하나여야 합니다.` }, 400)
  }

  try {
    const { data: checklistRows, error: checklistError } = await supabase
      .from('contract_checklists')
      .select('item_order, item_title, item_description, related_term')
      .eq('property_type', propertyType)
      .eq('deal_type', dealType)
      .order('item_order', { ascending: true })
    if (checklistError) throw checklistError

    const rows = (checklistRows ?? []) as ChecklistItemRow[]

    // related_term이 있는 항목들만 legal_terms를 한 번에 조회한다(항목마다 따로 쿼리하지 않음).
    const relatedTermNames = Array.from(new Set(rows.map((r) => r.related_term).filter((t): t is string => !!t)))

    let legalTermsByName = new Map<string, LegalTermRow>()
    if (relatedTermNames.length > 0) {
      const { data: termRows, error: termError } = await supabase
        .from('legal_terms')
        .select('term, official_definition, plain_explanation')
        .in('term', relatedTermNames)
      if (termError) throw termError

      legalTermsByName = new Map((termRows as LegalTermRow[]).map((t) => [t.term, t]))
    }

    const items: ChecklistItemResponse[] = rows.map((row) => {
      // related_term이 없는 항목만 relatedTerm 전체를 null로 둔다. related_term은 있는데
      // legal_terms에 아직 없는 용어면, 용어 텍스트(term)는 그대로 보여주고 정의/설명만 null로
      // 남긴다 — 프론트에서 "아직 등록되지 않은 용어" 정도로 구분해 보여줄 수 있게.
      if (!row.related_term) {
        return { order: row.item_order, title: row.item_title, description: row.item_description, relatedTerm: null }
      }

      const matchedTerm = legalTermsByName.get(row.related_term)

      return {
        order: row.item_order,
        title: row.item_title,
        description: row.item_description,
        relatedTerm: {
          term: row.related_term,
          officialDefinition: matchedTerm?.official_definition ?? null,
          plainExplanation: matchedTerm?.plain_explanation ?? null,
        },
      }
    })

    const response: ChecklistResponse = {
      propertyType: propertyType as PropertyType,
      dealType: dealType as DealType,
      items,
    }
    return jsonResponse(response)
  } catch (err) {
    console.error('get-contract-checklist failed', err)
    return jsonResponse({ error: '체크리스트를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, 502)
  }
})
