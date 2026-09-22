import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import BrokenText from '../components/ui/BrokenText'
import Card from '../components/ui/Card'
import LegalTermCard from '../components/ui/LegalTermCard'
import TopNav from '../components/TopNav'
import { fetchLegalTerms, type LegalTerm } from '../lib/legalTerms'
import { searchLegalTermsLive, type LiveLegalTermResult } from '../lib/lawSearch'

const UNAVAILABLE_MESSAGE = '지금은 이 기능을 이용할 수 없습니다. 잠시 후 다시 시도해주세요.'

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="뒤로가기"
      className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-text-gray shadow-card"
    >
      ←
    </button>
  )
}

function LiveResultCard({ item }: { item: LiveLegalTermResult }) {
  return (
    <Card className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-text-dark">{item.term}</h3>
        {item.aiGenerated && (
          <span className="shrink-0 rounded-chip bg-subtle px-2 py-0.5 text-[10px] font-bold text-text-gray">
            AI 생성
          </span>
        )}
      </div>
      {item.plainExplanation && (
        <p className="text-pretty text-xs leading-relaxed text-text-dark">
          <BrokenText text={item.plainExplanation} />
        </p>
      )}
      {item.officialDefinition && (
        <p className="text-pretty text-[11px] leading-relaxed text-text-gray">
          법령상 정의: <BrokenText text={item.officialDefinition} />
        </p>
      )}
      {item.source && <p className="text-[10px] leading-relaxed text-text-lightgray">출처: {item.source}</p>}
    </Card>
  )
}

export default function LawSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [verifiedTerms, setVerifiedTerms] = useState<LegalTerm[]>([])
  const [searchedFor, setSearchedFor] = useState<string | null>(null)
  const [verifiedMatch, setVerifiedMatch] = useState<LegalTerm | null>(null)
  const [showLive, setShowLive] = useState(false)
  const [liveLoading, setLiveLoading] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [liveResult, setLiveResult] = useState<LiveLegalTermResult | null>(null)
  const [liveIrrelevantMessage, setLiveIrrelevantMessage] = useState<string | null>(null)

  useEffect(() => {
    fetchLegalTerms()
      .then(setVerifiedTerms)
      .catch(() => setVerifiedTerms([]))
  }, [])

  async function runLiveSearch(term: string) {
    setLiveLoading(true)
    setLiveError(null)
    setLiveResult(null)
    setLiveIrrelevantMessage(null)
    try {
      const res = await searchLegalTermsLive(term)
      if ('irrelevant' in res) {
        setLiveIrrelevantMessage(res.message)
      } else {
        setLiveResult(res)
      }
    } catch {
      setLiveError(UNAVAILABLE_MESSAGE)
    } finally {
      setLiveLoading(false)
      setShowLive(true)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const term = query.trim()
    if (!term) return

    setSearchedFor(term)
    setShowLive(false)
    setLiveResult(null)
    setLiveIrrelevantMessage(null)
    setLiveError(null)

    const match = verifiedTerms.find((t) => t.term === term)
    setVerifiedMatch(match ?? null)

    if (!match) {
      await runLiveSearch(term)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <TopNav variant="app" />
      <div className="mx-auto w-full max-w-app flex-1 px-5 py-6 lg:max-w-[720px] lg:px-6 lg:py-10">
        <div className="flex items-center gap-3">
          <BackButton onClick={() => navigate(-1)} />
          <h1 className="text-lg font-bold text-primary lg:text-2xl">법령 원문 검색</h1>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-text-lightgray">
          <BrokenText text="용어 사전에 없는 단어도 검색할 수 있어요. 관련 법 조문이 없으면 AI가 생성한 설명이 대신 나올 수 있으니, 그런 경우 참고용으로만 확인해주세요." />
        </p>

        <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="검색어를 입력하세요 (예: 근저당)"
            className="h-11 flex-1 rounded-input border-[1.2px] border-border bg-white px-4 text-sm text-text-dark outline-none placeholder:text-text-lightgray focus:border-primary"
          />
          <button
            type="submit"
            className="h-11 shrink-0 rounded-btn bg-primary px-5 text-sm font-bold text-white shadow-btn active:opacity-80"
          >
            검색
          </button>
        </form>

        {searchedFor && (
          <div className="mt-4 flex flex-col gap-3">
            {verifiedMatch && (
              <>
                <p className="text-[11px] font-bold text-text-gray">✅ 검증된 용어 사전 결과</p>
                <LegalTermCard item={verifiedMatch} />

                {!showLive && (
                  <button
                    type="button"
                    onClick={() => runLiveSearch(searchedFor)}
                    className="self-start text-xs font-bold text-primary underline underline-offset-2"
                  >
                    다른 설명도 찾아보기 →
                  </button>
                )}
              </>
            )}

            {liveLoading && <p className="py-4 text-center text-xs text-text-lightgray">검색하는 중...</p>}

            {showLive && liveError && (
              <Card className="border-dashed text-center">
                <p className="text-pretty text-xs leading-relaxed text-text-gray">{liveError}</p>
              </Card>
            )}

            {showLive && !liveError && liveIrrelevantMessage && (
              <Card className="border-dashed text-center">
                <p className="text-pretty text-xs leading-relaxed text-text-gray">{liveIrrelevantMessage}</p>
              </Card>
            )}

            {showLive && !liveError && liveResult && (
              <div className="flex flex-col gap-2.5">
                {liveResult.aiGenerated && (
                  <div className="rounded-card border-2 border-warning bg-warning-bg p-3">
                    <p className="text-pretty text-xs font-bold leading-relaxed text-text-dark">
                      ⚠️ 이 설명은 AI가 자동 생성한 것으로, 사람이 직접 검증하지 않았습니다. 참고용으로만 확인하세요.
                    </p>
                  </div>
                )}
                <LiveResultCard item={liveResult} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
