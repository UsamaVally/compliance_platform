'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { Plus, Edit2, Building2, Search, Archive, RotateCcw, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/lib/hooks/useProfile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { Card, CardContent } from '@/components/ui/card'
import { LoadingPage } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate } from '@/lib/utils'
import type { Profile } from '@/lib/types'

type RegionOption = { id: string; name: string; code: string }

type BranchWithDetails = {
  id: string
  organisation_id: string
  name: string
  code: string
  address: string | null
  region_id: string | null
  branch_manager_id: string | null
  is_active: boolean
  created_at: string
  region: { name: string; code: string } | null
  bm_profile: { full_name: string; email: string } | null
}

const generateCode = (name: string) =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .trim()
    .split(' ')
    .map(w => w.slice(0, 3))
    .join('')
    .slice(0, 8)

const emptyForm = {
  name: '',
  code: '',
  address: '',
  region_id: '',
  branch_manager_id: '',
  is_active: true,
}

type BranchFormState = typeof emptyForm

function BranchForm({
  error, form, setForm, regions, bmProfiles,
}: {
  error: string
  form: BranchFormState
  setForm: React.Dispatch<React.SetStateAction<BranchFormState>>
  regions: RegionOption[]
  bmProfiles: Profile[]
}) {
  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <Input
        label="Branch Name"
        required
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value, code: f.code || generateCode(e.target.value) }))}
        placeholder="e.g. Downtown Branch"
      />
      <Input
        label="Branch Code"
        required
        value={form.code}
        onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
        helperText="Unique identifier. Auto-generated from name."
      />
      <Input
        label="Location / City"
        value={form.address}
        onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
        placeholder="e.g. Johannesburg CBD"
      />
      <Select
        label="Region"
        options={regions.map(r => ({ value: r.id, label: `${r.name} (${r.code})` }))}
        placeholder="Select a region…"
        value={form.region_id}
        onChange={e => setForm(f => ({ ...f, region_id: e.target.value }))}
      />
      <Select
        label="Branch Manager"
        options={bmProfiles.map(b => ({ value: b.id, label: `${b.full_name} — ${b.email}` }))}
        placeholder="Select a Branch Manager…"
        value={form.branch_manager_id}
        onChange={e => setForm(f => ({ ...f, branch_manager_id: e.target.value }))}
      />
    </div>
  )
}

export default function BranchesPage() {
  const { profile: adminProfile, loading: profileLoading } = useProfile()

  const [branches, setBranches] = useState<BranchWithDetails[]>([])
  const [regions, setRegions] = useState<RegionOption[]>([])
  const [bmProfiles, setBmProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [regionFilter, setRegionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [selected, setSelected] = useState<BranchWithDetails | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchBranches = useCallback(async () => {
    if (!adminProfile) return
    const supabase = createClient()
    const { data } = await supabase
      .from('stores')
      .select('*')
      .eq('organisation_id', adminProfile.organisation_id)
      .order('name')

    if (!data) { setLoading(false); return }

    const enriched = await Promise.all(
      data.map(async (b) => {
        const [{ data: regData }, { data: bmData }] = await Promise.all([
          b.region_id
            ? supabase.from('regions').select('name, code').eq('id', b.region_id).single()
            : Promise.resolve({ data: null }),
          b.branch_manager_id
            ? supabase.from('profiles').select('full_name, email').eq('id', b.branch_manager_id).single()
            : Promise.resolve({ data: null }),
        ])
        return { ...b, region: regData ?? null, bm_profile: bmData ?? null } as BranchWithDetails
      })
    )

    setBranches(enriched)
    setLoading(false)
  }, [adminProfile])

  useEffect(() => {
    if (!adminProfile) return
    const supabase = createClient()
    const orgId = adminProfile.organisation_id

    Promise.all([
      fetchBranches(),
      supabase.from('regions').select('id, name, code').eq('organisation_id', orgId).eq('status', 'active').order('name'),
      supabase.from('profiles').select('*').eq('organisation_id', orgId).eq('role', 'branch_manager').eq('is_active', true).order('full_name'),
    ]).then(([, regRes, bmRes]) => {
      setRegions(regRes.data ?? [])
      setBmProfiles(bmRes.data ?? [])
    })
  }, [adminProfile, fetchBranches])

  const filtered = branches.filter(b => {
    const matchSearch =
      !search ||
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.code.toLowerCase().includes(search.toLowerCase()) ||
      (b.address ?? '').toLowerCase().includes(search.toLowerCase())
    const matchRegion = !regionFilter || b.region_id === regionFilter
    const matchStatus =
      statusFilter === '' ? true : statusFilter === 'active' ? b.is_active : !b.is_active
    return matchSearch && matchRegion && matchStatus
  })

  function triggerScheduleGeneration(orgId: string) {
    const supabase = createClient()
    supabase
      .from('schedules')
      .select('id')
      .eq('organisation_id', orgId)
      .eq('is_active', true)
      .eq('is_ongoing', true)
      .then(({ data }) => {
        ;(data ?? []).forEach(s => {
          fetch('/api/schedules/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schedule_id: s.id, days: 90 }),
          })
        })
      })
  }

  async function handleAdd() {
    if (!form.name || !form.code) {
      setError('Branch name and code are required.')
      return
    }
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { data: newStore, error: err } = await supabase.from('stores').insert({
      organisation_id: adminProfile!.organisation_id,
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      address: form.address || null,
      region_id: form.region_id || null,
      branch_manager_id: form.branch_manager_id || null,
      is_active: form.is_active,
    }).select('id').single()
    if (err) { setError(err.message); setSaving(false); return }

    // Sync user_store_assignments so the BM can see their store
    if (newStore && form.branch_manager_id) {
      await supabase.from('user_store_assignments').upsert({
        user_id: form.branch_manager_id,
        store_id: newStore.id,
        is_primary: true,
        assigned_by: adminProfile!.id,
      }, { onConflict: 'user_id,store_id' })
    }

    await supabase.from('audit_logs').insert({
      organisation_id: adminProfile?.organisation_id,
      user_id: adminProfile?.id,
      action: 'branch_created',
      entity_type: 'stores',
      new_data: { name: form.name, code: form.code },
    })

    await fetchBranches()
    setAddOpen(false)
    setForm(emptyForm)
    setSaving(false)
    // Trigger expected_submissions generation for all ongoing schedules
    triggerScheduleGeneration(adminProfile!.organisation_id)
  }

  async function handleEdit() {
    if (!selected) return
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { error: err } = await supabase
      .from('stores')
      .update({
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        address: form.address || null,
        region_id: form.region_id || null,
        branch_manager_id: form.branch_manager_id || null,
      })
      .eq('id', selected.id)
    if (err) { setError(err.message); setSaving(false); return }

    // Sync user_store_assignments — remove old BM assignment if changed, add new one
    if (selected.branch_manager_id && selected.branch_manager_id !== form.branch_manager_id) {
      await supabase.from('user_store_assignments')
        .delete()
        .eq('user_id', selected.branch_manager_id)
        .eq('store_id', selected.id)
    }
    if (form.branch_manager_id) {
      await supabase.from('user_store_assignments').upsert({
        user_id: form.branch_manager_id,
        store_id: selected.id,
        is_primary: true,
        assigned_by: adminProfile!.id,
      }, { onConflict: 'user_id,store_id' })
    }

    await supabase.from('audit_logs').insert({
      organisation_id: adminProfile?.organisation_id,
      user_id: adminProfile?.id,
      action: 'branch_updated',
      entity_type: 'stores',
      entity_id: selected.id,
      old_data: { name: selected.name },
      new_data: { name: form.name },
    })

    await fetchBranches()
    setEditOpen(false)
    setSaving(false)
    // Re-trigger in case region or BM assignment changed
    triggerScheduleGeneration(adminProfile!.organisation_id)
  }

  async function handleToggleActive() {
    if (!selected) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('stores').update({ is_active: !selected.is_active }).eq('id', selected.id)

    await supabase.from('audit_logs').insert({
      organisation_id: adminProfile?.organisation_id,
      user_id: adminProfile?.id,
      action: selected.is_active ? 'branch_deactivated' : 'branch_activated',
      entity_type: 'stores',
      entity_id: selected.id,
      new_data: { is_active: !selected.is_active },
    })

    await fetchBranches()
    setDeactivateOpen(false)
    setSaving(false)
  }

  async function handleDelete() {
    if (!selected) return
    setDeleting(true)
    const supabase = createClient()
    await supabase.from('stores').delete().eq('id', selected.id)
    await fetchBranches()
    setDeleteOpen(false)
    setDeleting(false)
  }

  function openEdit(b: BranchWithDetails) {
    setSelected(b)
    setForm({
      name: b.name,
      code: b.code,
      address: b.address ?? '',
      region_id: b.region_id ?? '',
      branch_manager_id: b.branch_manager_id ?? '',
      is_active: b.is_active,
    })
    setError('')
    setEditOpen(true)
  }

  if (profileLoading || loading) return <LoadingPage />

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Branch Setup</h1>
          <p className="text-sm text-gray-500 mt-1">
            {filtered.length} of {branches.length} branch{branches.length !== 1 ? 'es' : ''}
          </p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setError(''); setAddOpen(true) }}>
          <Plus className="h-4 w-4" /> Add Branch
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search branches…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <Select
          options={[
            { value: '', label: 'All Regions' },
            ...regions.map(r => ({ value: r.id, label: r.name })),
          ]}
          value={regionFilter}
          onChange={e => setRegionFilter(e.target.value)}
          className="sm:w-48"
        />
        <Select
          options={[
            { value: '', label: 'All Status' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="sm:w-40"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState
                icon={Building2}
                title="No branches found"
                description="Add your first branch to get started."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {['Branch Name', 'Code', 'Location', 'Region', 'Branch Manager', 'Status', 'Created', 'Actions'].map(h => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {filtered.map(branch => (
                    <tr key={branch.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{branch.name}</td>
                      <td className="px-6 py-3 text-sm font-mono text-gray-600">{branch.code}</td>
                      <td className="px-6 py-3 text-sm text-gray-500 max-w-[150px] truncate">
                        {branch.address ?? '—'}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500">
                        {branch.region?.name ?? <span className="text-gray-400 italic">Unassigned</span>}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500">
                        {branch.bm_profile?.full_name ?? <span className="text-gray-400 italic">Unassigned</span>}
                      </td>
                      <td className="px-6 py-3">
                        <Badge variant={branch.is_active ? 'success' : 'danger'}>
                          {branch.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500 whitespace-nowrap">
                        {formatDate(branch.created_at)}
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(branch)}>
                            <Edit2 className="h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => { setSelected(branch); setDeleteOpen(true) }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant={branch.is_active ? 'danger' : 'secondary'}
                            onClick={() => { setSelected(branch); setDeactivateOpen(true) }}
                          >
                            {branch.is_active ? (
                              <><Archive className="h-3.5 w-3.5" /> Deactivate</>
                            ) : (
                              <><RotateCcw className="h-3.5 w-3.5" /> Activate</>
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Modal */}
      <Modal isOpen={addOpen} onClose={() => setAddOpen(false)} title="Add Branch" size="md">
        <div className="space-y-4">
          <BranchForm error={error} form={form} setForm={setForm} regions={regions} bmProfiles={bmProfiles} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleAdd}>
              <Plus className="h-4 w-4" /> Add Branch
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title={`Edit — ${selected?.name}`} size="md">
        <div className="space-y-4">
          <BranchForm error={error} form={form} setForm={setForm} regions={regions} bmProfiles={bmProfiles} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleEdit}>Save Changes</Button>
          </div>
        </div>
      </Modal>

      {/* Deactivate Confirmation */}
      <Modal isOpen={deactivateOpen} onClose={() => setDeactivateOpen(false)} title="Confirm Action" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Are you sure you want to{' '}
            <strong>{selected?.is_active ? 'deactivate' : 'activate'}</strong>{' '}
            <strong>{selected?.name}</strong>?
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setDeactivateOpen(false)}>Cancel</Button>
            <Button
              variant={selected?.is_active ? 'danger' : 'primary'}
              loading={saving}
              onClick={handleToggleActive}
            >
              {selected?.is_active ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Store" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Permanently delete <strong>{selected?.name}</strong>? This cannot be undone and will remove all associated data.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={deleting} onClick={handleDelete}>Delete Store</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
