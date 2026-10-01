import type { DealType, PropertyType } from '../../lib/contractChecklist'

/** 주소 선택 + 매물 정보 입력 폼(PropertySearchForm)이 만들어서 리포트(PropertyReport)로
 * 넘기는 값. landlordName은 search-hug-defaulter-by-name 조회에만 쓰이고 저장되지 않는다
 * (saved_properties에는 이 필드 자체가 없음 — src/lib/savedProperties.ts 참고). */
export interface PropertyReportInput {
  address: string
  lat: number
  lng: number
  adminCode: string
  sigunguCode: string
  sigunguName: string
  /** resolve-address의 읍면동명 — get-recent-transactions가 동 단위로 먼저 좁혀 찾는 데 쓴다. */
  eupmyeondong: string | null
  propertyType: PropertyType
  dealType: DealType
  depositAmount: number | null
  monthlyRent: number | null
  landlordName: string
}
