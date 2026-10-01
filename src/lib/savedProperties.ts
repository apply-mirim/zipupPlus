import { supabase } from './supabase'
import type { DealType, PropertyType } from './contractChecklist'

export interface SavedProperty {
  id: string
  user_id: string
  label: string | null
  address: string
  lat: number
  lng: number
  admin_code: string
  sigungu_name: string
  property_type: PropertyType
  deal_type: DealType
  deposit_amount: number | null
  monthly_rent: number | null
  created_at: string
}

export interface NewSavedProperty {
  label?: string | null
  address: string
  lat: number
  lng: number
  admin_code: string
  sigungu_name: string
  property_type: PropertyType
  deal_type: DealType
  deposit_amount?: number | null
  monthly_rent?: number | null
}

// saved_properties는 RLS로 본인 행만 select/insert/delete 가능하도록 막혀 있어(auth.uid() =
// user_id), Edge Function 없이 프론트에서 Supabase 클라이언트로 직접 호출한다.

export async function fetchSavedProperties(): Promise<SavedProperty[]> {
  const { data, error } = await supabase
    .from('saved_properties')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

/** 임대인 이름은 절대 받지 않는다 — 리포트 조회(search-hug-defaulter-by-name)에만 쓰이고
 * 저장되지 않는다는 설계를 타입으로도 강제한다(NewSavedProperty에 그 필드 자체가 없음). */
export async function saveProperty(input: NewSavedProperty): Promise<SavedProperty> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError) throw new Error(userError.message)
  if (!userData.user) throw new Error('로그인이 필요합니다.')

  const { data, error } = await supabase
    .from('saved_properties')
    .insert({ ...input, user_id: userData.user.id })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function deleteSavedProperty(id: string): Promise<void> {
  const { error } = await supabase.from('saved_properties').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
