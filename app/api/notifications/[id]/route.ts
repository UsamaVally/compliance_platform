import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'Notification ID is required' }, { status: 400 })
  }

  // Verify the notification belongs to the current user
  const { data: existing } = await supabase
    .from('notifications')
    .select('id, user_id, is_read')
    .eq('id', id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
  }

  if (existing.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden: notification does not belong to you' }, { status: 403 })
  }

  let body: { is_read?: boolean } = {}
  try {
    const text = await request.text()
    if (text) body = JSON.parse(text)
  } catch {
    // Body is optional for PATCH — default to marking as read
  }

  const is_read = body.is_read !== undefined ? body.is_read : true

  const { data, error } = await supabase
    .from('notifications')
    .update({ is_read })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: existing } = await supabase
    .from('notifications')
    .select('id, user_id')
    .eq('id', id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
  }

  if (existing.user_id !== user.id) {
    // Allow admin to delete any notification
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const { error } = await supabase.from('notifications').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
