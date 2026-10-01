import { useEffect, useState } from 'react'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Chip from '../ui/Chip'
import { DEAL_TYPE_LABELS, PROPERTY_TYPE_LABELS } from '../../lib/contractChecklist'
import { fetchDistrictJeonseRatio } from '../../lib/jeonseRatio'
import { fetchRecentTransactions } from '../../lib/recentTransactions'
import { fetchRegionStat, type RiskLevel } from '../../lib/regionStats'
import type { SavedProperty } from '../../lib/savedProperties'

const RISK_CHIP_TONE: Record<RiskLevel, 'danger' | 'warning' | 'success'> = {
  위험: 'danger',
  주의: 'warning',
  안전: 'success',
}

interface CompareRow {
  property: SavedProperty
  riskLevel: RiskLevel | null
  ratio: number | null
  transactionCount: number | null
  loading: boolean
  error: string | null
}

/** 선택한 매물(2~3개)을 각각 다시 분석(전세가율/안심시그널/실거래가)해서 표로 나란히
 * 비교한다. PropertyReport와 같은 lib 함수들을 재사용한다. */
export default function PropertyCompareTable({ properties, onBack }: { properties: SavedProperty[]; onBack: () => void }) {
  const [rows, setRows] = useState<CompareRow[]>(
    properties.map((property) => ({ property, riskLevel: null, ratio: null, transactionCount: null, loading: true, error: null })),
  )

  useEffect(() => {
    properties.forEach((property, index) => {
      const sigunguCode = property.admin_code.slice(0, 5)
      const isApartment = property.property_type === 'apartment'

      Promise.allSettled([
        fetchRegionStat(sigunguCode),
        fetchDistrictJeonseRatio(sigunguCode, property.sigungu_name),
        fetchRecentTransactions(sigunguCode, property.property_type),
      ]).then(([statResult, ratioResult, txResult]) => {
        const stat = statResult.status === 'fulfilled' ? statResult.value : null
        const ratioData = ratioResult.status === 'fulfilled' ? ratioResult.value : null
        const transactions = txResult.status === 'fulfilled' ? txResult.value : null

        const ratio = ratioData ? (isApartment ? ratioData.apartment_ratio : ratioData.villa_ratio) : null
        const firstError = [statResult, ratioResult, txResult].find((r) => r.status === 'rejected') as
          | PromiseRejectedResult
          | undefined

        setRows((prev) =>
          prev.map((row, i) =>
            i === index
              ? {
                  ...row,
                  riskLevel: stat?.risk_level ?? null,
                  ratio,
                  transactionCount: transactions?.transactions.length ?? 0,
                  loading: false,
                  error: firstError ? (firstError.reason instanceof Error ? firstError.reason.message : '일부 조회 실패') : null,
                }
              : row,
          ),
        )
      })
    })
  }, [properties])

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={onBack} className="self-start text-xs font-bold text-primary">
        ← 매물함으로 돌아가기
      </button>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead>
            <tr className="border-b border-border text-text-lightgray">
              <th className="px-3 py-2.5 font-medium">매물</th>
              <th className="px-3 py-2.5 font-medium">유형</th>
              <th className="px-3 py-2.5 font-medium">전세가율</th>
              <th className="px-3 py-2.5 font-medium">안심 시그널</th>
              <th className="px-3 py-2.5 font-medium">최근 실거래</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.property.id} className="border-b border-border/60">
                <td className="px-3 py-2.5">
                  <p className="font-bold text-text-dark">{row.property.label || row.property.address}</p>
                  <p className="text-[11px] text-text-lightgray">{row.property.address}</p>
                </td>
                <td className="px-3 py-2.5 text-text-gray">
                  {PROPERTY_TYPE_LABELS[row.property.property_type]}
                  <br />
                  {DEAL_TYPE_LABELS[row.property.deal_type]}
                </td>
                <td className="px-3 py-2.5 text-text-dark">
                  {row.loading ? '...' : row.ratio != null ? `${row.ratio.toFixed(1)}%` : '정보 없음'}
                </td>
                <td className="px-3 py-2.5">
                  {row.loading ? '...' : row.riskLevel ? <Chip tone={RISK_CHIP_TONE[row.riskLevel]}>{row.riskLevel}</Chip> : '정보 없음'}
                </td>
                <td className="px-3 py-2.5 text-text-dark">{row.loading ? '...' : `${row.transactionCount ?? 0}건`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Button type="button" variant="outline" onClick={onBack}>
        매물함으로 돌아가기
      </Button>
    </div>
  )
}
