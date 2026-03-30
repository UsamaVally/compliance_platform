'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function useProfile() {
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      if (!profileData) { setLoading(false); return }
      const { data: orgData } = await supabase
        .from('organisations')
        .select('*')
        .eq('id', profileData.organisation_id)
        .single()
      setProfile({ ...profileData, organisations: orgData ?? null })
      setLoading(false)
    }
    loadProfile()
  }, [])

  return { profile, loading }
}
