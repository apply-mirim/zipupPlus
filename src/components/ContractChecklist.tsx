import { useEffect, useState } from 'react'
import BrokenText from './ui/BrokenText'
import Card from './ui/Card'
import {
  DEAL_TYPES,
  DEAL_TYPE_LABELS,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  fetchContractChecklist,
  type ChecklistItem,
  type DealType,
  type PropertyType,
} from '../lib/contractChecklist'

function ChecklistItemCard({ item }: { item: ChecklistItem }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-bg text-[11px] font-bold text-primary">
          {item.order}
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-text-dark">{item.title}</h3>
          <p className="mt-1 text-pretty text-xs leading-relaxed text-text-gray">
            <BrokenText text={item.description} />
          </p>
        </div>
      </div>

      {item.relatedTerm && (
        <div className="ml-[30px] mt-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-bold text-primary underline underline-offset-2"
          >
            📖 {item.relatedTerm.term} {expanded ? '접기' : '자세히 보기'}
          </button>

          {expanded && (
            <div className="mt-2 flex flex-col gap-2">
              {item.relatedTerm.officialDefinition ? (
                <div className="rounded-2xl bg-subtle p-3">
                  <p className="text-[11px] font-bold text-text-gray">📖 법제처/법령 공식 정의</p>
                  <p className="mt-1 text-pretty text-xs leading-relaxed text-text-dark">
                    <BrokenText text={item.relatedTerm.officialDefinition} />
                  </p>
                </div>
              ) : (
                <p className="text-pretty text-[11px] leading-relaxed text-text-lightgray">
                  아직 공식 정의가 확인되지 않은 용어예요.
                </p>
              )}

              {item.relatedTerm.plainExplanation && (
                <div className="rounded-2xl bg-primary-bg/40 p-3">
                  <p className="text-[11px] font-bold text-primary">💡 쉽게 풀면</p>
                  <p className="mt-1 text-pretty text-xs leading-relaxed text-text-dark">
                    <BrokenText text={item.relatedTerm.plainExplanation} />
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/** 용어 사전 페이지의 "내 계약 체크리스트" 섹션. 건물유형+거래유형을 고르면
 *  get-contract-checklist를 호출해 체크리스트를 카드로 보여준다. 각 항목에 관련 용어가
 *  있으면 펼쳐서 법령 원문/쉬운 설명을 확인할 수 있다. */
export default function ContractChecklist() {
  const [propertyType, setPropertyType] = useState<PropertyType>('apartment')
  const [dealType, setDealType] = useState<DealType>('jeonse')
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchContractChecklist(propertyType, dealType)
      .then((result) => {
        if (cancelled) return
        setItems(result.items)
      })
      .catch((err) => {
        if (cancelled) return
        setItems([])
        setError(err instanceof Error ? err.message : '체크리스트를 불러오지 못했어요.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [propertyType, dealType])

  return (
    <div className="flex flex-col gap-4">
      <p className="text-pretty text-[11px] leading-relaxed text-text-lightgray">
        <BrokenText text="건물유형과 거래유형을 고르면 계약 전 꼭 확인해야 할 항목을 체크리스트로 보여드려요." />
      </p>

      <div className="flex gap-2">
        <select
          value={propertyType}
          onChange={(e) => setPropertyType(e.target.value as PropertyType)}
          className="h-11 flex-1 rounded-input border-[1.2px] border-border bg-white px-3 text-sm text-text-dark outline-none focus:border-primary"
        >
          {PROPERTY_TYPES.map((type) => (
            <option key={type} value={type}>
              {PROPERTY_TYPE_LABELS[type]}
            </option>
          ))}
        </select>

        <select
          value={dealType}
          onChange={(e) => setDealType(e.target.value as DealType)}
          className="h-11 flex-1 rounded-input border-[1.2px] border-border bg-white px-3 text-sm text-text-dark outline-none focus:border-primary"
        >
          {DEAL_TYPES.map((type) => (
            <option key={type} value={type}>
              {DEAL_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-3">
        {loading ? (
          <p className="py-8 text-center text-xs text-text-lightgray">불러오는 중...</p>
        ) : error ? (
          <Card className="border-dashed text-center">
            <p className="text-pretty text-xs leading-relaxed text-danger">{error}</p>
          </Card>
        ) : items.length === 0 ? (
          <Card className="border-dashed text-center">
            <p className="text-pretty text-xs leading-relaxed text-text-gray">
              이 조합에 대한 체크리스트가 아직 없어요.
            </p>
          </Card>
        ) : (
          items.map((item) => <ChecklistItemCard key={item.order} item={item} />)
        )}
      </div>
    </div>
  )
}
