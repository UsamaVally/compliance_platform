import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { ActionStatus, ActionPriority } from '@/lib/types'

const VALID_STATUSES: ActionStatus[] = [
  'open',
  'in_progress',
  'awaiting_evidence',
  'escalated',
  'resolved',
  'verified',
  'closed',
]

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organisation_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const { data: action, error } = await supabase
    .from('actions')
    .select(`
      *,
      stores(name, code, address),
      assigned_profile:profiles!assigned_to(id, full_name, email, role),
      raised_profile:profiles!raised_by(id, full_name, email, role),
      closed_profile:profiles!closed_by(id, full_name),
      action_updates(
        id, update_text, status_change_to, created_at,
        updater:profiles!updated_by(full_name)
      )
    `)
    .eq('id', id)
    .eq('organisation_id', profile.organisation_id)
    .single()

  if (error || !action) return NextResponse.json({ error: 'Action not found' }, { status: 404 })

  return NextResponse.json({ data: action })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organisation_id, full_name')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })


  // Fetch existing action to validate ownership and get old state
  const { data: existing, error: fetchError } = await supabase
    .from('actions')
    .select('*')
    .eq('id', id)
    .eq('organisation_id', profile.organisation_id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Action not found' }, { status: 404 })
  }

  // Permission check: only the assigned user, the raiser, or admin/supervisors can update
  const privilegedRoles = ['admin', 'higher_supervision', 'general_manager']
  const canUpdate =
    privilegedRoles.includes(profile.role) ||
    existing.assigned_to === user.id ||
    existing.raised_by === user.id

  if (!canUpdate) {
    return NextResponse.json({ error: 'Forbidden: you do not have permission to update this action' }, { status: 403 })
  }

  let body: {
    status?: ActionStatus
    action_taken?: string
    closure_notes?: string
    update_text?: string
    priority?: ActionPriority
    assigned_to?: string
    due_date?: string
    escalation_level?: number
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 }
    )
  }

  const isClosing = body.status === 'closed' || body.status === 'resolved' || body.status === 'verified'
  const now = new Date().toISOString()

  const updatePayload: Record<string, unknown> = { updated_at: now }

  if (body.status) updatePayload.status = body.status
  if (body.action_taken !== undefined) updatePayload.action_taken = body.action_taken
  if (body.closure_notes !== undefined) updatePayload.closure_notes = body.closure_notes
  if (body.priority) updatePayload.priority = body.priority
  if (body.assigned_to !== undefined) updatePayload.assigned_to = body.assigned_to ?? null
  if (body.due_date !== undefined) updatePayload.due_date = body.due_date ?? null
  if (body.escalation_level !== undefined) updatePayload.escalation_level = body.escalation_level

  if (isClosing) {
    updatePayload.closed_by = user.id
    updatePayload.closed_at = now
  }

  const { data: updated, error: updateError } = await supabase
    .from('actions')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // Determine update text for the activity log
  const updateTextParts: string[] = []
  if (body.update_text) updateTextParts.push(body.update_text)
  if (body.status && body.status !== existing.status) {
    updateTextParts.push(`Status changed from "${existing.status}" to "${body.status}"`)
  }
  if (body.assigned_to && body.assigned_to !== existing.assigned_to) {
    updateTextParts.push(`Reassigned action`)
  }
  if (body.action_taken && body.action_taken !== existing.action_taken) {
    updateTextParts.push(`Action taken: ${body.action_taken}`)
  }
  const updateText = updateTextParts.join('. ') || 'Action updated'

  // Create action_update record
  const { error: updateRecordError } = await supabase.from('action_updates').insert({
    action_id: id,
    updated_by: user.id,
    update_text: updateText,
    status_change_to: body.status ?? null,
  })

  if (updateRecordError) {
    // Non-fatal: log but don't fail the request
    console.error('Failed to create action_update:', updateRecordError.message)
  }

  // Notify assigned user if status changed
  if (body.status && body.status !== existing.status && existing.assigned_to && existing.assigned_to !== user.id) {
    await supabase.from('notifications').insert({
      organisation_id: profile.organisation_id,
      user_id: existing.assigned_to,
      type: 'action_status_changed',
      title: 'Action Updated',
      message: `${profile.full_name} updated action "${existing.title}": ${body.status.replace(/_/g, ' ')}`,
      related_entity_type: 'actions',
      related_entity_id: id,
      is_read: false,
    })
  }

  // Notify raiser if closed by someone else
  if (isClosing && existing.raised_by !== user.id) {
    await supabase.from('notifications').insert({
      organisation_id: profile.organisation_id,
      user_id: existing.raised_by,
      type: 'action_closed',
      title: 'Action Closed',
      message: `${profile.full_name} closed the action "${existing.title}"`,
      related_entity_type: 'actions',
      related_entity_id: id,
      is_read: false,
    })
  }

  // Notify new assignee if reassigned
  if (body.assigned_to && body.assigned_to !== existing.assigned_to && body.assigned_to !== user.id) {
    await supabase.from('notifications').insert({
      organisation_id: profile.organisation_id,
      user_id: body.assigned_to,
      type: 'action_assigned',
      title: 'Action Reassigned to You',
      message: `${profile.full_name} reassigned action "${existing.title}" to you`,
      related_entity_type: 'actions',
      related_entity_id: id,
      is_read: false,
    })
  }

  // Audit log
  const changedFields: Record<string, { from: unknown; to: unknown }> = {}
  if (body.status && body.status !== existing.status) {
    changedFields.status = { from: existing.status, to: body.status }
  }
  if (body.priority && body.priority !== existing.priority) {
    changedFields.priority = { from: existing.priority, to: body.priority }
  }
  if (body.assigned_to !== undefined && body.assigned_to !== existing.assigned_to) {
    changedFields.assigned_to = { from: existing.assigned_to, to: body.assigned_to }
  }

  await supabase.from('audit_logs').insert({
    organisation_id: profile.organisation_id,
    user_id: user.id,
    action: 'action_updated',
    entity_type: 'actions',
    entity_id: id,
    old_data: {
      status: existing.status,
      priority: existing.priority,
      assigned_to: existing.assigned_to,
      action_taken: existing.action_taken,
    },
    new_data: {
      ...Object.fromEntries(
        Object.entries(changedFields).map(([k, v]) => [k, v.to])
      ),
      update_text: updateText,
    },
  })

  // Return full action with details
  const { data: fullAction } = await supabase
    .from('actions')
    .select(`
      *,
      stores(name, code, address),
      assigned_profile:profiles!assigned_to(id, full_name, email, role),
      raised_profile:profiles!raised_by(id, full_name, email, role),
      closed_profile:profiles!closed_by(id, full_name),
      action_updates(
        id, update_text, status_change_to, created_at,
        updater:profiles!updated_by(full_name)
      )
    `)
    .eq('id', id)
    .single()

  return NextResponse.json({ data: fullAction })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organisation_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: admin role required to delete actions' }, { status: 403 })
  }

  const { data: existing } = await supabase
    .from('actions')
    .select('id, title')
    .eq('id', id)
    .eq('organisation_id', profile.organisation_id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Action not found' }, { status: 404 })

  // Delete action_updates first (FK constraint)
  await supabase.from('action_updates').delete().eq('action_id', id)

  const { error } = await supabase.from('actions').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('audit_logs').insert({
    organisation_id: profile.organisation_id,
    user_id: user.id,
    action: 'action_deleted',
    entity_type: 'actions',
    entity_id: id,
    old_data: { title: existing.title },
  })

  return NextResponse.json({ success: true })
}
