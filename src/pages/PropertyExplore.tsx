import { useState } from 'react'
import PropertyReport from '../components/property/PropertyReport'
import PropertySearchForm from '../components/property/PropertySearchForm'
import SavedPropertiesPanel from '../components/property/SavedPropertiesPanel'
import type { PropertyReportInput } from '../components/property/types'

const TABS = ['매물 분석', '내 매물함'] as const
type Tab = (typeof TABS)[number]

export default function PropertyExplore() {
  const [tab, setTab] = useState<Tab>('매물 분석')
  const [reportInput, setReportInput] = useState<PropertyReportInput | null>(null)

  return (
    <div className="flex w-full flex-col gap-4 px-5 pt-6 pb-4 lg:mx-auto lg:max-w-[720px] lg:gap-6 lg:px-6 lg:py-10">
      <header className="lg:hidden">
        <h1 className="text-lg font-bold text-primary">매물 탐색</h1>
        <p className="mt-1 text-xs text-text-gray">주소를 입력하면 종합 리포트를 만들어드려요</p>
      </header>
      <div className="hidden lg:block">
        <h1 className="text-2xl font-bold text-text-dark">매물 탐색</h1>
        <p className="mt-1 text-sm text-text-gray">주소를 입력하면 종합 리포트를 만들어드려요</p>
      </div>

      <div className="flex gap-1.5 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-bold transition-colors ${
              tab === t ? 'border-primary text-primary' : 'border-transparent text-text-lightgray'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === '매물 분석' ? (
        <div className="flex flex-col gap-4">
          {reportInput ? (
            <>
              <button
                type="button"
                onClick={() => setReportInput(null)}
                className="self-start text-xs font-bold text-primary"
              >
                ← 다시 검색하기
              </button>
              <PropertyReport input={reportInput} />
            </>
          ) : (
            <PropertySearchForm onSubmit={setReportInput} />
          )}
        </div>
      ) : (
        <SavedPropertiesPanel />
      )}
    </div>
  )
}
