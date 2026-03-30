import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const searchParams = request.nextUrl.searchParams
  const store_id = searchParams.get('store_id')
  const status = searchParams.get('status')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const form_template_id = searchParams.get('form_template_id')
  const submitted_by = searchParams.get('submitted_by')
  const page = parseInt(searchParams.get('page') ?? '1')
  const page_size = parseInt(searchParams.get('page_size') ?? '50')

  let query = supabase
    .from('submissions')
    .select(`
      *,
      stores(name, code),
      profiles!submitted_by(full_name),
      expected_submissions(due_date, due_time, cutoff_time)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * page_size, page * page_size - 1)

  if (store_id) query = query.eq('store_id', store_id)
  if (status) query = query.eq('status', status)
  if (from) query = query.gte('submitted_at', from)
  if (to) query = query.lte('submitted_at', to)
  if (form_template_id) query = query.eq('form_template_id', form_template_id)
  if (submitted_by) query = query.eq('submitted_by', submitted_by)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    data,
    count,
    page,
    page_size,
    total_pages: count ? Math.ceil(count / page_size) : 0,
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    expected_submission_id?: string
    answers?: { question_id: string; answer_text?: string; answer_value?: unknown }[]
    is_draft?: boolean
    organisation_id?: string
    store_id?: string
    form_template_id?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { expected_submission_id, answers, is_draft } = body

  if (!expected_submission_id) {
    return NextResponse.json({ error: 'expected_submission_id is required' }, { status: 400 })
  }

  // Get expected submission with schedule and form template
  const { data: expected, error: expectedError } = await supabase
    .from('expected_submissions')
    .select('*, schedules(id, form_type, time_due, cutoff_time)')
    .eq('id', expected_submission_id)
    .single()

  if (expectedError || !expected) {
    return NextResponse.json({ error: 'Expected submission not found' }, { status: 404 })
  }

  // Verify the user is allowed to submit for this expected submission
  if (expected.assigned_user_id && expected.assigned_user_id !== user.id) {
    // Allow admin/supervisor to override — check profile role
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const allowedRoles = ['admin', 'higher_supervision']
    if (!profile || !allowedRoles.includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden: not assigned to this submission' }, { status: 403 })
    }
  }

  const now = new Date()
  const cutoffStr = expected.cutoff_time ?? '23:59:59'
  const cutoff = new Date(`${expected.due_date}T${cutoffStr}`)
  const is_late = now > cutoff
  const status = is_draft ? 'draft' : is_late ? 'submitted_late' : 'submitted_on_time'

  // Fetch form_template_id from schedule
  const { data: formTemplate } = await supabase
    .from('form_templates')
    .select('id')
    .eq('schedule_id', expected.schedule_id)
    .eq('is_active', true)
    .single()

  if (!formTemplate && !is_draft) {
    return NextResponse.json({ error: 'No active form template found for this schedule' }, { status: 400 })
  }

  // Check for existing submission to upsert
  const { data: existingSubmission } = await supabase
    .from('submissions')
    .select('id')
    .eq('expected_submission_id', expected_submission_id)
    .maybeSingle()

  const submissionPayload = {
    expected_submission_id,
    organisation_id: expected.organisation_id,
    store_id: expected.store_id,
    submitted_by: user.id,
    form_template_id: formTemplate?.id ?? body.form_template_id ?? '',
    status,
    submitted_at: is_draft ? null : now.toISOString(),
    is_late,
    draft_data: is_draft ? (body as unknown as Record<string, unknown>) : null,
  }

  let submissionId: string

  if (existingSubmission) {
    const { data: updated, error: updateError } = await supabase
      .from('submissions')
      .update(submissionPayload)
      .eq('id', existingSubmission.id)
      .select()
      .single()

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
    submissionId = updated.id
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from('submissions')
      .insert(submissionPayload)
      .select()
      .single()

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
    submissionId = inserted.id
  }

  // Insert answers if not a draft
  if (!is_draft && answers && answers.length > 0) {
    // Delete old answers first (in case of resubmission)
    await supabase.from('submission_answers').delete().eq('submission_id', submissionId)

    const { error: answersError } = await supabase.from('submission_answers').insert(
      answers.map(a => ({
        submission_id: submissionId,
        question_id: a.question_id,
        answer_text: a.answer_text ?? null,
        answer_value: a.answer_value ?? null,
      }))
    )
    if (answersError) {
      return NextResponse.json({ error: `Answers insert failed: ${answersError.message}` }, { status: 500 })
    }
  }

  // Update expected_submissions status
  if (!is_draft) {
    await supabase
      .from('expected_submissions')
      .update({ status })
      .eq('id', expected_submission_id)
  }

  // Create audit log
  await supabase.from('audit_logs').insert({
    organisation_id: expected.organisation_id,
    user_id: user.id,
    action: is_draft ? 'submission_draft_saved' : 'submission_created',
    entity_type: 'submissions',
    entity_id: submissionId,
    new_data: { status, is_late, expected_submission_id },
  })

  // Fetch the complete submission to return
  const { data: finalSubmission } = await supabase
    .from('submissions')
    .select(`
      *,
      stores(name, code),
      profiles!submitted_by(full_name),
      expected_submissions(due_date, due_time, cutoff_time)
    `)
    .eq('id', submissionId)
    .single()

  return NextResponse.json({ data: finalSubmission }, { status: existingSubmission ? 200 : 201 })
}
