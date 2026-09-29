// scripts/populate-sigungu-population.mjs
// 행정안전부 도로명별 주민등록 인구 API가 Supabase Edge Function(Deno Deploy 클라우드 IP)
// 환경에서는 응답을 주지 않는 문제(법제처 API 때와 동일한 IP 기반 접근 제한으로 추정)가 있어,
// calculate-hug-density는 이 API를 직접 호출하지 않는다. 대신 이 스크립트를 로컬(브라우저와
// 마찬가지로 일반 ISP IP)에서 한 번 돌려 전국 시군구 인구를 sigungu_population 테이블에
// 미리 채워 넣는다.
//
// _shared/regions.ts(전국 시군구 코드 목록)를 순회하면서 각 시군구의
// roadNmCd(시군구코드 5자리 + '0000000')로 도로명별 인구를 조회하고, totNmprCnt를 합산해서
// sigungu_population에 upsert한다.
//
// 사용법: node scripts/populate-sigungu-population.mjs
// 필요 env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POPULATION_API_KEY (.env.local)
//
// data.go.kr 15108092(행정안전부_도로명별 주민등록 인구 및 세대현황) API — 엔드포인트/파라미터는
// calculate-hug-density를 만들 때 공식 문서 페이지(JS 렌더링이라 정적 크롤링 불가)에 내장된
// Swagger(OAS) JSON에서 직접 확인한 것과 동일하다.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const REGIONS_TS_PATH = path.join(
  ROOT,
  "supabase/functions/_shared/regions.generated.ts",
);

const ROADNAME_POPULATION_ENDPOINT =
  "https://apis.data.go.kr/1741000/rnPpltnHhStus/selectRnPpltnHhStus";
const POPULATION_API_KEY = process.env.POPULATION_API_KEY;

const REQUEST_DELAY_MS = 300; // 공공데이터포털 호출량 제한을 배려한 딜레이
const MAX_MONTH_FALLBACKS = 3; // 최신월 데이터가 아직 없으면 한 달씩 거슬러 최대 3번 재시도
const PAGE_SIZE = 100; // numOfRows 최대값(스펙상 1~100)
const MAX_PAGES = 30; // 시군구 하나의 도로명 수가 비정상적으로 많을 때를 대비한 안전 상한

// .env.local에는 프론트엔드(Vite)용 VITE_SUPABASE_URL만 있고 순수 SUPABASE_URL은 없어서 폴백한다.
// 다만 서비스 롤 키는 폴백이 없다 — sigungu_population은 RLS로 anon/authenticated 쓰기가
// 막혀 있어(마이그레이션 참고) VITE_SUPABASE_ANON_KEY로는 upsert가 실패하므로, Supabase
// 대시보드(Project Settings > API > service_role secret)에서 직접 받아 .env.local에
// SUPABASE_SERVICE_ROLE_KEY로 추가해야 한다.
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "[populate-sigungu-population] .env.local에 SUPABASE_URL(또는 VITE_SUPABASE_URL)과 " +
      "SUPABASE_SERVICE_ROLE_KEY가 필요합니다. 서비스 롤 키는 Supabase 대시보드 > " +
      "Project Settings > API > service_role secret에서 확인할 수 있습니다 " +
      "(anon/publishable 키로는 RLS 때문에 쓰기가 실패합니다).",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** regions.generated.ts는 TS 파일이라 Node에서 바로 import할 수 없어(프로젝트에 ts-node/tsx가
 *  없음), scripts/generate-regions.mjs가 만드는 고정 포맷(`{ code: '...', name: '...' },`)을
 *  정규식으로 그대로 파싱한다 — 그 스크립트의 출력 포맷이 바뀌면 이 정규식도 같이 바뀌어야 한다. */
function loadAllRegions() {
  const text = readFileSync(REGIONS_TS_PATH, "utf8");
  const regions = [];
  const re = /\{\s*code:\s*'(\d+)',\s*name:\s*'([^']+)'\s*\}/g;
  let match;
  while ((match = re.exec(text))) {
    regions.push({ code: match[1], name: match[2] });
  }
  return regions;
}

function parseAmount(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/,/g, "").trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** 이번 달 i개월 전(1부터 시작)의 YYYYMM. i=1이면 지난달. */
function monthsAgoYYYYMM(i) {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const target = new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - i, 1),
  );
  const yyyy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, "0");
  return `${yyyy}${mm}`;
}

// head가 {resultCode,...} 형태인 계열과 [{totalCount}, {RESULT:{resultCode,...}}] 형태인 계열이
// 둘 다 있어(문서로 100% 확신 못함) 둘 다 시도한다 — calculate-hug-density와 동일한 방어 로직.
function extractResultCode(head) {
  if (Array.isArray(head)) {
    for (const entry of head) {
      if (entry?.RESULT?.resultCode) return String(entry.RESULT.resultCode);
      if (entry?.resultCode) return String(entry.resultCode);
    }
    return undefined;
  }
  return head?.resultCode;
}

function extractTotalCount(head) {
  if (Array.isArray(head)) {
    for (const entry of head) {
      if (entry?.totalCount != null) return Number(entry.totalCount);
    }
    return 0;
  }
  return Number(head?.totalCount ?? 0);
}

/** 한 페이지를 조회한다. resultCode가 NODATA_ERROR(3)면 빈 배열, 그 외 에러 코드면 예외를 던진다. */
async function fetchPopulationPage(roadNmCd, yyyymm, pageNo) {
  const params = new URLSearchParams({
    serviceKey: POPULATION_API_KEY,
    roadNmCd,
    srchFrYm: yyyymm,
    srchToYm: yyyymm,
    type: "JSON",
    numOfRows: String(PAGE_SIZE),
    pageNo: String(pageNo),
  });

  const res = await fetch(`${ROADNAME_POPULATION_ENDPOINT}?${params.toString()}`);
  const rawText = await res.text();

  if (!res.ok) {
    throw new Error(`행안부 인구 API HTTP ${res.status}: ${rawText.slice(0, 200)}`);
  }

  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new Error(`행안부 인구 API 비JSON 응답: ${rawText.slice(0, 200)}`);
  }

  const root = json?.response ?? json;
  const head = root?.head;
  const resultCode = extractResultCode(head);

  if (resultCode === "3") return { items: [], totalCount: 0 }; // NODATA_ERROR — 해당 월 데이터 없음
  if (resultCode && !["00", "0"].includes(resultCode)) {
    throw new Error(`행안부 인구 API 오류 코드 ${resultCode}: ${rawText.slice(0, 200)}`);
  }

  const itemsContainer = root?.items;
  const rawItems = itemsContainer?.item ?? itemsContainer;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  return { items, totalCount: extractTotalCount(head) };
}

/** roadNmCd(시군구코드+'0000000')로 그 시군구에 속한 모든 도로명의 총인구수를 합산한다.
 *  최신월 데이터가 아직 안 올라왔으면(NODATA) 최대 MAX_MONTH_FALLBACKS번 이전 달로 재시도한다. */
async function fetchSigunguPopulation(sigunguCode) {
  const roadNmCd = `${sigunguCode}0000000`;

  for (let monthOffset = 1; monthOffset <= MAX_MONTH_FALLBACKS; monthOffset++) {
    const yyyymm = monthsAgoYYYYMM(monthOffset);

    const firstPage = await fetchPopulationPage(roadNmCd, yyyymm, 1);
    if (firstPage.items.length === 0) continue; // 이 달은 데이터 없음 — 이전 달로 폴백

    const allItems = [...firstPage.items];
    const totalPages = Math.min(
      Math.ceil(firstPage.totalCount / PAGE_SIZE),
      MAX_PAGES,
    );
    for (let page = 2; page <= totalPages; page++) {
      await sleep(REQUEST_DELAY_MS);
      const nextPage = await fetchPopulationPage(roadNmCd, yyyymm, page);
      allItems.push(...nextPage.items);
      if (nextPage.items.length === 0) break;
    }

    return allItems.reduce(
      (sum, item) => sum + (parseAmount(item.totNmprCnt) ?? 0),
      0,
    );
  }

  return null; // 최근 몇 달치 모두 데이터 없음
}

async function main() {
  if (!POPULATION_API_KEY) {
    console.error(
      "[populate-sigungu-population] POPULATION_API_KEY가 설정되어 있지 않습니다(.env.local 확인).",
    );
    process.exitCode = 1;
    return;
  }

  const regions = loadAllRegions();
  console.log(`[populate-sigungu-population] 총 ${regions.length}개 시군구 조회 시작`);

  let succeeded = 0;
  const failed = [];

  for (const [index, region] of regions.entries()) {
    // TODO(debug): 대부분 지역이 "최근 3개월 모두 데이터 없음"으로 스킵되는 문제 확인용 임시
    // 로그 — 강남구는 브라우저 직접 테스트에서 roadNmCd=116800000000으로 정상 응답을 받았다고
    // 확인됐으니, 이 값과 실제로 비교해서 포맷이 일치하는지 볼 것. 원인 파악되면 제거할 것.
    console.log(
      `[DEBUG populate-sigungu-population] ${region.name}(${region.code}) → roadNmCd=${region.code}0000000`,
    );

    try {
      const population = await fetchSigunguPopulation(region.code);
      if (population == null) {
        console.warn(
          `[populate-sigungu-population] ${region.name}(${region.code}) — 최근 ${MAX_MONTH_FALLBACKS}개월 모두 데이터 없음, 건너뜀`,
        );
        failed.push(region);
        continue;
      }

      const { error } = await supabase.from("sigungu_population").upsert(
        {
          sigungu_code: region.code,
          sigungu_name: region.name,
          population,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "sigungu_code" },
      );
      if (error) throw error;

      succeeded++;
      if ((index + 1) % 20 === 0) {
        console.log(
          `[populate-sigungu-population] ${index + 1}/${regions.length} 처리 (${region.name}: ${population.toLocaleString("ko-KR")}명)`,
        );
      }
    } catch (err) {
      console.error(
        `[populate-sigungu-population] ${region.name}(${region.code}) 실패`,
        err.message ?? err,
      );
      failed.push(region);
    }

    await sleep(REQUEST_DELAY_MS);
  }

  console.log(
    `[populate-sigungu-population] 완료 — 성공 ${succeeded}건, 실패 ${failed.length}건`,
  );
  if (failed.length > 0) {
    console.log(
      "[populate-sigungu-population] 실패 목록:",
      failed.map((r) => `${r.name}(${r.code})`).join(", "),
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[populate-sigungu-population] 실패", err);
  process.exitCode = 1;
});
