import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchLatestNews, type NewsItem } from "../lib/news";

function formatNewsDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : value;
}

const NEWS_PAGE_SIZE = 3;

const FEATURES = [
  {
    icon: "◈",
    title: "지역별 주거 위험도",
    body: "전세가율, 사고 이력, 시세 흐름을 지도 위에서 한눈에 비교하세요.",
  },
  {
    icon: "✓",
    title: "HUG 공식 데이터 대조",
    body: "주택도시보증공사 상습 채무불이행자 명단과 지역 통계를 참고하세요.",
  },
  {
    icon: "◆",
    title: "국토교통부 실거래가 기반",
    body: "공식 실거래가 통계로 지역별 전세가율과 위험도를 계산해요.",
  },
];

export default function Home() {
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [newsExpanded, setNewsExpanded] = useState(false);

  useEffect(() => {
    fetchLatestNews(12)
      .then(setNewsItems)
      .catch((err) =>
        setNewsError(
          err instanceof Error ? err.message : "뉴스를 불러오지 못했습니다.",
        ),
      )
      .finally(() => setNewsLoading(false));
  }, []);

  return (
    <div className="flex w-full flex-col gap-8 px-5 pt-6 pb-4 lg:mx-auto lg:max-w-[1040px] lg:gap-14 lg:px-6 lg:pb-16 lg:pt-10">
      <header className="lg:hidden">
        <h1 className="text-lg font-bold text-primary">매물 탐색</h1>
        <p className="mt-1 text-xs text-text-gray">
          계약 전에, 위험을 먼저 확인하세요
        </p>
      </header>

      <section>
        <div className="mb-5 inline-flex items-center gap-[7px] rounded-chip bg-primary-bg px-3.5 py-[7px] text-[13px] font-bold text-primary-dark">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          상경 청년을 위한 안심 주거 파트너
        </div>
        <h2 className="text-balance text-[32px] font-extrabold leading-[1.15] tracking-tight text-text-dark lg:text-[42px]">
          계약 전에,
          <br />
          위험을 먼저 확인하세요
        </h2>
        <p className="mt-5 max-w-[440px] text-[15px] leading-relaxed text-text-gray lg:text-[17px]">
          살고 싶은 동네의 주거 위험도를 지도에서 한눈에 확인하고,
          <br />
          처음 서울 살이, 이제 혼자 걱정하지 마세요.
        </p>
        <Link
          to="/map"
          className="mt-6 inline-flex items-center justify-center rounded-btn bg-primary px-6 py-3 text-sm font-bold text-white"
        >
          안심 시그널 맵 보기 →
        </Link>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="rounded-2xl border border-border bg-subtle p-6"
          >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary-bg text-xl text-primary">
              {feature.icon}
            </div>
            <div className="text-balance text-[17px] font-bold text-text-dark">
              {feature.title}
            </div>
            <p className="mt-1.5 text-pretty text-[13px] leading-relaxed text-text-gray">
              {feature.body}
            </p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-sm font-bold text-text-dark lg:text-base">
          뉴스 살펴보기
        </h2>
        <p className="mt-1 text-xs font-medium text-primary-dark lg:text-[13px]">
          최근 발생한 전세사기 관련 뉴스를 확인해 보세요
        </p>
        <div className="mt-3 rounded-card border border-border bg-card p-0 shadow-card">
          {newsLoading ? (
            <p className="p-4 text-xs text-text-gray">뉴스를 불러오는 중...</p>
          ) : newsError ? (
            <p className="p-4 text-xs text-danger">{newsError}</p>
          ) : newsItems.length === 0 ? (
            <p className="p-4 text-xs text-text-gray">
              아직 등록된 뉴스가 없어요.
            </p>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-border px-4">
                {(newsExpanded
                  ? newsItems
                  : newsItems.slice(0, NEWS_PAGE_SIZE)
                ).map((item) => (
                  <li key={item.id} className="py-3.5">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-[13px] font-medium leading-snug text-text-dark hover:text-primary"
                    >
                      {item.title}
                    </a>
                    <p className="mt-1 text-[11px] text-text-lightgray">
                      {item.media ? `${item.media} · ` : ""}
                      {formatNewsDate(item.published_at)}
                    </p>
                  </li>
                ))}
              </ul>
              {newsItems.length > NEWS_PAGE_SIZE && (
                <button
                  type="button"
                  onClick={() => setNewsExpanded((v) => !v)}
                  className="w-full border-t border-border py-3 text-center text-xs font-bold text-primary"
                >
                  {newsExpanded ? "접기" : "뉴스 더보기"}
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
