import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

// Cloudflare Workers exposes env bindings on the global scope when nodejs_compat is enabled
function getSupabaseConfig() {
  // Try process.env first (works after server.ts copies CF env to process.env)
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

  // Hard fallback — bake the values directly so they're always available
  return {
    url: url || 'https://jqfregzookauxjdvgina.supabase.co',
    key: key || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpxZnJlZ3pvb2thdXhqZHZnaW5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NDE3NzUsImV4cCI6MjA5NjUxNzc3NX0.bcsb1-eH0vSx1OkUHIGAk4fzkctu59yHx3RxwNYwuvs',
  }
}

export const requireSupabaseAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const { url: SUPABASE_URL, key: SUPABASE_KEY } = getSupabaseConfig()

    const request = getRequest()
    if (!request?.headers) throw new Error('Unauthorized: No request headers')

    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) throw new Error('Unauthorized')

    const token = authHeader.replace('Bearer ', '')

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    })

    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) throw new Error('Unauthorized: Invalid token')

    return next({ context: { supabase, userId: user.id, user } })
  },
)
