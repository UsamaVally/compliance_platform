'use client'

import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import {
  CheckCircle2,
  XCircle,
  Minus,
  Clock,
  ChevronLeft,
  ChevronRight,
  Search,
  Store as StoreIcon,
  X,
  Shield,
  Download,
  AlertCircle,
  Star,
  CheckCheck,
} from 'lucide-react'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { LoadingPage } from '@/components/ui/loading'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { FormSection, FormQuestion, SubmissionAnswer, Attachment } from '@/lib/types'

// ─── Week helpers ─────────────────────────────────────────────────────────────

function getMondayOf(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

function getWeekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    return d
  })
}

function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ─── Types ────────────────────────────────────────────────────────────────────

type CellStatus = 'done' | 'late' | 'not_done' | 'pending' | 'not_scheduled'

type ReviewSummary = {
  id: string
  rating: number | null
  action_taken: string | null
  notes: string | null
}

type GridCell = {
  expectedId: string
  submissionId: string | null
  status: CellStatus
  submittedAt: string | null
  formName: string | null
  review: ReviewSummary | null
}

type GridRow = {
  storeId: string
  storeName: string
  days: Record<string, GridCell | null>
}

type PanelTarget = {
  cell: GridCell
  storeId: string
  storeName: string
}

type SectionWithQuestions = FormSection & { form_questions: FormQuestion[] }

type DrawerData = {
  id: string
  status: string
  submitted_at: string | null
  is_late: boolean
  store_name: string
  bm_name: string | null
  form_name: string | null
  due_date: string | null
  form_sections: SectionWithQuestions[]
  answers: SubmissionAnswer[]
  attachments: Attachment[]
}

function esStatusToCell(status: string): CellStatus {
  if (status === 'submitted_on_time' || status === 'approved' || status === 'under_review') return 'done'
  if (status === 'submitted_late') return 'late'
  if (status === 'missed') return 'not_done'
  if (status === 'due' || status === 'not_due') return 'pending'
  return 'not_scheduled'
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RMDashboard() {
  const { profile, loading: profileLoading } = useProfile()
  const [weekStart, setWeekStart] = useState(() => getMondayOf(new Date()))
  const [rows, setRows] = useState<GridRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'has_missed' | 'all_done' | 'needs_review'>('all')
  const [panelTarget, setPanelTarget] = useState<PanelTarget | null>(null)

  const weekDays = getWeekDays(weekStart)

  const fetchData = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const supabase = createClient()

    const days = getWeekDays(weekStart)
    const weekFrom = toDateStr(days[0])
    const weekTo = toDateStr(days[6])

    const { data: regionRows } = await supabase
      .from('user_region_assignments')
      .select('region_id')
      .eq('user_id', profile.id)

    const regionIds = (regionRows ?? []).map((r: any) => r.region_id)

    const { data: storeRows } = await supabase
      .from('stores')
      .select('id, name')
      .in('region_id', regionIds.length > 0 ? regionIds : ['_none_'])
      .eq('is_active', true)
      .order('name')

    const stores: { id: string; name: string }[] = storeRows ?? []
    const storeIds = stores.map(s => s.id)

    if (storeIds.length === 0) {
      setRows([])
      setLoading(false)
      return
    }

    const { data: expected } = await supabase
      .from('expected_submissions')
      .select(`
        id, store_id, due_date, status,
        schedules(name, form_templates!schedules_template_id_fkey(name))
      `)
      .in('store_id', storeIds)
      .gte('due_date', weekFrom)
      .lte('due_date', weekTo)

    const expectedIds = (expected ?? []).map((e: any) => e.id)

    const [submissionsResult, reviewsResult] = await Promise.all([
      expectedIds.length > 0
        ? supabase
            .from('submissions')
            .select('id, expected_submission_id, submitted_at')
            .in('expected_submission_id', expectedIds)
            .not('submitted_at', 'is', null)
        : { data: [] },
      expectedIds.length > 0
        ? supabase
            .from('rm_reviews')
            .select('id, expected_submission_id, rating, action_taken, notes')
            .eq('regional_manager_id', profile.id)
            .in('expected_submission_id', expectedIds)
        : { data: [] },
    ])

    const subMap: Record<string, { id: string; submitted_at: string }> = {}
    for (const s of submissionsResult.data ?? []) subMap[s.expected_submission_id] = s

    const reviewMap: Record<string, ReviewSummary> = {}
    for (const r of reviewsResult.data ?? []) {
      reviewMap[r.expected_submission_id] = {
        id: r.id,
        rating: r.rating ?? null,
        action_taken: r.action_taken ?? null,
        notes: r.notes ?? null,
      }
    }

    const built: GridRow[] = stores.map(store => {
      const dayCells: Record<string, GridCell | null> = {}
      for (const d of days) dayCells[toDateStr(d)] = null

      for (const e of (expected ?? []).filter((e: any) => e.store_id === store.id)) {
        const sub = subMap[e.id] ?? null
        dayCells[e.due_date] = {
          expectedId: e.id,
          submissionId: sub?.id ?? null,
          status: esStatusToCell(e.status),
          submittedAt: sub?.submitted_at ?? null,
          formName: (e.schedules as any)?.form_templates?.name ?? (e.schedules as any)?.name ?? null,
          review: reviewMap[e.id] ?? null,
        }
      }

      return { storeId: store.id, storeName: store.name, days: dayCells }
    })

    setRows(built)
    setLoading(false)
  }, [profile, weekStart])

  useEffect(() => {
    if (profile) fetchData()
  }, [profile, fetchData])

  function prevWeek() {
    setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })
  }
  function nextWeek() {
    setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })
  }

  function handleReviewSaved(expectedId: string, review: ReviewSummary) {
    setRows(prev => prev.map(row => ({
      ...row,
      days: Object.fromEntries(
        Object.entries(row.days).map(([date, cell]) => [
          date,
          cell?.expectedId === expectedId ? { ...cell, review } : cell,
        ])
      ),
    })))
    setPanelTarget(prev =>
      prev?.cell.expectedId === expectedId
        ? { ...prev, cell: { ...prev.cell, review } }
        : prev
    )
  }

  const today = toDateStr(new Date())
  const isCurrentWeek = toDateStr(weekStart) === toDateStr(getMondayOf(new Date()))
  const weekLabel = `${weekDays[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${weekDays[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`

  const allCells = rows.flatMap(r => Object.values(r.days).filter(Boolean)) as GridCell[]
  const totalDone = allCells.filter(c => c.status === 'done' || c.status === 'late').length
  const totalMissed = allCells.filter(c => c.status === 'not_done').length
  const needsReview = allCells.filter(c =>
    (c.status === 'done' || c.status === 'late' || c.status === 'not_done') && !c.review
  ).length

  const filtered = rows.filter(r => {
    if (search && !r.storeName.toLowerCase().includes(search.toLowerCase())) return false
    if (statusFilter === 'has_missed') {
      if (!Object.values(r.days).some(c => c?.status === 'not_done')) return false
    }
    if (statusFilter === 'all_done') {
      const scheduled = Object.values(r.days).filter(c => c && c.status !== 'not_scheduled' && c.status !== 'pending')
      if (scheduled.length === 0) return false
      if (!scheduled.every(c => c?.status === 'done' || c?.status === 'late')) return false
    }
    if (statusFilter === 'needs_review') {
      if (!Object.values(r.days).some(c =>
        c && (c.status === 'done' || c.status === 'late' || c.status === 'not_done') && !c.review
      )) return false
    }
    return true
  })

  if (profileLoading) return <LoadingPage />

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1400px] mx-auto">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Compliance Overview</h1>
        <p className="text-sm text-gray-500 mt-0.5">Weekly submission status across your stores</p>
      </div>

      {/* Week selector */}
      <div className="flex items-center gap-2">
        <button onClick={prevWeek} className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors">
          <ChevronLeft className="h-4 w-4 text-gray-600" />
        </button>
        <span className="text-sm font-semibold text-gray-700 min-w-[210px] text-center">{weekLabel}</span>
        <button onClick={nextWeek} className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors">
          <ChevronRight className="h-4 w-4 text-gray-600" />
        </button>
        {!isCurrentWeek && (
          <button onClick={() => setWeekStart(getMondayOf(new Date()))} className="ml-1 text-xs text-indigo-600 hover:underline font-medium">
            This week
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total Stores" value={rows.length} icon={<StoreIcon className="h-5 w-5 text-indigo-500" />} color="indigo" />
        <SummaryCard label="Done" value={totalDone} icon={<CheckCircle2 className="h-5 w-5 text-green-500" />} color="green" />
        <SummaryCard label="Not Done" value={totalMissed} icon={<XCircle className="h-5 w-5 text-red-500" />} color="red" />
        <SummaryCard label="Needs Review" value={needsReview} icon={<Star className="h-5 w-5 text-amber-500" />} color="amber" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search store…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          className="sm:w-52 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">All Stores</option>
          <option value="has_missed">Has Missed Submissions</option>
          <option value="all_done">All Completed</option>
          <option value="needs_review">Needs Review</option>
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16 text-center">
          <StoreIcon className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-500">No stores assigned to your region</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3 sticky left-0 bg-gray-50/80 z-10 min-w-[160px]">
                    Store
                  </th>
                  {weekDays.map((d, i) => {
                    const dateStr = toDateStr(d)
                    const isToday = dateStr === today
                    return (
                      <th key={dateStr} className={`text-center text-xs font-semibold uppercase tracking-wider px-2 py-3 min-w-[90px] ${isToday ? 'text-indigo-600' : 'text-gray-500'}`}>
                        <div>{DAY_NAMES[i]}</div>
                        <div className={`text-[11px] font-normal mt-0.5 ${isToday ? 'text-indigo-400' : 'text-gray-400'}`}>
                          {d.getDate()}/{d.getMonth() + 1}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-sm text-gray-400">No stores match the current filter.</td>
                  </tr>
                ) : (
                  filtered.map(row => (
                    <tr key={row.storeId} className="hover:bg-gray-50/40 transition-colors">
                      <td className="px-5 py-3 sticky left-0 bg-white z-10 border-r border-gray-100">
                        <p className="text-sm font-semibold text-gray-900 truncate max-w-[150px]">{row.storeName}</p>
                      </td>
                      {weekDays.map(d => {
                        const dateStr = toDateStr(d)
                        const cell = row.days[dateStr]
                        return (
                          <td key={dateStr} className="px-2 py-2.5 text-center">
                            <CellIndicator
                              cell={cell}
                              storeId={row.storeId}
                              storeName={row.storeName}
                              onOpen={setPanelTarget}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-2.5 flex flex-wrap gap-x-5 gap-y-1.5 items-center">
            {([
              ['bg-green-100', <CheckCircle2 className="h-3 w-3 text-green-600" />, 'Done'],
              ['bg-yellow-100', <Clock className="h-3 w-3 text-yellow-600" />, 'Late'],
              ['bg-red-100', <XCircle className="h-3 w-3 text-red-500" />, 'Not Done'],
              ['bg-gray-100', <Minus className="h-3 w-3 text-gray-400" />, 'Pending'],
            ] as [string, React.ReactNode, string][]).map(([bg, icon, label]) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${bg}`}>{icon}</span>
                <span className="text-xs text-gray-500">{label}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-amber-400">
                <span className="text-[9px] font-bold text-white">!</span>
              </span>
              <span className="text-xs text-gray-500">Needs Review</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-indigo-500">
                <CheckCheck className="h-2.5 w-2.5 text-white" />
              </span>
              <span className="text-xs text-gray-500">Reviewed</span>
            </div>
          </div>
        </div>
      )}

      {/* Panels */}
      {panelTarget && (
        panelTarget.cell.status === 'not_done' ? (
          <ActionPanel
            target={panelTarget}
            profile={profile}
            onReviewSaved={handleReviewSaved}
            onClose={() => setPanelTarget(null)}
          />
        ) : (
          <SubmissionDrawer
            target={panelTarget}
            profile={profile}
            onReviewSaved={handleReviewSaved}
            onClose={() => setPanelTarget(null)}
          />
        )
      )}
    </div>
  )
}

// ─── Cell indicator ───────────────────────────────────────────────────────────

function CellIndicator({
  cell, storeId, storeName, onOpen,
}: {
  cell: GridCell | null
  storeId: string
  storeName: string
  onOpen: (t: PanelTarget) => void
}) {
  if (!cell) return <span className="text-gray-200 text-xs select-none">—</span>

  const isActionable = cell.status === 'done' || cell.status === 'late' || cell.status === 'not_done'
  const reviewed = !!cell.review

  const configs: Record<CellStatus, { bg: string; icon: React.ReactNode } | null> = {
    done:          { bg: 'bg-green-100',  icon: <CheckCircle2 className="h-4 w-4 text-green-600" /> },
    late:          { bg: 'bg-yellow-100', icon: <Clock        className="h-4 w-4 text-yellow-600" /> },
    not_done:      { bg: 'bg-red-100',    icon: <XCircle      className="h-4 w-4 text-red-500" /> },
    pending:       { bg: 'bg-gray-100',   icon: <Minus        className="h-4 w-4 text-gray-400" /> },
    not_scheduled: null,
  }

  const config = configs[cell.status]
  if (!config) return <span className="text-gray-200 text-xs select-none">—</span>

  const badge = isActionable ? (
    reviewed ? (
      (cell.status === 'done' || cell.status === 'late') ? (
        <span className="absolute -bottom-1.5 -right-1.5 inline-flex items-center justify-center min-w-[20px] h-[20px] rounded-full bg-indigo-500 text-white text-[9px] font-bold px-1 shadow">
          ★{cell.review!.rating ?? '?'}
        </span>
      ) : (
        <span className="absolute -bottom-1.5 -right-1.5 inline-flex items-center justify-center w-[20px] h-[20px] rounded-full bg-green-500 shadow">
          <CheckCheck className="h-3 w-3 text-white" />
        </span>
      )
    ) : (
      <span className="absolute -bottom-1.5 -right-1.5 inline-flex items-center justify-center w-[20px] h-[20px] rounded-full bg-amber-400 shadow">
        <span className="text-[9px] font-bold text-white leading-none">!</span>
      </span>
    )
  ) : null

  const inner = (
    <span className={`relative inline-flex items-center justify-center w-10 h-10 rounded-xl transition-all ${config.bg} ${isActionable ? 'cursor-pointer hover:scale-110 hover:shadow-md' : ''}`}>
      {config.icon}
      {badge}
    </span>
  )

  if (isActionable) {
    return (
      <button
        onClick={() => onOpen({ cell, storeId, storeName })}
        className="inline-flex items-center justify-center p-1"
        title={cell.status === 'not_done' ? 'Record action taken' : 'View submission & rate'}
      >
        {inner}
      </button>
    )
  }
  return <div className="inline-flex items-center justify-center p-1">{inner}</div>
}

// ─── Action Panel (Not Done) ──────────────────────────────────────────────────

function ActionPanel({
  target, profile, onReviewSaved, onClose,
}: {
  target: PanelTarget
  profile: any
  onReviewSaved: (expectedId: string, review: ReviewSummary) => void
  onClose: () => void
}) {
  const { cell, storeId, storeName } = target
  const existing = cell.review

  const [actionTaken, setActionTaken] = useState(existing?.action_taken ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [editing, setEditing] = useState(!existing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSave() {
    if (!actionTaken.trim()) { setError('Action taken is required.'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const now = new Date().toISOString()

    const { data, error: err } = await supabase
      .from('rm_reviews')
      .upsert({
        organisation_id: profile.organisation_id,
        regional_manager_id: profile.id,
        expected_submission_id: cell.expectedId,
        store_id: storeId,
        submission_id: null,
        submission_status: 'missed',
        acknowledged: false,
        action_taken: actionTaken.trim(),
        notes: notes.trim() || null,
        rating: null,
        reviewed_at: now,
        updated_at: now,
      }, { onConflict: 'regional_manager_id,expected_submission_id' })
      .select('id, rating, action_taken, notes')
      .single()

    if (err) { setError(err.message); setSaving(false) }
    else {
      onReviewSaved(cell.expectedId, { id: data.id, rating: data.rating, action_taken: data.action_taken, notes: data.notes })
      setEditing(false)
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Record Action</h2>
            <p className="text-xs text-gray-500 mt-0.5">{storeName} · Missed submission</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
            <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-700">Submission Not Done</p>
              <p className="text-xs text-red-500 mt-0.5">{storeName} did not complete this submission.</p>
            </div>
          </div>

          {existing && !editing ? (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
                  <CheckCheck className="h-3.5 w-3.5" /> Action Recorded
                </p>
                <p className="text-sm text-gray-800">
                  <span className="font-medium text-gray-500">Action: </span>{existing.action_taken}
                </p>
                {existing.notes && (
                  <p className="text-sm text-gray-700">
                    <span className="font-medium text-gray-500">Notes: </span>{existing.notes}
                  </p>
                )}
              </div>
              <button onClick={() => setEditing(true)} className="text-xs text-indigo-600 hover:underline">
                Edit action
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Action Taken <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={actionTaken}
                  onChange={e => { setActionTaken(e.target.value); setError(null) }}
                  placeholder="Describe what action was taken regarding this missed submission…"
                  rows={4}
                  className={`block w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none ${error ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                />
                {error && (
                  <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {error}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Any additional notes…"
                  rows={2}
                  className="block w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              <div className="flex gap-3">
                <Button onClick={handleSave} loading={saving} size="sm">
                  {existing ? 'Update Action' : 'Save Action'}
                </Button>
                {existing && (
                  <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setActionTaken(existing.action_taken ?? ''); setNotes(existing.notes ?? '') }}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Submission Drawer (Done / Late) ─────────────────────────────────────────

function SubmissionDrawer({
  target, profile, onReviewSaved, onClose,
}: {
  target: PanelTarget
  profile: any
  onReviewSaved: (expectedId: string, review: ReviewSummary) => void
  onClose: () => void
}) {
  const { cell, storeId } = target
  const submissionId = cell.submissionId!
  const existing = cell.review

  const [data, setData] = useState<DrawerData | null>(null)
  const [loadingData, setLoadingData] = useState(true)

  const [rating, setRating] = useState<number>(existing?.rating ?? 0)
  const [hoverRating, setHoverRating] = useState(0)
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [editingReview, setEditingReview] = useState(!existing)
  const [savingReview, setSavingReview] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: sub } = await supabase
        .from('submissions')
        .select(`
          id, status, submitted_at, is_late,
          stores(name),
          form_templates(name, form_sections(*, form_questions(*))),
          submitted_profile:profiles!submissions_submitted_by_fkey(full_name),
          expected_submissions(due_date)
        `)
        .eq('id', submissionId)
        .single()

      if (!sub) { setLoadingData(false); return }

      const tmpl = sub.form_templates as any
      if (tmpl?.form_sections) {
        tmpl.form_sections = [...tmpl.form_sections]
          .sort((a: any, b: any) => a.order_index - b.order_index)
          .map((sec: any) => ({
            ...sec,
            form_questions: [...(sec.form_questions ?? [])].sort((a: any, b: any) => a.order_index - b.order_index),
          }))
      }

      const [{ data: answerData }, { data: attachmentData }] = await Promise.all([
        supabase.from('submission_answers').select('*').eq('submission_id', submissionId),
        supabase.from('attachments').select('*').eq('entity_type', 'submission').eq('entity_id', submissionId),
      ])

      setData({
        id: sub.id,
        status: sub.status,
        submitted_at: sub.submitted_at,
        is_late: sub.is_late,
        store_name: (sub.stores as any)?.name ?? '—',
        bm_name: (sub.submitted_profile as any)?.full_name ?? null,
        form_name: tmpl?.name ?? null,
        due_date: (sub.expected_submissions as any)?.due_date ?? null,
        form_sections: tmpl?.form_sections ?? [],
        answers: answerData ?? [],
        attachments: attachmentData ?? [],
      })
      setLoadingData(false)
    }
    load()
  }, [submissionId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSaveReview() {
    if (!rating) { setReviewError('Please select a rating.'); return }
    setSavingReview(true)
    setReviewError(null)
    const supabase = createClient()
    const now = new Date().toISOString()

    const { data: saved, error } = await supabase
      .from('rm_reviews')
      .upsert({
        organisation_id: profile.organisation_id,
        regional_manager_id: profile.id,
        expected_submission_id: cell.expectedId,
        store_id: storeId,
        submission_id: submissionId,
        submission_status: cell.status === 'late' ? 'submitted_late' : 'submitted_on_time',
        acknowledged: true,
        action_taken: null,
        notes: notes.trim() || null,
        rating,
        reviewed_at: now,
        updated_at: now,
      }, { onConflict: 'regional_manager_id,expected_submission_id' })
      .select('id, rating, action_taken, notes')
      .single()

    if (error) { setReviewError(error.message); setSavingReview(false) }
    else {
      onReviewSaved(cell.expectedId, { id: saved.id, rating: saved.rating, action_taken: saved.action_taken, notes: saved.notes })
      setEditingReview(false)
      setSavingReview(false)
    }
  }

  const answerMap: Record<string, SubmissionAnswer> = {}
  if (data) for (const a of data.answers) answerMap[a.question_id] = a

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-900 truncate">{data?.form_name ?? 'Submission Detail'}</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              {data?.store_name}{data?.bm_name ? ` · ${data.bm_name}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="ml-3 p-2 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loadingData ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
            </div>
          ) : !data ? (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-xl p-4">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <p className="text-sm">Could not load submission.</p>
            </div>
          ) : (
            <>
              {/* ── Rating section ── */}
              <div className={`rounded-xl border p-4 space-y-3 ${existing && !editingReview ? 'bg-indigo-50 border-indigo-200' : 'bg-amber-50 border-amber-200'}`}>
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5 text-amber-500" /> Your Review
                </p>

                {existing && !editingReview ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1">
                      {[1,2,3,4,5].map(i => (
                        <Star key={i} className={`h-6 w-6 ${i <= (existing.rating ?? 0) ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`} />
                      ))}
                      <span className="ml-2 text-sm font-semibold text-gray-700">{existing.rating}/5</span>
                    </div>
                    {existing.notes && <p className="text-sm text-gray-600 italic">"{existing.notes}"</p>}
                    <button onClick={() => setEditingReview(true)} className="text-xs text-indigo-600 hover:underline">Edit review</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-gray-600 mb-2">Rating <span className="text-red-500">*</span></p>
                      <div className="flex items-center gap-1">
                        {[1,2,3,4,5].map(i => (
                          <button
                            key={i}
                            onClick={() => { setRating(i); setReviewError(null) }}
                            onMouseEnter={() => setHoverRating(i)}
                            onMouseLeave={() => setHoverRating(0)}
                            className="transition-transform hover:scale-110"
                          >
                            <Star className={`h-8 w-8 transition-colors ${i <= (hoverRating || rating) ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`} />
                          </button>
                        ))}
                        {rating > 0 && <span className="ml-2 text-sm font-semibold text-gray-700">{rating}/5</span>}
                      </div>
                      {reviewError && (
                        <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> {reviewError}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs text-gray-600 mb-1.5">Feedback <span className="text-gray-400">(optional)</span></label>
                      <textarea
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        placeholder="Add feedback or notes about this submission…"
                        rows={2}
                        className="block w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveReview} loading={savingReview} disabled={!rating}>
                        {existing ? 'Update Review' : 'Save Review'}
                      </Button>
                      {existing && (
                        <Button size="sm" variant="ghost" onClick={() => { setEditingReview(false); setRating(existing.rating ?? 0); setNotes(existing.notes ?? ''); setReviewError(null) }}>
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Proof of submission */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <Shield className="h-3.5 w-3.5 text-indigo-500" /> Proof of Submission
                </p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div className="col-span-2">
                    <dt className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Submission ID</dt>
                    <dd className="text-xs font-mono text-gray-700 break-all mt-0.5">{data.id}</dd>
                  </div>
                  {([
                    ['Submitted At', data.submitted_at ? formatDateTime(data.submitted_at) : '—'],
                    ['Store', data.store_name],
                    ['Branch Manager', data.bm_name ?? '—'],
                    ['Form', data.form_name ?? '—'],
                    ['Scheduled Date', data.due_date ? formatDate(data.due_date) : '—'],
                  ] as [string, string][]).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">{label}</dt>
                      <dd className="text-sm text-gray-800 mt-0.5">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex items-center gap-2 pt-1">
                  <StatusBadge status={data.status} />
                  {data.is_late && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                      <Clock className="h-3 w-3" /> Late
                    </span>
                  )}
                </div>
              </div>

              {/* Questions */}
              {data.form_sections.map(section => (
                <div key={section.id} className="space-y-4">
                  <h3 className="text-sm font-bold text-gray-800 border-b border-gray-100 pb-2">{section.title}</h3>
                  {section.form_questions.map(question => {
                    const answer = answerMap[question.id]
                    const value = answer?.answer_text ?? (answer?.answer_value != null ? String(answer.answer_value) : null)
                    const av = answer?.answer_value as { no_photo_url?: string; comment?: string } | null

                    return (
                      <div key={question.id} className="space-y-1.5">
                        <p className="text-sm font-medium text-gray-700">{question.question_text}</p>

                        {question.question_type === 'photo' ? (
                          value ? (
                            <a href={value} target="_blank" rel="noopener noreferrer">
                              <Image src={value} alt="Photo" width={400} height={300} className="rounded-xl border border-gray-200 object-cover max-h-56 w-auto hover:opacity-90 transition" />
                            </a>
                          ) : (
                            <p className="text-sm text-gray-400 italic bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">No photo</p>
                          )
                        ) : question.question_type === 'yes_no' ? (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              {['Yes', 'No'].map(opt => (
                                <span key={opt} className={`inline-flex items-center px-3 py-1 rounded-lg text-sm font-medium border ${
                                  value === opt
                                    ? opt === 'Yes' ? 'bg-green-50 border-green-400 text-green-700' : 'bg-red-50 border-red-400 text-red-700'
                                    : 'bg-gray-50 border-gray-200 text-gray-400'
                                }`}>{opt}</span>
                              ))}
                            </div>
                            {value === 'No' && av?.no_photo_url && (
                              <a href={av.no_photo_url} target="_blank" rel="noopener noreferrer">
                                <Image src={av.no_photo_url} alt="Evidence" width={300} height={200} className="rounded-lg border border-gray-200 object-cover max-h-44 hover:opacity-90 transition" />
                              </a>
                            )}
                          </div>
                        ) : (
                          <p className={`text-sm bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 min-h-[36px] ${value ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                            {value ?? '— Not answered'}
                          </p>
                        )}

                        {av?.comment && (
                          <div>
                            <p className="text-xs font-medium text-gray-400 mb-0.5">Comment</p>
                            <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 whitespace-pre-wrap">{av.comment}</p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}

              {/* Attachments */}
              {data.attachments.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-gray-800 border-b border-gray-100 pb-2 mb-3">
                    Attachments ({data.attachments.length})
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {data.attachments.map(att =>
                      att.mime_type?.startsWith('image/') ? (
                        <a key={att.id} href={att.file_url} target="_blank" rel="noopener noreferrer" download={att.file_name}>
                          <div className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-50 group">
                            <Image src={att.file_url} alt={att.file_name} fill className="object-cover group-hover:opacity-90 transition" />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition flex items-center justify-center">
                              <Download className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition" />
                            </div>
                          </div>
                          <p className="mt-1 text-xs text-gray-500 truncate">{att.file_name}</p>
                        </a>
                      ) : (
                        <a key={att.id} href={att.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition">
                          <Download className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          <span className="text-xs text-gray-700 truncate">{att.file_name}</span>
                        </a>
                      )
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ─── SummaryCard ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon, color }: {
  label: string; value: number; icon: React.ReactNode; color: 'indigo' | 'green' | 'red' | 'amber'
}) {
  const bg = { indigo: 'bg-indigo-50', green: 'bg-green-50', red: 'bg-red-50', amber: 'bg-amber-50' }[color]
  const text = { indigo: 'text-indigo-700', green: 'text-green-700', red: 'text-red-700', amber: 'text-amber-700' }[color]
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${bg}`}>{icon}</div>
      <div>
        <p className={`text-2xl font-bold ${text}`}>{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  )
}
