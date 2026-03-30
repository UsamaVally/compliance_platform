'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, AlertTriangle, Eye, Archive, TrendingUp, Filter, BarChart2 } from 'lucide-react'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { LoadingPage, LoadingCard } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate } from '@/lib/utils'
import type { Store, Profile, ActionStatus, ActionPriority } from '@/lib/types'

interface ActionRow {
  id: string
  title: string
  description: string | null
  store_id: string | null
  assigned_to: string | null
  raised_by: string
  status: string
  priority: string
  due_date: string | null
  action_required: string | null
  action_taken: string | null
  escalation_level: number
  created_at: string
  stores: Store | null
  assigned_profile: Profile | null
  raised_profile: Profile | null
  region_name?: string
  gm_name?: string
}

interface ActionAnalytics {
  byStatus: Record<string, number>
  byPriority: Record<string, number>
  totalOverdue: number
  avgResolutionDays: number | null
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'awaiting_evidence', label: 'Awaiting Evidence' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'verified', label: 'Verified' },
  { value: 'closed', label: 'Closed' },
]

const PRIORITY_OPTIONS = [
  { value: '', label: 'All Priorities' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-500',
  in_progress: 'bg-blue-500',
  awaiting_evidence: 'bg-yellow-500',
  escalated: 'bg-orange-500',
  resolved: 'bg-green-500',
  verified: 'bg-emerald-500',
  closed: 'bg-gray-400',
}

export default function HSActionsPage() {
  const { profile, loading: profileLoading } = useProfile()

  const [actions, setActions] = useState<ActionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [analytics, setAnalytics] = useState<ActionAnalytics | null>(null)

  // Options for filters
  const [gmOptions, setGmOptions] = useState<{ value: string; label: string }[]>([])
  const [regionOptions, setRegionOptions] = useState<{ value: string; label: string }[]>([])
  const [storeOptions, setStoreOptions] = useState<{ value: string; label: string }[]>([])
  const [rmOptions, setRmOptions] = useState<{ value: string; label: string }[]>([])

  // Filters
  const [gmFilter, setGmFilter] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [rmFilter, setRmFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // Bulk
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkModal, setBulkModal] = useState<{ open: boolean; action: 'close' | 'escalate' | null }>({ open: false, action: null })
  const [bulkNotes, setBulkNotes] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)

  // Raise
  const [raiseModal, setRaiseModal] = useState(false)
  const [raiseForm, setRaiseForm] = useState({ title: '', description: '', store_id: '', assigned_to: '', action_required: '', due_date: '', priority: 'medium' as ActionPriority })
  const [raiseLoading, setRaiseLoading] = useState(false)
  const [raiseError, setRaiseError] = useState('')
  const [allAssignees, setAllAssignees] = useState<{ value: string; label: string }[]>([])
  const [allStores, setAllStores] = useState<{ value: string; label: string }[]>([])

  // Update
  const [updateModal, setUpdateModal] = useState<{ open: boolean; action: ActionRow | null }>({ open: false, action: null })
  const [updateForm, setUpdateForm] = useState<{ status: ActionStatus | ''; action_taken: string; update_notes: string }>({ status: '', action_taken: '', update_notes: '' })
  const [updateLoading, setUpdateLoading] = useState(false)
  const [updateError, setUpdateError] = useState('')

  // Store lookup maps
  const [regionMap, setRegionMap] = useState<Record<string, { name: string; gm_id: string | null }>>({})
  const [gmMap, setGmMap] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!profile) return
    async function loadMetadata() {
      const supabase = createClient()

      const { data: gmsData } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'general_manager')
      const gms = (gmsData ?? []) as { id: string; full_name: string }[]
      const gm_map = Object.fromEntries(gms.map(g => [g.id, g.full_name]))
      setGmMap(gm_map)
      setGmOptions([{ value: '', label: 'All GMs' }, ...gms.map(g => ({ value: g.id, label: g.full_name }))])

      const { data: regionsData } = await supabase
        .from('regions')
        .select('id, name, general_manager_id')
      const regions = (regionsData ?? []) as { id: string; name: string; general_manager_id: string | null }[]
      const r_map: Record<string, { name: string; gm_id: string | null }> = {}
      for (const r of regions) r_map[r.id] = { name: r.name, gm_id: r.general_manager_id }
      setRegionMap(r_map)
      setRegionOptions([{ value: '', label: 'All Regions' }, ...regions.map(r => ({ value: r.id, label: r.name }))])

      const { data: rmsData } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'regional_manager')
      const rms = (rmsData ?? []) as { id: string; full_name: string }[]
      setRmOptions([{ value: '', label: 'All RMs' }, ...rms.map(r => ({ value: r.id, label: r.full_name }))])

      const { data: storesData } = await supabase
        .from('stores')
        .select('id, name')
        .eq('is_active', true)
      const stores = (storesData ?? []) as { id: string; name: string }[]
      setStoreOptions([{ value: '', label: 'All Stores' }, ...stores.map(s => ({ value: s.id, label: s.name }))])
      setAllStores(stores.map(s => ({ value: s.id, label: s.name })))

      // All staff for assign
      const { data: staffData } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('is_active', true)
        .in('role', ['general_manager', 'regional_manager', 'branch_manager'])
      const staff = (staffData ?? []) as { id: string; full_name: string; role: string }[]
      setAllAssignees(staff.map(s => ({ value: s.id, label: `${s.full_name} (${s.role.replace(/_/g, ' ')})` })))
    }
    loadMetadata()
  }, [profile])

  const fetchActions = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const supabase = createClient()

    let storeTargets: string[] | null = null
    if (storeFilter) {
      storeTargets = [storeFilter]
    } else if (regionFilter) {
      const { data: rs } = await supabase.from('stores').select('id').eq('region_id', regionFilter)
      storeTargets = (rs ?? []).map((s: { id: string }) => s.id)
    } else if (gmFilter) {
      const gmRegions = Object.entries(regionMap).filter(([, r]) => r.gm_id === gmFilter).map(([id]) => id)
      if (gmRegions.length > 0) {
        const { data: rs } = await supabase.from('stores').select('id').in('region_id', gmRegions)
        storeTargets = (rs ?? []).map((s: { id: string }) => s.id)
      } else {
        storeTargets = []
      }
    }

    let query = supabase
      .from('actions')
      .select(`
        id, title, description, store_id, assigned_to, raised_by, status, priority,
        due_date, action_required, action_taken, escalation_level, created_at,
        stores(id, name, region_id),
        assigned_profile:profiles!actions_assigned_to_fkey(id, full_name, email),
        raised_profile:profiles!actions_raised_by_fkey(id, full_name, email)
      `)
      .order('created_at', { ascending: false })

    if (storeTargets !== null) {
      if (storeTargets.length === 0) {
        setActions([])
        setLoading(false)
        return
      }
      query = query.in('store_id', storeTargets)
    }
    if (statusFilter) query = query.eq('status', statusFilter as ActionStatus)
    if (priorityFilter) query = query.eq('priority', priorityFilter as ActionPriority)
    if (fromDate) query = query.gte('created_at', fromDate)
    if (toDate) query = query.lte('created_at', toDate + 'T23:59:59')
    if (rmFilter) query = query.eq('raised_by', rmFilter)

    const { data } = await query

    type RawAction = ActionRow & {
      stores: (Store & { region_id: string | null }) | null
    }
    const raw = (data ?? []) as unknown as RawAction[]
    const enriched: ActionRow[] = raw.map(a => {
      const region = a.stores?.region_id ? regionMap[a.stores.region_id] : null
      return {
        ...a,
        region_name: region?.name ?? '—',
        gm_name: region?.gm_id ? (gmMap[region.gm_id] ?? '—') : '—',
      }
    })

    setActions(enriched)

    // Compute analytics
    const byStatus: Record<string, number> = {}
    const byPriority: Record<string, number> = {}
    let overdueCount = 0
    const today = new Date()
    let totalResolutionMs = 0
    let resolvedCount = 0

    for (const a of enriched) {
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1
      byPriority[a.priority] = (byPriority[a.priority] ?? 0) + 1
      if (a.due_date && new Date(a.due_date) < today && !['resolved', 'verified', 'closed'].includes(a.status)) overdueCount++
      if ((a.status === 'resolved' || a.status === 'verified' || a.status === 'closed')) {
        const created = new Date(a.created_at)
        const resolved = today // proxy for resolution time
        totalResolutionMs += resolved.getTime() - created.getTime()
        resolvedCount++
      }
    }

    setAnalytics({
      byStatus,
      byPriority,
      totalOverdue: overdueCount,
      avgResolutionDays: resolvedCount > 0 ? Math.round(totalResolutionMs / resolvedCount / (1000 * 60 * 60 * 24)) : null,
    })

    setLoading(false)
  }, [profile, regionMap, gmMap, storeFilter, regionFilter, gmFilter, statusFilter, priorityFilter, fromDate, toDate, rmFilter])

  useEffect(() => {
    if (profile && Object.keys(regionMap).length >= 0) fetchActions()
  }, [profile, regionMap, fetchActions])

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === actions.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(actions.map(a => a.id)))
    }
  }

  async function handleBulk() {
    if (!profile || selectedIds.size === 0 || !bulkModal.action) return
    setBulkLoading(true)
    const supabase = createClient()
    const ids = [...selectedIds]

    if (bulkModal.action === 'close') {
      await supabase.from('actions').update({
        status: 'closed',
        closure_notes: bulkNotes.trim() || 'Bulk closed by Higher Supervision',
        closed_by: profile.id,
        closed_at: new Date().toISOString(),
      }).in('id', ids)

      for (const id of ids) {
        await supabase.from('action_updates').insert({
          action_id: id,
          updated_by: profile.id,
          update_text: bulkNotes.trim() || 'Bulk closed by Higher Supervision',
          status_change_to: 'closed',
        })
      }
    } else if (bulkModal.action === 'escalate') {
      for (const id of ids) {
        const action = actions.find(a => a.id === id)
        await supabase.from('actions').update({
          status: 'escalated',
          escalation_level: (action?.escalation_level ?? 1) + 1,
        }).eq('id', id)
        await supabase.from('action_updates').insert({
          action_id: id,
          updated_by: profile.id,
          update_text: bulkNotes.trim() || 'Bulk escalated by Higher Supervision',
          status_change_to: 'escalated',
        })
      }
    }

    setBulkLoading(false)
    setBulkModal({ open: false, action: null })
    setBulkNotes('')
    setSelectedIds(new Set())
    fetchActions()
  }

  async function handleUpdate() {
    if (!updateModal.action || !profile) return
    setUpdateLoading(true)
    setUpdateError('')
    const supabase = createClient()

    const updates: Record<string, unknown> = {}
    if (updateForm.status) updates.status = updateForm.status
    if (updateForm.action_taken.trim()) updates.action_taken = updateForm.action_taken.trim()

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('actions').update(updates).eq('id', updateModal.action.id)
      if (error) { setUpdateError('Failed to update action.'); setUpdateLoading(false); return }
    }

    if (updateForm.update_notes.trim()) {
      await supabase.from('action_updates').insert({
        action_id: updateModal.action.id,
        updated_by: profile.id,
        update_text: updateForm.update_notes.trim(),
        status_change_to: updateForm.status || null,
      })
    }

    setUpdateLoading(false)
    setUpdateModal({ open: false, action: null })
    setUpdateForm({ status: '', action_taken: '', update_notes: '' })
    fetchActions()
  }

  async function handleRaise() {
    if (!raiseForm.title.trim() || !raiseForm.store_id) {
      setRaiseError('Title and store are required.')
      return
    }
    if (!profile) return
    setRaiseLoading(true)
    setRaiseError('')
    const supabase = createClient()

    const { error } = await supabase.from('actions').insert({
      organisation_id: profile.organisation_id,
      title: raiseForm.title.trim(),
      description: raiseForm.description.trim() || null,
      store_id: raiseForm.store_id,
      assigned_to: raiseForm.assigned_to || null,
      raised_by: profile.id,
      action_required: raiseForm.action_required.trim() || null,
      due_date: raiseForm.due_date || null,
      priority: raiseForm.priority,
      status: 'open',
      escalation_level: 3,
    })

    if (error) { setRaiseError('Failed to raise action.'); setRaiseLoading(false); return }

    setRaiseLoading(false)
    setRaiseModal(false)
    setRaiseForm({ title: '', description: '', store_id: '', assigned_to: '', action_required: '', due_date: '', priority: 'medium' })
    fetchActions()
  }

  const overdueActions = actions.filter(
    a => a.due_date && new Date(a.due_date) < new Date() && !['resolved', 'verified', 'closed'].includes(a.status)
  )

  if (profileLoading) return <LoadingPage />

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enterprise Action Tracker</h1>
          <p className="text-sm text-gray-500 mt-1">All actions across the platform</p>
        </div>
        <Button variant="primary" onClick={() => { setRaiseModal(true); setRaiseError('') }}>
          <Plus className="h-4 w-4" />
          Raise New Action
        </Button>
      </div>

      {/* Analytics */}
      {analytics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <BarChart2 className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Total Actions</p>
                <p className="text-2xl font-bold text-gray-900">{actions.length}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Overdue</p>
                <p className="text-2xl font-bold text-red-600">{analytics.totalOverdue}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Resolved / Verified</p>
                <p className="text-2xl font-bold text-green-600">
                  {(analytics.byStatus['resolved'] ?? 0) + (analytics.byStatus['verified'] ?? 0)}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Eye className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Open / In Progress</p>
                <p className="text-2xl font-bold text-blue-600">
                  {(analytics.byStatus['open'] ?? 0) + (analytics.byStatus['in_progress'] ?? 0)}
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Status Breakdown */}
      {analytics && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 flex-wrap">
              {Object.entries(analytics.byStatus).map(([status, count]) => (
                <div key={status} className="flex flex-col items-center gap-1">
                  <span className="text-xs font-bold text-gray-700">{count}</span>
                  <div
                    className={`w-10 rounded-t ${STATUS_COLORS[status] ?? 'bg-gray-400'}`}
                    style={{ height: `${Math.max(8, (count / Math.max(...Object.values(analytics.byStatus))) * 60)}px` }}
                  />
                  <span className="text-xs text-gray-500 truncate w-16 text-center">{status.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overdue Alert */}
      {overdueActions.length > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-4">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800">{overdueActions.length} overdue action{overdueActions.length !== 1 ? 's' : ''} across the platform</p>
            <p className="text-xs text-red-600 mt-0.5">Use the filters to focus on overdue actions requiring escalation.</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
            <Filter className="h-4 w-4" />
            <span className="font-medium">Filters</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <select value={gmFilter} onChange={e => setGmFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {gmOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {regionOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <select value={rmFilter} onChange={e => setRmFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {rmOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {storeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {PRIORITY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} placeholder="From date" />
            <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} placeholder="To date" />
          </div>
        </CardContent>
      </Card>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-5 py-3">
          <span className="text-sm font-medium text-indigo-800">{selectedIds.size} selected</span>
          <Button size="sm" variant="outline"
            onClick={() => { setBulkModal({ open: true, action: 'escalate' }); setBulkNotes('') }}>
            <AlertTriangle className="h-3.5 w-3.5" />
            Bulk Escalate
          </Button>
          <Button size="sm" variant="outline"
            onClick={() => { setBulkModal({ open: true, action: 'close' }); setBulkNotes('') }}>
            <Archive className="h-3.5 w-3.5" />
            Bulk Close
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Actions Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Actions{' '}
            {actions.length > 0 && (
              <span className="text-sm font-normal text-gray-500 ml-1">({actions.length})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <LoadingCard />
          ) : actions.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState
                icon={AlertTriangle}
                title="No actions found"
                description="No actions match your current filters."
                action={
                  <Button variant="primary" size="sm" onClick={() => setRaiseModal(true)}>
                    <Plus className="h-4 w-4" />
                    Raise New Action
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === actions.length && actions.length > 0}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Store</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Region</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">GM</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Due Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Raised By</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {actions.map(action => {
                    const isOverdue = action.due_date && new Date(action.due_date) < new Date() && !['resolved', 'verified', 'closed'].includes(action.status)
                    return (
                      <tr key={action.id} className={`hover:bg-gray-50 transition-colors ${isOverdue ? 'bg-red-50/20' : ''}`}>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(action.id)}
                            onChange={() => toggleSelect(action.id)}
                            className="h-4 w-4 text-indigo-600 border-gray-300 rounded"
                          />
                        </td>
                        <td className="px-6 py-3 text-sm max-w-[160px]">
                          <p className="font-medium text-gray-900 truncate">{action.title}</p>
                          {action.escalation_level > 1 && (
                            <span className="text-xs text-purple-600">Escalated L{action.escalation_level}</span>
                          )}
                        </td>
                        <td className="px-6 py-3 text-sm text-gray-700">{action.stores?.name ?? '—'}</td>
                        <td className="px-6 py-3 text-sm text-gray-500">{action.region_name}</td>
                        <td className="px-6 py-3 text-sm text-gray-500">{action.gm_name}</td>
                        <td className="px-6 py-3 text-sm text-gray-600">{action.assigned_profile?.full_name ?? '—'}</td>
                        <td className="px-6 py-3 text-sm whitespace-nowrap">
                          {action.due_date ? (
                            <span className={isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'}>
                              {formatDate(action.due_date)}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-6 py-3">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[action.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                            {action.priority.charAt(0).toUpperCase() + action.priority.slice(1)}
                          </span>
                        </td>
                        <td className="px-6 py-3"><StatusBadge status={action.status} /></td>
                        <td className="px-6 py-3 text-sm text-gray-500">{action.raised_profile?.full_name ?? '—'}</td>
                        <td className="px-6 py-3">
                          <Button size="sm" variant="ghost"
                            onClick={() => {
                              setUpdateModal({ open: true, action })
                              setUpdateForm({ status: action.status as ActionStatus, action_taken: action.action_taken ?? '', update_notes: '' })
                              setUpdateError('')
                            }}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Update
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Raise Modal */}
      <Modal isOpen={raiseModal} onClose={() => setRaiseModal(false)} title="Raise New Action" size="lg">
        <div className="space-y-4">
          <Input label="Title" required value={raiseForm.title}
            onChange={e => setRaiseForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Brief description of the issue" />
          <Textarea label="Description" value={raiseForm.description}
            onChange={e => setRaiseForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Detailed description..." rows={3} />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Store <span className="text-red-500">*</span></label>
              <select value={raiseForm.store_id} onChange={e => setRaiseForm(f => ({ ...f, store_id: e.target.value }))}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Select store...</option>
                {allStores.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assign To</label>
              <select value={raiseForm.assigned_to} onChange={e => setRaiseForm(f => ({ ...f, assigned_to: e.target.value }))}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Select assignee...</option>
                {allAssignees.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
          </div>
          <Textarea label="Action Required" value={raiseForm.action_required}
            onChange={e => setRaiseForm(f => ({ ...f, action_required: e.target.value }))}
            placeholder="What specific action needs to be taken..." rows={2} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Due Date" type="date" value={raiseForm.due_date}
              onChange={e => setRaiseForm(f => ({ ...f, due_date: e.target.value }))} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select value={raiseForm.priority} onChange={e => setRaiseForm(f => ({ ...f, priority: e.target.value as ActionPriority }))}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {PRIORITY_OPTIONS.filter(o => o.value).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
          </div>
          {raiseError && <p className="text-sm text-red-600">{raiseError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setRaiseModal(false)}>Cancel</Button>
            <Button variant="primary" loading={raiseLoading} onClick={handleRaise}>
              <AlertTriangle className="h-4 w-4" />
              Raise Action
            </Button>
          </div>
        </div>
      </Modal>

      {/* Update Modal */}
      <Modal isOpen={updateModal.open} onClose={() => setUpdateModal({ open: false, action: null })} title="Update Action" size="md">
        <div className="space-y-4">
          {updateModal.action && (
            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-sm font-semibold text-gray-900">{updateModal.action.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{updateModal.action.stores?.name ?? '—'} · {updateModal.action.region_name}</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select value={updateForm.status} onChange={e => setUpdateForm(f => ({ ...f, status: e.target.value as ActionStatus }))}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {STATUS_OPTIONS.filter(o => o.value).map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
          <Textarea label="Action Taken" value={updateForm.action_taken}
            onChange={e => setUpdateForm(f => ({ ...f, action_taken: e.target.value }))}
            placeholder="Describe what has been done..." rows={3} />
          <Textarea label="Update Notes" value={updateForm.update_notes}
            onChange={e => setUpdateForm(f => ({ ...f, update_notes: e.target.value }))}
            placeholder="Add a comment or update note..." rows={2} />
          {updateError && <p className="text-sm text-red-600">{updateError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setUpdateModal({ open: false, action: null })}>Cancel</Button>
            <Button variant="primary" loading={updateLoading} onClick={handleUpdate}>Save Update</Button>
          </div>
        </div>
      </Modal>

      {/* Bulk Action Modal */}
      <Modal
        isOpen={bulkModal.open}
        onClose={() => setBulkModal({ open: false, action: null })}
        title={bulkModal.action === 'close' ? `Bulk Close ${selectedIds.size} Actions` : `Bulk Escalate ${selectedIds.size} Actions`}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {bulkModal.action === 'close'
              ? `You are about to close ${selectedIds.size} actions. This cannot be undone.`
              : `You are about to escalate ${selectedIds.size} actions to the next level.`
            }
          </p>
          <Textarea
            label="Notes"
            value={bulkNotes}
            onChange={e => setBulkNotes(e.target.value)}
            placeholder={bulkModal.action === 'close' ? 'Reason for bulk closure...' : 'Reason for bulk escalation...'}
            rows={3}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setBulkModal({ open: false, action: null })}>Cancel</Button>
            <Button
              variant={bulkModal.action === 'close' ? 'danger' : 'primary'}
              loading={bulkLoading}
              onClick={handleBulk}
            >
              {bulkModal.action === 'close' ? <><Archive className="h-4 w-4" />Confirm Close</> : <><AlertTriangle className="h-4 w-4" />Confirm Escalate</>}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
