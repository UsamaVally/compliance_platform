'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Edit2, Globe, ChevronRight, Archive, RotateCcw } from 'lucide-react'
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
import type { GeneralArea, Profile, Region, EntityStatus } from '@/lib/types'

type GeneralAreaWithDetails = GeneralArea & {
  gm_profile: { full_name: string; email: string } | null
  regions: { id: string; name: string; code: string }[]
  region_count: number
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
  general_manager_id: '',
  status: 'active' as EntityStatus,
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

export default function GeneralAreasPage() {
  const { profile: adminProfile, loading: profileLoading } = useProfile()

  const [areas, setAreas] = useState<GeneralAreaWithDetails[]>([])
  const [gmProfiles, setGmProfiles] = useState<Profile[]>([])
  const [allRegions, setAllRegions] = useState<Region[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [viewRegionsOpen, setViewRegionsOpen] = useState(false)
  const [assignRegionsOpen, setAssignRegionsOpen] = useState(false)

  const [selected, setSelected] = useState<GeneralAreaWithDetails | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [assignRegionIds, setAssignRegionIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchAreas = useCallback(async () => {
    if (!adminProfile) return
    const supabase = createClient()

    const { data } = await supabase
      .from('general_areas')
      .select('*')
      .eq('organisation_id', adminProfile.organisation_id)
      .order('name')

    if (!data) { setLoading(false); return }

    const enriched = await Promise.all(
      data.map(async (a) => {
        const [{ data: regData }, { data: gmData }] = await Promise.all([
          supabase
            .from('regions')
            .select('id, name, code')
            .eq('general_area_id', a.id),
          a.general_manager_id
            ? supabase
                .from('profiles')
                .select('full_name, email')
                .eq('id', a.general_manager_id)
                .single()
            : Promise.resolve({ data: null }),
        ])

        return {
          ...a,
          gm_profile: gmData ?? null,
          regions: regData ?? [],
          region_count: regData?.length ?? 0,
        } as GeneralAreaWithDetails
      })
    )

    setAreas(enriched)
    setLoading(false)
  }, [adminProfile])

  useEffect(() => {
    if (!adminProfile) return
    const supabase = createClient()
    const orgId = adminProfile.organisation_id

    Promise.all([
      fetchAreas(),
      supabase
        .from('profiles')
        .select('*')
        .eq('organisation_id', orgId)
        .eq('role', 'general_manager')
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('regions')
        .select('*')
        .eq('organisation_id', orgId)
        .order('name'),
    ]).then(([, gmRes, regRes]) => {
      setGmProfiles(gmRes.data ?? [])
      setAllRegions(regRes.data ?? [])
    })
  }, [adminProfile, fetchAreas])

  const filtered = areas.filter(a => {
    const matchSearch =
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.code.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || a.status === statusFilter
    return matchSearch && matchStatus
  })

  async function handleAdd() {
    if (!form.name || !form.code) {
      setError('Name and code are required.')
      return
    }
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { error: err } = await supabase.from('general_areas').insert({
      organisation_id: adminProfile!.organisation_id,
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      status: form.status,
      general_manager_id: form.general_manager_id || null,
    })
    if (err) { setError(err.message); setSaving(false); return }

    await supabase.from('audit_logs').insert({
      organisation_id: adminProfile?.organisation_id,
      user_id: adminProfile?.id,
      action: 'general_area_created',
      entity_type: 'general_areas',
      new_data: { name: form.name, code: form.code },
    })

    await fetchAreas()
    setAddOpen(false)
    setForm(emptyForm)
    setSaving(false)
  }

  async function handleEdit() {
    if (!selected) return
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { error: err } = await supabase
      .from('general_areas')
      .update({
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        status: form.status,
        general_manager_id: form.general_manager_id || null,
      })
      .eq('id', selected.id)
    if (err) { setError(err.message); setSaving(false); return }

    await supabase.from('audit_logs').insert({
      organisation_id: adminProfile?.organisation_id,
      user_id: adminProfile?.id,
      action: 'general_area_updated',
      entity_type: 'general_areas',
      entity_id: selected.id,
      old_data: { name: selected.name },
      new_data: { name: form.name },
    })

    await fetchAreas()
    setEditOpen(false)
    setSaving(false)
  }

  async function handleArchive(newStatus: EntityStatus) {
    if (!selected) return
    setSaving(true)
    const supabase = createClient()
    await supabase
      .from('general_areas')
      .update({ status: newStatus })
      .eq('id', selected.id)

    await supabase.from('audit_logs').insert({
      organisation_id: adminProfile?.organisation_id,
      user_id: adminProfile?.id,
      action: `general_area_${newStatus}`,
      entity_type: 'general_areas',
      entity_id: selected.id,
      new_data: { status: newStatus },
    })

    await fetchAreas()
    setArchiveOpen(false)
    setSaving(false)
  }

  async function handleAssignRegions() {
    if (!selected) return
    setSaving(true)
    const supabase = createClient()

    // Unlink regions that were removed
    await supabase
      .from('regions')
      .update({ general_area_id: null })
      .eq('general_area_id', selected.id)
      .not('id', 'in', assignRegionIds.length > 0 ? `(${assignRegionIds.map(id => `'${id}'`).join(',')})` : "('__none__')")

    // Link new regions
    if (assignRegionIds.length > 0) {
      await supabase
        .from('regions')
        .update({ general_area_id: selected.id })
        .in('id', assignRegionIds)
    }

    await fetchAreas()
    setAssignRegionsOpen(false)
    setSaving(false)
  }

  function openEdit(a: GeneralAreaWithDetails) {
    setSelected(a)
    setForm({
      name: a.name,
      code: a.code,
      general_manager_id: a.general_manager_id ?? '',
      status: a.status,
    })
    setError('')
    setEditOpen(true)
  }

  function openAssignRegions(a: GeneralAreaWithDetails) {
    setSelected(a)
    setAssignRegionIds(a.regions.map(r => r.id))
    setAssignRegionsOpen(true)
  }

  const statusBadge = (status: EntityStatus) => {
    if (status === 'active') return <Badge variant="success">Active</Badge>
    if (status === 'inactive') return <Badge variant="warning">Inactive</Badge>
    return <Badge variant="default">Archived</Badge>
  }

  if (profileLoading || loading) return <LoadingPage />

  const AreaForm = () => (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}
      <Input
        label="General Area Name"
        required
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value, code: generateCode(e.target.value) }))}
        placeholder="e.g. Northern Region Area"
      />
      <Input
        label="Area Code"
        required
        value={form.code}
        onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
        helperText="Short unique identifier. Auto-generated from name."
      />
      <Select
        label="Assign General Manager"
        options={gmProfiles.map(g => ({ value: g.id, label: `${g.full_name} — ${g.email}` }))}
        placeholder="Select a General Manager…"
        value={form.general_manager_id}
        onChange={e => setForm(f => ({ ...f, general_manager_id: e.target.value }))}
      />
      <Select
        label="Status"
        options={STATUS_OPTIONS}
        value={form.status}
        onChange={e => setForm(f => ({ ...f, status: e.target.value as EntityStatus }))}
      />
    </div>
  )

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">General Area Setup</h1>
          <p className="text-sm text-gray-500 mt-1">
            {filtered.length} of {areas.length} general area{areas.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setError(''); setAddOpen(true) }}>
          <Plus className="h-4 w-4" /> Add General Area
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Globe className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search general areas…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
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
              <EmptyState
                icon={Globe}
                title="No general areas found"
                description="Create your first general area to start building the company hierarchy."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {['General Area', 'Code', 'General Manager', 'Regions', 'Status', 'Created', 'Actions'].map(h => (
                      <th
                        key={h}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {filtered.map(area => (
                    <tr key={area.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{area.name}</td>
                      <td className="px-6 py-3 text-sm font-mono text-gray-600">{area.code}</td>
                      <td className="px-6 py-3 text-sm text-gray-500">
                        {area.gm_profile?.full_name ?? (
                          <span className="text-gray-400 italic">Unassigned</span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <button
                          onClick={() => { setSelected(area); setViewRegionsOpen(true) }}
                          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                        >
                          {area.region_count} region{area.region_count !== 1 ? 's' : ''}
                          <ChevronRight className="inline h-3 w-3 ml-0.5" />
                        </button>
                      </td>
                      <td className="px-6 py-3">{statusBadge(area.status)}</td>
                      <td className="px-6 py-3 text-sm text-gray-500 whitespace-nowrap">
                        {formatDate(area.created_at)}
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(area)}>
                            <Edit2 className="h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openAssignRegions(area)}>
                            Regions
                          </Button>
                          {area.status !== 'archived' ? (
                            <Button
                              size="sm"
                              variant={area.status === 'active' ? 'danger' : 'secondary'}
                              onClick={() => { setSelected(area); setArchiveOpen(true) }}
                            >
                              {area.status === 'active' ? (
                                <><Archive className="h-3.5 w-3.5" /> Deactivate</>
                              ) : (
                                <><RotateCcw className="h-3.5 w-3.5" /> Activate</>
                              )}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleArchive('active')}
                            >
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
      <Modal isOpen={addOpen} onClose={() => setAddOpen(false)} title="Add General Area" size="md">
        <div className="space-y-4">
          <AreaForm />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleAdd}>
              <Plus className="h-4 w-4" /> Add General Area
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title={`Edit — ${selected?.name}`}
        size="md"
      >
        <div className="space-y-4">
          <AreaForm />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleEdit}>Save Changes</Button>
          </div>
        </div>
      </Modal>

      {/* Assign Regions Modal */}
      <Modal
        isOpen={assignRegionsOpen}
        onClose={() => setAssignRegionsOpen(false)}
        title={`Assign Regions — ${selected?.name}`}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Select which regions belong to <strong>{selected?.name}</strong>. A region can only belong to one general area.
          </p>
          <div className="grid grid-cols-1 gap-1.5 max-h-72 overflow-y-auto border border-gray-200 rounded-lg p-3">
            {allRegions.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No regions found. Create regions first.</p>
            ) : (
              allRegions.map(r => {
                const otherArea = areas.find(
                  a => a.id !== selected?.id && a.regions.some(ar => ar.id === r.id)
                )
                return (
                  <label
                    key={r.id}
                    className={`flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-gray-50 ${otherArea ? 'opacity-50' : ''}`}
                    title={otherArea ? `Already assigned to ${otherArea.name}` : ''}
                  >
                    <input
                      type="checkbox"
                      checked={assignRegionIds.includes(r.id)}
                      disabled={!!otherArea}
                      onChange={e => {
                        if (e.target.checked) setAssignRegionIds(ids => [...ids, r.id])
                        else setAssignRegionIds(ids => ids.filter(id => id !== r.id))
                      }}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700">{r.name}</span>
                    <span className="text-xs text-gray-400 font-mono ml-1">({r.code})</span>
                    {otherArea && (
                      <span className="ml-auto text-xs text-amber-600">→ {otherArea.name}</span>
                    )}
                  </label>
                )
              })
            )}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setAssignRegionsOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleAssignRegions}>Save Assignments</Button>
          </div>
        </div>
      </Modal>

      {/* View Regions Modal */}
      <Modal
        isOpen={viewRegionsOpen}
        onClose={() => setViewRegionsOpen(false)}
        title={`Regions in ${selected?.name}`}
        size="md"
      >
        <div>
          {selected?.regions.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No regions assigned to this area yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {selected?.regions.map(r => (
                <li key={r.id} className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium text-gray-900">{r.name}</span>
                  <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                    {r.code}
                  </span>
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
            {selected?.status === 'active' && (
              <span className="block mt-1 text-gray-500">
                This will not affect the regions or branches linked to this area.
              </span>
            )}
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
    </div>
  )
}
