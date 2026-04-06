'use client'

import { useEffect, useState, useCallback } from 'react'
import { UserPlus, Search, Edit2, UserX, UserCheck, Users, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/lib/hooks/useProfile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingPage } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDateTime, getRoleLabel } from '@/lib/utils'
import type { Profile, Region, Store, UserRole } from '@/lib/types'

type ProfileWithDetails = Profile & {
  organisations: { name: string } | null
  user_store_assignments: { store_id: string; stores: { name: string } | null }[]
  user_region_assignments: { region_id: string; regions: { name: string } | null }[]
}

const ROLES: UserRole[] = [
  'admin',
  'higher_supervision',
  'general_manager',
  'regional_manager',
  'branch_manager',
]

const roleBadgeVariant = (role: UserRole) => {
  const map: Record<UserRole, 'danger' | 'warning' | 'info' | 'purple' | 'default'> = {
    admin: 'danger',
    higher_supervision: 'purple',
    general_manager: 'warning',
    regional_manager: 'info',
    branch_manager: 'default',
  }
  return map[role]
}

const emptyInvite = { full_name: '', email: '', role: '' as UserRole | '', password: '' }
const emptyEdit = { full_name: '', phone: '', role: '' as UserRole | '', is_active: true }

export default function UsersPage() {
  const { profile: adminProfile, loading: profileLoading } = useProfile()

  const [users, setUsers] = useState<ProfileWithDetails[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Modals
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [selectedUser, setSelectedUser] = useState<ProfileWithDetails | null>(null)
  const [inviteForm, setInviteForm] = useState(emptyInvite)
  const [editForm, setEditForm] = useState(emptyEdit)
  const [assignStoreIds, setAssignStoreIds] = useState<string[]>([])
  const [assignRegionIds, setAssignRegionIds] = useState<string[]>([])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchUsers = useCallback(async () => {
    if (!adminProfile) return
    const supabase = createClient()

    const { data: profilesData } = await supabase
      .from('profiles')
      .select('*')
      .eq('organisation_id', adminProfile.organisation_id)
      .order('full_name')

    if (!profilesData) { setLoading(false); return }

    // Enrich with store/region assignments separately
    const enriched = await Promise.all(profilesData.map(async (p) => {
      const [{ data: storeAssignments }, { data: regionAssignments }] = await Promise.all([
        supabase
          .from('user_store_assignments')
          .select('store_id, stores(name)')
          .eq('user_id', p.id),
        supabase
          .from('user_region_assignments')
          .select('region_id, regions(name)')
          .eq('user_id', p.id),
      ])
      return {
        ...p,
        organisations: { name: adminProfile.organisations?.name ?? '' },
        user_store_assignments: (storeAssignments ?? []).map((a: any) => ({ store_id: a.store_id, stores: a.stores })),
        user_region_assignments: (regionAssignments ?? []).map((a: any) => ({ region_id: a.region_id, regions: a.regions })),
      }
    }))

    setUsers(enriched as ProfileWithDetails[])
    setLoading(false)
  }, [adminProfile])

  useEffect(() => {
    if (!adminProfile) return
    const supabase = createClient()

    Promise.all([
      fetchUsers(),
      supabase
        .from('regions')
        .select('*')
        .eq('organisation_id', adminProfile.organisation_id)
        .order('name'),
      supabase
        .from('stores')
        .select('*')
        .eq('organisation_id', adminProfile.organisation_id)
        .eq('is_active', true)
        .order('name'),
    ]).then(([, regResult, storeResult]) => {
      setRegions(regResult.data ?? [])
      setStores(storeResult.data ?? [])
    })
  }, [adminProfile, fetchUsers])

  const filtered = users.filter(u => {
    const matchSearch =
      !search ||
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    const matchRole = !roleFilter || u.role === roleFilter
    const matchStatus =
      statusFilter === ''
        ? true
        : statusFilter === 'active'
        ? u.is_active
        : !u.is_active
    return matchSearch && matchRole && matchStatus
  })

  async function handleInvite() {
    if (!inviteForm.full_name || !inviteForm.email || !inviteForm.role || !inviteForm.password) {
      setError('All fields are required.')
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
        role: inviteForm.role,
        password: inviteForm.password,
      }),
    })

    const json = await res.json()
    if (!res.ok) {
      setError(json.error ?? 'Failed to send invite.')
      setSaving(false)
      return
    }

    await fetchUsers()
    setInviteOpen(false)
    setInviteForm(emptyInvite)
    setSaving(false)
  }

  async function handleEdit() {
    if (!selectedUser) return
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { error: err } = await supabase
      .from('profiles')
      .update({
        full_name: editForm.full_name,
        phone: editForm.phone || null,
        role: editForm.role as UserRole,
        is_active: editForm.is_active,
      })
      .eq('id', selectedUser.id)
    if (err) { setError(err.message); setSaving(false); return }

    // Audit log
    await supabase.from('audit_logs').insert({
      organisation_id: adminProfile?.organisation_id,
      user_id: adminProfile?.id,
      action: 'user_updated',
      entity_type: 'profiles',
      entity_id: selectedUser.id,
      old_data: { role: selectedUser.role, is_active: selectedUser.is_active },
      new_data: { role: editForm.role, is_active: editForm.is_active },
    })

    await fetchUsers()
    setEditOpen(false)
    setSaving(false)
  }

  async function handleAssign() {
    if (!selectedUser) return
    setSaving(true)
    setError('')
    const supabase = createClient()
    const isStoreRole = ['branch_manager'].includes(selectedUser.role)

    if (isStoreRole) {
      // Remove old assignments then insert new
      await supabase.from('user_store_assignments').delete().eq('user_id', selectedUser.id)
      if (assignStoreIds.length > 0) {
        await supabase.from('user_store_assignments').insert(
          assignStoreIds.map((sid, idx) => ({
            user_id: selectedUser.id,
            store_id: sid,
            is_primary: idx === 0,
            assigned_by: adminProfile?.id,
          }))
        )
      }
    } else {
      await supabase.from('user_region_assignments').delete().eq('user_id', selectedUser.id)
      if (assignRegionIds.length > 0) {
        await supabase.from('user_region_assignments').insert(
          assignRegionIds.map(rid => ({
            user_id: selectedUser.id,
            region_id: rid,
            assigned_by: adminProfile?.id,
          }))
        )
      }
    }

    await fetchUsers()
    setAssignOpen(false)
    setSaving(false)
  }

  async function handleDeactivate() {
    if (!selectedUser) return
    setSaving(true)
    const supabase = createClient()
    await supabase
      .from('profiles')
      .update({ is_active: !selectedUser.is_active })
      .eq('id', selectedUser.id)

    await supabase.from('audit_logs').insert({
      organisation_id: adminProfile?.organisation_id,
      user_id: adminProfile?.id,
      action: selectedUser.is_active ? 'user_deactivated' : 'user_activated',
      entity_type: 'profiles',
      entity_id: selectedUser.id,
      new_data: { is_active: !selectedUser.is_active },
    })

    await fetchUsers()
    setDeactivateOpen(false)
    setSaving(false)
  }

  async function handleDelete() {
    if (!selectedUser) return
    setDeleting(true)
    const res = await fetch('/api/auth/invite', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: selectedUser.id }),
    })
    if (res.ok) {
      await fetchUsers()
      setDeleteOpen(false)
    }
    setDeleting(false)
  }

  function openEdit(user: ProfileWithDetails) {
    setSelectedUser(user)
    setEditForm({ full_name: user.full_name, phone: user.phone ?? '', role: user.role, is_active: user.is_active })
    setError('')
    setEditOpen(true)
  }

  function openAssign(user: ProfileWithDetails) {
    setSelectedUser(user)
    setAssignStoreIds(user.user_store_assignments.map(a => a.store_id).filter(Boolean))
    setAssignRegionIds(user.user_region_assignments.map(a => a.region_id).filter(Boolean))
    setAssignOpen(true)
  }

  function openDeactivate(user: ProfileWithDetails) {
    setSelectedUser(user)
    setDeactivateOpen(true)
  }

  if (profileLoading || loading) return <LoadingPage />

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-500 mt-1">{filtered.length} of {users.length} users</p>
        </div>
        <Button onClick={() => { setInviteForm(emptyInvite); setError(''); setInviteOpen(true) }}>
          <UserPlus className="h-4 w-4" />
          Invite User
        </Button>
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
        <Select
          options={[{ value: '', label: 'All Roles' }, ...ROLES.map(r => ({ value: r, label: getRoleLabel(r) }))]}
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
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
              <EmptyState icon={Users} title="No users found" description="Try adjusting your search or filters." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {['Full Name', 'Email', 'Role', 'Organisation', 'Assigned Store / Region', 'Status', 'Actions'].map(h => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {filtered.map(user => {
                    const storeNames = user.user_store_assignments.map(a => a.stores?.name).filter(Boolean).join(', ')
                    const regionNames = user.user_region_assignments.map(a => a.regions?.name).filter(Boolean).join(', ')
                    const assigned = storeNames || regionNames || '—'
                    return (
                      <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                          {user.full_name}
                        </td>
                        <td className="px-6 py-3 text-sm text-gray-500">{user.email}</td>
                        <td className="px-6 py-3">
                          <Badge variant={roleBadgeVariant(user.role)}>
                            {getRoleLabel(user.role)}
                          </Badge>
                        </td>
                        <td className="px-6 py-3 text-sm text-gray-500">
                          {user.organisations?.name ?? '—'}
                        </td>
                        <td className="px-6 py-3 text-sm text-gray-500 max-w-xs truncate">
                          {assigned}
                        </td>
                        <td className="px-6 py-3">
                          <Badge variant={user.is_active ? 'success' : 'danger'}>
                            {user.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => { setSelectedUser(user); setDeleteOpen(true) }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(user)}>
                              <Edit2 className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => openAssign(user)}>
                              Assign
                            </Button>
                            <Button
                              size="sm"
                              variant={user.is_active ? 'danger' : 'secondary'}
                              onClick={() => openDeactivate(user)}
                            >
                              {user.is_active ? (
                                <><UserX className="h-3.5 w-3.5" /> Deactivate</>
                              ) : (
                                <><UserCheck className="h-3.5 w-3.5" /> Activate</>
                              )}
                            </Button>
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

      {/* Invite User Modal */}
      <Modal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite User" size="md">
        <div className="space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <Input
            label="Full Name"
            required
            value={inviteForm.full_name}
            onChange={e => setInviteForm(f => ({ ...f, full_name: e.target.value }))}
          />
          <Input
            label="Email"
            type="email"
            required
            value={inviteForm.email}
            onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))}
          />
          <Select
            label="Role"
            required
            options={ROLES.map(r => ({ value: r, label: getRoleLabel(r) }))}
            placeholder="Select a role…"
            value={inviteForm.role}
            onChange={e => setInviteForm(f => ({ ...f, role: e.target.value as UserRole }))}
          />
          <Input
            label="Password"
            type="password"
            required
            value={inviteForm.password}
            onChange={e => setInviteForm(f => ({ ...f, password: e.target.value }))}
            placeholder="Min. 8 characters"
            minLength={8}
            autoComplete="new-password"
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleInvite}>
              <UserPlus className="h-4 w-4" /> Add User
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit User Modal */}
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title={`Edit — ${selectedUser?.full_name}`} size="md">
        <div className="space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <Input
            label="Full Name"
            value={editForm.full_name}
            onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
          />
          <Input
            label="Phone"
            type="tel"
            value={editForm.phone}
            onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
          />
          <Select
            label="Role"
            options={ROLES.map(r => ({ value: r, label: getRoleLabel(r) }))}
            value={editForm.role}
            onChange={e => setEditForm(f => ({ ...f, role: e.target.value as UserRole }))}
          />
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">Active</label>
            <button
              type="button"
              onClick={() => setEditForm(f => ({ ...f, is_active: !f.is_active }))}
              className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${editForm.is_active ? 'bg-indigo-600' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${editForm.is_active ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleEdit}>Save Changes</Button>
          </div>
        </div>
      </Modal>

      {/* Assign Store/Region Modal */}
      <Modal isOpen={assignOpen} onClose={() => setAssignOpen(false)} title={`Assign — ${selectedUser?.full_name}`} size="lg">
        <div className="space-y-4">
          {selectedUser?.role === 'branch_manager' ? (
            <>
              <p className="text-sm text-gray-600">Select stores to assign to this Branch Manager.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3">
                {stores.map(store => (
                  <label key={store.id} className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={assignStoreIds.includes(store.id)}
                      onChange={e => {
                        if (e.target.checked) setAssignStoreIds(ids => [...ids, store.id])
                        else setAssignStoreIds(ids => ids.filter(id => id !== store.id))
                      }}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700">{store.name} <span className="text-gray-400">({store.code})</span></span>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600">Select regions to assign to this user.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3">
                {regions.map(region => (
                  <label key={region.id} className="flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={assignRegionIds.includes(region.id)}
                      onChange={e => {
                        if (e.target.checked) setAssignRegionIds(ids => [...ids, region.id])
                        else setAssignRegionIds(ids => ids.filter(id => id !== region.id))
                      }}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-700">{region.name} <span className="text-gray-400">({region.code})</span></span>
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleAssign}>Save Assignments</Button>
          </div>
        </div>
      </Modal>

      {/* Deactivate Confirmation */}
      <Modal isOpen={deactivateOpen} onClose={() => setDeactivateOpen(false)} title="Confirm Action" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Are you sure you want to{' '}
            <strong>{selectedUser?.is_active ? 'deactivate' : 'activate'}</strong>{' '}
            <strong>{selectedUser?.full_name}</strong>?
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setDeactivateOpen(false)}>Cancel</Button>
            <Button
              variant={selectedUser?.is_active ? 'danger' : 'primary'}
              loading={saving}
              onClick={handleDeactivate}
            >
              {selectedUser?.is_active ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete User" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Permanently delete <strong>{selectedUser?.full_name}</strong>? This will remove their account and all associated data. This cannot be undone.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={deleting} onClick={handleDelete}>Delete User</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
