'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Edit2, CalendarClock, Pause, Play, Search, Copy, Trash2 } from 'lucide-react'
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
import { getRoleLabel } from '@/lib/utils'
import type { UserRole } from '@/lib/types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const ROLES: UserRole[] = ['branch_manager', 'regional_manager', 'general_manager', 'higher_supervision']

const AUDIENCE_TYPES = [
  { value: 'role', label: 'By Role' },
  { value: 'branch', label: 'Specific Branch' },
  { value: 'region', label: 'Specific Region' },
  { value: 'general_area', label: 'Specific General Area' },
]

type ScheduleRow = {
  id: string
  organisation_id: string
  name: string
  form_type: string
  frequency: string
  days_of_week: number[] | null
  time_due: string | null
  cutoff_time: string | null
  applicable_role: string | null
  is_ongoing: boolean
  is_active: boolean
  template_id: string | null
  start_date: string | null
  end_date: string | null
  audience_type: string | null
  audience_id: string | null
  created_at: string
}

type ScheduleWithDetails = ScheduleRow & {
  template_name: string | null
  audience_label: string | null
}

type TemplateOption = { id: string; name: string }
type EntityOption = { id: string; label: string }

const emptyForm = {
  name: '',
  template_id: '',
  frequency: 'weekly' as string,
  days_of_week: [] as number[],
  time_due: '',
  cutoff_time: '',
  start_date: '',
  end_date: '',
  is_ongoing: true,
  audience_type: 'role' as string,
  applicable_role: 'branch_manager' as string,
  audience_id: '',
}

export default function SchedulesPage() {
  const { profile: adminProfile, loading: profileLoading } = useProfile()

  const [schedules, setSchedules] = useState<ScheduleWithDetails[]>([])
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [branches, setBranches] = useState<EntityOption[]>([])
  const [regions, setRegions] = useState<EntityOption[]>([])
  const [generalAreas, setGeneralAreas] = useState<EntityOption[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [toggleOpen, setToggleOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [selected, setSelected] = useState<ScheduleWithDetails | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchSchedules = useCallback(async () => {
    if (!adminProfile) return
    const supabase = createClient()

    const { data } = await supabase
      .from('schedules')
      .select('*')
      .eq('organisation_id', adminProfile.organisation_id)
      .order('created_at', { ascending: false })

    if (!data) { setLoading(false); return }

    // Enrich with template names and audience labels
    const enriched = await Promise.all(
      data.map(async (s: ScheduleRow) => {
        let template_name: string | null = null
        let audience_label: string | null = null

        if (s.template_id) {
          const { data: tmpl } = await supabase
            .from('form_templates')
            .select('name')
            .eq('id', s.template_id)
            .single()
          template_name = tmpl?.name ?? null
        }

        if (s.audience_type === 'role') {
          audience_label = s.applicable_role ? getRoleLabel(s.applicable_role) : 'All Roles'
        } else if (s.audience_id) {
          const tableMap: Record<string, string> = {
            branch: 'stores',
            region: 'regions',
            general_area: 'general_areas',
          }
          const table = tableMap[s.audience_type ?? '']
          if (table) {
            const { data: entity } = await supabase
              .from(table)
              .select('name')
              .eq('id', s.audience_id)
              .single()
            audience_label = entity?.name ?? null
          }
        }

        return { ...s, template_name, audience_label }
      })
    )

    setSchedules(enriched)
    setLoading(false)
  }, [adminProfile])

  useEffect(() => {
    if (!adminProfile) return
    const supabase = createClient()
    const orgId = adminProfile.organisation_id

    Promise.all([
      fetchSchedules(),
      supabase.from('form_templates').select('id, name').eq('organisation_id', orgId).eq('is_active', true).order('name'),
      supabase.from('stores').select('id, name').eq('organisation_id', orgId).eq('is_active', true).order('name'),
      supabase.from('regions').select('id, name').eq('organisation_id', orgId).eq('status', 'active').order('name'),
      supabase.from('general_areas').select('id, name').eq('organisation_id', orgId).eq('status', 'active').order('name'),
    ]).then(([, tmplRes, branchRes, regRes, areaRes]) => {
      setTemplates(tmplRes.data ?? [])
      setBranches((branchRes.data ?? []).map(b => ({ id: b.id, label: b.name })))
      setRegions((regRes.data ?? []).map(r => ({ id: r.id, label: r.name })))
      setGeneralAreas((areaRes.data ?? []).map(a => ({ id: a.id, label: a.name })))
    })
  }, [adminProfile, fetchSchedules])

  // Auto-generate 90 days ahead for ongoing schedules on load
  useEffect(() => {
    if (!adminProfile || schedules.length === 0) return
    const ongoing = schedules.filter(s => s.is_ongoing && s.is_active)
    ongoing.forEach(s => {
      fetch('/api/schedules/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule_id: s.id, days: 90 }),
      })
    })
  }, [schedules, adminProfile])

  const filtered = schedules.filter(s => {
    const matchSearch =
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.template_name ?? '').toLowerCase().includes(search.toLowerCase())
    const matchStatus =
      statusFilter === '' ? true :
      statusFilter === 'active' ? s.is_active :
      !s.is_active
    return matchSearch && matchStatus
  })

  function toggleDay(day: number) {
    setForm(f => ({
      ...f,
      days_of_week: f.days_of_week.includes(day)
        ? f.days_of_week.filter(d => d !== day)
        : [...f.days_of_week, day].sort(),
    }))
  }

  function buildPayload() {
    return {
      organisation_id: adminProfile!.organisation_id,
      name: form.name.trim(),
      form_type: 'branch_check' as const,
      template_id: form.template_id || null,
      frequency: form.frequency,
      days_of_week: form.frequency === 'daily' ? null : form.days_of_week.length > 0 ? form.days_of_week : null,
      time_due: form.time_due || null,
      cutoff_time: form.cutoff_time || null,
      is_ongoing: form.is_ongoing,
      is_active: true,
      start_date: form.start_date || null,
      end_date: form.is_ongoing ? null : (form.end_date || null),
      audience_type: form.audience_type || null,
      applicable_role: form.audience_type === 'role' ? (form.applicable_role || null) : null,
      audience_id: form.audience_type !== 'role' ? (form.audience_id || null) : null,
    }
  }

  async function handleSave(isEdit: boolean) {
    if (!form.name.trim()) {
      setError('Schedule name is required.')
      return
    }
    if (!form.template_id) {
      setError('Please select a template.')
      return
    }
    if ((form.frequency === 'weekly' || form.frequency === 'custom') && form.days_of_week.length === 0) {
      setError('Please select at least one day for weekly/custom schedules.')
      return
    }
    setSaving(true)
    setError('')
    const supabase = createClient()
    const payload = buildPayload()

    if (isEdit && selected) {
      const { error: err } = await supabase.from('schedules').update(payload).eq('id', selected.id)
      if (err) { setError(err.message); setSaving(false); return }

      await supabase.from('audit_logs').insert({
        organisation_id: adminProfile?.organisation_id,
        user_id: adminProfile?.id,
        action: 'schedule_updated',
        entity_type: 'schedules',
        entity_id: selected.id,
        old_data: { name: selected.name },
        new_data: { name: form.name },
      })
      setEditOpen(false)
    } else {
      const { error: err } = await supabase.from('schedules').insert(payload)
      if (err) { setError(err.message); setSaving(false); return }

      await supabase.from('audit_logs').insert({
        organisation_id: adminProfile?.organisation_id,
        user_id: adminProfile?.id,
        action: 'schedule_created',
        entity_type: 'schedules',
        new_data: { name: form.name },
      })
      setAddOpen(false)
    }

    await fetchSchedules()
    setForm(emptyForm)
    setSaving(false)
  }

  async function handleDelete() {
    if (!selected) return
    setDeleting(true)
    const supabase = createClient()
    await supabase.from('schedules').delete().eq('id', selected.id)
    await fetchSchedules()
    setDeleteOpen(false)
    setDeleting(false)
  }

  async function handleToggleActive() {
    if (!selected) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('schedules').update({ is_active: !selected.is_active }).eq('id', selected.id)

    await supabase.from('audit_logs').insert({
      organisation_id: adminProfile?.organisation_id,
      user_id: adminProfile?.id,
      action: selected.is_active ? 'schedule_paused' : 'schedule_activated',
      entity_type: 'schedules',
      entity_id: selected.id,
      new_data: { is_active: !selected.is_active },
    })

    await fetchSchedules()
    setToggleOpen(false)
    setSaving(false)
  }

  async function handleDuplicate(s: ScheduleWithDetails) {
    const supabase = createClient()
    const { error: err } = await supabase.from('schedules').insert({
      organisation_id: s.organisation_id,
      name: `${s.name} (Copy)`,
      form_type: s.form_type as any,
      template_id: s.template_id,
      frequency: s.frequency as any,
      days_of_week: s.days_of_week,
      time_due: s.time_due,
      cutoff_time: s.cutoff_time,
      is_ongoing: s.is_ongoing,
      is_active: false,
      start_date: s.start_date,
      end_date: s.end_date,
      audience_type: s.audience_type as any,
      applicable_role: s.applicable_role as any,
      audience_id: s.audience_id,
    })
    if (!err) await fetchSchedules()
  }

  function openEdit(s: ScheduleWithDetails) {
    setSelected(s)
    setForm({
      name: s.name,
      template_id: s.template_id ?? '',
      frequency: s.frequency,
      days_of_week: s.days_of_week ?? [],
      time_due: s.time_due ?? '',
      cutoff_time: s.cutoff_time ?? '',
      start_date: s.start_date ?? '',
      end_date: s.end_date ?? '',
      is_ongoing: s.is_ongoing,
      audience_type: s.audience_type ?? 'role',
      applicable_role: s.applicable_role ?? 'branch_manager',
      audience_id: s.audience_id ?? '',
    })
    setError('')
    setEditOpen(true)
  }

  // Audience options based on selected type
  function audienceOptions(): { value: string; label: string }[] {
    if (form.audience_type === 'branch') return branches.map(b => ({ value: b.id, label: b.label }))
    if (form.audience_type === 'region') return regions.map(r => ({ value: r.id, label: r.label }))
    if (form.audience_type === 'general_area') return generalAreas.map(a => ({ value: a.id, label: a.label }))
    return []
  }

  const ScheduleForm = () => (
    <div className="space-y-5">
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      <Input
        label="Schedule Name"
        required
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        placeholder="e.g. Daily Branch Compliance Check"
      />

      <Select
        label="Form Template"
        required
        options={templates.map(t => ({ value: t.id, label: t.name }))}
        placeholder="Select a template…"
        value={form.template_id}
        onChange={e => setForm(f => ({ ...f, template_id: e.target.value }))}
      />

      {/* Audience */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-gray-700">Assign To</label>
        <div className="grid grid-cols-2 gap-2">
          {AUDIENCE_TYPES.map(at => (
            <label
              key={at.value}
              className={`flex items-center gap-2 p-3 rounded-lg border-2 cursor-pointer transition-colors text-sm ${
                form.audience_type === at.value
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700 font-medium'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="audience_type"
                value={at.value}
                checked={form.audience_type === at.value}
                onChange={() => setForm(f => ({ ...f, audience_type: at.value, audience_id: '', applicable_role: 'branch_manager' }))}
                className="text-indigo-600"
              />
              {at.label}
            </label>
          ))}
        </div>

        {form.audience_type === 'role' ? (
          <Select
            label="Role"
            options={ROLES.map(r => ({ value: r, label: getRoleLabel(r) }))}
            value={form.applicable_role}
            onChange={e => setForm(f => ({ ...f, applicable_role: e.target.value }))}
          />
        ) : (
          <Select
            label={AUDIENCE_TYPES.find(a => a.value === form.audience_type)?.label ?? 'Select'}
            options={audienceOptions()}
            placeholder="Select…"
            value={form.audience_id}
            onChange={e => setForm(f => ({ ...f, audience_id: e.target.value }))}
          />
        )}
      </div>

      {/* Frequency */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Frequency</label>
        <div className="grid grid-cols-4 gap-2">
          {['daily', 'weekly', 'monthly', 'custom'].map(freq => (
            <button
              key={freq}
              type="button"
              onClick={() => setForm(f => ({ ...f, frequency: freq, days_of_week: [] }))}
              className={`py-2 rounded-lg text-xs font-medium capitalize border-2 transition-colors ${
                form.frequency === freq
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {freq}
            </button>
          ))}
        </div>
      </div>

      {/* Days of week */}
      {(form.frequency === 'weekly' || form.frequency === 'custom') && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Days of Week</label>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => toggleDay(idx)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  form.days_of_week.includes(idx)
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Times */}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Opens at"
          type="time"
          value={form.time_due}
          onChange={e => setForm(f => ({ ...f, time_due: e.target.value }))}
          helperText="When the form becomes available"
        />
        <Input
          label="Closes at"
          type="time"
          value={form.cutoff_time}
          onChange={e => setForm(f => ({ ...f, cutoff_time: e.target.value }))}
          helperText="Deadline — not submitted by this time = Missed"
        />
      </div>

      {/* Start date */}
      <Input
        label="Start Date"
        type="date"
        value={form.start_date}
        onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
      />

      {/* Ongoing toggle */}
      <div
        className={`flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-colors ${
          form.is_ongoing ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-white hover:border-gray-300'
        }`}
        onClick={() => setForm(f => ({ ...f, is_ongoing: !f.is_ongoing }))}
      >
        <div>
          <p className="text-sm font-semibold text-gray-800">Ongoing Schedule</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Runs forever on the scheduled recurrence pattern until manually paused. No end date.
          </p>
        </div>
        <div className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${form.is_ongoing ? 'bg-indigo-600' : 'bg-gray-200'}`}>
          <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.is_ongoing ? 'translate-x-5' : 'translate-x-0'}`} />
        </div>
      </div>

      {/* End date (only if not ongoing) */}
      {!form.is_ongoing && (
        <Input
          label="End Date"
          type="date"
          value={form.end_date}
          onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
          helperText="Leave blank for no end date."
        />
      )}
    </div>
  )

  if (profileLoading || loading) return <LoadingPage />

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Template Scheduling</h1>
          <p className="text-sm text-gray-500 mt-1">
            {schedules.length} schedule{schedules.length !== 1 ? 's' : ''} —
            {' '}{schedules.filter(s => s.is_active).length} active
          </p>
        </div>
        <Button onClick={() => { setForm(emptyForm); setError(''); setAddOpen(true) }}>
          <Plus className="h-4 w-4" /> New Schedule
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search schedules or templates…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="sm:w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Paused</option>
        </select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState
                icon={CalendarClock}
                title="No schedules yet"
                description="Create your first schedule to start assigning templates to users."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {['Name', 'Template', 'Assigned To', 'Frequency', 'Days', 'Window', 'Start', 'Ongoing', 'Status', 'Actions'].map(h => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {filtered.map(s => (
                    <tr key={s.id} className={`hover:bg-gray-50 transition-colors ${!s.is_active ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-[180px] truncate">{s.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-[160px] truncate">
                        {s.template_name ?? <span className="text-gray-400 italic">No template</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-[140px] truncate">
                        {s.audience_label ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 capitalize">{s.frequency}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {s.days_of_week?.length
                          ? s.days_of_week.map(d => DAYS[d]).join(', ')
                          : s.frequency === 'daily' ? 'Every day' : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                        {s.time_due || s.cutoff_time
                          ? <span>{s.time_due ? s.time_due.slice(0,5) : '—'} – {s.cutoff_time ? s.cutoff_time.slice(0,5) : '—'}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                        {s.start_date ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {s.is_ongoing
                          ? <Badge variant="success">Ongoing</Badge>
                          : <span className="text-xs text-gray-400">One-time</span>
                        }
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={s.is_active ? 'success' : 'warning'}>
                          {s.is_active ? 'Active' : 'Paused'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDuplicate(s)}
                            title="Duplicate"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant={s.is_active ? 'outline' : 'secondary'}
                            onClick={() => { setSelected(s); setToggleOpen(true) }}
                            title={s.is_active ? 'Pause' : 'Activate'}
                          >
                            {s.is_active
                              ? <><Pause className="h-3.5 w-3.5" /> Pause</>
                              : <><Play className="h-3.5 w-3.5" /> Activate</>
                            }
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => { setSelected(s); setDeleteOpen(true) }} title="Delete">
                            <Trash2 className="h-3.5 w-3.5" />
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
      <Modal isOpen={addOpen} onClose={() => setAddOpen(false)} title="New Schedule" size="lg">
        <div className="space-y-4">
          <ScheduleForm />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={() => handleSave(false)}>
              <Plus className="h-4 w-4" /> Create Schedule
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title={`Edit — ${selected?.name}`} size="lg">
        <div className="space-y-4">
          <ScheduleForm />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={() => handleSave(true)}>Save Changes</Button>
          </div>
        </div>
      </Modal>

      {/* Pause / Activate Confirmation */}
      <Modal isOpen={toggleOpen} onClose={() => setToggleOpen(false)} title="Confirm Action" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Are you sure you want to{' '}
            <strong>{selected?.is_active ? 'pause' : 'activate'}</strong>{' '}
            <strong>{selected?.name}</strong>?
            {selected?.is_active && (
              <span className="block mt-2 text-gray-500">
                Pausing this schedule will stop new expected submissions from being generated.
                {selected?.is_ongoing && ' This ongoing schedule can be reactivated at any time.'}
              </span>
            )}
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setToggleOpen(false)}>Cancel</Button>
            <Button
              variant={selected?.is_active ? 'danger' : 'primary'}
              loading={saving}
              onClick={handleToggleActive}
            >
              {selected?.is_active ? 'Pause Schedule' : 'Activate Schedule'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Schedule" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Permanently delete <strong>{selected?.name}</strong>? This will also remove all future expected submissions for this schedule. This cannot be undone.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={deleting} onClick={handleDelete}>Delete Schedule</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
