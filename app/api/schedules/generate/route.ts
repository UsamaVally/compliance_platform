import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { addDays, format, getDay } from 'date-fns'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify admin role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organisation_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: admin role required' }, { status: 403 })
  }

  let body: { schedule_id?: string; days?: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { schedule_id, days = 30 } = body

  if (!schedule_id) {
    return NextResponse.json({ error: 'schedule_id is required' }, { status: 400 })
  }

  if (days < 1 || days > 365) {
    return NextResponse.json({ error: 'days must be between 1 and 365' }, { status: 400 })
  }

  // Fetch schedule
  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .select('*')
    .eq('id', schedule_id)
    .single()

  if (scheduleError || !schedule) {
    return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  }

  // Ensure schedule belongs to the admin's organisation
  if (schedule.organisation_id !== profile.organisation_id) {
    return NextResponse.json({ error: 'Forbidden: schedule belongs to a different organisation' }, { status: 403 })
  }

  // Get all active stores for this organisation with their primary assigned user
  const { data: stores, error: storesError } = await supabase
    .from('stores')
    .select('id, branch_manager_id, user_store_assignments(user_id, is_primary)')
    .eq('organisation_id', schedule.organisation_id)
    .eq('is_active', true)

  if (storesError) {
    return NextResponse.json({ error: storesError.message }, { status: 500 })
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = format(today, 'yyyy-MM-dd')

  // Start from Monday of the current week so the whole current week gets entries
  const dayOfWeekToday = getDay(today) // 0=Sun...6=Sat
  const daysFromMonday = dayOfWeekToday === 0 ? 6 : dayOfWeekToday - 1
  const weekStart = addDays(today, -daysFromMonday)

  const endDate = addDays(today, days - 1)
  const startDateStr = format(weekStart, 'yyyy-MM-dd')
  const endDateStr = format(endDate, 'yyyy-MM-dd')

  // Fetch existing expected submissions in range to avoid duplicates
  const { data: existing } = await supabase
    .from('expected_submissions')
    .select('store_id, due_date')
    .eq('schedule_id', schedule_id)
    .gte('due_date', startDateStr)
    .lte('due_date', endDateStr)

  const existingSet = new Set(
    (existing ?? []).map(e => `${e.store_id}::${e.due_date}`)
  )

  const submissions: {
    organisation_id: string
    schedule_id: string
    store_id: string
    assigned_user_id: string | null
    due_date: string
    due_time: string | null
    cutoff_time: string | null
    status: string
  }[] = []

  const daysOfWeek: number[] = schedule.days_of_week ?? []
  const totalDays = Math.round((endDate.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24)) + 1

  for (let i = 0; i < totalDays; i++) {
    const date = addDays(weekStart, i)
    const dayOfWeek = getDay(date) // 0=Sun, 1=Mon...
    const dateStr = format(date, 'yyyy-MM-dd')

    // Frequency check
    if (schedule.frequency === 'weekly') {
      if (!daysOfWeek.includes(dayOfWeek)) continue
    } else if (schedule.frequency === 'monthly') {
      if (date.getDate() !== 1) continue
    } else if (schedule.frequency === 'custom') {
      if (daysOfWeek.length > 0 && !daysOfWeek.includes(dayOfWeek)) continue
    }
    // 'daily' — runs every day, no filter

    const isPast = dateStr < todayStr

    for (const store of stores ?? []) {
      const storeAssignments = (store.user_store_assignments as { user_id: string; is_primary: boolean }[]) ?? []
      // Prefer primary assignment, fallback to branch_manager_id direct assignment
      const primaryAssignment =
        storeAssignments.find(a => a.is_primary) ?? storeAssignments[0] ?? null
      const assignedUserId = primaryAssignment?.user_id ?? store.branch_manager_id ?? null

      const key = `${store.id}::${dateStr}`
      if (existingSet.has(key)) continue // skip duplicates

      submissions.push({
        organisation_id: schedule.organisation_id,
        schedule_id: schedule.id,
        store_id: store.id,
        assigned_user_id: assignedUserId,
        due_date: dateStr,
        due_time: schedule.time_due ?? null,
        cutoff_time: schedule.cutoff_time ?? null,
        status: isPast ? 'missed' : dateStr === todayStr ? 'due' : 'not_due',
      })

      // Track to avoid duplicates in this batch
      existingSet.add(key)
    }
  }

  if (submissions.length === 0) {
    return NextResponse.json({
      data: { generated: 0, message: 'No new expected submissions to create (all may already exist or no stores matched).' },
    })
  }

  // Insert in batches of 500 to avoid hitting Supabase limits
  const BATCH_SIZE = 500
  for (let start = 0; start < submissions.length; start += BATCH_SIZE) {
    const batch = submissions.slice(start, start + BATCH_SIZE)
    const { error: insertError } = await supabase.from('expected_submissions').insert(batch)
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
  }

  // Patch any existing rows that have null assigned_user_id for stores with a known BM
  for (const store of stores ?? []) {
    const storeAssignments = (store.user_store_assignments as { user_id: string; is_primary: boolean }[]) ?? []
    const primaryAssignment = storeAssignments.find(a => a.is_primary) ?? storeAssignments[0] ?? null
    const assignedUserId = primaryAssignment?.user_id ?? store.branch_manager_id ?? null
    if (!assignedUserId) continue
    await supabase
      .from('expected_submissions')
      .update({ assigned_user_id: assignedUserId })
      .eq('store_id', store.id)
      .eq('schedule_id', schedule_id)
      .is('assigned_user_id', null)
  }

  // Audit log
  await supabase.from('audit_logs').insert({
    organisation_id: schedule.organisation_id,
    user_id: user.id,
    action: 'expected_submissions_generated',
    entity_type: 'expected_submissions',
    entity_id: schedule_id,
    new_data: { schedule_id, days, generated: submissions.length },
  })

  return NextResponse.json({ data: { generated: submissions.length } })
}
