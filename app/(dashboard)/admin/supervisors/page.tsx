'use client'

import { useEffect, useState, useCallback } from 'react'
import { UserPlus, Search, Edit2, UserX, UserCheck, Shield } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/lib/hooks/useProfile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { Card, CardContent } from '@/components/ui/card'
import { LoadingPage } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate } from '@/lib/utils'
import type { Profile } from '@/lib/types'

export default function SupervisorsPage() {
  const { profile: adminProfile, loading: profileLoading } = useProfile()

  const [supervisors, setSupervisors] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [inviteOpen, setInviteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)

  const [selected, setSelected] = useState<Profile | null>(null)
  const [inviteForm, setInviteForm] = useState({ full_name: '', email: '', phone: '', password: '' })
  const [editForm, setEditForm] = useState({ full_name: '', phone: '', is_active: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchSupervisors = useCallback(async () => {
    if (!adminProfile) return
    const supabase = createClient()
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('organisation_id', adminProfile.organisation_id)
      .eq('role', 'higher_supervision')
      .order('full_name')
    setSupervisors(data ?? [])
    setLoading(false)
  }, [adminProfile])

  useEffect(() => { fetchSupervisors() }, [fetchSupervisors])

  const filtered = supervisors.filter(u => {
    const matchSearch =
      !search ||
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    const matchStatus =
      statusFilter === '' ? true : statusFilter === 'active' ? u.is_active : !u.is_active
    return matchSearch && matchStatus
  })

  async function handleInvite() {
    if (!inviteForm.full_name || !inviteForm.email || !inviteForm.password) {
      setError('Full name, email, and password are required.')
      return
    }
    if (inviteForm.password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setSaving(true)
    setError('')

    const res = await fetch('/api/auth/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: inviteForm.email,
        fullName: inviteForm.full_name,
        role: 'higher_supervision',
        password: inviteForm.password,
      }),
    })

    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Failed to create account.'); setSaving(false); return }

    // Update phone if provided
    const supabase = createClient()
    if (inviteForm.phone && json.userId) {
      await supabase.from('profiles').update({ phone: inviteForm.phone }).eq('id', json.userId)
    }

    await supabase.from('audit_logs').insert({
      organisation_id: adminProfile?.organisation_id,
      user_id: adminProfile?.id,
      action: 'supervisor_created',
      entity_type: 'profiles',
      new_data: { email: inviteForm.email, role: 'higher_supervision' },
    })

    await fetchSupervisors()
    setInviteOpen(false)
    setInviteForm({ full_name: '', email: '', phone: '', password: '' })
    setSaving(false)
  }

  async function handleEdit() {
    if (!selected) return
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { error: err } = await supabase
      .from('profiles')
      .update({ full_name: editForm.full_name, phone: editForm.phone || null })
      .eq('id', selected.id)
    if (err) { setError(err.message); setSaving(false); return }

    await fetchSupervisors()
    setEditOpen(false)
    setSaving(false)
  }

  async function handleToggleActive() {
    if (!selected) return
    setSaving(true)
    const supabase = createClient()
    await supabase
      .from('profiles')
      .update({ is_active: !selected.is_active })
      .eq('id', selected.id)

    await supabase.from('audit_logs').insert({
      organisation_id: adminProfile?.organisation_id,
      user_id: adminProfile?.id,
      action: selected.is_active ? 'supervisor_deactivated' : 'supervisor_activated',
      entity_type: 'profiles',
      entity_id: selected.id,
      new_data: { is_active: !selected.is_active },
    })

    await fetchSupervisors()
    setDeactivateOpen(false)
    setSaving(false)
  }

  if (profileLoading || loading) return <LoadingPage />

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Supervisor Accounts</h1>
          <p className="text-sm text-gray-500 mt-1">
            Supervisors have global visibility across all areas, regions, and branches.
            {' '}{filtered.length} of {supervisors.length} supervisor{supervisors.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => { setInviteForm({ full_name: '', email: '', phone: '', password: '' }); setError(''); setInviteOpen(true) }}>
          <UserPlus className="h-4 w-4" /> Add Supervisor
        </Button>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
        <Shield className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-blue-800">Supervisor Role — Global Oversight</p>
          <p className="text-xs text-blue-600 mt-0.5">
            Supervisors can view all general areas, regions, and branches across the platform.
            They receive escalations and reports from General Managers but cannot access Admin configuration.
            This role is separate from Admin.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name or email…"
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
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState
                icon={Shield}
                title="No supervisors found"
                description="Add your first supervisor to enable global oversight across the platform."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {['Full Name', 'Email', 'Phone', 'Status', 'Joined', 'Actions'].map(h => (
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
                  {filtered.map(sup => (
                    <tr key={sup.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-semibold text-purple-700">
                              {sup.full_name.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}
                            </span>
                          </div>
                          <span className="text-sm font-medium text-gray-900">{sup.full_name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500">{sup.email}</td>
                      <td className="px-6 py-3 text-sm text-gray-500">{sup.phone ?? '—'}</td>
                      <td className="px-6 py-3">
                        <Badge variant={sup.is_active ? 'success' : 'danger'}>
                          {sup.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500 whitespace-nowrap">
                        {formatDate(sup.created_at)}
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelected(sup)
                              setEditForm({ full_name: sup.full_name, phone: sup.phone ?? '', is_active: sup.is_active })
                              setError('')
                              setEditOpen(true)
                            }}
                          >
                            <Edit2 className="h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant={sup.is_active ? 'danger' : 'secondary'}
                            onClick={() => { setSelected(sup); setDeactivateOpen(true) }}
                          >
                            {sup.is_active ? (
                              <><UserX className="h-3.5 w-3.5" /> Deactivate</>
                            ) : (
                              <><UserCheck className="h-3.5 w-3.5" /> Activate</>
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

      {/* Add Supervisor Modal */}
      <Modal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} title="Add Supervisor Account" size="md">
        <div className="space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
            <p className="text-xs text-purple-700">
              This account will be created with the <strong>Supervisor</strong> role and will have read-only oversight
              across all areas, regions, and branches.
            </p>
          </div>
          <Input
            label="Full Name"
            required
            value={inviteForm.full_name}
            onChange={e => setInviteForm(f => ({ ...f, full_name: e.target.value }))}
            placeholder="e.g. Sarah Johnson"
          />
          <Input
            label="Email Address"
            type="email"
            required
            value={inviteForm.email}
            onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
          />
          <Input
            label="Phone Number"
            type="tel"
            value={inviteForm.phone}
            onChange={e => setInviteForm(f => ({ ...f, phone: e.target.value }))}
            placeholder="Optional"
          />
          <Input
            label="Password"
            type="password"
            required
            value={inviteForm.password}
            onChange={e => setInviteForm(f => ({ ...f, password: e.target.value }))}
            placeholder="Min. 8 characters"
            autoComplete="new-password"
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleInvite}>
              <UserPlus className="h-4 w-4" /> Create Supervisor
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title={`Edit — ${selected?.full_name}`} size="sm">
        <div className="space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}
          <Input
            label="Full Name"
            value={editForm.full_name}
            onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
          />
          <Input
            label="Phone Number"
            type="tel"
            value={editForm.phone}
            onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
          />
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
            <strong>{selected?.full_name}</strong>?
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
    </div>
  )
}
