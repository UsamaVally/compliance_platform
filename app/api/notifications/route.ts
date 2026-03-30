import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const searchParams = request.nextUrl.searchParams
  const is_read = searchParams.get('is_read')
  const type = searchParams.get('type')
  const page = parseInt(searchParams.get('page') ?? '1')
  const page_size = parseInt(searchParams.get('page_size') ?? '20')

  let query = supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range((page - 1) * page_size, page * page_size - 1)

  if (is_read !== null && is_read !== '') {
    query = query.eq('is_read', is_read === 'true')
  }
  if (type) query = query.eq('type', type)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Count unread separately
  const { count: unread_count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_read', false)

  return NextResponse.json({
    data,
    count,
    unread_count: unread_count ?? 0,
    page,
    page_size,
    total_pages: count ? Math.ceil(count / page_size) : 0,
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify admin or system role for creating notifications
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organisation_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const allowedRoles = ['admin', 'higher_supervision', 'general_manager', 'regional_manager']
  if (!allowedRoles.includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden: insufficient role' }, { status: 403 })
  }

  let body: {
    user_id?: string
    user_ids?: string[]
    type: string
    title: string
    message: string
    related_entity_type?: string
    related_entity_id?: string
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.type || !body.title || !body.message) {
    return NextResponse.json({ error: 'type, title, and message are required' }, { status: 400 })
  }

  // Support sending to a single user or multiple users
  const recipientIds: string[] = body.user_ids?.length
    ? body.user_ids
    : body.user_id
    ? [body.user_id]
    : []

  if (recipientIds.length === 0) {
    return NextResponse.json({ error: 'At least one of user_id or user_ids is required' }, { status: 400 })
  }

  const notifications = recipientIds.map(uid => ({
    organisation_id: profile.organisation_id,
    user_id: uid,
    type: body.type,
    title: body.title,
    message: body.message,
    related_entity_type: body.related_entity_type ?? null,
    related_entity_id: body.related_entity_id ?? null,
    is_read: false,
  }))

  const { data, error } = await supabase
    .from('notifications')
    .insert(notifications)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data }, { status: 201 })
}
