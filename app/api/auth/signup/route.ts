import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, password, fullName, orgName } = body

    if (!email || !password || !fullName || !orgName) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
    }

    const serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Generate a unique slug from the org name
    const baseSlug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const slug = `${baseSlug}-${Date.now()}`

    // Create organisation
    const { data: org, error: orgError } = await serviceClient
      .from('organisations')
      .insert({ name: orgName, slug })
      .select('id')
      .single()

    if (orgError) {
      return NextResponse.json({ error: `Failed to create organisation: ${orgError.message}` }, { status: 500 })
    }

    // Create auth user
    const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (authError || !authData.user) {
      await serviceClient.from('organisations').delete().eq('id', org.id)
      return NextResponse.json({ error: authError?.message ?? 'Failed to create user.' }, { status: 400 })
    }

    // Create profile
    const { error: profileError } = await serviceClient.from('profiles').insert({
      id: authData.user.id,
      organisation_id: org.id,
      role: 'admin',
      full_name: fullName,
      email,
    })

    if (profileError) {
      await serviceClient.auth.admin.deleteUser(authData.user.id)
      await serviceClient.from('organisations').delete().eq('id', org.id)
      return NextResponse.json({ error: `Failed to create profile: ${profileError.message}` }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
