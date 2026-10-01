import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Chip from '../ui/Chip'
import BrokenText from '../ui/BrokenText'
import ContractChecklist from '../ContractChecklist'
import PropertyMiniMap from './PropertyMiniMap'
import { fetchRegionStat, type RegionStat, type RiskLevel } from '../../lib/regionStats'
import { fetchDistrictJeonseRatio, type DistrictJeonseRatio } from '../../lib/jeonseRatio'
import { fetchRecentTransactions, type RecentTransactionsResponse } from '../../lib/recentTransactions'
import { searchHugDefaulterByName, type HugDefaulterSearchResult } from '../../lib/hugDefaulterSearch'
import { saveProperty } from '../../lib/savedProperties'
import { DEAL_TYPE_LABELS, PROPERTY_TYPE_LABELS } from '../../lib/contractChecklist'
import { supabase } from '../../lib/supabase'
import type { PropertyReportInput } from './types'

const RISK_CHIP_TONE: Record<RiskLevel, 'danger' | 'warning' | 'success'> = {
  위험: 'danger',
  주의: 'warning',
  안전: 'success',
}

function formatManwon(value: number | null): string {
  if (value == null) return '정보 없음'
  const eok = value / 10000
  return eok >= 1 ? `${eok.toFixed(1)}억원` : `${Math.round(value).toLocaleString('ko-KR')}만원`
}

/** "202607" → "2026년 7월" 식으로, fromYm~toYm을 "2026년 7월~9월"(같은 해) 또는
 * "2025년 12월~2026년 2월"(연도가 걸칠 때) 형태로 합친다. */
function formatYmRange(fromYm?: string, toYm?: string): string | null {
  if (!fromYm || !toYm) return null
  const fromYear = fromYm.slice(0, 4)
  const fromMonth = Number(fromYm.slice(4, 6))
  const toYear = toYm.slice(0, 4)
  const toMonth = Number(toYm.slice(4, 6))
  if (fromYear === toYear) return `${fromYear}년 ${fromMonth}월~${toMonth}월`
  return `${fromYear}년 ${fromMonth}월~${toYear}년 ${toMonth}월`
}

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-sm font-bold text-text-dark">{title}</h2>
      {children}
    </Card>
  )
}

/** "매물 탐색" 종합 리포트. 입력 폼에서 넘어온 PropertyReportInput 하나로 섹션별 데이터를
 * 각각 독립적으로 불러온다(한 섹션이 느리거나 실패해도 다른 섹션은 그대로 보여줌). */
export default function PropertyReport({ input }: { input: PropertyReportInput }) {
  const navigate = useNavigate()

  const [regionStat, setRegionStat] = useState<RegionStat | null>(null)
  const [regionStatError, setRegionStatError] = useState<string | null>(null)
  const [regionStatLoading, setRegionStatLoading] = useState(true)

  const [ratio, setRatio] = useState<DistrictJeonseRatio | null>(null)
  const [ratioError, setRatioError] = useState<string | null>(null)
  const [ratioLoading, setRatioLoading] = useState(true)

  const [transactions, setTransactions] = useState<RecentTransactionsResponse | null>(null)
  const [transactionsError, setTransactionsError] = useState<string | null>(null)
  const [transactionsLoading, setTransactionsLoading] = useState(true)

  const [hugResult, setHugResult] = useState<HugDefaulterSearchResult | null>(null)
  const [hugError, setHugError] = useState<string | null>(null)
  const [hugLoading, setHugLoading] = useState(!!input.landlordName)

  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedLabel, setSavedLabel] = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setIsLoggedIn(!!data.user))
  }, [])

  useEffect(() => {
    setRegionStatLoading(true)
    fetchRegionStat(input.sigunguCode)
      .then(setRegionStat)
      .catch((err) => setRegionStatError(err instanceof Error ? err.message : '안심 시그널 조회에 실패했어요.'))
      .finally(() => setRegionStatLoading(false))
  }, [input.sigunguCode])

  useEffect(() => {
    setRatioLoading(true)
    fetchDistrictJeonseRatio(input.sigunguCode, input.sigunguName)
      .then(setRatio)
      .catch((err) => setRatioError(err instanceof Error ? err.message : '전세가율 조회에 실패했어요.'))
      .finally(() => setRatioLoading(false))
  }, [input.sigunguCode, input.sigunguName])

  useEffect(() => {
    setTransactionsLoading(true)
    fetchRecentTransactions(input.sigunguCode, input.propertyType, { eupmyeondong: input.eupmyeondong })
      .then(setTransactions)
      .catch((err) => setTransactionsError(err instanceof Error ? err.message : '실거래가 조회에 실패했어요.'))
      .finally(() => setTransactionsLoading(false))
  }, [input.sigunguCode, input.propertyType, input.eupmyeondong])

  useEffect(() => {
    if (!input.landlordName) return
    setHugLoading(true)
    searchHugDefaulterByName(input.landlordName)
      .then(setHugResult)
      .catch((err) => setHugError(err instanceof Error ? err.message : '임대인 대조에 실패했어요.'))
      .finally(() => setHugLoading(false))
  }, [input.landlordName])

  async function handleSave() {
    setSaveState('saving')
    setSaveError(null)
    try {
      await saveProperty({
        label: savedLabel.trim() || null,
        address: input.address,
        lat: input.lat,
        lng: input.lng,
        admin_code: input.adminCode,
        sigungu_name: input.sigunguName,
        eupmyeondong: input.eupmyeondong,
        property_type: input.propertyType,
        deal_type: input.dealType,
        deposit_amount: input.depositAmount,
        monthly_rent: input.monthlyRent,
      })
      setSaveState('saved')
    } catch (err) {
      setSaveState('error')
      setSaveError(err instanceof Error ? err.message : '저장 중 오류가 발생했어요.')
    }
  }

  const isOfficetel = input.propertyType === 'officetel'
  const regionRatio = isOfficetel ? null : input.propertyType === 'apartment' ? ratio?.apartment_ratio ?? null : ratio?.villa_ratio ?? null
  const regionAvgSalePrice = isOfficetel
    ? null
    : input.propertyType === 'apartment'
      ? regionStat?.avg_sale_price ?? null
      : regionStat?.villa_avg_sale_price ?? null

  const userImpliedRatio =
    input.depositAmount && regionAvgSalePrice ? (input.depositAmount / regionAvgSalePrice) * 100 : null

  let comparisonText: string | null = null
  if (userImpliedRatio != null && regionRatio != null && input.dealType !== 'maemae') {
    const diff = userImpliedRatio - regionRatio
    comparisonText =
      Math.abs(diff) < 3
        ? '지역 평균과 비슷한 수준이에요.'
        : diff > 0
          ? `지역 평균(${regionRatio.toFixed(1)}%)보다 높아요 — 더 꼼꼼히 확인하세요.`
          : `지역 평균(${regionRatio.toFixed(1)}%)보다 낮아요.`
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 1. 위치 */}
      <SectionCard title="📍 위치">
        <PropertyMiniMap lat={input.lat} lng={input.lng} />
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-gray">{input.address}</p>
          {regionStatLoading ? (
            <span className="text-[11px] text-text-lightgray">확인 중...</span>
          ) : regionStat?.risk_level ? (
            <Chip tone={RISK_CHIP_TONE[regionStat.risk_level]}>안심 시그널: {regionStat.risk_level}</Chip>
          ) : (
            <span className="text-[11px] text-text-lightgray">{regionStatError ?? '아직 집계된 데이터가 없어요.'}</span>
          )}
        </div>
      </SectionCard>

      {/* 2. 전세가율 */}
      <SectionCard title="📊 전세가율">
        {isOfficetel ? (
          <p className="text-xs leading-relaxed text-text-lightgray">
            오피스텔은 아직 전세가율 데이터를 지원하지 않아요(국토교통부 오피스텔 전용 API 미연동).
          </p>
        ) : ratioLoading ? (
          <p className="text-xs text-text-lightgray">불러오는 중...</p>
        ) : ratioError ? (
          <p className="text-xs text-danger">{ratioError}</p>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-text-gray">
              <BrokenText
                text={`${input.sigunguName} ${input.propertyType === 'apartment' ? '아파트' : '빌라/연립다세대'} 전세가율: ${
                  regionRatio != null ? `${regionRatio.toFixed(1)}%` : '표본 부족으로 산출 불가'
                }`}
              />
            </p>
            {comparisonText && <p className="text-xs font-bold text-primary">{comparisonText}</p>}
            {ratio?.sample_count != null && (
              <p className="text-[11px] text-text-lightgray">표본 {ratio.sample_count.toLocaleString('ko-KR')}건 기준</p>
            )}
          </>
        )}
      </SectionCard>

      {/* 3. 최근 실거래가 */}
      <SectionCard title="🏘️ 최근 실거래가">
        {transactionsLoading ? (
          <p className="text-xs text-text-lightgray">불러오는 중...</p>
        ) : transactionsError ? (
          <p className="text-xs text-danger">{transactionsError}</p>
        ) : (
          <>
            {transactions && formatYmRange(transactions.fromYm, transactions.toYm) && (
              <p className="text-[11px] text-text-lightgray">
                {formatYmRange(transactions.fromYm, transactions.toYm)} 거래 중 최신순 상위 20건까지 표시해요(총 {transactions.transactions.length}건).
              </p>
            )}
            {transactions?.expandedToSigungu && input.eupmyeondong && (
              <p className="text-[11px] font-medium text-primary">
                {input.eupmyeondong} 기준 거래가 적어 {input.sigunguName} 전체 범위로 확대했어요.
              </p>
            )}
            {!transactions || transactions.transactions.length === 0 ? (
              <p className="text-xs text-text-lightgray">{transactions?.note ?? '조회된 실거래가가 없어요.'}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-border text-text-lightgray">
                      <th className="py-1.5 pr-2 font-medium">건물명</th>
                      <th className="py-1.5 pr-2 font-medium">전용면적</th>
                      <th className="py-1.5 pr-2 font-medium">거래연월</th>
                      <th className="py-1.5 pr-2 font-medium">유형</th>
                      <th className="py-1.5 font-medium">가격</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.transactions.map((t, idx) => (
                      <tr key={idx} className="border-b border-border/60">
                        <td className="py-1.5 pr-2 text-text-dark">{t.buildingName}</td>
                        <td className="py-1.5 pr-2 text-text-gray">{t.exclusiveArea != null ? `${t.exclusiveArea}㎡` : '-'}</td>
                        <td className="py-1.5 pr-2 text-text-gray">{t.dealYearMonth}</td>
                        <td className="py-1.5 pr-2 text-text-gray">{t.dealType}</td>
                        <td className="py-1.5 text-text-dark">
                          {formatManwon(t.price)}
                          {t.monthlyRent ? ` / 월 ${t.monthlyRent.toLocaleString('ko-KR')}만원` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* 4. 임대인 대조 (이름 입력했을 때만) */}
      {input.landlordName && (
        <SectionCard title="🔍 임대인 대조">
          {hugLoading ? (
            <p className="text-xs text-text-lightgray">조회 중...</p>
          ) : hugError ? (
            <p className="text-xs text-danger">{hugError}</p>
          ) : hugResult ? (
            <>
              <p className="text-xs font-bold text-text-dark">
                "{input.landlordName}" — HUG 상습채무불이행자 명단 일치 {hugResult.matchCount}건
              </p>
              {hugResult.matches.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {hugResult.matches.map((m, idx) => (
                    <li key={idx} className="text-xs text-text-gray">
                      {m.name} · {m.sigunguName ?? '지역 미확인'} {m.age != null ? `· ${m.age}세` : ''}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[11px] leading-relaxed text-danger">
                <BrokenText text={hugResult.warning} />
              </p>
            </>
          ) : null}
        </SectionCard>
      )}

      {/* 5. 계약 체크리스트 */}
      <SectionCard title="✅ 계약 체크리스트">
        <ContractChecklist propertyType={input.propertyType} dealType={input.dealType} />
      </SectionCard>

      {/* 저장 */}
      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-bold text-text-dark">이 매물 저장하기</h2>
        <p className="text-[11px] text-text-lightgray">
          {PROPERTY_TYPE_LABELS[input.propertyType]} · {DEAL_TYPE_LABELS[input.dealType]} · 임대인 정보는 저장되지 않아요.
        </p>
        {isLoggedIn === false ? (
          <Button type="button" onClick={() => navigate('/login')}>
            로그인하고 저장하기
          </Button>
        ) : saveState === 'saved' ? (
          <p className="text-xs font-bold text-primary">저장했어요! "내 매물함" 탭에서 확인하세요.</p>
        ) : (
          <>
            <input
              type="text"
              value={savedLabel}
              onChange={(e) => setSavedLabel(e.target.value)}
              placeholder="매물 별칭 (선택, 예: 강남 원룸)"
              className="h-11 w-full rounded-input border-[1.2px] border-border bg-white px-3 text-sm text-text-dark outline-none placeholder:text-text-lightgray focus:border-primary"
            />
            {saveError && <p className="text-xs text-danger">{saveError}</p>}
            <Button type="button" onClick={handleSave} disabled={saveState === 'saving'}>
              {saveState === 'saving' ? '저장 중...' : '이 매물 저장하기'}
            </Button>
          </>
        )}
      </Card>
    </div>
  )
}
