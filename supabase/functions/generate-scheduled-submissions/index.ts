import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

function getMondayOfCurrentWeek(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dow = today.getDay()
  const daysFromMonday = dow === 0 ? 6 : dow - 1
  today.setDate(today.getDate() - daysFromMonday)
  return today
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function format(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

Deno.serve(async () => {
  const DAYS = 90

  // Fetch all ongoing active schedules
  const { data: schedules, error: schedulesError } = await supabase
    .from('schedules')
    .select('*')
    .eq('is_active', true)
    .eq('is_ongoing', true)

  if (schedulesError) {
    return new Response(JSON.stringify({ error: schedulesError.message }), { status: 500 })
  }

  const results: { schedule: string; generated: number }[] = []

  for (const schedule of schedules ?? []) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = format(today)

    const weekStart = getMondayOfCurrentWeek()
    const endDate = addDays(today, DAYS - 1)
    const startDateStr = format(weekStart)
    const endDateStr = format(endDate)

    // Fetch stores for this org
    const { data: stores } = await supabase
      .from('stores')
      .select('id, branch_manager_id, user_store_assignments(user_id, is_primary)')
      .eq('organisation_id', schedule.organisation_id)
      .eq('is_active', true)

    if (!stores?.length) continue

    // Fetch existing entries in range
    const { data: existing } = await supabase
      .from('expected_submissions')
      .select('store_id, due_date')
      .eq('schedule_id', schedule.id)
      .gte('due_date', startDateStr)
      .lte('due_date', endDateStr)

    const existingSet = new Set((existing ?? []).map((e: any) => `${e.store_id}::${e.due_date}`))

    const daysOfWeek: number[] = schedule.days_of_week ?? []
    const totalDays = Math.round((endDate.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
    const submissions: any[] = []

    for (let i = 0; i < totalDays; i++) {
      const date = addDays(weekStart, i)
      const dow = date.getDay()
      const dateStr = format(date)

      if (schedule.frequency === 'weekly' || schedule.frequency === 'custom') {
        if (daysOfWeek.length > 0 && !daysOfWeek.includes(dow)) continue
      } else if (schedule.frequency === 'monthly') {
        if (date.getDate() !== 1) continue
      }
      // 'daily' — no filter

      const isPast = dateStr < todayStr

      for (const store of stores) {
        const assignments = (store.user_store_assignments as any[]) ?? []
        const primary = assignments.find((a: any) => a.is_primary) ?? assignments[0] ?? null
        const assignedUserId = primary?.user_id ?? store.branch_manager_id ?? null

        const key = `${store.id}::${dateStr}`
        if (existingSet.has(key)) continue

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
        existingSet.add(key)
      }
    }

    // Insert in batches
    const BATCH = 500
    for (let s = 0; s < submissions.length; s += BATCH) {
      await supabase.from('expected_submissions').insert(submissions.slice(s, s + BATCH))
    }

    // Patch any existing null assigned_user_ids
    for (const store of stores) {
      const assignments = (store.user_store_assignments as any[]) ?? []
      const primary = assignments.find((a: any) => a.is_primary) ?? assignments[0] ?? null
      const assignedUserId = primary?.user_id ?? store.branch_manager_id ?? null
      if (!assignedUserId) continue
      await supabase
        .from('expected_submissions')
        .update({ assigned_user_id: assignedUserId })
        .eq('store_id', store.id)
        .eq('schedule_id', schedule.id)
        .is('assigned_user_id', null)
    }

    results.push({ schedule: schedule.name, generated: submissions.length })
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
