'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface SubmissionFilters {
  store_id?: string
  status?: string
  from?: string
  to?: string
}

export function useSubmissions(filters: SubmissionFilters = {}) {
  const [submissions, setSubmissions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  const fetchSubmissions = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('submissions')
      .select(`
        *,
        stores(name, code),
        profiles!submitted_by(full_name, email),
        expected_submissions(due_date, due_time, cutoff_time, schedules(name))
      `)
      .order('created_at', { ascending: false })

    if (filters.store_id) query = query.eq('store_id', filters.store_id)
    if (filters.status) query = query.eq('status', filters.status)
    if (filters.from) query = query.gte('submitted_at', filters.from)
    if (filters.to) query = query.lte('submitted_at', filters.to)

    const { data, error } = await query
    if (error) setError(error.message)
    else setSubmissions(data || [])
    setLoading(false)
  }, [filters.store_id, filters.status, filters.from, filters.to])

  useEffect(() => { fetchSubmissions() }, [fetchSubmissions])

  return { submissions, loading, error, refresh: fetchSubmissions }
}
