import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { ActionStatus, ActionPriority } from '@/lib/types'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organisation_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const searchParams = request.nextUrl.searchParams
  const store_id = searchParams.get('store_id')
  const status = searchParams.get('status')
  const priority = searchParams.get('priority')
  const assigned_to = searchParams.get('assigned_to')
  const raised_by = searchParams.get('raised_by')
  const related_entity_type = searchParams.get('related_entity_type')
  const related_entity_id = searchParams.get('related_entity_id')
  const page = parseInt(searchParams.get('page') ?? '1')
  const page_size = parseInt(searchParams.get('page_size') ?? '50')

  let query = supabase
    .from('actions')
    .select(`
      *,
      stores(name, code),
      assigned_profile:profiles!assigned_to(id, full_name, email),
      raised_profile:profiles!raised_by(id, full_name, email),
      action_updates(id, updated_by, update_text, status_change_to, created_at)
    `, { count: 'exact' })
    .eq('organisation_id', profile.organisation_id)
    .order('created_at', { ascending: false })
    .range((page - 1) * page_size, page * page_size - 1)

  // Role-based filtering: non-admin users only see their relevant actions
  if (profile.role === 'branch_manager') {
    // BMs see actions assigned to them or raised by them
    query = query.or(`assigned_to.eq.${user.id},raised_by.eq.${user.id}`)
  } else if (profile.role === 'regional_manager') {
    // RMs see actions assigned to them or in their stores
    if (!store_id) {
      query = query.or(`assigned_to.eq.${user.id},raised_by.eq.${user.id}`)
    }
  }

  if (store_id) query = query.eq('store_id', store_id)
  if (status) query = query.eq('status', status)
  if (priority) query = query.eq('priority', priority)
  if (assigned_to) query = query.eq('assigned_to', assigned_to)
  if (raised_by) query = query.eq('raised_by', raised_by)
  if (related_entity_type) query = query.eq('related_entity_type', related_entity_type)
  if (related_entity_id) query = query.eq('related_entity_id', related_entity_id)

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

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organisation_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  let body: {
    title?: string
    description?: string
    action_required?: string
    issue_type?: string
    store_id?: string
    assigned_to?: string
    priority?: ActionPriority
    due_date?: string
    related_entity_type?: string
    related_entity_id?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  // Create the action
  const { data: action, error: actionError } = await supabase
    .from('actions')
    .insert({
      organisation_id: profile.organisation_id,
      raised_by: user.id,
      title: body.title,
      description: body.description ?? null,
      action_required: body.action_required ?? null,
      issue_type: body.issue_type ?? null,
      store_id: body.store_id ?? null,
      assigned_to: body.assigned_to ?? null,
      priority: (body.priority ?? 'medium') as ActionPriority,
      due_date: body.due_date ?? null,
      related_entity_type: body.related_entity_type ?? null,
      related_entity_id: body.related_entity_id ?? null,
      status: 'open' as ActionStatus,
      escalation_level: 0,
    })
    .select()
    .single()

  if (actionError) return NextResponse.json({ error: actionError.message }, { status: 500 })

  // Create initial action_update record
  await supabase.from('action_updates').insert({
    action_id: action.id,
    updated_by: user.id,
    update_text: `Action created: ${body.title}`,
    status_change_to: 'open',
  })

  // Notify assigned user if one is specified
  if (body.assigned_to && body.assigned_to !== user.id) {
    const { data: raiserProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single()

    await supabase.from('notifications').insert({
      organisation_id: profile.organisation_id,
      user_id: body.assigned_to,
      type: 'action_assigned',
      title: 'New Action Assigned',
      message: `${raiserProfile?.full_name ?? 'Someone'} assigned you an action: "${body.title}"`,
      related_entity_type: 'actions',
      related_entity_id: action.id,
      is_read: false,
    })
  }

  // Audit log
  await supabase.from('audit_logs').insert({
    organisation_id: profile.organisation_id,
    user_id: user.id,
    action: 'action_created',
    entity_type: 'actions',
    entity_id: action.id,
    new_data: {
      title: action.title,
      priority: action.priority,
      assigned_to: action.assigned_to,
      store_id: action.store_id,
    },
  })

  // Return action with details
  const { data: fullAction } = await supabase
    .from('actions')
    .select(`
      *,
      stores(name, code),
      assigned_profile:profiles!assigned_to(id, full_name, email),
      raised_profile:profiles!raised_by(id, full_name, email),
      action_updates(id, updated_by, update_text, status_change_to, created_at)
    `)
    .eq('id', action.id)
    .single()

  return NextResponse.json({ data: fullAction }, { status: 201 })
}
