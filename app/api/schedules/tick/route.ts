import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * Transitions expected_submissions statuses for the current day:
 * - not_due  → due    (where due_date <= today)
 * - due      → missed (where due_date < today)
 * - due      → missed (where due_date = today AND cutoff_time has passed)
 *
 * Uses the service role to bypass RLS — this needs to update all orgs' submissions.
 * Called from the branch-manager dashboard on load.
 */
export async function POST() {
  // Verify the caller is authenticated
  const authClient = await createServerClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use service role to bypass RLS for bulk status transitions
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const currentTime = now.toTimeString().slice(0, 8)

  // Activate today's and past not_due submissions
  await supabase
    .from('expected_submissions')
    .update({ status: 'due' })
    .eq('status', 'not_due')
    .lte('due_date', today)

  // Mark past-date due submissions as missed
  await supabase
    .from('expected_submissions')
    .update({ status: 'missed' })
    .eq('status', 'due')
    .lt('due_date', today)

  // Mark today's submissions as missed if cutoff_time has passed
  await supabase
    .from('expected_submissions')
    .update({ status: 'missed' })
    .eq('status', 'due')
    .eq('due_date', today)
    .not('cutoff_time', 'is', null)
    .lt('cutoff_time', currentTime)

  return NextResponse.json({ ok: true })
}
