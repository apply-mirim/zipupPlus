// 각 배치 Edge Function이 실행을 마칠 때(성공/실패 모두) `batch_job_status`에 자신의
// 상태를 기록하기 위한 공통 헬퍼. 프론트(마이페이지)가 이 테이블을 읽어 "마지막 갱신: N시간 전"을
// 보여준다 — see docs/PROJECT_OVERVIEW.md의 sync-news 401 무응답 사고 기록.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type JobOutcome = { success: true; result?: unknown } | { success: false; error: string }

/** 실패해도(예: batch_job_status 자체에 문제가 생겨도) 배치 작업 본연의 결과 응답은 막지 않도록
 *  호출부에서 이 함수의 실패를 별도로 처리하지 않는다 — 에러는 로그만 남긴다. */
export async function recordJobRun(supabase: SupabaseClient, jobName: string, outcome: JobOutcome): Promise<void> {
  const now = new Date().toISOString()

  // 성공/실패 두 분기를 하나의 `patch` 변수(유니온 타입)로 묶어 upsert()에 한 번만 넘기면,
  // 최신 supabase-js의 upsert() 오버로드가 제네릭 행 타입을 유니온 전체에서 추론하다가
  // "실패 분기엔 없는 last_success_at/last_result가 성공 분기 기준으로는 필수"라고 오판해
  // 타입 에러를 낸다(RejectExcessProperties가 유니온을 분배(distribute)하지 않고 한쪽 분기
  // 형태를 기준으로 다른 분기를 검사하는 것으로 보임). 분기별로 upsert()를 따로 호출해 각
  // 호출이 단일하고 명확한 객체 타입만 받도록 피한다 — 실패 시 last_success_at/last_result를
  // 컬럼째로 생략해 이전 성공 기록을 덮어쓰지 않는 동작(partial upsert)은 그대로 유지된다.
  if (outcome.success) {
    const patch = {
      job_name: jobName,
      last_run_at: now,
      last_success_at: now,
      last_error: null,
      last_result: outcome.result ?? null,
      updated_at: now,
    }
    const { error } = await supabase.from('batch_job_status').upsert(patch, { onConflict: 'job_name' })
    if (error) {
      console.error(`recordJobRun(${jobName}): failed to update batch_job_status`, error)
    }
    return
  }

  const patch = {
    job_name: jobName,
    last_run_at: now,
    // 사용자 대면 에러 메시지 수준으로만 저장 — 스택 트레이스나 시크릿이 섞여 들어가지
    // 않도록 호출부에서 이미 정리된 메시지를 넘긴다는 전제. 길이도 방어적으로 제한.
    last_error: outcome.error.slice(0, 500),
    updated_at: now,
  }
  const { error } = await supabase.from('batch_job_status').upsert(patch, { onConflict: 'job_name' })
  if (error) {
    console.error(`recordJobRun(${jobName}): failed to update batch_job_status`, error)
  }
}
