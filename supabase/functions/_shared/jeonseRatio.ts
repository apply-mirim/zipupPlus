// 아파트/연립다세대(빌라) 매매·전월세 실거래가로 전세가율을 계산하는 공용 로직.
// `fetch-market-data`(전국 배치 갱신, region_stats)와 `calculate-jeonse-ratio`(사용자 요청
// 단건 조회, district_jeonse_ratios)가 이 모듈을 공유한다 — 원래는 두 함수에 각각 따로
// 구현돼 있었는데, fetch-market-data 쪽이 단순 평균만 내던 탓에 매매/전세 표본의 평형 구성이
// 다를 때 전세가율이 왜곡되는 문제가 있어(서초구에서 실측 확인) calculate-jeonse-ratio의
// 검증된 계산 방식으로 통일했다.
//
// 전세가율 계산: 매매 표본과 전세 표본을 단순히 통째로 평균 내 나누면 왜곡되므로, 전용면적
// (excluUseAr) 기준 3개 구간(60㎡ 이하 / 60~85㎡ / 85㎡ 초과)으로 나눠 구간별 전세가율을 구하고,
// 구간별 표본 수(매매+전세 건수)를 가중치로 가중평균한다. 구간 표본이 매매·전세 각각
// MIN_SAMPLES_FOR_RATIO 미만이면 그 구간은 가중평균에서 제외한다.
//
// 조회 기간: 최근 INITIAL_LOOKBACK_MONTHS(3)개월을 우선 조회하고, 원시 레코드 합계가
// MIN_RAW_RECORDS_BEFORE_EXTEND(20) 미만이면 EXTENDED_LOOKBACK_MONTHS(6)개월로 기간을 늘려
// 재조회한다(이미 받은 처음 3개월은 다시 부르지 않고 4~6개월 전만 추가로 받는다).
//
// 스로틀링: 지역 하나당 최대 24콜(4엔드포인트×6개월)이 fetchRegionMarketData 안에서 거의
// 동시에 나가는데, BATCH_SIZE를 50으로 올린 뒤 실전 배치에서 MOLIT API가
// LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR(HTTP 429)를 대량으로 반환하는
// 것을 확인했다. MOLIT/data.go.kr는 초당 요청 제한 수치를 공개 문서에 명시하지 않으므로,
// 실측 429 발생을 근거로 보수적인 값(동시 3콜, 요청 시작 간 최소 150ms → 이론상 최대 약
// 초당 6.7건 시작)으로 전역 스로틀을 건다. 429(또는 그 리소스코드 메시지)를 받으면 1.5초
// 대기 후 1회만 재시도한다 — see withMolitThrottle/RATE_LIMIT_RETRY_DELAY_MS.

export const APT_TRADE_ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade'
export const APT_RENT_ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent'
export const VILLA_TRADE_ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade'
export const VILLA_RENT_ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent'

// 면적 구간별 매매/전세 각각 이 건수 미만이면 그 구간은 신뢰도가 낮다고 보고 가중평균에서 제외한다.
export const MIN_SAMPLES_FOR_RATIO = 5
// 1차 조회(최근 3개월) 원시 레코드 합계가 이 값 미만이면 6개월로 기간을 늘려 재조회한다.
export const MIN_RAW_RECORDS_BEFORE_EXTEND = 20
export const INITIAL_LOOKBACK_MONTHS = 3
export const EXTENDED_LOOKBACK_MONTHS = 6

// 전용면적(㎡) 구간 — 경계값은 "이하/초과" 기준: 60㎡는 첫 구간, 85㎡는 둘째 구간에 포함된다.
const AREA_BUCKETS: { label: string; max: number }[] = [
  { label: '60㎡ 이하', max: 60 },
  { label: '60㎡ 초과 85㎡ 이하', max: 85 },
  { label: '85㎡ 초과', max: Infinity },
]

function areaBucketIndex(area: number): number {
  if (area <= 60) return 0
  if (area <= 85) return 1
  return 2
}

/** 이번 달 i개월 전(1부터 시작)의 YYYYMM. i=1이면 지난달, i=2면 지지난달. 이번 달은 신고
 *  건수가 안정되지 않았으므로 항상 "지난달"부터 거꾸로 센다. */
export function monthsAgoYYYYMM(i: number): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const target = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - i, 1))
  const yyyy = target.getUTCFullYear()
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0')
  return `${yyyy}${mm}`
}

export function recentMonths(n: number): string[] {
  return Array.from({ length: n }, (_, idx) => monthsAgoYYYYMM(idx + 1))
}

export function parseAmount(raw: unknown): number | null {
  if (raw == null) return null
  const cleaned = String(raw).replace(/,/g, '').trim()
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

// MOLIT/data.go.kr가 초당 요청 제한 수치를 문서에 밝히지 않아, 실제 429
// (LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR) 발생 사례를 근거로 보수적인
// 값을 잡는다 — 동시 최대 3콜 + 요청 "시작" 간격 최소 150ms(이론상 최대 초당 ~6.7건 시작).
// 이 두 제약을 모두 만족해야 다음 요청이 나가므로, 실제 순간 최대 동시 연결 수는 3보다도
// 낮게 유지되는 경우가 많다(간격 제약이 더 강하게 작용).
const MOLIT_MAX_CONCURRENCY = 3
const MOLIT_MIN_REQUEST_INTERVAL_MS = 150
// 429를 받으면 이 시간만큼 대기 후 딱 1회만 재시도한다 — 계속 재시도하면 이미 밀린 요청들이
// 더 쌓여 악화될 수 있어 1회로 제한한다.
const RATE_LIMIT_RETRY_DELAY_MS = 1500

let molitActiveRequests = 0
let molitLastRequestStartedAt = 0

/** 동시 실행 수(MOLIT_MAX_CONCURRENCY)와 요청 시작 간격(MOLIT_MIN_REQUEST_INTERVAL_MS)을
 *  모두 만족할 때까지 대기한 뒤 fn을 실행한다. 이 모듈로 나가는 모든 MOLIT API 호출이 반드시
 *  이 함수를 거치도록 해서 fetch-market-data(지역당 최대 24콜)든 calculate-jeonse-ratio든
 *  전역적으로 같은 스로틀을 공유한다. */
async function withMolitThrottle<T>(fn: () => Promise<T>): Promise<T> {
  for (;;) {
    const sinceLast = Date.now() - molitLastRequestStartedAt
    if (molitActiveRequests < MOLIT_MAX_CONCURRENCY && sinceLast >= MOLIT_MIN_REQUEST_INTERVAL_MS) {
      break
    }
    const waitMs = Math.max(MOLIT_MIN_REQUEST_INTERVAL_MS - sinceLast, 10)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }

  molitActiveRequests++
  molitLastRequestStartedAt = Date.now()
  try {
    return await fn()
  } finally {
    molitActiveRequests--
  }
}

function isRateLimitError(message: string): boolean {
  return message.includes('429') || message.includes('LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR')
}

/** data.go.kr의 XML→JSON 게이트웨이는 결과를 response.body.items.item으로 감싸며, 단일
 *  객체/배열 차이와 결과 없을 때 빈 문자열이 되는 특이 케이스를 흡수해준다. */
export async function fetchItems(endpoint: string, lawdCd: string, dealYmd: string, apiKey: string): Promise<Record<string, unknown>[]> {
  try {
    return await withMolitThrottle(() => fetchItemsOnce(endpoint, lawdCd, dealYmd, apiKey))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isRateLimitError(message)) throw err

    console.error(`MOLIT API rate limited, retrying once after ${RATE_LIMIT_RETRY_DELAY_MS}ms: ${message}`)
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS))
    return await withMolitThrottle(() => fetchItemsOnce(endpoint, lawdCd, dealYmd, apiKey))
  }
}

async function fetchItemsOnce(endpoint: string, lawdCd: string, dealYmd: string, apiKey: string): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({
    serviceKey: apiKey,
    LAWD_CD: lawdCd,
    DEAL_YMD: dealYmd,
    numOfRows: '1000',
    pageNo: '1',
    _type: 'json',
  })

  const res = await fetch(`${endpoint}?${params.toString()}`)
  const rawText = await res.text()

  if (!res.ok) {
    throw new Error(`MOLIT API HTTP ${res.status}: ${rawText.slice(0, 200)}`)
  }

  let json: Record<string, any>
  try {
    json = JSON.parse(rawText)
  } catch {
    throw new Error(`MOLIT API non-JSON response: ${rawText.slice(0, 200)}`)
  }
  // TODO(debug): 게이트웨이(공공데이터포털) 레벨 오류(트래픽/인증 제한 등)는 이 API 고유의
  // response.header.resultCode 형태가 아니라, data.go.kr 공통 오류 포맷(cmmMsgHeader 등)으로
  // 오는 경우가 있다 — 그러면 response 자체가 아예 없어서 바로 아래 resultCode 체크를
  // 통과(falsy)해버리고 items도 undefined라 "정상인데 결과 없음"으로 빈 배열을 반환해버린다.
  // 실측(여수시·순천시·목포시 등 대도시에서 6개월치가 통째로 0건 — 있을 수 없는 결과)으로
  // 이 경로가 429/스로틀링을 "에러 없음"으로 둔갑시키는 것으로 의심돼 방어 코드를 추가한다.
  if (!json?.response) {
    const gatewayError =
      json?.cmmMsgHeader?.returnAuthMsg ?? json?.cmmMsgHeader?.errMsg ?? json?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg
    throw new Error(`MOLIT API unexpected response shape${gatewayError ? ` (${gatewayError})` : ''}: ${rawText.slice(0, 300)}`)
  }

  // 성공 코드가 '00'이 아니라 '000'인 경우도 있다(다른 data.go.kr API와 다른 체계).
  const resultCode = json?.response?.header?.resultCode
  if (resultCode && !['00', '000'].includes(resultCode)) {
    throw new Error(`MOLIT API error ${resultCode}: ${json?.response?.header?.resultMsg}`)
  }

  const items = json?.response?.body?.items
  if (!items || typeof items === 'string') return []

  const item = items.item
  if (!item) return []
  return Array.isArray(item) ? item : [item]
}

/** 여러 개월치를 한 endpoint에 대해 병렬로 조회해 하나의 배열로 합친다. 한두 달 조회가
 *  실패해도(일시적 오류 등) 나머지 달의 데이터는 살리기 위해 개별 실패를 흡수한다.
 *
 *  TODO(debug): errorSink는 "아파트/빌라 실거래 데이터를 가져오지 못함"처럼 뭉뚱그려지던
 *  실패 사유(HTTP 상태 코드, MOLIT API 에러 코드/메시지 등)를 호출부까지 그대로 전달하기 위한
 *  임시 파라미터 — 원인 파악되면 제거할 것. 기존 console.error 로그는 그대로 유지한다. */
export async function fetchItemsForMonths(
  endpoint: string,
  lawdCd: string,
  months: string[],
  apiKey: string,
  logLabel: string,
  errorSink?: string[],
): Promise<Record<string, unknown>[]> {
  const results = await Promise.allSettled(months.map((month) => fetchItems(endpoint, lawdCd, month, apiKey)))
  const items: Record<string, unknown>[] = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'fulfilled') {
      items.push(...result.value)
    } else {
      console.error(`${logLabel}: month fetch failed`, result.reason)
      errorSink?.push(
        `${endpoint.split('/').pop()} ${months[i]}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      )
    }
  }
  return items
}

export interface HousingTypeData {
  trade: Record<string, unknown>[]
  rent: Record<string, unknown>[]
}

export async function fetchHousingType(
  tradeEndpoint: string,
  rentEndpoint: string,
  lawdCd: string,
  months: string[],
  apiKey: string,
  logLabel: string,
  errorSink?: string[],
): Promise<HousingTypeData> {
  const [trade, rent] = await Promise.all([
    fetchItemsForMonths(tradeEndpoint, lawdCd, months, apiKey, logLabel, errorSink),
    fetchItemsForMonths(rentEndpoint, lawdCd, months, apiKey, logLabel, errorSink),
  ])
  return { trade, rent }
}

export interface RegionMarketData {
  apt: HousingTypeData
  villa: HousingTypeData
  months: string[]
}

/** 시군구(LAWD_CD) 하나에 대해 아파트+빌라 매매/전월세 실거래가를 최근 3개월(부족하면
 *  6개월까지)치 조회한다. fetch-market-data/calculate-jeonse-ratio가 공유하는 단일 진입점.
 *  errorSink를 넘기면 개별 월/엔드포인트 실패 사유가 그 배열에 쌓인다(TODO(debug), 위 참고). */
export async function fetchRegionMarketData(
  lawdCd: string,
  apiKey: string,
  logLabel: string,
  errorSink?: string[],
): Promise<RegionMarketData> {
  let months = recentMonths(INITIAL_LOOKBACK_MONTHS)
  let [apt, villa] = await Promise.all([
    fetchHousingType(APT_TRADE_ENDPOINT, APT_RENT_ENDPOINT, lawdCd, months, apiKey, logLabel, errorSink),
    fetchHousingType(VILLA_TRADE_ENDPOINT, VILLA_RENT_ENDPOINT, lawdCd, months, apiKey, logLabel, errorSink),
  ])

  const totalRaw = apt.trade.length + apt.rent.length + villa.trade.length + villa.rent.length
  if (totalRaw < MIN_RAW_RECORDS_BEFORE_EXTEND) {
    // 이미 조회한 최근 3개월은 다시 부르지 않고, 그 이전 3개월(4~6개월 전)만 추가로 조회해 합친다.
    const extraMonths = recentMonths(EXTENDED_LOOKBACK_MONTHS).slice(INITIAL_LOOKBACK_MONTHS)
    const [extraApt, extraVilla] = await Promise.all([
      fetchHousingType(APT_TRADE_ENDPOINT, APT_RENT_ENDPOINT, lawdCd, extraMonths, apiKey, logLabel, errorSink),
      fetchHousingType(VILLA_TRADE_ENDPOINT, VILLA_RENT_ENDPOINT, lawdCd, extraMonths, apiKey, logLabel, errorSink),
    ])
    apt = { trade: apt.trade.concat(extraApt.trade), rent: apt.rent.concat(extraApt.rent) }
    villa = { trade: villa.trade.concat(extraVilla.trade), rent: villa.rent.concat(extraVilla.rent) }
    months = months.concat(extraMonths)
  }

  return { apt, villa, months }
}

export interface RatioSummary {
  ratio: number | null
  avgSalePrice: number | null
  avgJeonsePrice: number | null
  saleCount: number
  jeonseCount: number
}

/** 매매가/전세 보증금을 전용면적 구간별로 나눠 구간별 전세가율을 구하고, 구간별 표본 수
 *  (매매+전세 건수)를 가중치로 가중평균한 최종 ratio를 반환한다. avgSalePrice/avgJeonsePrice는
 *  구간과 무관한 전체 평균값(화면 표시용, region_stats.avg_sale_price 등) — ratio 계산에는
 *  쓰이지 않는다. */
export function summarizeAreaWeightedRatio(tradeItems: Record<string, unknown>[], rentItems: Record<string, unknown>[]): RatioSummary {
  const allSalePrices: number[] = []
  const allJeonseDeposits: number[] = []
  const salesByBucket: number[][] = AREA_BUCKETS.map(() => [])
  const jeonsesByBucket: number[][] = AREA_BUCKETS.map(() => [])

  for (const item of tradeItems) {
    const price = parseAmount(item.dealAmount)
    const area = parseAmount(item.excluUseAr)
    if (price == null) continue
    allSalePrices.push(price)
    if (area != null) salesByBucket[areaBucketIndex(area)].push(price)
  }

  for (const item of rentItems) {
    if ((parseAmount(item.monthlyRent) ?? 0) !== 0) continue
    const deposit = parseAmount(item.deposit)
    const area = parseAmount(item.excluUseAr)
    if (deposit == null) continue
    allJeonseDeposits.push(deposit)
    if (area != null) jeonsesByBucket[areaBucketIndex(area)].push(deposit)
  }

  let weightedRatioSum = 0
  let weightTotal = 0
  let saleCount = 0
  let jeonseCount = 0

  for (let i = 0; i < AREA_BUCKETS.length; i++) {
    const sales = salesByBucket[i]
    const jeonses = jeonsesByBucket[i]
    saleCount += sales.length
    jeonseCount += jeonses.length

    const avgSale = mean(sales)
    const avgJeonse = mean(jeonses)
    const qualifies = sales.length >= MIN_SAMPLES_FOR_RATIO && jeonses.length >= MIN_SAMPLES_FOR_RATIO
    const bucketRatio = qualifies && avgSale && avgJeonse ? (avgJeonse / avgSale) * 100 : null

    if (bucketRatio != null) {
      const weight = sales.length + jeonses.length
      weightedRatioSum += bucketRatio * weight
      weightTotal += weight
    }
  }

  const ratio = weightTotal > 0 ? weightedRatioSum / weightTotal : null

  return {
    ratio,
    avgSalePrice: mean(allSalePrices),
    avgJeonsePrice: mean(allJeonseDeposits),
    saleCount,
    jeonseCount,
  }
}
