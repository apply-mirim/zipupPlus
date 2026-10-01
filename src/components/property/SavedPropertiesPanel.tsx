import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../ui/Button'
import Card from '../ui/Card'
import PropertyCompareTable from './PropertyCompareTable'
import { DEAL_TYPE_LABELS, PROPERTY_TYPE_LABELS } from '../../lib/contractChecklist'
import { deleteSavedProperty, fetchSavedProperties, type SavedProperty } from '../../lib/savedProperties'
import { supabase } from '../../lib/supabase'

const MAX_COMPARE = 3

function formatManwon(value: number | null): string {
  if (value == null) return '-'
  const eok = value / 10000
  return eok >= 1 ? `${eok.toFixed(1)}억원` : `${value.toLocaleString('ko-KR')}만원`
}

function PropertyCard({
  property,
  selected,
  selectable,
  onToggleSelect,
  onDelete,
}: {
  property: SavedProperty
  selected: boolean
  selectable: boolean
  onToggleSelect: () => void
  onDelete: () => void
}) {
  return (
    <Card className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={selected}
        disabled={!selected && !selectable}
        onChange={onToggleSelect}
        className="mt-1 h-4 w-4 shrink-0 accent-primary"
      />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-bold text-text-dark">{property.label || property.address}</h3>
        <p className="mt-0.5 truncate text-xs text-text-gray">{property.address}</p>
        <p className="mt-1 text-[11px] text-text-lightgray">
          {PROPERTY_TYPE_LABELS[property.property_type]} · {DEAL_TYPE_LABELS[property.deal_type]}
          {property.deposit_amount != null && ` · 보증금 ${formatManwon(property.deposit_amount)}`}
          {property.monthly_rent != null && ` · 월세 ${property.monthly_rent.toLocaleString('ko-KR')}만원`}
        </p>
      </div>
      <button type="button" onClick={onDelete} aria-label="삭제" className="text-xs font-bold text-text-lightgray">
        삭제
      </button>
    </Card>
  )
}

/** "내 매물함" 탭. 로그인한 사용자가 저장한 매물을 카드로 보여주고, 2~3개 선택하면
 * PropertyCompareTable로 전세가율/안심시그널/실거래가를 나란히 비교할 수 있다. */
export default function SavedPropertiesPanel() {
  const navigate = useNavigate()
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)
  const [properties, setProperties] = useState<SavedProperty[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setIsLoggedIn(!!data.user)
      if (!data.user) {
        setLoading(false)
        return
      }
      fetchSavedProperties()
        .then(setProperties)
        .catch((err) => setError(err instanceof Error ? err.message : '매물함을 불러오지 못했어요.'))
        .finally(() => setLoading(false))
    })
  }, [])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((v) => v !== id)
      if (prev.length >= MAX_COMPARE) return prev
      return [...prev, id]
    })
  }

  async function handleDelete(id: string) {
    try {
      await deleteSavedProperty(id)
      setProperties((prev) => prev.filter((p) => p.id !== id))
      setSelectedIds((prev) => prev.filter((v) => v !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제 중 오류가 발생했어요.')
    }
  }

  if (isLoggedIn === null || loading) {
    return <p className="py-8 text-center text-xs text-text-lightgray">불러오는 중...</p>
  }

  if (!isLoggedIn) {
    return (
      <Card className="flex flex-col items-center gap-3 text-center">
        <p className="text-xs text-text-gray">로그인하면 저장한 매물을 모아볼 수 있어요.</p>
        <Button type="button" onClick={() => navigate('/login')}>
          로그인
        </Button>
      </Card>
    )
  }

  const selectedProperties = properties.filter((p) => selectedIds.includes(p.id))

  if (comparing) {
    return <PropertyCompareTable properties={selectedProperties} onBack={() => setComparing(false)} />
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-xs text-danger">{error}</p>}

      {properties.length === 0 ? (
        <Card className="border-dashed text-center">
          <p className="text-xs text-text-gray">아직 저장한 매물이 없어요. "매물 분석" 탭에서 리포트를 만들고 저장해보세요.</p>
        </Card>
      ) : (
        <>
          <p className="text-[11px] text-text-lightgray">최대 {MAX_COMPARE}개까지 선택해서 비교할 수 있어요.</p>
          {properties.map((property) => (
            <PropertyCard
              key={property.id}
              property={property}
              selected={selectedIds.includes(property.id)}
              selectable={selectedIds.length < MAX_COMPARE}
              onToggleSelect={() => toggleSelect(property.id)}
              onDelete={() => handleDelete(property.id)}
            />
          ))}
          <Button type="button" onClick={() => setComparing(true)} disabled={selectedIds.length < 2}>
            선택한 {selectedIds.length}개 비교하기
          </Button>
        </>
      )}
    </div>
  )
}
