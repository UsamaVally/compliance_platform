'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, AlertTriangle, Eye, ShieldCheck, Filter } from 'lucide-react'
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

export default function GMActionsPage() {
  const { profile, loading: profileLoading } = useProfile()

  const [storeIds, setStoreIds] = useState<string[]>([])
  const [regionIds, setRegionIds] = useState<string[]>([])
  const [actions, setActions] = useState<ActionRow[]>([])
  const [loading, setLoading] = useState(true)

  // Options
  const [regionOptions, setRegionOptions] = useState<{ value: string; label: string }[]>([])
  const [storeOptions, setStoreOptions] = useState<{ value: string; label: string }[]>([])
  const [rmOptions, setRmOptions] = useState<{ value: string; label: string }[]>([])

  // Filters
  const [regionFilter, setRegionFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [rmFilter, setRmFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [fromDate, setFromDate] = useState('')

  // Raise modal
  const [raiseModal, setRaiseModal] = useState(false)
  const [raiseForm, setRaiseForm] = useState({
    title: '',
    description: '',
    store_id: '',
    assigned_to: '',
    action_required: '',
    due_date: '',
    priority: 'medium' as ActionPriority,
  })
  const [raiseLoading, setRaiseLoading] = useState(false)
  const [raiseError, setRaiseError] = useState('')

  // Update modal
  const [updateModal, setUpdateModal] = useState<{ open: boolean; action: ActionRow | null }>({ open: false, action: null })
  const [updateForm, setUpdateForm] = useState<{
    status: ActionStatus | ''
    action_taken: string
    update_notes: string
  }>({ status: '', action_taken: '', update_notes: '' })
  const [updateLoading, setUpdateLoading] = useState(false)
  const [updateError, setUpdateError] = useState('')

  // Verify modal
  const [verifyModal, setVerifyModal] = useState<{ open: boolean; actionId: string | null }>({ open: false, actionId: null })
  const [verifyNotes, setVerifyNotes] = useState('')
  const [verifyLoading, setVerifyLoading] = useState(false)

  // Region -> stores mapping
  const [regionStoreMap, setRegionStoreMap] = useState<Record<string, { id: string; name: string }[]>>({})
  const [allAssignees, setAllAssignees] = useState<{ value: string; label: string }[]>([])

  useEffect(() => {
    if (!profile) return
    async function loadRegions() {
      const supabase = createClient()

      // GM's regions
      const { data: regionsData } = await supabase
        .from('regions')
        .select('id, name')
        .eq('general_manager_id', profile.id)

      const regions = (regionsData ?? []) as { id: string; name: string }[]
      const rIds = regions.map(r => r.id)
      setRegionIds(rIds)
      setRegionOptions([{ value: '', label: 'All Regions' }, ...regions.map(r => ({ value: r.id, label: r.name }))])

      if (rIds.length === 0) return

      // Stores in regions
      const { data: storesData } = await supabase
        .from('stores')
        .select('id, name, region_id')
        .in('region_id', rIds)
        .eq('is_active', true)

      type StoreRow = { id: string; name: string; region_id: string | null }
      const stores = (storesData ?? []) as StoreRow[]
      const sIds = stores.map(s => s.id)
      setStoreIds(sIds)
      setStoreOptions([{ value: '', label: 'All Stores' }, ...stores.map(s => ({ value: s.id, label: s.name }))])

      // Region -> stores map for raise form
      const rsm: Record<string, { id: string; name: string }[]> = {}
      for (const s of stores) {
        if (s.region_id) {
          if (!rsm[s.region_id]) rsm[s.region_id] = []
          rsm[s.region_id].push({ id: s.id, name: s.name })
        }
      }
      setRegionStoreMap(rsm)

      // RMs for these regions + BMs for these stores
      const { data: rmData } = await supabase
        .from('user_region_assignments')
        .select('user_id, profiles!user_region_assignments_user_id_fkey(id, full_name, role)')
        .in('region_id', rIds)

      type RMA = { user_id: string; profiles: { id: string; full_name: string; role: string } | null }
      const rmList = (rmData ?? []) as unknown as RMA[]
      const rmProfiles = rmList.map(a => a.profiles).filter(p => p !== null && p.role === 'regional_manager') as { id: string; full_name: string; role: string }[]

      const { data: bmData } = await supabase
        .from('user_store_assignments')
        .select('user_id, profiles!user_store_assignments_user_id_fkey(id, full_name, role)')
        .in('store_id', sIds.length > 0 ? sIds : ['_none_'])

      type BMA = { user_id: string; profiles: { id: string; full_name: string; role: string } | null }
      const bmList = (bmData ?? []) as unknown as BMA[]
      const bmProfiles = bmList.map(a => a.profiles).filter(p => p !== null && p.role === 'branch_manager') as { id: string; full_name: string; role: string }[]

      const allProfiles = [...rmProfiles, ...bmProfiles]
      const unique = Array.from(new Map(allProfiles.map(p => [p.id, p])).values())
      setAllAssignees(unique.map(p => ({ value: p.id, label: p.full_name })))

      setRmOptions([{ value: '', label: 'All RMs' }, ...rmProfiles.map(p => ({ value: p.id, label: p.full_name }))])
    }
    loadRegions()
  }, [profile])

  const fetchActions = useCallback(async () => {
    if (storeIds.length === 0 && regionIds.length === 0) return
    setLoading(true)
    const supabase = createClient()

    // Get target store IDs after filters
    let targetStores = storeFilter ? [storeFilter] : storeIds
    if (regionFilter && !storeFilter) {
      // Filter by region
      const { data: regionStores } = await supabase
        .from('stores')
        .select('id')
        .eq('region_id', regionFilter)
      targetStores = (regionStores ?? []).map((s: { id: string }) => s.id)
    }

    if (targetStores.length === 0) {
      setActions([])
      setLoading(false)
      return
    }

    let query = supabase
      .from('actions')
      .select(`
        id, title, description, store_id, assigned_to, raised_by, status, priority,
        due_date, action_required, action_taken, escalation_level, created_at,
        stores(*, regions(id, name)),
        assigned_profile:profiles!actions_assigned_to_fkey(id, full_name, email),
        raised_profile:profiles!actions_raised_by_fkey(id, full_name, email)
      `)
      .in('store_id', targetStores)
      .order('created_at', { ascending: false })

    if (statusFilter) query = query.eq('status', statusFilter as ActionStatus)
    if (priorityFilter) query = query.eq('priority', priorityFilter as ActionPriority)
    if (fromDate) query = query.gte('created_at', fromDate)
    if (rmFilter) query = query.eq('raised_by', rmFilter)

    const { data } = await query

    type RawAction = ActionRow & {
      stores: (Store & { regions: { id: string; name: string } | null }) | null
    }
    const raw = (data ?? []) as unknown as RawAction[]
    const enriched: ActionRow[] = raw.map(a => ({
      ...a,
      region_name: (a.stores as unknown as { regions: { name: string } | null } | null)?.regions?.name ?? '—',
    }))

    setActions(enriched)
    setLoading(false)
  }, [storeIds, regionIds, storeFilter, regionFilter, statusFilter, priorityFilter, fromDate, rmFilter])

  useEffect(() => {
    if (storeIds.length > 0) fetchActions()
  }, [storeIds, fetchActions])

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
      escalation_level: 2,
    })

    if (error) {
      setRaiseError('Failed to raise action. Please try again.')
      setRaiseLoading(false)
      return
    }

    setRaiseLoading(false)
    setRaiseModal(false)
    setRaiseForm({ title: '', description: '', store_id: '', assigned_to: '', action_required: '', due_date: '', priority: 'medium' })
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

  async function handleVerify() {
    if (!verifyModal.actionId || !profile) return
    setVerifyLoading(true)
    const supabase = createClient()

    await supabase.from('actions').update({
      status: 'verified',
      closure_notes: verifyNotes.trim() || null,
      closed_by: profile.id,
      closed_at: new Date().toISOString(),
    }).eq('id', verifyModal.actionId)

    if (verifyNotes.trim()) {
      await supabase.from('action_updates').insert({
        action_id: verifyModal.actionId,
        updated_by: profile.id,
        update_text: verifyNotes.trim(),
        status_change_to: 'verified',
      })
    }

    setVerifyLoading(false)
    setVerifyModal({ open: false, actionId: null })
    setVerifyNotes('')
    fetchActions()
  }

  const overdueActions = actions.filter(
    a => a.due_date && new Date(a.due_date) < new Date() && !['resolved', 'verified', 'closed'].includes(a.status)
  )

  if (profileLoading) return <LoadingPage />

  // Filtered store options for raise form based on selected region
  const raisableStores = raiseForm.assigned_to === '' && raiseForm.store_id === ''
    ? storeOptions.filter(o => o.value)
    : storeOptions.filter(o => o.value)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Actions</h1>
          <p className="text-sm text-gray-500 mt-1">Manage compliance actions across your regions</p>
        </div>
        <Button variant="primary" onClick={() => { setRaiseModal(true); setRaiseError('') }}>
          <Plus className="h-4 w-4" />
          Raise New Action
        </Button>
      </div>

      {/* Overdue Alert */}
      {overdueActions.length > 0 && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-4">
          <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800">{overdueActions.length} overdue action{overdueActions.length !== 1 ? 's' : ''}</p>
            <p className="text-xs text-red-600 mt-0.5">These actions have passed their due date and require attention.</p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {regionOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {storeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <select value={rmFilter} onChange={e => setRmFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {rmOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {PRIORITY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
        </CardContent>
      </Card>

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
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Title</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Store</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Region</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Due Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {actions.map(action => {
                    const isOverdue = action.due_date && new Date(action.due_date) < new Date() && !['resolved', 'verified', 'closed'].includes(action.status)
                    return (
                      <tr key={action.id} className={`hover:bg-gray-50 transition-colors ${isOverdue ? 'bg-red-50/20' : ''}`}>
                        <td className="px-6 py-3 text-sm max-w-[180px]">
                          <p className="font-medium text-gray-900 truncate">{action.title}</p>
                          {action.escalation_level > 1 && (
                            <span className="text-xs text-purple-600">Escalated (L{action.escalation_level})</span>
                          )}
                        </td>
                        <td className="px-6 py-3 text-sm text-gray-700">{action.stores?.name ?? '—'}</td>
                        <td className="px-6 py-3 text-sm text-gray-500">{action.region_name}</td>
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
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-1.5">
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
                            {action.status === 'resolved' && (
                              <Button size="sm" variant="outline"
                                onClick={() => { setVerifyModal({ open: true, actionId: action.id }); setVerifyNotes('') }}
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
                                Verify
                              </Button>
                            )}
                          </div>
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

      {/* Raise Action Modal */}
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
                {storeOptions.filter(o => o.value).map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assign To</label>
              <select value={raiseForm.assigned_to} onChange={e => setRaiseForm(f => ({ ...f, assigned_to: e.target.value }))}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Select assignee...</option>
                {allAssignees.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
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
                {PRIORITY_OPTIONS.filter(o => o.value).map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
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
              <p className="text-xs text-gray-500 mt-0.5">{updateModal.action.stores?.name ?? '—'}</p>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select value={updateForm.status} onChange={e => setUpdateForm(f => ({ ...f, status: e.target.value as ActionStatus }))}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {STATUS_OPTIONS.filter(o => o.value).map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
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

      {/* Verify Modal */}
      <Modal isOpen={verifyModal.open} onClose={() => setVerifyModal({ open: false, actionId: null })} title="Verify Action Completion" size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Confirm that this action has been completed satisfactorily. This will mark it as Verified.
          </p>
          <Textarea label="Verification Notes (optional)" value={verifyNotes}
            onChange={e => setVerifyNotes(e.target.value)}
            placeholder="Notes on evidence reviewed and verification..." rows={3} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setVerifyModal({ open: false, actionId: null })}>Cancel</Button>
            <Button variant="primary" loading={verifyLoading} onClick={handleVerify}>
              <ShieldCheck className="h-4 w-4" />
              Mark as Verified
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
