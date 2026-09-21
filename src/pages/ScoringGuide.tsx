import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import BrokenText from '../components/ui/BrokenText'
import Card from '../components/ui/Card'
import TopNav from '../components/TopNav'

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-bold text-text-dark">{title}</h2>
      <div className="mt-1.5 text-xs leading-relaxed text-text-gray">{children}</div>
    </div>
  )
}

interface WeightRow {
  name: string
  weight: string
  reason: string
}

// supabase/functions/_shared/riskScore.ts의 calculateRisk와 같은 값을 유지해야 한다.
const MAP_WEIGHTS: WeightRow[] = [
  { name: '전세가율', weight: '50%', reason: '국토교통부 실거래가로 계산한 정량 지표라 가장 신뢰도가 높아요.' },
  { name: 'HUG 상습 채무불이행자 밀도', weight: '30%', reason: '그 지역에서 실제로 보증금 사고가 얼마나 일어났는지를 보여줘요.' },
  { name: '뉴스 언급 빈도', weight: '20%', reason: '공식 통계가 아닌 참고 지표라 비중을 가장 낮게 뒀어요.' },
]

function WeightTable({ rows }: { rows: WeightRow[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.name} className="rounded-2xl bg-subtle p-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-bold text-text-dark">{row.name}</span>
            <span className="shrink-0 text-xs font-extrabold text-primary">{row.weight}</span>
          </div>
          <p className="mt-0.5 text-pretty text-[11px] leading-relaxed text-text-gray">{row.reason}</p>
        </li>
      ))}
    </ul>
  )
}

export default function ScoringGuide() {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <TopNav variant="app" />
      <div className="mx-auto w-full max-w-app flex-1 px-5 py-6 lg:max-w-[720px] lg:px-6 lg:py-10">
        <div className="flex items-center gap-3">
          <BackButton onClick={() => navigate(-1)} />
          <h1 className="text-lg font-bold text-primary lg:text-2xl">위험도 산정 기준</h1>
        </div>

        <Card className="mt-4 border-primary/30 bg-primary-bg/40 lg:mt-6">
          <p className="text-xs font-bold text-text-dark">📊 점수가 높을수록 위험합니다</p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-gray">
            <BrokenText text="안심 시그널 맵은 0~100점으로 표시되며, 점수가 높을수록 위험하다는 뜻이에요." />
          </p>
        </Card>

        <div className="mt-4 flex flex-col gap-5 lg:mt-6">
          <Section title="1. 안심 시그널 맵의 지역 위험도는 어떻게 계산되나요?">
            <BrokenText text="지역 단위 위험도는 아래 3가지를 가중 결합해 계산해요." />
            <WeightTable rows={MAP_WEIGHTS} />
            <p className="mt-2">
              <BrokenText text="지역 위험도 등급은 70점 이상이면 위험, 40점 이상이면 주의, 그 아래는 안전이에요. 전세가율은 아파트와 빌라를 각각 집계한 뒤 빌라 쪽에 70%, 아파트 쪽에 30% 비중을 둬서 하나로 합칩니다." />
            </p>
          </Section>

          <Section title="2. 참고해주세요">
            <ul className="flex flex-col gap-1">
              <li>
                <BrokenText text="· 이 점수는 계약 여부를 대신 판단해주는 것이 아니라, 무엇을 더 확인해야 하는지 알려주는 참고 지표예요." />
              </li>
              <li>
                <BrokenText text="· 실거래가·HUG 명단 등 원본 데이터가 갱신되면 같은 지역이라도 점수가 달라질 수 있어요." />
              </li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  )
}
