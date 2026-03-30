'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { FileText, Eye, Filter } from 'lucide-react'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingPage, LoadingCard } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate, formatDateTime } from '@/lib/utils'

interface EscalationRow {
  id: string
  period_start: string
  period_end: string
  status: string
  submitted_at: string | null
  submitted_by: string
  rm_name: string
  region_name: string
  region_id: string | null
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'draft', label: 'Draft' },
  { value: 'closed', label: 'Closed' },
]

export default function GMEscalationsPage() {
  const { profile, loading: profileLoading } = useProfile()
  const [escalations, setEscalations] = useState<EscalationRow[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [regionFilter, setRegionFilter] = useState('')
  const [rmFilter, setRmFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const [regionOptions, setRegionOptions] = useState<{ value: string; label: string }[]>([])
  const [rmOptions, setRmOptions] = useState<{ value: string; label: string }[]>([])

  const fetchData = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const supabase = createClient()

    // Fetch GM's regions
    const { data: regionsData } = await supabase
      .from('regions')
      .select('id, name')
      .eq('general_manager_id', profile.id)

    const regions = (regionsData ?? []) as { id: string; name: string }[]
    const regionIds = regions.map(r => r.id)
    setRegionOptions([{ value: '', label: 'All Regions' }, ...regions.map(r => ({ value: r.id, label: r.name }))])

    if (regionIds.length === 0) {
      setEscalations([])
      setLoading(false)
      return
    }

    // RM assignments
    const { data: rmData } = await supabase
      .from('user_region_assignments')
      .select('user_id, region_id, profiles!user_region_assignments_user_id_fkey(id, full_name, role)')
      .in('region_id', regionIds)

    type RMAssignment = {
      user_id: string
      region_id: string
      profiles: { id: string; full_name: string; role: string } | null
    }
    const rmList = (rmData ?? []) as unknown as RMAssignment[]
    const regionToRM: Record<string, { id: string; name: string }> = {}
    const rmMap: Record<string, { id: string; name: string; regionId: string }> = {}

    for (const a of rmList) {
      if (a.profiles?.role === 'regional_manager') {
        regionToRM[a.region_id] = { id: a.user_id, name: a.profiles.full_name }
        rmMap[a.user_id] = { id: a.user_id, name: a.profiles.full_name, regionId: a.region_id }
      }
    }

    const uniqueRMs = Object.values(rmMap)
    setRmOptions([{ value: '', label: 'All RMs' }, ...uniqueRMs.map(rm => ({ value: rm.id, label: rm.name }))])

    const rmUserIds = uniqueRMs.map(rm => rm.id)
    if (rmUserIds.length === 0) {
      setEscalations([])
      setLoading(false)
      return
    }

    const targetRMs = rmFilter ? [rmFilter] : rmUserIds

    let query = supabase
      .from('escalations')
      .select('id, period_start, period_end, status, submitted_at, submitted_by')
      .eq('escalation_type', 'regional_report')
      .in('submitted_by', targetRMs)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (statusFilter) query = query.eq('status', statusFilter)
    if (fromDate) query = query.gte('period_start', fromDate)
    if (toDate) query = query.lte('period_end', toDate)

    const { data: escsData } = await query

    type EscRow = {
      id: string
      period_start: string
      period_end: string
      status: string
      submitted_at: string | null
      submitted_by: string
    }
    const escs = (escsData ?? []) as EscRow[]

    // Enrich with region and RM name
    const enriched: EscalationRow[] = escs
      .flatMap(e => {
        const rm = rmMap[e.submitted_by]
        if (!rm) return []
        if (regionFilter && rm.regionId !== regionFilter) return []
        const region = regions.find(r => r.id === rm.regionId)
        const row: EscalationRow = {
          ...e,
          rm_name: rm.name,
          region_name: region?.name ?? '—',
          region_id: rm.regionId,
        }
        return [row]
      })

    setEscalations(enriched)
    setLoading(false)
  }, [profile, rmFilter, statusFilter, fromDate, toDate, regionFilter])

  useEffect(() => {
    if (profile) fetchData()
  }, [profile, fetchData])

  if (profileLoading) return <LoadingPage />

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Regional Escalation Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Review weekly reports submitted by Regional Managers</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 sm:col-span-2 lg:col-span-5">
              <Filter className="h-4 w-4" />
              <span className="font-medium">Filters</span>
            </div>
            <select
              value={regionFilter}
              onChange={e => setRegionFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {regionOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              value={rmFilter}
              onChange={e => setRmFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {rmOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <Input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              placeholder="From date"
            />
            <Input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              placeholder="To date"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Escalations
            {escalations.length > 0 && (
              <span className="text-sm font-normal text-gray-500 ml-1">({escalations.length})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <LoadingCard />
          ) : escalations.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState
                icon={FileText}
                title="No escalations found"
                description="No regional reports match your current filters."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Period</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Region</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">RM Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted At</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {escalations.map(esc => (
                    <tr key={esc.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 text-sm text-gray-900 whitespace-nowrap">
                        {formatDate(esc.period_start)} – {formatDate(esc.period_end)}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-700">{esc.region_name}</td>
                      <td className="px-6 py-3 text-sm text-gray-700">{esc.rm_name}</td>
                      <td className="px-6 py-3 text-sm text-gray-500">
                        {esc.submitted_at ? formatDateTime(esc.submitted_at) : <span className="text-gray-400">Not submitted</span>}
                      </td>
                      <td className="px-6 py-3">
                        <StatusBadge status={esc.status} />
                      </td>
                      <td className="px-6 py-3">
                        <Link href={`/general-manager/escalations/${esc.id}`}>
                          <Button size="sm" variant="ghost">
                            <Eye className="h-3.5 w-3.5" />
                            Review
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
