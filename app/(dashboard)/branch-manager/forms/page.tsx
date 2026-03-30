'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ClipboardList, Calendar } from 'lucide-react'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/status-badge'
import { Card, CardContent } from '@/components/ui/card'
import { LoadingPage } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { formatDate, isOverdue } from '@/lib/utils'
import type { ExpectedSubmission, Store, Schedule, FormTemplate } from '@/lib/types'

type DueItem = ExpectedSubmission & {
  stores: Store | null
  schedules: (Schedule & { form_templates: FormTemplate | null }) | null
}

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'due', label: 'Due' },
  { value: 'submitted_on_time', label: 'Submitted On Time' },
  { value: 'submitted_late', label: 'Submitted Late' },
  { value: 'missed', label: 'Missed' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
]

export default function BranchManagerFormsPage() {
  const { profile, loading: profileLoading } = useProfile()
  const [items, setItems] = useState<DueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [noStore, setNoStore] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    if (!profile) return

    async function fetchData() {
      const supabase = createClient()

      const { data: assignment } = await supabase
        .from('user_store_assignments')
        .select('store_id')
        .eq('user_id', profile.id)
        .eq('is_primary', true)
        .single()

      if (!assignment?.store_id) {
        setNoStore(true)
        setLoading(false)
        return
      }

      // Show last 30 days + next 30 days
      const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const to = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

      const { data } = await supabase
        .from('expected_submissions')
        .select('*, stores(*), schedules(*, form_templates!schedules_template_id_fkey(*))')
        .eq('store_id', assignment.store_id)
        .gte('due_date', from)
        .lte('due_date', to)
        .order('due_date', { ascending: false })

      setItems((data ?? []) as DueItem[])
      setLoading(false)
    }

    fetchData()
  }, [profile])

  if (profileLoading || loading) return <LoadingPage />

  const filtered = statusFilter ? items.filter(i => i.status === statusFilter) : items

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Forms</h1>
          <p className="text-sm text-gray-500 mt-1">Last 30 days and upcoming submissions</p>
        </div>
        <Select
          options={STATUS_OPTIONS}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="w-48"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {noStore ? (
            <div className="px-6 py-10">
              <EmptyState
                icon={ClipboardList}
                title="No store assigned"
                description="You haven't been assigned to a store yet. Contact your administrator."
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState
                icon={ClipboardList}
                title="No forms found"
                description={statusFilter ? 'No forms match this filter.' : 'No forms scheduled in this period.'}
              />
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map(item => {
                const formName = item.schedules?.form_templates?.name ?? item.schedules?.name ?? 'Form'
                const overdue = item.status === 'due' && isOverdue(item.due_date, item.due_time ?? undefined)
                const canOpen = item.status === 'due' || item.status === 'rejected'

                return (
                  <div key={item.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                    <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <ClipboardList className="h-5 w-5 text-indigo-600" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{formName}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <Calendar className="h-3 w-3" />
                          {formatDate(item.due_date)}
                          {item.due_time && ` · ${item.due_time.slice(0, 5)}`}
                        </span>
                        {item.stores?.name && (
                          <span className="text-xs text-gray-400">· {item.stores.name}</span>
                        )}
                        {overdue && (
                          <span className="text-xs font-medium text-red-600">· Overdue</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      <StatusBadge status={item.status} />
                      {canOpen ? (
                        <Link href={`/branch-manager/forms/${item.id}`}>
                          <button className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors whitespace-nowrap">
                            {item.status === 'rejected' ? 'Resubmit →' : 'Fill in →'}
                          </button>
                        </Link>
                      ) : (
                        <Link href={`/branch-manager/forms/${item.id}`}>
                          <button className="text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors whitespace-nowrap">
                            View →
                          </button>
                        </Link>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
