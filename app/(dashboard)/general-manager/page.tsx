'use client'

import React, { useEffect, useState, useCallback } from 'react'
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
  Users,
  AlertTriangle,
  BarChart2,
  LayoutGrid,
  ArrowUpDown,
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

type BranchStatus = 'done' | 'late' | 'not_done' | 'pending' | 'not_scheduled'

type RMReview = {
  id: string
  rmId: string
  rating: number | null
  action_taken: string | null
  notes: string | null
  reviewed_at: string | null
}

type GMCell = {
  expectedId: string
  submissionId: string | null
  branchStatus: BranchStatus
  review: RMReview | null
  submittedAt: string | null
}

type GMRow = {
  rmId: string
  rmName: string
  regionId: string
  regionName: string
  storeId: string
  storeName: string
  bmId: string
  bmName: string
  days: Record<string, GMCell | null>
}

type CellTarget = {
  cell: GMCell
  rmName: string
  storeName: string
  dateStr: string
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

type RMOption = { value: string; label: string }

// ─── Status mapping ───────────────────────────────────────────────────────────

function esStatusToBranch(status: string): BranchStatus {
  if (status === 'submitted_on_time' || status === 'approved' || status === 'under_review') return 'done'
  if (status === 'submitted_late') return 'late'
  if (status === 'missed') return 'not_done'
  if (status === 'due' || status === 'not_due') return 'pending'
  return 'not_scheduled'
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function GMDashboard() {
  const { profile, loading: profileLoading } = useProfile()
  const [weekStart, setWeekStart] = useState(() => getMondayOf(new Date()))
  const [rows, setRows] = useState<GMRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [rmFilter, setRmFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'branch_missed' | 'rm_not_reviewed' | 'all_reviewed'>('all')
  const [panelTarget, setPanelTarget] = useState<CellTarget | null>(null)
  const [rmOptions, setRmOptions] = useState<RMOption[]>([{ value: 'all', label: 'All RMs' }])
  const [tab, setTab] = useState<'grid' | 'performance'>('grid')

  const weekDays = getWeekDays(weekStart)

  const fetchData = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const supabase = createClient()

    const days = getWeekDays(weekStart)
    const weekFrom = toDateStr(days[0])
    const weekTo = toDateStr(days[6])

    // 1. Regions where this profile is the GM
    const { data: regionRows } = await supabase
      .from('regions')
      .select('id, name')
      .eq('general_manager_id', profile.id)

    const regions: { id: string; name: string }[] = regionRows ?? []
    const regionIds = regions.map(r => r.id)

    if (regionIds.length === 0) {
      setRows([])
      setRmOptions([{ value: 'all', label: 'All RMs' }])
      setLoading(false)
      return
    }

    // 2. RM assignments for those regions
    const { data: rmAssignments } = await supabase
      .from('user_region_assignments')
      .select('user_id, region_id')
      .in('region_id', regionIds)

    const rmUserIds = [...new Set((rmAssignments ?? []).map((a: any) => a.user_id))]

    const { data: rmProfiles } = rmUserIds.length > 0
      ? await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', rmUserIds)
          .eq('role', 'regional_manager')
      : { data: [] }

    // First RM per region
    const regionToRM: Record<string, { rmId: string; rmName: string }> = {}
    for (const a of (rmAssignments ?? [])) {
      if (regionToRM[a.region_id]) continue
      const rm = (rmProfiles ?? []).find((p: any) => p.id === a.user_id)
      if (rm) regionToRM[a.region_id] = { rmId: rm.id, rmName: rm.full_name }
    }

    const uniqueRMs = Object.values(regionToRM).reduce<RMOption[]>((acc, { rmId, rmName }) => {
      if (!acc.find(r => r.value === rmId)) acc.push({ value: rmId, label: rmName })
      return acc
    }, [])
    setRmOptions([{ value: 'all', label: 'All RMs' }, ...uniqueRMs])

    // 3. Stores in those regions
    const { data: storeRows } = await supabase
      .from('stores')
      .select('id, name, region_id, branch_manager_id')
      .in('region_id', regionIds)
      .eq('is_active', true)
      .order('name')

    const stores: { id: string; name: string; region_id: string; branch_manager_id: string | null }[] = storeRows ?? []

    // Fetch BM profiles
    const bmIds = [...new Set(stores.map(s => s.branch_manager_id).filter(Boolean))] as string[]
    const { data: bmProfileRows } = bmIds.length > 0
      ? await supabase.from('profiles').select('id, full_name').in('id', bmIds)
      : { data: [] as { id: string; full_name: string }[] }
    const bmProfileMap: Record<string, string> = {}
    for (const p of (bmProfileRows ?? [])) bmProfileMap[p.id] = p.full_name
    const storeIds = stores.map(s => s.id)

    if (storeIds.length === 0) {
      setRows([])
      setLoading(false)
      return
    }

    // 4. Expected submissions for the week
    const { data: expected } = await supabase
      .from('expected_submissions')
      .select('id, store_id, due_date, status')
      .in('store_id', storeIds)
      .gte('due_date', weekFrom)
      .lte('due_date', weekTo)

    const expectedIds = (expected ?? []).map((e: any) => e.id)

    // 5. Submissions + reviews in parallel
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
            .select('id, expected_submission_id, regional_manager_id, rating, action_taken, notes, reviewed_at')
            .in('expected_submission_id', expectedIds)
        : { data: [] },
    ])

    const subMap: Record<string, { id: string; submitted_at: string }> = {}
    for (const s of submissionsResult.data ?? []) subMap[s.expected_submission_id] = s

    const reviewMap: Record<string, RMReview> = {}
    for (const r of reviewsResult.data ?? []) {
      reviewMap[r.expected_submission_id] = {
        id: r.id,
        rmId: r.regional_manager_id,
        rating: r.rating ?? null,
        action_taken: r.action_taken ?? null,
        notes: r.notes ?? null,
        reviewed_at: r.reviewed_at ?? null,
      }
    }

    // 6. Build grid rows
    const built: GMRow[] = stores.map(store => {
      const region = regions.find(r => r.id === store.region_id)
      const rmInfo = regionToRM[store.region_id] ?? { rmId: 'none', rmName: 'No RM Assigned' }

      const dayCells: Record<string, GMCell | null> = {}
      for (const d of days) dayCells[toDateStr(d)] = null

      for (const e of (expected ?? []).filter((e: any) => e.store_id === store.id)) {
        const sub = subMap[e.id] ?? null
        dayCells[e.due_date] = {
          expectedId: e.id,
          submissionId: sub?.id ?? null,
          branchStatus: esStatusToBranch(e.status),
          review: reviewMap[e.id] ?? null,
          submittedAt: sub?.submitted_at ?? null,
        }
      }

      return {
        rmId: rmInfo.rmId,
        rmName: rmInfo.rmName,
        regionId: store.region_id,
        regionName: region?.name ?? '—',
        storeId: store.id,
        storeName: store.name,
        bmId: store.branch_manager_id ?? 'none',
        bmName: store.branch_manager_id ? (bmProfileMap[store.branch_manager_id] ?? 'Unknown BM') : 'No BM Assigned',
        days: dayCells,
      }
    })

    setRows(built)
    setLoading(false)
  }, [profile, weekStart])

  useEffect(() => {
    if (profile) fetchData()
  }, [profile, fetchData])

  const prevWeek = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })
  const nextWeek = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })

  const today = toDateStr(new Date())
  const isCurrentWeek = toDateStr(weekStart) === toDateStr(getMondayOf(new Date()))
  const weekLabel = `${weekDays[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${weekDays[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`

  // Summary stats
  const allCells = rows.flatMap(r => Object.values(r.days).filter(Boolean)) as GMCell[]
  const actionableCells = allCells.filter(c => c.branchStatus === 'done' || c.branchStatus === 'late' || c.branchStatus === 'not_done')
  const totalDone = allCells.filter(c => c.branchStatus === 'done' || c.branchStatus === 'late').length
  const totalMissed = allCells.filter(c => c.branchStatus === 'not_done').length
  const rmPending = actionableCells.filter(c => !c.review).length

  // Filter rows
  const filtered = rows.filter(r => {
    if (rmFilter !== 'all' && r.rmId !== rmFilter) return false
    if (search && !r.storeName.toLowerCase().includes(search.toLowerCase())) return false
    const cells = Object.values(r.days).filter(Boolean) as GMCell[]
    if (statusFilter === 'branch_missed') {
      if (!cells.some(c => c.branchStatus === 'not_done')) return false
    }
    if (statusFilter === 'rm_not_reviewed') {
      if (!cells.some(c =>
        (c.branchStatus === 'done' || c.branchStatus === 'late' || c.branchStatus === 'not_done') && !c.review
      )) return false
    }
    if (statusFilter === 'all_reviewed') {
      const actionable = cells.filter(c =>
        c.branchStatus === 'done' || c.branchStatus === 'late' || c.branchStatus === 'not_done'
      )
      if (actionable.length === 0 || !actionable.every(c => !!c.review)) return false
    }
    return true
  })

  // Group by RM
  const rmGroups: Record<string, { rmId: string; rmName: string; regionName: string; stores: GMRow[] }> = {}
  for (const row of filtered) {
    if (!rmGroups[row.rmId]) {
      rmGroups[row.rmId] = { rmId: row.rmId, rmName: row.rmName, regionName: row.regionName, stores: [] }
    }
    rmGroups[row.rmId].stores.push(row)
  }

  if (profileLoading) return <LoadingPage />

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1600px] mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">GM Compliance Overview</h1>
          <p className="text-sm text-gray-500 mt-0.5">RM accountability and branch submission tracking across all regions</p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 flex-shrink-0">
          <button
            onClick={() => setTab('grid')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${tab === 'grid' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <LayoutGrid className="h-4 w-4" /> Grid
          </button>
          <button
            onClick={() => setTab('performance')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${tab === 'performance' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <BarChart2 className="h-4 w-4" /> Performance
          </button>
        </div>
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
          <button
            onClick={() => setWeekStart(getMondayOf(new Date()))}
            className="ml-1 text-xs text-indigo-600 hover:underline font-medium"
          >
            This week
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Total Stores" value={rows.length} icon={<StoreIcon className="h-5 w-5 text-indigo-500" />} color="indigo" />
        <SummaryCard label="Branches Done" value={totalDone} icon={<CheckCircle2 className="h-5 w-5 text-green-500" />} color="green" />
        <SummaryCard label="Branches Missed" value={totalMissed} icon={<XCircle className="h-5 w-5 text-red-500" />} color="red" />
        <SummaryCard label="RM Reviews Pending" value={rmPending} icon={<AlertTriangle className="h-5 w-5 text-amber-500" />} color="amber" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search branch…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <select
          value={rmFilter}
          onChange={e => setRmFilter(e.target.value)}
          className="sm:w-52 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {rmOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {tab === 'grid' && (
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
            className="sm:w-56 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Stores</option>
            <option value="branch_missed">Branch Missed</option>
            <option value="rm_not_reviewed">RM Not Reviewed</option>
            <option value="all_reviewed">All Reviewed</option>
          </select>
        )}
      </div>

      {/* Performance tab */}
      {tab === 'performance' && (
        <PerformanceTab rows={rows} rmFilter={rmFilter} search={search} loading={loading} weekLabel={weekLabel} />
      )}

      {/* Grid */}
      {tab === 'grid' && (loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16 text-center">
          <StoreIcon className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-500">No regions assigned to your GM account</p>
          <p className="text-xs text-gray-400 mt-1">Ask an admin to assign your regions in the admin panel.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 sticky left-0 bg-gray-50/80 z-10 min-w-[180px] border-r border-gray-200">
                    Store
                  </th>
                  {weekDays.map((d, i) => {
                    const dateStr = toDateStr(d)
                    const isToday = dateStr === today
                    return (
                      <th key={dateStr} className={`text-center text-xs font-semibold uppercase tracking-wider px-2 py-3 min-w-[88px] ${isToday ? 'text-indigo-600' : 'text-gray-500'}`}>
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
                {Object.keys(rmGroups).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-sm text-gray-400">
                      No stores match the current filter.
                    </td>
                  </tr>
                ) : (
                  Object.values(rmGroups).map(group => (
                    <React.Fragment key={group.rmId}>
                      {/* RM group header */}
                      <tr className="bg-indigo-50/70 border-t-2 border-indigo-100">
                        <td colSpan={8} className="px-4 py-2 sticky left-0">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-indigo-200 flex items-center justify-center flex-shrink-0">
                              <Users className="h-3.5 w-3.5 text-indigo-700" />
                            </div>
                            <span className="text-sm font-bold text-indigo-800">{group.rmName}</span>
                            <span className="text-xs text-indigo-500">·</span>
                            <span className="text-xs text-indigo-500">{group.regionName}</span>
                            <span className="ml-2 text-xs text-indigo-400 font-normal">
                              {group.stores.length} branch{group.stores.length !== 1 ? 'es' : ''}
                            </span>
                          </div>
                        </td>
                      </tr>

                      {/* Store rows */}
                      {group.stores.map(row => (
                        <tr key={row.storeId} className="hover:bg-gray-50/40 transition-colors">
                          <td className="px-4 py-3 sticky left-0 bg-white z-10 border-r border-gray-100">
                            <p className="text-sm font-medium text-gray-800 truncate max-w-[160px]">{row.storeName}</p>
                          </td>
                          {weekDays.map(d => {
                            const dateStr = toDateStr(d)
                            const cell = row.days[dateStr]
                            return (
                              <td key={dateStr} className="px-2 py-2.5 text-center">
                                <GMCellIndicator
                                  cell={cell}
                                  rmName={row.rmName}
                                  storeName={row.storeName}
                                  dateStr={dateStr}
                                  onOpen={setPanelTarget}
                                />
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-3 flex flex-wrap gap-x-5 gap-y-2 items-center">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Legend:</span>
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
                <AlertTriangle className="h-2.5 w-2.5 text-white" />
              </span>
              <span className="text-xs text-gray-500">RM Not Reviewed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] rounded-full bg-indigo-500 px-1">
                <span className="text-[9px] font-bold text-white">★N</span>
              </span>
              <span className="text-xs text-gray-500">RM Rated</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-green-500">
                <CheckCheck className="h-2.5 w-2.5 text-white" />
              </span>
              <span className="text-xs text-gray-500">RM Action Recorded</span>
            </div>
          </div>
        </div>
      ))}

      {/* Detail Drawer */}
      {panelTarget && (
        <GMDetailDrawer target={panelTarget} onClose={() => setPanelTarget(null)} />
      )}
    </div>
  )
}

// ─── Cell Indicator ───────────────────────────────────────────────────────────

function GMCellIndicator({
  cell, rmName, storeName, dateStr, onOpen,
}: {
  cell: GMCell | null
  rmName: string
  storeName: string
  dateStr: string
  onOpen: (t: CellTarget) => void
}) {
  if (!cell) return <span className="text-gray-200 text-xs select-none">—</span>

  const isActionable = cell.branchStatus === 'done' || cell.branchStatus === 'late' || cell.branchStatus === 'not_done'
  const reviewed = !!cell.review

  type Config = { bg: string; border: string; icon: React.ReactNode }
  const configs: Record<BranchStatus, Config | null> = {
    done:          { bg: 'bg-green-100',  border: reviewed ? 'border-transparent' : 'border-amber-400',  icon: <CheckCircle2 className="h-4 w-4 text-green-600" /> },
    late:          { bg: 'bg-yellow-100', border: reviewed ? 'border-transparent' : 'border-amber-400',  icon: <Clock        className="h-4 w-4 text-yellow-600" /> },
    not_done:      { bg: 'bg-red-100',    border: reviewed ? 'border-transparent' : 'border-amber-400',  icon: <XCircle      className="h-4 w-4 text-red-500" /> },
    pending:       { bg: 'bg-gray-100',   border: 'border-transparent',                                   icon: <Minus        className="h-4 w-4 text-gray-400" /> },
    not_scheduled: null,
  }

  const config = configs[cell.branchStatus]
  if (!config) return <span className="text-gray-200 text-xs select-none">—</span>

  const badge = isActionable ? (
    reviewed ? (
      (cell.branchStatus === 'done' || cell.branchStatus === 'late') ? (
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
        <AlertTriangle className="h-2.5 w-2.5 text-white" />
      </span>
    )
  ) : null

  const inner = (
    <span className={`relative inline-flex items-center justify-center w-10 h-10 rounded-xl border-2 transition-all ${config.bg} ${config.border} ${isActionable ? 'cursor-pointer hover:scale-110 hover:shadow-md' : ''}`}>
      {config.icon}
      {badge}
    </span>
  )

  if (isActionable) {
    return (
      <button
        onClick={() => onOpen({ cell, rmName, storeName, dateStr })}
        className="inline-flex items-center justify-center p-1"
        title={reviewed ? 'View details' : 'RM has not reviewed — click to view'}
      >
        {inner}
      </button>
    )
  }
  return <div className="inline-flex items-center justify-center p-1">{inner}</div>
}

// ─── Detail Drawer ────────────────────────────────────────────────────────────

function GMDetailDrawer({
  target, onClose,
}: {
  target: CellTarget
  onClose: () => void
}) {
  const { cell, rmName, storeName, dateStr } = target
  const [data, setData] = useState<DrawerData | null>(null)
  const [loadingData, setLoadingData] = useState(!!cell.submissionId)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!cell.submissionId) return
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
        .eq('id', cell.submissionId!)
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
        supabase.from('submission_answers').select('*').eq('submission_id', cell.submissionId!),
        supabase.from('attachments').select('*').eq('entity_type', 'submission').eq('entity_id', cell.submissionId!),
      ])

      setData({
        id: sub.id,
        status: sub.status,
        submitted_at: sub.submitted_at,
        is_late: sub.is_late,
        store_name: (sub.stores as any)?.name ?? '—',
        bm_name: (sub.submitted_profile as any)?.full_name ?? null,
        form_name: (sub.form_templates as any)?.name ?? null,
        due_date: (sub.expected_submissions as any)?.due_date ?? null,
        form_sections: tmpl?.form_sections ?? [],
        answers: answerData ?? [],
        attachments: attachmentData ?? [],
      })
      setLoadingData(false)
    }
    load()
  }, [cell.submissionId])

  const review = cell.review
  const branchSubmitted = cell.branchStatus === 'done' || cell.branchStatus === 'late'
  const branchMissed = cell.branchStatus === 'not_done'
  const rmReviewed = !!review

  const answerMap: Record<string, SubmissionAnswer> = {}
  if (data) for (const a of data.answers) answerMap[a.question_id] = a

  const dateFormatted = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-gray-900 truncate">{storeName}</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate">RM: {rmName} · {dateFormatted}</p>
          </div>
          <button onClick={onClose} className="ml-3 p-2 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* Branch status banner */}
          {branchSubmitted && (
            <div className={`flex items-center gap-3 rounded-xl p-4 ${cell.branchStatus === 'late' ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
              {cell.branchStatus === 'late'
                ? <Clock className="h-5 w-5 text-yellow-600 flex-shrink-0" />
                : <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
              }
              <div>
                <p className={`text-sm font-semibold ${cell.branchStatus === 'late' ? 'text-yellow-700' : 'text-green-700'}`}>
                  {cell.branchStatus === 'late' ? 'Submitted Late' : 'Submitted On Time'}
                </p>
                {cell.submittedAt && (
                  <p className={`text-xs mt-0.5 ${cell.branchStatus === 'late' ? 'text-yellow-600' : 'text-green-600'}`}>
                    {formatDateTime(cell.submittedAt)}
                  </p>
                )}
              </div>
            </div>
          )}

          {branchMissed && (
            <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
              <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-700">Submission Not Done</p>
                <p className="text-xs text-red-500 mt-0.5">{storeName} did not complete this submission.</p>
              </div>
            </div>
          )}

          {/* RM review status */}
          {(branchSubmitted || branchMissed) && (
            rmReviewed ? (
              <div className={`rounded-xl border p-4 space-y-3 ${branchSubmitted ? 'bg-indigo-50 border-indigo-200' : 'bg-green-50 border-green-200'}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${branchSubmitted ? 'bg-indigo-500' : 'bg-green-500'}`}>
                    {branchSubmitted
                      ? <Star className="h-3.5 w-3.5 text-white" />
                      : <CheckCheck className="h-3.5 w-3.5 text-white" />
                    }
                  </div>
                  <p className={`text-sm font-semibold ${branchSubmitted ? 'text-indigo-700' : 'text-green-700'}`}>
                    RM Review Completed
                  </p>
                </div>

                {branchSubmitted && review!.rating != null && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">RM Rating</p>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map(i => (
                        <Star
                          key={i}
                          className={`h-5 w-5 ${i <= (review!.rating ?? 0) ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`}
                        />
                      ))}
                      <span className="ml-1 text-sm font-bold text-gray-700">{review!.rating}/5</span>
                    </div>
                  </div>
                )}

                {branchMissed && review!.action_taken && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Action Taken by RM</p>
                    <p className="text-sm text-gray-800 bg-white rounded-lg px-3 py-2 border border-green-200">
                      {review!.action_taken}
                    </p>
                  </div>
                )}

                {review!.notes && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">RM Notes</p>
                    <p className="text-sm text-gray-700 italic">"{review!.notes}"</p>
                  </div>
                )}

                {review!.reviewed_at && (
                  <p className="text-[10px] text-gray-400">Reviewed {formatDateTime(review!.reviewed_at)}</p>
                )}
              </div>
            ) : (
              <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-amber-400 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="h-3.5 w-3.5 text-white" />
                  </div>
                  <p className="text-sm font-bold text-amber-800">RM Review Not Completed</p>
                </div>
                <p className="text-xs text-amber-700">
                  {rmName} has not yet {branchMissed ? 'recorded an action for this missed submission' : 'reviewed and rated this submission'}.
                </p>
              </div>
            )
          )}

          {/* Submission details */}
          {branchSubmitted && (
            loadingData ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600" />
              </div>
            ) : !data ? (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 rounded-xl p-4">
                <AlertCircle className="h-4 w-4" />
                <p className="text-sm">Could not load submission details.</p>
              </div>
            ) : (
              <>
                {/* Proof card */}
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

                {/* Questions & answers */}
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
            )
          )}
        </div>
      </div>
    </>
  )
}

// ─── Performance Tab ─────────────────────────────────────────────────────────

type PerfRow = {
  storeId: string
  storeName: string
  rmName: string
  bmId: string
  bmName: string
  done: number
  missed: number
  total: number
  rate: number | null
}

type BMPerfRow = {
  bmId: string
  bmName: string
  stores: number
  done: number
  missed: number
  total: number
  rate: number | null
}

type SortKey = 'storeName' | 'rate' | 'missed' | 'done'
type BMSortKey = 'bmName' | 'rate' | 'missed' | 'done'
type PerfView = 'stores' | 'bm'

function PerformanceTab({
  rows, rmFilter, search, loading, weekLabel,
}: {
  rows: GMRow[]
  rmFilter: string
  search: string
  loading: boolean
  weekLabel: string
}) {
  const [view, setView] = useState<PerfView>('stores')
  const [sortKey, setSortKey] = useState<SortKey>('rate')
  const [sortAsc, setSortAsc] = useState(true)
  const [bmSortKey, setBmSortKey] = useState<BMSortKey>('rate')
  const [bmSortAsc, setBmSortAsc] = useState(true)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(key === 'storeName') }
  }

  function toggleBmSort(key: BMSortKey) {
    if (bmSortKey === key) setBmSortAsc(a => !a)
    else { setBmSortKey(key); setBmSortAsc(key === 'bmName') }
  }

  const perfRows: PerfRow[] = rows
    .filter(r => {
      if (rmFilter !== 'all' && r.rmId !== rmFilter) return false
      if (search && !r.storeName.toLowerCase().includes(search.toLowerCase()) && !r.bmName.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
    .map(r => {
      const cells = Object.values(r.days).filter(Boolean) as GMCell[]
      const done = cells.filter(c => c.branchStatus === 'done' || c.branchStatus === 'late').length
      const missed = cells.filter(c => c.branchStatus === 'not_done').length
      const total = done + missed
      return {
        storeId: r.storeId,
        storeName: r.storeName,
        rmName: r.rmName,
        bmId: r.bmId,
        bmName: r.bmName,
        done,
        missed,
        total,
        rate: total > 0 ? Math.round((done / total) * 100) : null,
      }
    })

  const sorted = [...perfRows].sort((a, b) => {
    let diff = 0
    if (sortKey === 'storeName') diff = a.storeName.localeCompare(b.storeName)
    else if (sortKey === 'rate') diff = (a.rate ?? -1) - (b.rate ?? -1)
    else if (sortKey === 'missed') diff = a.missed - b.missed
    else if (sortKey === 'done') diff = a.done - b.done
    return sortAsc ? diff : -diff
  })

  // Aggregate by BM
  const bmMap: Record<string, BMPerfRow> = {}
  for (const r of perfRows) {
    if (!bmMap[r.bmId]) {
      bmMap[r.bmId] = { bmId: r.bmId, bmName: r.bmName, stores: 0, done: 0, missed: 0, total: 0, rate: null }
    }
    bmMap[r.bmId].stores += 1
    bmMap[r.bmId].done += r.done
    bmMap[r.bmId].missed += r.missed
    bmMap[r.bmId].total += r.total
  }
  for (const bm of Object.values(bmMap)) {
    bm.rate = bm.total > 0 ? Math.round((bm.done / bm.total) * 100) : null
  }
  const bmRows = Object.values(bmMap).sort((a, b) => {
    let diff = 0
    if (bmSortKey === 'bmName') diff = a.bmName.localeCompare(b.bmName)
    else if (bmSortKey === 'rate') diff = (a.rate ?? -1) - (b.rate ?? -1)
    else if (bmSortKey === 'missed') diff = a.missed - b.missed
    else if (bmSortKey === 'done') diff = a.done - b.done
    return bmSortAsc ? diff : -diff
  })

  function rateColor(rate: number | null) {
    if (rate === null) return 'text-gray-400'
    if (rate >= 90) return 'text-green-600'
    if (rate >= 70) return 'text-yellow-600'
    return 'text-red-600'
  }

  function barColor(rate: number | null) {
    if (rate === null) return 'bg-gray-200'
    if (rate >= 90) return 'bg-green-500'
    if (rate >= 70) return 'bg-yellow-400'
    return 'bg-red-500'
  }

  function SortBtn({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col
    return (
      <button
        onClick={() => toggleSort(col)}
        className={`flex items-center gap-1 group ${active ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
      >
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? 'text-indigo-500' : 'text-gray-400 group-hover:text-gray-500'}`} />
      </button>
    )
  }

  function BMSortBtn({ col, label }: { col: BMSortKey; label: string }) {
    const active = bmSortKey === col
    return (
      <button
        onClick={() => toggleBmSort(col)}
        className={`flex items-center gap-1 group ${active ? 'text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
      >
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? 'text-indigo-500' : 'text-gray-400 group-hover:text-gray-500'}`} />
      </button>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    )
  }

  if (sorted.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16 text-center">
        <BarChart2 className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-semibold text-gray-500">No data to display</p>
      </div>
    )
  }

  // Aggregate totals for the week
  const totalDone = sorted.reduce((s, r) => s + r.done, 0)
  const totalMissed = sorted.reduce((s, r) => s + r.missed, 0)
  const grandTotal = totalDone + totalMissed
  const overallRate = grandTotal > 0 ? Math.round((totalDone / grandTotal) * 100) : null

  return (
    <div className="space-y-4">
      {/* Week totals banner */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 flex flex-wrap gap-6 items-center">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Week</p>
          <p className="text-sm font-semibold text-gray-700 mt-0.5">{weekLabel}</p>
        </div>
        <div className="h-8 w-px bg-gray-200" />
        <div className="flex gap-6">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Submitted</p>
            <p className="text-xl font-bold text-green-600 mt-0.5">{totalDone} <span className="text-sm font-normal text-gray-400">/ {grandTotal}</span></p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Missed</p>
            <p className="text-xl font-bold text-red-500 mt-0.5">{totalMissed} <span className="text-sm font-normal text-gray-400">/ {grandTotal}</span></p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Overall Rate</p>
            <p className={`text-xl font-bold mt-0.5 ${rateColor(overallRate)}`}>{overallRate !== null ? `${overallRate}%` : '—'}</p>
          </div>
        </div>
        {/* View toggle */}
        <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-lg p-1 flex-shrink-0">
          <button
            onClick={() => setView('stores')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${view === 'stores' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <StoreIcon className="h-3.5 w-3.5" /> By Store
          </button>
          <button
            onClick={() => setView('bm')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${view === 'bm' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Users className="h-3.5 w-3.5" /> By Branch Manager
          </button>
        </div>
      </div>

      {/* By Store table */}
      {view === 'stores' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <SortBtn col="storeName" label="Store" />
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                  Branch Manager
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">
                  Regional Manager
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <SortBtn col="done" label="Done" />
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <SortBtn col="missed" label="Missed" />
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Total
                </th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[180px]">
                  <SortBtn col="rate" label="Completion Rate" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map(row => (
                <tr key={row.storeId} className="hover:bg-gray-50/40 transition-colors">
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-semibold text-gray-900">{row.storeName}</p>
                  </td>
                  <td className="px-4 py-3.5 hidden sm:table-cell">
                    <p className="text-sm text-gray-700">{row.bmName}</p>
                  </td>
                  <td className="px-4 py-3.5 hidden md:table-cell">
                    <p className="text-sm text-gray-500">{row.rmName}</p>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-600">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {row.done}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${row.missed > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                      {row.missed > 0 && <XCircle className="h-3.5 w-3.5" />}
                      {row.missed}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className="text-sm text-gray-500">{row.total}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    {row.total === 0 ? (
                      <span className="text-xs text-gray-400 italic">No data</span>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-2 rounded-full transition-all ${barColor(row.rate)}`}
                            style={{ width: `${row.rate ?? 0}%` }}
                          />
                        </div>
                        <span className={`text-sm font-bold w-12 text-right ${rateColor(row.rate)}`}>
                          {row.rate}%
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* By Branch Manager table */}
      {view === 'bm' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/80">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <BMSortBtn col="bmName" label="Branch Manager" />
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                  Stores
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <BMSortBtn col="done" label="Done" />
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <BMSortBtn col="missed" label="Missed" />
                </th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Total
                </th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider min-w-[180px]">
                  <BMSortBtn col="rate" label="Completion Rate" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bmRows.map(bm => (
                <tr key={bm.bmId} className="hover:bg-gray-50/40 transition-colors">
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-semibold text-gray-900">{bm.bmName}</p>
                  </td>
                  <td className="px-4 py-3.5 text-center hidden sm:table-cell">
                    <span className="text-sm text-gray-500">{bm.stores}</span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-600">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {bm.done}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${bm.missed > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                      {bm.missed > 0 && <XCircle className="h-3.5 w-3.5" />}
                      {bm.missed}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className="text-sm text-gray-500">{bm.total}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    {bm.total === 0 ? (
                      <span className="text-xs text-gray-400 italic">No data</span>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-2 rounded-full transition-all ${barColor(bm.rate)}`}
                            style={{ width: `${bm.rate ?? 0}%` }}
                          />
                        </div>
                        <span className={`text-sm font-bold w-12 text-right ${rateColor(bm.rate)}`}>
                          {bm.rate}%
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon, color }: {
  label: string
  value: number
  icon: React.ReactNode
  color: 'indigo' | 'green' | 'red' | 'amber'
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
