'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  AlertCircle,
  CheckCheck,
  Store as StoreIcon,
  RotateCcw,
  Eye,
} from 'lucide-react'
import Link from 'next/link'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { LoadingPage } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type ReviewRecord = {
  id: string
  acknowledged: boolean
  action_taken: string | null
  notes: string | null
  reviewed_at: string
}

type StoreRow = {
  expected_submission_id: string
  store_id: string
  store_name: string
  bm_name: string | null
  form_name: string | null
  due_date: string
  due_time: string | null
  cutoff_time: string | null
  status: string // 'due' | 'missed' | 'submitted_on_time' | 'submitted_late' | etc.
  submitted_at: string | null
  submission_id: string | null
  review: ReviewRecord | null
  // local edit state
  _action_taken: string
  _notes: string
  _acknowledged: boolean
  _editing: boolean
  _saving: boolean
  _error: string | null
}

const isSubmitted = (s: string) =>
  s === 'submitted_on_time' || s === 'submitted_late' || s === 'under_review' || s === 'approved'

// ─── Component ────────────────────────────────────────────────────────────────

export default function RegionalManagerDashboard() {
  const { profile, loading: profileLoading } = useProfile()

  const [rows, setRows] = useState<StoreRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'submitted' | 'missed'>('all')
  const [reviewFilter, setReviewFilter] = useState<'all' | 'pending' | 'reviewed'>('all')

  const fetchData = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const supabase = createClient()

    // RM's regions → stores
    const { data: regionRows } = await supabase
      .from('user_region_assignments')
      .select('region_id')
      .eq('user_id', profile.id)

    const regionIds = (regionRows ?? []).map((r: any) => r.region_id)

    const { data: storeRows } = await supabase
      .from('stores')
      .select('id')
      .in('region_id', regionIds.length > 0 ? regionIds : ['_none_'])
      .eq('is_active', true)

    const storeIds = (storeRows ?? []).map((s: any) => s.id)

    if (storeIds.length === 0) {
      setRows([])
      setLoading(false)
      return
    }

    // Expected submissions for selected date
    const { data: expected } = await supabase
      .from('expected_submissions')
      .select(`
        id, store_id, due_date, due_time, cutoff_time, status,
        stores(id, name),
        assigned_profile:profiles!expected_submissions_assigned_user_id_fkey(id, full_name),
        schedules(id, name, form_templates!schedules_template_id_fkey(id, name))
      `)
      .in('store_id', storeIds)
      .eq('due_date', selectedDate)
      .order('due_time', { ascending: true, nullsFirst: true })

    const expectedIds = (expected ?? []).map((e: any) => e.id)

    // Actual submissions
    const { data: submissions } = expectedIds.length > 0
      ? await supabase
          .from('submissions')
          .select('id, expected_submission_id, submitted_at')
          .in('expected_submission_id', expectedIds)
          .not('submitted_at', 'is', null)
      : { data: [] }

    const subMap: Record<string, { id: string; submitted_at: string }> = {}
    for (const s of submissions ?? []) subMap[s.expected_submission_id] = s

    // Existing RM reviews
    const { data: reviews } = expectedIds.length > 0
      ? await supabase
          .from('rm_reviews')
          .select('id, expected_submission_id, acknowledged, action_taken, notes, reviewed_at')
          .eq('regional_manager_id', profile.id)
          .in('expected_submission_id', expectedIds)
      : { data: [] }

    const reviewMap: Record<string, ReviewRecord> = {}
    for (const r of reviews ?? []) reviewMap[r.expected_submission_id] = r

    const built: StoreRow[] = (expected ?? []).map((e: any) => {
      const sub = subMap[e.id] ?? null
      const rev = reviewMap[e.id] ?? null
      return {
        expected_submission_id: e.id,
        store_id: e.store_id,
        store_name: e.stores?.name ?? '—',
        bm_name: e.assigned_profile?.full_name ?? null,
        form_name: e.schedules?.form_templates?.name ?? e.schedules?.name ?? null,
        due_date: e.due_date,
        due_time: e.due_time ?? null,
        cutoff_time: e.cutoff_time ?? null,
        status: e.status,
        submitted_at: sub?.submitted_at ?? null,
        submission_id: sub?.id ?? null,
        review: rev,
        _action_taken: rev?.action_taken ?? '',
        _notes: rev?.notes ?? '',
        _acknowledged: rev?.acknowledged ?? false,
        _editing: false,
        _saving: false,
        _error: null,
      }
    })

    setRows(built)
    setLoading(false)
  }, [profile, selectedDate])

  useEffect(() => {
    if (profile) fetchData()
  }, [profile, fetchData])

  function patch(id: string, changes: Partial<StoreRow>) {
    setRows(prev => prev.map(r => r.expected_submission_id === id ? { ...r, ...changes } : r))
  }

  async function handleSave(row: StoreRow) {
    if (!profile) return

    // Validate: missed requires action_taken
    if (!isSubmitted(row.status) && row.status === 'missed' && !row._action_taken.trim()) {
      patch(row.expected_submission_id, { _error: 'Please describe the action taken for this missed submission.' })
      return
    }

    patch(row.expected_submission_id, { _saving: true, _error: null })
    const supabase = createClient()
    const now = new Date().toISOString()

    const payload = {
      organisation_id: profile.organisation_id,
      regional_manager_id: profile.id,
      expected_submission_id: row.expected_submission_id,
      store_id: row.store_id,
      submission_id: row.submission_id,
      submission_status: row.status,
      acknowledged: isSubmitted(row.status) ? row._acknowledged : false,
      action_taken: row._action_taken.trim() || null,
      notes: row._notes.trim() || null,
      reviewed_at: now,
      updated_at: now,
    }

    const { data, error } = await supabase
      .from('rm_reviews')
      .upsert(payload, { onConflict: 'regional_manager_id,expected_submission_id' })
      .select('id, acknowledged, action_taken, notes, reviewed_at')
      .single()

    if (error) {
      patch(row.expected_submission_id, { _saving: false, _error: error.message })
    } else {
      patch(row.expected_submission_id, {
        _saving: false,
        _editing: false,
        _error: null,
        review: {
          id: data.id,
          acknowledged: data.acknowledged,
          action_taken: data.action_taken,
          notes: data.notes,
          reviewed_at: data.reviewed_at,
        },
      })
    }
  }

  // ─── Filtering ──────────────────────────────────────────────────────────────

  const filtered = rows.filter(r => {
    if (statusFilter === 'submitted' && !isSubmitted(r.status)) return false
    if (statusFilter === 'missed' && r.status !== 'missed') return false
    if (reviewFilter === 'reviewed' && !r.review) return false
    if (reviewFilter === 'pending' && r.review) return false
    if (search) {
      const q = search.toLowerCase()
      if (!r.store_name.toLowerCase().includes(q) && !(r.bm_name ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const totalSubmitted = rows.filter(r => isSubmitted(r.status)).length
  const totalMissed = rows.filter(r => r.status === 'missed').length
  const pendingReview = rows.filter(r => !r.review).length

  if (profileLoading || loading) return <LoadingPage />

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Review</h1>
          <p className="text-sm text-gray-500 mt-0.5">Review branch submissions and record follow-up actions</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={() => fetchData()}
            className="p-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 transition-colors"
            title="Refresh"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="Total Stores" value={rows.length} icon={<StoreIcon className="h-5 w-5 text-indigo-500" />} color="indigo" />
        <SummaryCard label="Submitted" value={totalSubmitted} icon={<CheckCircle2 className="h-5 w-5 text-green-500" />} color="green" />
        <SummaryCard label="Missed" value={totalMissed} icon={<XCircle className="h-5 w-5 text-red-500" />} color="red" />
        <SummaryCard label="Pending Review" value={pendingReview} icon={<Clock className="h-5 w-5 text-amber-500" />} color="amber" />
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search store or branch manager…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as any)}
          className="sm:w-44 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">All Statuses</option>
          <option value="submitted">Submitted</option>
          <option value="missed">Missed</option>
        </select>
        <select
          value={reviewFilter}
          onChange={e => setReviewFilter(e.target.value as any)}
          className="sm:w-44 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">All Reviews</option>
          <option value="pending">Pending Review</option>
          <option value="reviewed">Reviewed</option>
        </select>
      </div>

      {/* ── Store list ── */}
      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16">
          <EmptyState
            icon={StoreIcon}
            title="No submissions scheduled"
            description={`No expected submissions for your stores on ${formatDate(selectedDate)}.`}
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 px-6 py-16">
          <EmptyState
            icon={Search}
            title="No results"
            description="No stores match the current filters."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(row => (
            <StoreCard
              key={row.expected_submission_id}
              row={row}
              onPatch={patch}
              onSave={handleSave}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── StoreCard ────────────────────────────────────────────────────────────────

function StoreCard({
  row,
  onPatch,
  onSave,
}: {
  row: StoreRow
  onPatch: (id: string, changes: Partial<StoreRow>) => void
  onSave: (row: StoreRow) => void
}) {
  const submitted = isSubmitted(row.status)
  const missed = row.status === 'missed'
  const reviewed = !!row.review
  const editing = row._editing || !reviewed

  // Status display
  const statusConfig = submitted
    ? { label: 'Submitted', bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle2 className="h-4 w-4 text-green-600" />, border: 'border-green-200' }
    : missed
    ? { label: 'Missed', bg: 'bg-red-100', text: 'text-red-700', icon: <XCircle className="h-4 w-4 text-red-500" />, border: 'border-red-200' }
    : { label: 'Pending', bg: 'bg-gray-100', text: 'text-gray-600', icon: <Clock className="h-4 w-4 text-gray-400" />, border: 'border-gray-200' }

  const cardBorder = reviewed ? 'border-gray-200' : missed ? 'border-red-200' : 'border-gray-200'

  return (
    <div className={`bg-white rounded-2xl border ${cardBorder} overflow-hidden`}>
      {/* ── Store header ── */}
      <div className="flex items-center gap-4 px-5 py-4">
        {/* Status icon */}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${statusConfig.bg}`}>
          {statusConfig.icon}
        </div>

        {/* Store info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-gray-900">{row.store_name}</p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${statusConfig.bg} ${statusConfig.text}`}>
              {statusConfig.label}
            </span>
            {reviewed && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                <CheckCheck className="h-3 w-3" /> Reviewed
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
            {row.bm_name && <span>Manager: {row.bm_name}</span>}
            {row.form_name && <span>Form: {row.form_name}</span>}
            <span>Date: {formatDate(row.due_date)}</span>
            {(row.due_time || row.cutoff_time) && (
              <span>Window: {row.due_time?.slice(0,5) ?? '—'} – {row.cutoff_time?.slice(0,5) ?? '—'}</span>
            )}
            {row.submitted_at && (
              <span className="text-green-600 font-medium">
                Submitted at {new Date(row.submitted_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {row.submission_id && (
            <Link href={`/regional-manager/submissions/${row.submission_id}`}>
              <button className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 border border-indigo-200 font-medium">
                <Eye className="h-3.5 w-3.5" /> View
              </button>
            </Link>
          )}
          {reviewed && !row._editing && (
            <button
              onClick={() => onPatch(row.expected_submission_id, { _editing: true })}
              className="text-xs text-gray-400 hover:text-indigo-600 transition-colors underline underline-offset-2"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* ── Saved review summary (when reviewed and not editing) ── */}
      {reviewed && !row._editing && (
        <div className="border-t border-gray-100 px-5 py-3 bg-gray-50 space-y-1">
          {row.review?.acknowledged && (
            <p className="text-xs text-green-700 font-medium flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Acknowledged
            </p>
          )}
          {row.review?.action_taken && (
            <p className="text-xs text-gray-700">
              <span className="font-medium text-gray-500">Action taken: </span>
              {row.review.action_taken}
            </p>
          )}
          {row.review?.notes && (
            <p className="text-xs text-gray-700">
              <span className="font-medium text-gray-500">Notes: </span>
              {row.review.notes}
            </p>
          )}
          <p className="text-xs text-gray-400">
            Reviewed {new Date(row.review!.reviewed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      )}

      {/* ── Action area (always shown when not yet reviewed; shown when editing) ── */}
      {editing && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">

          {/* Error */}
          {row._error && (
            <p className="text-xs text-red-600 flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" /> {row._error}
            </p>
          )}

          {/* Submitted → Acknowledge toggle */}
          {submitted && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => onPatch(row.expected_submission_id, { _acknowledged: !row._acknowledged })}
                className={`flex items-center gap-2.5 px-4 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${
                  row._acknowledged
                    ? 'bg-green-50 border-green-400 text-green-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:border-green-300 hover:bg-green-50'
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                  row._acknowledged ? 'bg-green-500 border-green-500' : 'border-gray-300'
                }`}>
                  {row._acknowledged && <CheckCheck className="h-3 w-3 text-white" />}
                </div>
                {row._acknowledged ? 'Acknowledged' : 'Acknowledge submission'}
              </button>
            </div>
          )}

          {/* Missed → Action taken (required) */}
          {missed && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">
                Action Taken <span className="text-red-500 normal-case font-normal">* required</span>
              </label>
              <textarea
                value={row._action_taken}
                onChange={e => {
                  onPatch(row.expected_submission_id, {
                    _action_taken: e.target.value,
                    _error: e.target.value.trim() ? null : row._error,
                  })
                }}
                placeholder="Describe what action was taken regarding this missed submission…"
                rows={2}
                className={`block w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none transition-colors ${
                  row._error ? 'border-red-400 bg-red-50' : 'border-gray-300'
                }`}
              />
            </div>
          )}

          {/* Notes (always available) */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1.5 uppercase tracking-wide">
              Notes <span className="text-gray-400 normal-case font-normal">(optional)</span>
            </label>
            <textarea
              value={row._notes}
              onChange={e => onPatch(row.expected_submission_id, { _notes: e.target.value })}
              placeholder="Any additional notes, observations, or follow-up comments…"
              rows={2}
              className="block w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => onSave(row)}
              loading={row._saving}
            >
              {reviewed ? 'Update Review' : submitted ? 'Save' : 'Save Action'}
            </Button>
            {reviewed && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onPatch(row.expected_submission_id, {
                  _editing: false,
                  _action_taken: row.review?.action_taken ?? '',
                  _notes: row.review?.notes ?? '',
                  _acknowledged: row.review?.acknowledged ?? false,
                  _error: null,
                })}
                disabled={row._saving}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── SummaryCard ──────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, icon, color
}: {
  label: string
  value: number
  icon: React.ReactNode
  color: 'indigo' | 'green' | 'red' | 'amber'
}) {
  const bg = { indigo: 'bg-indigo-50', green: 'bg-green-50', red: 'bg-red-50', amber: 'bg-amber-50' }[color]
  const text = { indigo: 'text-indigo-700', green: 'text-green-700', red: 'text-red-700', amber: 'text-amber-700' }[color]
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
