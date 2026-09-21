// Supabase Edge Function: delete-account
// Deletes the currently authenticated user via the Supabase Auth admin API (requires the
// service_role key, which is never exposed to the client).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: '로그인이 필요합니다.' }, 401)
  }

  const token = authHeader.slice('Bearer '.length)
  const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser(token)

  if (!user) {
    return jsonResponse({ error: '로그인이 필요합니다.' }, 401)
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id)

  if (deleteError) {
    console.error('delete-account error', deleteError)
    return jsonResponse({ error: '계정 삭제 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' }, 500)
  }

  return jsonResponse({ success: true })
})
