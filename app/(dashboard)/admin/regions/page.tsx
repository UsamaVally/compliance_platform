'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Edit2, MapPin, ChevronRight, Archive, RotateCcw, Search, Trash2 } from 'lucide-react'
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
import type { Profile, GeneralArea, EntityStatus } from '@/lib/types'

type RegionRow = {
  id: string
  organisation_id: string
  name: string
  code: string
  status: EntityStatus
  general_area_id: string | null
  regional_manager_id: string | null
  created_at: string
}

type RegionWithDetails = RegionRow & {
  general_area: { id: string; name: string } | null
  rm_profile: { id: string; full_name: string; email: string } | null
  branch_count: number
  branches: { id: string; name: string; code: string }[]
}

const emptyForm = {
  name: '',
  code: '',
  general_area_id: '',
  regional_manager_id: '',
  status: 'active' as EntityStatus,
}

export default function RegionsPage() {
  const { profile: adminProfile, loading: profileLoading } = useProfile()

  const [regions, setRegions] = useState<RegionWithDetails[]>([])
  const [generalAreas, setGeneralAreas] = useState<GeneralArea[]>([])
  const [rmProfiles, setRmProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [areaFilter, setAreaFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [viewBranchesOpen, setViewBranchesOpen] = useState(false)

  const [selected, setSelected] = useState<RegionWithDetails | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchRegions = useCallback(async () => {
    if (!adminProfile) return
    const supabase = createClient()

    const { data: regData } = await supabase
      .from('regions')
      .select('*')
      .eq('organisation_id', adminProfile.organisation_id)
      .order('name')

    if (!regData) { setLoading(false); return }

    const enriched = await Promise.all(
      regData.map(async (r: RegionRow) => {
        const [{ data: areaData }, { data: rmData }, { data: branches }, { count: branchCount }] = await Promise.all([
          r.general_area_id
            ? supabase.from('general_areas').select('id, name').eq('id', r.general_area_id).single()
            : Promise.resolve({ data: null }),
          r.regional_manager_id
            ? supabase.from('profiles').select('id, full_name, email').eq('id', r.regional_manager_id).single()
            : Promise.resolve({ data: null }),
          supabase.from('stores').select('id, name, code').eq('region_id', r.id).eq('is_active', true),
          supabase.from('stores').select('id', { count: 'exact', head: true }).eq('region_id', r.id),
        ])

        return {
          ...r,
          general_area: areaData ?? null,
          rm_profile: rmData ?? null,
          branch_count: branchCount ?? 0,
          branches: branches ?? [],
        } as RegionWithDetails
      })
    )

    setRegions(enriched)
    setLoading(false)
  }, [adminProfile])

  useEffect(() => {
    if (!adminProfile) return
    const supabase = createClient()
    const orgId = adminProfile.organisation_id

    Promise.all([
      fetchRegions(),
      supabase.from('general_areas').select('*').eq('organisation_id', orgId).eq('status', 'active').order('name'),
      supabase.from('profiles').select('*').eq('organisation_id', orgId).eq('role', 'regional_manager').eq('is_active', true).order('full_name'),
    ]).then(([, areaRes, rmRes]) => {
      setGeneralAreas(areaRes.data ?? [])
      setRmProfiles(rmRes.data ?? [])
    })
  }, [adminProfile, fetchRegions])

  const filtered = regions.filter(r => {
    const matchSearch =
      !search ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.code.toLowerCase().includes(search.toLowerCase())
    const matchArea = !areaFilter || r.general_area_id === areaFilter
    const matchStatus = !statusFilter || r.status === statusFilter
    return matchSearch && matchArea && matchStatus
  })

  async function handleSave(isEdit: boolean) {
    if (!form.name || !form.code) {
      setError('Region name and code are required.')
      return
    }
    setSaving(true)
    setError('')
    const supabase = createClient()

    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      status: form.status,
      general_area_id: form.general_area_id || null,
      regional_manager_id: form.regional_manager_id || null,
    }

    if (isEdit && selected) {
      const { error: err } = await supabase
        .from('regions')
        .update(payload)
        .eq('id', selected.id)
      if (err) { setError(err.message); setSaving(false); return }

      await supabase.from('audit_logs').insert({
        organisation_id: adminProfile?.organisation_id,
        user_id: adminProfile?.id,
        action: 'region_updated',
        entity_type: 'regions',
        entity_id: selected.id,
        old_data: { name: selected.name },
        new_data: { name: form.name },
      })
      setEditOpen(false)
    } else {
      const { error: err } = await supabase.from('regions').insert({
        organisation_id: adminProfile!.organisation_id,
        ...payload,
      })
      if (err) { setError(err.message); setSaving(false); return }

      await supabase.from('audit_logs').insert({
        organisation_id: adminProfile?.organisation_id,
        user_id: adminProfile?.id,
        action: 'region_created',
        entity_type: 'regions',
        new_data: { name: form.name, code: form.code },
      })
      setAddOpen(false)
    }

    await fetchRegions()
    setForm(emptyForm)
    setSaving(false)
  }

  async function handleArchive(newStatus: EntityStatus) {
    if (!selected) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('regions').update({ status: newStatus }).eq('id', selected.id)

    await supabase.from('audit_logs').insert({
      organisation_id: adminProfile?.organisation_id,
      user_id: adminProfile?.id,
      action: `region_${newStatus}`,
      entity_type: 'regions',
      entity_id: selected.id,
      new_data: { status: newStatus },
    })

    await fetchRegions()
    setArchiveOpen(false)
    setSaving(false)
  }

  async function handleDelete() {
    if (!selected) return
    setDeleting(true)
    const supabase = createClient()
    await supabase.from('regions').delete().eq('id', selected.id)
    await fetchRegions()
    setDeleteOpen(false)
    setDeleting(false)
  }

  function openEdit(r: RegionWithDetails) {
    setSelected(r)
    setForm({
      name: r.name,
      code: r.code,
      status: r.status,
      general_area_id: r.general_area_id ?? '',
      regional_manager_id: r.regional_manager_id ?? '',
    })
    setError('')
    setEditOpen(true)
  }

  const statusBadge = (status: EntityStatus) => {
    if (status === 'active') return <Badge variant="success">Active</Badge>
    if (status === 'inactive') return <Badge variant="warning">Inactive</Badge>
    return <Badge variant="default">Archived</Badge>
  }

  const RegionForm = () => (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      <Input
        label="Region Name"
        required
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="e.g. North Region"
      />
      <Input
        label="Region Code"
        required
        value={form.code}
        onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
        placeholder="e.g. NR"
        helperText="Short unique identifier"
      />
      <Select
        label="General Area"
        options={generalAreas.map(a => ({ value: a.id, label: a.name }))}
        placeholder="Select a General Area…"
        value={form.general_area_id}
        onChange={e => setForm(f => ({ ...f, general_area_id: e.target.value }))}
      />
      <Select
        label="Regional Manager"
        options={rmProfiles.map(r => ({ value: r.id, label: `${r.full_name} — ${r.email}` }))}
        placeholder="Select a Regional Manager…"
        value={form.regional_manager_id}
        onChange={e => setForm(f => ({ ...f, regional_manager_id: e.target.value }))}
      />
      <Select
        label="Status"
        options={[
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' },
        ]}
        value={form.status}
        onChange={e => setForm(f => ({ ...f, status: e.target.value as EntityStatus }))}
      />
    </div>
  )

  if (profileLoading || loading) return <LoadingPage />

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Region Setup</h1>
          <p className="text-sm text-gray-500 mt-1">
            {filtered.length} of {regions.length} region{regions.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setError(''); setAddOpen(true) }}>
          <Plus className="h-4 w-4" /> Add Region
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search regions…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <Select
          options={[
            { value: '', label: 'All Areas' },
            ...generalAreas.map(a => ({ value: a.id, label: a.name })),
          ]}
          value={areaFilter}
          onChange={e => setAreaFilter(e.target.value)}
          className="sm:w-52"
        />
        <Select
          options={[
            { value: '', label: 'All Status' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
            { value: 'archived', label: 'Archived' },
          ]}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="sm:w-44"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState icon={MapPin} title="No regions found" description="Add your first region to get started." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {['Region', 'Code', 'General Area', 'Regional Manager', 'Branches', 'Status', 'Created', 'Actions'].map(h => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {filtered.map(region => (
                    <tr key={region.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{region.name}</td>
                      <td className="px-6 py-3 text-sm font-mono text-gray-600">{region.code}</td>
                      <td className="px-6 py-3 text-sm text-gray-500">
                        {region.general_area?.name ?? <span className="text-gray-400 italic">Unassigned</span>}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500">
                        {region.rm_profile?.full_name ?? <span className="text-gray-400 italic">Unassigned</span>}
                      </td>
                      <td className="px-6 py-3">
                        <button
                          onClick={() => { setSelected(region); setViewBranchesOpen(true) }}
                          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          {region.branch_count} branch{region.branch_count !== 1 ? 'es' : ''}
                          <ChevronRight className="inline h-3 w-3 ml-0.5" />
                        </button>
                      </td>
                      <td className="px-6 py-3">{statusBadge(region.status)}</td>
                      <td className="px-6 py-3 text-sm text-gray-500 whitespace-nowrap">{formatDate(region.created_at)}</td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(region)}>
                            <Edit2 className="h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => { setSelected(region); setDeleteOpen(true) }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          {region.status !== 'archived' ? (
                            <Button
                              size="sm"
                              variant={region.status === 'active' ? 'danger' : 'secondary'}
                              onClick={() => { setSelected(region); setArchiveOpen(true) }}
                            >
                              {region.status === 'active' ? (
                                <><Archive className="h-3.5 w-3.5" /> Deactivate</>
                              ) : (
                                <><RotateCcw className="h-3.5 w-3.5" /> Activate</>
                              )}
                            </Button>
                          ) : (
                            <Button size="sm" variant="secondary" onClick={() => handleArchive('active')}>
                              <RotateCcw className="h-3.5 w-3.5" /> Restore
                            </Button>
                          )}
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
      <Modal isOpen={addOpen} onClose={() => setAddOpen(false)} title="Add Region" size="md">
        <div className="space-y-4">
          <RegionForm />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={() => handleSave(false)}>
              <Plus className="h-4 w-4" /> Add Region
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title={`Edit — ${selected?.name}`} size="md">
        <div className="space-y-4">
          <RegionForm />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={() => handleSave(true)}>Save Changes</Button>
          </div>
        </div>
      </Modal>

      {/* View Branches Modal */}
      <Modal
        isOpen={viewBranchesOpen}
        onClose={() => setViewBranchesOpen(false)}
        title={`Branches in ${selected?.name}`}
        size="md"
      >
        <div>
          {selected?.branches.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No active branches in this region.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {selected?.branches.map(b => (
                <li key={b.id} className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium text-gray-900">{b.name}</span>
                  <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{b.code}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      {/* Archive / Deactivate Confirmation */}
      <Modal isOpen={archiveOpen} onClose={() => setArchiveOpen(false)} title="Confirm Action" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Are you sure you want to{' '}
            <strong>{selected?.status === 'active' ? 'deactivate' : 'activate'}</strong>{' '}
            <strong>{selected?.name}</strong>?
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setArchiveOpen(false)}>Cancel</Button>
            <Button
              variant={selected?.status === 'active' ? 'danger' : 'primary'}
              loading={saving}
              onClick={() => handleArchive(selected?.status === 'active' ? 'inactive' : 'active')}
            >
              {selected?.status === 'active' ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Region" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Permanently delete <strong>{selected?.name}</strong>? This cannot be undone.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={deleting} onClick={handleDelete}>Delete Region</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
