import { useState } from 'react'
import AddressAutocomplete from '../ui/AddressAutocomplete'
import Button from '../ui/Button'
import BrokenText from '../ui/BrokenText'
import {
  DEAL_TYPES,
  DEAL_TYPE_LABELS,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  type DealType,
  type PropertyType,
} from '../../lib/contractChecklist'
import type { ResolvedAddress } from '../../lib/address'
import type { PropertyReportInput } from './types'

interface PropertySearchFormProps {
  onSubmit: (input: PropertyReportInput) => void
}

const inputClass =
  'h-11 w-full rounded-input border-[1.2px] border-border bg-white px-3 text-sm text-text-dark outline-none placeholder:text-text-lightgray focus:border-primary'

/** "매물 탐색" 종합 리포트 입력 폼. 주소를 고르면(resolve-address) 좌표/법정동코드가
 * 확보되고, 나머지 매물 정보를 더 채운 뒤 "분석하기"를 누르면 PropertyReportInput을 그대로
 * 위(PropertyExplore 페이지)로 올린다. */
export default function PropertySearchForm({ onSubmit }: PropertySearchFormProps) {
  const [resolved, setResolved] = useState<ResolvedAddress | null>(null)
  const [propertyType, setPropertyType] = useState<PropertyType>('apartment')
  const [dealType, setDealType] = useState<DealType>('jeonse')
  const [depositAmount, setDepositAmount] = useState('')
  const [monthlyRent, setMonthlyRent] = useState('')
  const [landlordName, setLandlordName] = useState('')

  function handleSubmit() {
    if (!resolved) return

    onSubmit({
      address: resolved.input_address,
      lat: resolved.lat,
      lng: resolved.lng,
      adminCode: resolved.admin_code,
      sigunguCode: resolved.admin_code.slice(0, 5),
      sigunguName: resolved.sigungu ?? resolved.admin_code.slice(0, 5),
      propertyType,
      dealType,
      depositAmount: depositAmount.trim() ? Number(depositAmount) : null,
      monthlyRent: dealType === 'wolse' && monthlyRent.trim() ? Number(monthlyRent) : null,
      landlordName: landlordName.trim(),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <AddressAutocomplete label="주소" onResolve={setResolved} />
      {resolved && (
        <p className="text-[11px] font-medium text-primary">선택된 주소: {resolved.input_address}</p>
      )}

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="mb-1.5 block text-sm font-medium text-text-gray">건물유형</label>
          <select value={propertyType} onChange={(e) => setPropertyType(e.target.value as PropertyType)} className={inputClass}>
            {PROPERTY_TYPES.map((type) => (
              <option key={type} value={type}>
                {PROPERTY_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-1.5 block text-sm font-medium text-text-gray">거래유형</label>
          <select value={dealType} onChange={(e) => setDealType(e.target.value as DealType)} className={inputClass}>
            {DEAL_TYPES.map((type) => (
              <option key={type} value={type}>
                {DEAL_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="mb-1.5 block text-sm font-medium text-text-gray">보증금 (만원, 선택)</label>
          <input
            type="number"
            inputMode="numeric"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder="예: 30000"
            className={inputClass}
          />
        </div>
        {dealType === 'wolse' && (
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-text-gray">월세 (만원)</label>
            <input
              type="number"
              inputMode="numeric"
              value={monthlyRent}
              onChange={(e) => setMonthlyRent(e.target.value)}
              placeholder="예: 50"
              className={inputClass}
            />
          </div>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-gray">임대인 이름 (선택)</label>
        <input
          type="text"
          value={landlordName}
          onChange={(e) => setLandlordName(e.target.value)}
          placeholder="HUG 상습채무불이행자 명단과 대조해드려요"
          className={inputClass}
        />
        <p className="mt-1.5 text-[11px] leading-relaxed text-text-lightgray">
          <BrokenText text="저장 시 이 정보는 보존되지 않고 조회에만 사용됩니다." />
        </p>
      </div>

      <Button type="button" onClick={handleSubmit} disabled={!resolved}>
        분석하기
      </Button>
    </div>
  )
}
