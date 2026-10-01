import { useEffect, useRef, useState, type FormEvent } from "react";
import BrokenText from "../components/ui/BrokenText";
import Card from "../components/ui/Card";
import Chip from "../components/ui/Chip";
import {
  fetchRegionStats,
  type RegionStat,
  type RiskLevel,
} from "../lib/regionStats";
import { loadKakaoSdk } from "../lib/kakaoMap";

interface DistrictFeature {
  type: "Feature";
  // code: 법정동코드 앞 5자리(LAWD_CD) = region_stats.region_code와 매칭하는 키.
  // region_name으로만 매칭하면 전국 단위에서 이름이 겹치는 지역(중구, 강서구 등)이 서로를
  // 덮어쓰므로, GeoJSON feature에는 항상 LAWD_CD가 들어있어야 한다.
  properties: { code: string; name: string };
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

const RISK_COLOR: Record<RiskLevel, string> = {
  위험: "#E5484D",
  주의: "#E8912A",
  안전: "#12A150",
};
const NO_DATA_COLOR = "#B4B1AB";

const CHIP_TONE: Record<RiskLevel, "danger" | "warning" | "success"> = {
  위험: "danger",
  주의: "warning",
  안전: "success",
};

function colorForRiskLevel(level: RiskLevel | null | undefined): string {
  return level ? RISK_COLOR[level] : NO_DATA_COLOR;
}

function ringToLatLngs(ring: number[][]): kakao.maps.LatLng[] {
  return ring.map(([lng, lat]) => new window.kakao.maps.LatLng(lat, lng));
}

function featurePaths(feature: DistrictFeature): kakao.maps.LatLng[][] {
  if (feature.geometry.type === "Polygon") {
    return feature.geometry.coordinates.map(ringToLatLngs);
  }
  return feature.geometry.coordinates.flatMap((polygon) =>
    polygon.map(ringToLatLngs),
  );
}

function boundsForFeature(feature: DistrictFeature): kakao.maps.LatLngBounds {
  const bounds = new window.kakao.maps.LatLngBounds();
  for (const path of featurePaths(feature)) {
    for (const latlng of path) bounds.extend(latlng);
  }
  return bounds;
}

function formatManwon(value: number | null): string {
  if (value == null) return "정보 없음";
  const eok = value / 10000;
  return eok >= 1
    ? `${eok.toFixed(1)}억원`
    : `${Math.round(value).toLocaleString("ko-KR")}만원`;
}

const LEGEND_ITEMS: { label: string; color: string }[] = [
  { label: "위험", color: RISK_COLOR.위험 },
  { label: "주의", color: RISK_COLOR.주의 },
  { label: "안전", color: RISK_COLOR.안전 },
  { label: "데이터 없음", color: NO_DATA_COLOR },
];

const RISK_FACTORS = [
  {
    label: "전세가율",
    weight: 50,
    detail:
      "국토교통부 실거래가 기준 아파트·빌라 전세가율. 시세 파악이 어려워 전세사기 위험이 더 큰 빌라(연립다세대) 전세가율에 더 큰 가중치를 둬요.",
  },
  {
    label: "HUG 채무불이행자 밀도",
    weight: 30,
    detail:
      "주택도시보증공사 상습채무불이행자 명단 중 해당 지역 주소로 집계된 등록 건수예요.",
  },
  {
    label: "전세사기 뉴스 언급",
    weight: 20,
    detail: "해당 지역이 전세사기 관련 기사에 언급된 빈도 기반 참고 지표예요.",
  },
];

export default function SignalMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<kakao.maps.Map | null>(null);
  const polygonsRef = useRef<kakao.maps.Polygon[]>([]);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [stats, setStats] = useState<RegionStat[]>([]);
  const [geoFeatures, setGeoFeatures] = useState<DistrictFeature[] | null>(
    null,
  );
  const [mapReady, setMapReady] = useState(false);
  const [selected, setSelected] = useState<
    RegionStat | { region_name: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [searchNotice, setSearchNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchRegionStats()
      .then(setStats)
      .catch((err) =>
        setError(
          err instanceof Error
            ? err.message
            : "지역 데이터를 불러오지 못했습니다.",
        ),
      );
  }, []);

  // SDK + 지도 인스턴스 + GeoJSON은 한 번만 로드한다.
  useEffect(() => {
    const appKey = import.meta.env.VITE_KAKAO_MAP_KEY;
    if (!appKey) {
      setError("카카오맵 API 키가 설정되지 않았어요. 관리자에게 문의하세요.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function init() {
      try {
        await loadKakaoSdk(appKey);
        const geoRes = await fetch("/data/skorea-municipalities.json");
        const geo: { features: DistrictFeature[] } = await geoRes.json();
        if (cancelled) return;

        setGeoFeatures(geo.features);

        if (mapContainerRef.current && !mapRef.current) {
          mapRef.current = new window.kakao.maps.Map(mapContainerRef.current, {
            center: new window.kakao.maps.LatLng(36.2, 127.9), // 전국이 한 화면에 들어오는 대략적인 중심
            level: 13,
          });
        }
        setMapReady(true);
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "지도를 불러오지 못했습니다.",
          );
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // region_stats가 갱신될 때마다(또는 지도가 준비되면) 폴리곤을 다시 그린다.
  useEffect(() => {
    if (!mapReady || !geoFeatures || !mapRef.current) return;

    polygonsRef.current.forEach((polygon) => polygon.setMap(null));
    polygonsRef.current = [];

    const statsByCode = new Map(stats.map((s) => [s.region_code, s]));

    for (const feature of geoFeatures) {
      const stat = statsByCode.get(feature.properties.code);
      const color = colorForRiskLevel(stat?.risk_level);

      const polygon = new window.kakao.maps.Polygon({
        path: featurePaths(feature),
        strokeWeight: 1.5,
        strokeColor: "#FFFFFF",
        strokeOpacity: 0.8,
        fillColor: color,
        fillOpacity: 0.6,
      });
      polygon.setMap(mapRef.current);

      window.kakao.maps.event.addListener(polygon, "mouseover", () => {
        polygon.setOptions({ fillOpacity: 0.85 });
      });
      window.kakao.maps.event.addListener(polygon, "mouseout", () => {
        polygon.setOptions({ fillOpacity: 0.6 });
      });
      window.kakao.maps.event.addListener(polygon, "click", () => {
        setSelected(stat ?? { region_name: feature.properties.name });
      });

      polygonsRef.current.push(polygon);
    }

    setLoading(false);
  }, [mapReady, geoFeatures, stats]);

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    setSearchNotice(null);

    const term = query.trim();
    if (!term || !geoFeatures || !mapRef.current) return;

    const index = geoFeatures.findIndex((f) => f.properties.name.includes(term));
    if (index === -1) {
      setSearchNotice("일치하는 지역을 찾지 못했어요. 시/군/구 이름으로 검색해보세요.");
      return;
    }

    const feature = geoFeatures[index];
    const statsByCode = new Map(stats.map((s) => [s.region_code, s]));
    const stat = statsByCode.get(feature.properties.code);

    mapRef.current.setBounds(boundsForFeature(feature));
    setSelected(stat ?? { region_name: feature.properties.name });

    const polygon = polygonsRef.current[index];
    if (polygon) {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      polygon.setOptions({ strokeWeight: 4, strokeColor: "#FF5A1F" });
      highlightTimerRef.current = setTimeout(() => {
        polygon.setOptions({ strokeWeight: 1.5, strokeColor: "#FFFFFF" });
      }, 1800);
    }
  }

  const selectedStat = selected && "risk_level" in selected ? selected : null;

  return (
    <div className="flex w-full flex-col gap-4 px-5 pt-6 pb-4 lg:mx-auto lg:max-w-[1120px] lg:gap-6 lg:px-6 lg:py-10">
      <header className="lg:hidden">
        <h1 className="text-lg font-bold text-primary">안심 시그널 맵</h1>
        <p className="mt-1 text-pretty text-xs text-text-gray">
          지역을 확대하여 전세사기 위험도를 확인하세요!
        </p>
      </header>

      <div className="hidden lg:block">
        <h1 className="text-2xl font-bold text-text-dark">안심 시그널 맵</h1>
        <p className="mt-1 text-pretty text-sm text-text-gray">
          지역을 확대하여 전세사기 위험도를 확인하세요!
        </p>
      </div>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[320px_1fr] lg:items-start lg:gap-5">
        {/* 왼쪽: 검색 + 위험도 계산 방식 */}
        <div className="flex flex-col gap-4">
          <Card>
            <form onSubmit={handleSearch} className="flex items-center gap-2 rounded-input border border-border-input px-3.5">
              <span className="text-text-lightgray">⌕</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="지역·동 이름 검색 (예: 관악구)"
                className="flex-1 border-none bg-transparent py-3 text-sm text-text-dark outline-none placeholder:text-text-lightgray"
              />
            </form>
            {searchNotice && (
              <p className="mt-2 text-[11px] font-medium text-danger">{searchNotice}</p>
            )}
          </Card>

          <Card>
            <h2 className="text-sm font-bold text-text-dark">위험도는 이렇게 계산돼요</h2>
            <div className="mt-3 flex flex-col gap-3.5">
              {RISK_FACTORS.map((factor) => (
                <div key={factor.label}>
                  <div className="flex items-center justify-between text-xs font-semibold text-text-dark">
                    <span>{factor.label}</span>
                    <span className="text-primary">{factor.weight}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${factor.weight}%` }} />
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-text-lightgray">
                    <BrokenText text={factor.detail} />
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3.5 border-t border-border pt-3 text-[10px] leading-relaxed text-text-lightgray">
              <BrokenText text="세 지표를 합산해 위험도 점수를 계산해요. 지역 위험도는 공식 피해 통계가 아닌 참고 지표이며, 특정 임대인이나 지역에 대한 법적 판단으로 사용될 수 없습니다." />
            </p>
          </Card>
        </div>

        {/* 오른쪽: 지도 + 선택한 지역 상세 */}
        <div className="flex flex-col gap-4">
          <Card className="overflow-hidden p-0 lg:p-5">
            <div className="relative overflow-hidden lg:rounded-[20px]">
              <div ref={mapContainerRef} className="h-[55vh] w-full lg:h-[520px]" />

              {loading && !error && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm text-text-gray">
                  지도를 불러오는 중...
                </div>
              )}

              {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white p-6 text-center">
                  <span className="text-2xl">⚠️</span>
                  <p className="text-xs leading-relaxed text-danger">{error}</p>
                </div>
              )}

              <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 rounded-input bg-white/90 px-3 py-2 shadow-card">
                {LEGEND_ITEMS.map((item) => (
                  <span
                    key={item.label}
                    className="flex items-center gap-1 text-[10px] font-medium text-text-dark"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
          </Card>

          {selectedStat && (
            <Card>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-text-dark">
                    {selectedStat.region_name}
                  </h2>
                  {selectedStat.risk_level && (
                    <Chip tone={CHIP_TONE[selectedStat.risk_level]}>
                      {selectedStat.risk_level}
                    </Chip>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="닫기"
                  className="text-xs font-bold text-text-gray"
                >
                  ✕
                </button>
              </div>

              {"jeonse_ratio" in selectedStat ? (
                <dl className="mt-3 grid grid-cols-2 gap-y-2 text-xs">
                  <dt className="text-text-gray">전세가율 (아파트)</dt>
                  <dd className="text-right font-medium text-text-dark">
                    {selectedStat.jeonse_ratio != null
                      ? `${selectedStat.jeonse_ratio.toFixed(1)}%`
                      : "정보 없음"}
                  </dd>
                  <dt className="text-text-gray">전세가율 (빌라)</dt>
                  <dd className="text-right font-medium text-text-dark">
                    {selectedStat.villa_jeonse_ratio != null
                      ? `${selectedStat.villa_jeonse_ratio.toFixed(1)}%`
                      : "정보 없음"}
                  </dd>
                  <dt className="text-text-gray">평균 매매가</dt>
                  <dd className="text-right font-medium text-text-dark">
                    {formatManwon(selectedStat.avg_sale_price)}
                  </dd>
                  <dt className="text-text-gray">평균 전세가</dt>
                  <dd className="text-right font-medium text-text-dark">
                    {formatManwon(selectedStat.avg_jeonse_price)}
                  </dd>
                  <dt className="text-text-gray">전세사기 뉴스 언급</dt>
                  <dd className="text-right font-medium text-text-dark">
                    {selectedStat.news_mentions != null
                      ? `${selectedStat.news_mentions.toLocaleString("ko-KR")}건`
                      : "정보 없음"}
                  </dd>
                  <dt className="text-text-gray">HUG 채무불이행자 등록</dt>
                  <dd className="text-right font-medium text-text-dark">
                    {selectedStat.hug_defaulter_count != null
                      ? `${selectedStat.hug_defaulter_count.toLocaleString("ko-KR")}명`
                      : "정보 없음"}
                  </dd>
                  <dt className="text-text-gray">위험도 점수</dt>
                  <dd className="text-right font-medium text-text-dark">
                    {selectedStat.risk_score != null
                      ? `${selectedStat.risk_score}점`
                      : "정보 없음"}
                  </dd>
                </dl>
              ) : (
                <p className="mt-3 text-xs text-text-gray">
                  아직 집계된 데이터가 없어요.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
