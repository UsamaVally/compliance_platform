'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ClipboardList,
  CheckCircle,
  Clock,
  FileEdit,
  ChevronRight,
} from 'lucide-react'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingPage } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { Store, Schedule, FormTemplate, ExpectedSubmission, Submission } from '@/lib/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type DueItem = ExpectedSubmission & {
  stores: Store | null
  schedules: (Schedule & { form_templates: FormTemplate | null }) | null
}

type DraftItem = Submission & {
  stores: Store | null
  form_templates: FormTemplate | null
  expected_submissions: Pick<ExpectedSubmission, 'id' | 'due_date' | 'due_time'> | null
}

type SubmittedItem = Submission & {
  stores: Store | null
  form_templates: FormTemplate | null
  expected_submissions: Pick<ExpectedSubmission, 'id' | 'due_date'> | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Component ────────────────────────────────────────────────────────────────

export default function BranchManagerDashboard() {
  const { profile, loading: profileLoading } = useProfile()

  const [storeId, setStoreId] = useState<string | null>(null)
  const [dueItems, setDueItems] = useState<DueItem[]>([])
  const [rejectedItems, setRejectedItems] = useState<DueItem[]>([])
  const [drafts, setDrafts] = useState<DraftItem[]>([])
  const [submitted, setSubmitted] = useState<SubmittedItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    if (!profile) return

    // Transition not_due → due and due → missed for today
    await fetch('/api/schedules/tick', { method: 'POST' })

    const supabase = createClient()

    // Get primary store assignment
    const { data: assignment } = await supabase
      .from('user_store_assignments')
      .select('store_id')
      .eq('user_id', profile.id)
      .eq('is_primary', true)
      .single()

    const sid = assignment?.store_id ?? null
    setStoreId(sid)

    if (!sid) { setLoading(false); return }

    const from = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const to = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    // 1. To Do: only currently due expected submissions
    const { data: dueData } = await supabase
      .from('expected_submissions')
      .select('*, stores(*), schedules(*, form_templates!schedules_template_id_fkey(*))')
      .eq('store_id', sid)
      .eq('status', 'due')
      .gte('due_date', from)
      .lte('due_date', to)
      .order('due_date', { ascending: true })

    // 2. Needs resubmission: rejected submissions
    const { data: rejectedData } = await supabase
      .from('expected_submissions')
      .select('*, stores(*), schedules(*, form_templates!schedules_template_id_fkey(*))')
      .eq('store_id', sid)
      .eq('status', 'rejected')
      .gte('due_date', from)
      .order('due_date', { ascending: false })

    // 3. Drafts: submissions started but not submitted
    const { data: draftData } = await supabase
      .from('submissions')
      .select('*, stores(*), form_templates(*), expected_submissions(id, due_date, due_time)')
      .eq('store_id', sid)
      .eq('submitted_by', profile.id)
      .is('submitted_at', null)
      .not('draft_data', 'is', null)
      .order('updated_at', { ascending: false })

    // 4. Submitted: completed submissions
    const { data: submittedData } = await supabase
      .from('submissions')
      .select('*, stores(*), form_templates(*), expected_submissions(id, due_date)')
      .eq('store_id', sid)
      .eq('submitted_by', profile.id)
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(20)

    setDueItems((dueData ?? []) as DueItem[])
    setRejectedItems((rejectedData ?? []) as DueItem[])
    setDrafts((draftData ?? []) as DraftItem[])
    setSubmitted((submittedData ?? []) as SubmittedItem[])
    setLoading(false)
  }, [profile])

  useEffect(() => {
    if (profile) fetchData()
  }, [profile, fetchData])

  if (profileLoading || loading) return <LoadingPage />

  if (!storeId) {
    return (
      <div className="p-6 max-w-2xl mx-auto mt-12">
        <EmptyState
          icon={ClipboardList}
          title="No store assigned"
          description="You have not been assigned to a store yet. Please contact your administrator."
        />
      </div>
    )
  }

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const submittedThisWeek = submitted.filter(s => s.submitted_at && s.submitted_at > weekAgo)

  return (
    <div className="p-6 space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard
          label="Due Today"
          value={dueItems.length}
          color="blue"
          icon={<Clock className="h-5 w-5 text-blue-500" />}
        />
        <SummaryCard
          label="Drafts"
          value={drafts.length}
          color="yellow"
          icon={<FileEdit className="h-5 w-5 text-yellow-500" />}
        />
        <SummaryCard
          label="Submitted This Week"
          value={submittedThisWeek.length}
          color="green"
          icon={<CheckCircle className="h-5 w-5 text-green-500" />}
        />
      </div>

      {/* ── Section A: To Do ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          icon={<Clock className="h-4 w-4 text-blue-500" />}
          title="To Do"
          subtitle="Submissions that need your attention"
          count={dueItems.length + rejectedItems.length}
        />

        {dueItems.length === 0 && rejectedItems.length === 0 ? (
          <Card>
            <CardContent className="py-10">
              <EmptyState icon={CheckCircle} title="All done!" description="No submissions are currently due." />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0 divide-y divide-gray-100">
              {/* Rejected = needs resubmission */}
              {rejectedItems.map(item => {
                const formName = item.schedules?.form_templates?.name ?? item.schedules?.name ?? 'Form'
                return (
                  <ToDoRow
                    key={item.id}
                    formName={formName}
                    dueDate={item.due_date}
                    dueTime={item.due_time ?? null}
                    cutoffTime={item.cutoff_time ?? null}
                    statusLabel="Needs Resubmission"
                    statusColor="bg-orange-100 text-orange-700"
                    storeName={item.stores?.name}
                    href={`/branch-manager/forms/${item.id}`}
                    actionLabel="Resubmit →"
                    actionVariant="danger"
                  />
                )
              })}

              {/* Due */}
              {dueItems.map(item => {
                const formName = item.schedules?.form_templates?.name ?? item.schedules?.name ?? 'Form'
                return (
                  <ToDoRow
                    key={item.id}
                    formName={formName}
                    dueDate={item.due_date}
                    dueTime={item.due_time ?? null}
                    cutoffTime={item.cutoff_time ?? null}
                    storeName={item.stores?.name}
                    href={`/branch-manager/forms/${item.id}`}
                  />
                )
              })}
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── Section B: Drafts ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          icon={<FileEdit className="h-4 w-4 text-yellow-500" />}
          title="Drafts"
          subtitle="Started but not yet submitted"
          count={drafts.length}
        />

        {drafts.length === 0 ? (
          <Card>
            <CardContent className="py-10">
              <EmptyState icon={FileEdit} title="No drafts" description="Any submissions you start saving will appear here." />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0 divide-y divide-gray-100">
              {drafts.map(draft => {
                const expectedId = draft.expected_submissions?.id
                return (
                  <div key={draft.id} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
                    <div className="w-9 h-9 rounded-lg bg-yellow-50 flex items-center justify-center flex-shrink-0">
                      <FileEdit className="h-4 w-4 text-yellow-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {draft.form_templates?.name ?? 'Form'}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-gray-400">
                        {draft.expected_submissions?.due_date && (
                          <span>Due {formatDate(draft.expected_submissions.due_date)}</span>
                        )}
                        <span>· Last saved {formatDateTime(draft.updated_at)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                        Draft
                      </span>
                      {expectedId ? (
                        <Link href={`/branch-manager/forms/${expectedId}`}>
                          <Button size="sm" variant="outline">
                            Continue <ChevronRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        </Link>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── Section C: Submitted ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          icon={<CheckCircle className="h-4 w-4 text-green-500" />}
          title="Submitted"
          subtitle="Your completed submissions"
          count={submitted.length}
        />

        {submitted.length === 0 ? (
          <Card>
            <CardContent className="py-10">
              <EmptyState icon={ClipboardList} title="No submissions yet" description="Completed submissions will appear here." />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Form', 'Scheduled For', 'Submitted At', 'Status', ''].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {submitted.map(sub => (
                      <tr key={sub.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 text-sm font-medium text-gray-900">
                          {sub.form_templates?.name ?? '—'}
                        </td>
                        <td className="px-5 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {sub.expected_submissions?.due_date ? formatDate(sub.expected_submissions.due_date) : '—'}
                        </td>
                        <td className="px-5 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {sub.submitted_at ? formatDateTime(sub.submitted_at) : '—'}
                        </td>
                        <td className="px-5 py-3">
                          <StatusBadge status={sub.status} />
                        </td>
                        <td className="px-5 py-3">
                          <Link href={`/branch-manager/submissions/${sub.id}`}>
                            <Button size="sm" variant="ghost">View →</Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label, value, color, icon
}: {
  label: string
  value: number
  color: 'blue' | 'red' | 'yellow' | 'green'
  icon: React.ReactNode
}) {
  const bg = { blue: 'bg-blue-50', red: 'bg-red-50', yellow: 'bg-yellow-50', green: 'bg-green-50' }[color]
  const text = { blue: 'text-blue-700', red: 'text-red-700', yellow: 'text-yellow-700', green: 'text-green-700' }[color]
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${bg}`}>
        {icon}
      </div>
      <div>
        <p className={`text-2xl font-bold ${text}`}>{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  )
}

function SectionHeader({
  icon, title, subtitle, count
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  count: number
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {count > 0 && (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-200 text-xs font-semibold text-gray-600">
            {count}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400">{subtitle}</p>
    </div>
  )
}

function ToDoRow({
  formName, dueDate, dueTime, cutoffTime, storeName, href
}: {
  formName: string
  dueDate: string
  dueTime: string | null
  cutoffTime: string | null
  storeName?: string
  href: string
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
      <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
        <ClipboardList className="h-4 w-4 text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{formName}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-gray-400">
          <span>
            {formatDate(dueDate)}
            {(dueTime || cutoffTime) && <> · {dueTime ? dueTime.slice(0, 5) : '—'} – {cutoffTime ? cutoffTime.slice(0, 5) : '—'}</>}
          </span>
          {storeName && <span>· {storeName}</span>}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
          Due
        </span>
        <Link href={href}>
          <Button size="sm" variant="primary">Fill In →</Button>
        </Link>
      </div>
    </div>
  )
}
