'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Users,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileText,
  Eye,
  Bell,
  BarChart2,
  ArrowRight,
  Clock,
} from 'lucide-react'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { StatCard } from '@/components/ui/stat-card'
import { StatusBadge } from '@/components/ui/status-badge'
import { ComplianceBar } from '@/components/ui/compliance-bar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingPage, LoadingCard } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { Profile, Region, Store } from '@/lib/types'

interface RMReportRow {
  regionId: string
  regionName: string
  rmId: string | null
  rmName: string
  escalationId: string | null
  escalationStatus: string | null
  submittedAt: string | null
}

interface RegionCompliance {
  regionId: string
  regionName: string
  total: number
  submitted: number
  rate: number
}

interface OverdueAction {
  id: string
  title: string
  store_name: string
  region_name: string
  due_date: string
  priority: string
  status: string
  assigned_name: string | null
}

interface DashboardStats {
  myRegions: number
  rmsSubmitted: number
  rmsMissed: number
  unresolvedEscalations: number
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

function getWeekBounds() {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((day + 6) % 7))
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  return {
    start: monday.toISOString().split('T')[0],
    end: friday.toISOString().split('T')[0],
  }
}

export default function GeneralManagerDashboard() {
  const { profile, loading: profileLoading } = useProfile()
  const [stats, setStats] = useState<DashboardStats>({
    myRegions: 0,
    rmsSubmitted: 0,
    rmsMissed: 0,
    unresolvedEscalations: 0,
  })
  const [rmReports, setRmReports] = useState<RMReportRow[]>([])
  const [regionCompliance, setRegionCompliance] = useState<RegionCompliance[]>([])
  const [overdueActions, setOverdueActions] = useState<OverdueAction[]>([])
  const [loading, setLoading] = useState(true)
  const [remindLoading, setRemindLoading] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!profile) return
    const supabase = createClient()
    const { start, end } = getWeekBounds()
    const today = new Date().toISOString().split('T')[0]

    // 1. Fetch GM's regions
    const { data: regionsData } = await supabase
      .from('regions')
      .select('id, name, general_manager_id')
      .eq('general_manager_id', profile.id)

    const regions = (regionsData ?? []) as { id: string; name: string; general_manager_id: string | null }[]
    const regionIds = regions.map(r => r.id)

    if (regionIds.length === 0) {
      setLoading(false)
      return
    }

    // 2. Fetch RM assignments for each region
    const { data: rmAssignments } = await supabase
      .from('user_region_assignments')
      .select('user_id, region_id, profiles!user_region_assignments_user_id_fkey(id, full_name, role)')
      .in('region_id', regionIds)

    type RMAssignment = {
      user_id: string
      region_id: string
      profiles: { id: string; full_name: string; role: string } | null
    }
    const rmAssignmentList = (rmAssignments ?? []) as unknown as RMAssignment[]

    // Map region -> RM
    const regionToRM: Record<string, { id: string; name: string }> = {}
    for (const a of rmAssignmentList) {
      if (a.profiles?.role === 'regional_manager') {
        regionToRM[a.region_id] = { id: a.user_id, name: a.profiles.full_name }
      }
    }

    const rmUserIds = Object.values(regionToRM).map(rm => rm.id)

    // 3. Fetch this week's regional escalations from those RMs
    const { data: escalationsData } = await supabase
      .from('escalations')
      .select('id, submitted_by, status, submitted_at, period_start, period_end')
      .in('submitted_by', rmUserIds.length > 0 ? rmUserIds : ['_none_'])
      .eq('escalation_type', 'regional_report')
      .gte('period_start', start)
      .lte('period_end', end)
      .order('submitted_at', { ascending: false })

    type EscalationRow = {
      id: string
      submitted_by: string
      status: string
      submitted_at: string | null
      period_start: string
      period_end: string
    }
    const escalations = (escalationsData ?? []) as EscalationRow[]

    // Map rmId -> latest escalation
    const rmToEscalation: Record<string, EscalationRow> = {}
    for (const e of escalations) {
      if (!rmToEscalation[e.submitted_by]) {
        rmToEscalation[e.submitted_by] = e
      }
    }

    // Build RM Report rows
    const rows: RMReportRow[] = regions.map(region => {
      const rm = regionToRM[region.id]
      const esc = rm ? rmToEscalation[rm.id] : undefined
      return {
        regionId: region.id,
        regionName: region.name,
        rmId: rm?.id ?? null,
        rmName: rm?.name ?? 'Unassigned',
        escalationId: esc?.id ?? null,
        escalationStatus: esc?.status ?? null,
        submittedAt: esc?.submitted_at ?? null,
      }
    })

    setRmReports(rows)

    const submitted = rows.filter(r => r.escalationStatus && r.escalationStatus !== 'draft').length
    const missed = rows.filter(r => !r.escalationStatus || r.escalationStatus === 'draft').length

    // 4. Unresolved escalations count
    const { count: unresolvedCount } = await supabase
      .from('escalations')
      .select('id', { count: 'exact', head: true })
      .in('submitted_by', rmUserIds.length > 0 ? rmUserIds : ['_none_'])
      .eq('escalation_type', 'regional_report')
      .in('status', ['submitted', 'under_review'])

    // 5. Region compliance
    const { data: storesData } = await supabase
      .from('stores')
      .select('id, name, region_id')
      .in('region_id', regionIds)
      .eq('is_active', true)

    const stores = (storesData ?? []) as { id: string; name: string; region_id: string | null }[]
    const storeIds = stores.map(s => s.id)

    const { data: expectedData } = await supabase
      .from('expected_submissions')
      .select('store_id, status')
      .in('store_id', storeIds.length > 0 ? storeIds : ['_none_'])
      .gte('due_date', start)
      .lte('due_date', end)

    type ExpRow = { store_id: string; status: string }
    const expectedList = (expectedData ?? []) as ExpRow[]

    // Build compliance per region
    const regionComplianceMap: Record<string, { total: number; submitted: number; name: string }> = {}
    for (const region of regions) {
      regionComplianceMap[region.id] = { total: 0, submitted: 0, name: region.name }
    }
    for (const exp of expectedList) {
      const store = stores.find(s => s.id === exp.store_id)
      if (!store?.region_id) continue
      const rc = regionComplianceMap[store.region_id]
      if (!rc) continue
      rc.total++
      if (exp.status === 'submitted_on_time' || exp.status === 'submitted_late') rc.submitted++
    }
    const complianceRows: RegionCompliance[] = Object.entries(regionComplianceMap).map(([id, rc]) => ({
      regionId: id,
      regionName: rc.name,
      total: rc.total,
      submitted: rc.submitted,
      rate: rc.total > 0 ? Math.round((rc.submitted / rc.total) * 100) : 0,
    }))

    setRegionCompliance(complianceRows)

    // 6. Overdue actions
    const { data: actionsData } = await supabase
      .from('actions')
      .select(`
        id, title, priority, status, due_date, store_id,
        stores(id, name, region_id),
        assigned_profile:profiles!actions_assigned_to_fkey(id, full_name)
      `)
      .in('store_id', storeIds.length > 0 ? storeIds : ['_none_'])
      .lt('due_date', today)
      .not('status', 'in', '("resolved","verified","closed")')
      .order('due_date', { ascending: true })
      .limit(10)

    type ActionRow = {
      id: string
      title: string
      priority: string
      status: string
      due_date: string | null
      store_id: string | null
      stores: { id: string; name: string; region_id: string | null } | null
      assigned_profile: { id: string; full_name: string } | null
    }
    const actionsRaw = (actionsData ?? []) as unknown as ActionRow[]
    const overdueList: OverdueAction[] = actionsRaw.map(a => {
      const store = a.stores
      const regionName = store?.region_id
        ? (regions.find(r => r.id === store.region_id)?.name ?? '—')
        : '—'
      return {
        id: a.id,
        title: a.title,
        store_name: store?.name ?? '—',
        region_name: regionName,
        due_date: a.due_date ?? '',
        priority: a.priority,
        status: a.status,
        assigned_name: a.assigned_profile?.full_name ?? null,
      }
    })
    setOverdueActions(overdueList)

    setStats({
      myRegions: regions.length,
      rmsSubmitted: submitted,
      rmsMissed: missed,
      unresolvedEscalations: unresolvedCount ?? 0,
    })

    setLoading(false)
  }, [profile])

  useEffect(() => {
    if (profile) fetchData()
  }, [profile, fetchData])

  async function handleRemind(rmId: string | null, rmName: string) {
    if (!rmId) return
    setRemindLoading(rmId)
    const supabase = createClient()
    await supabase.from('notifications').insert({
      organisation_id: profile.organisation_id,
      user_id: rmId,
      type: 'reminder',
      title: 'Weekly Report Reminder',
      message: `You have been reminded to submit your regional report for this week.`,
      related_entity_type: 'escalation',
      related_entity_id: null,
    })
    setRemindLoading(null)
  }

  if (profileLoading || loading) return <LoadingPage />

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">General Manager Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            {profile?.full_name && ` · Welcome back, ${profile.full_name}`}
          </p>
        </div>
        <Link href="/general-manager/gm-report">
          <Button size="sm" variant="primary">
            <FileText className="h-4 w-4" />
            Submit GM Report
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="My Regions"
          value={stats.myRegions}
          subtitle="Regions under oversight"
          icon={BarChart2}
          iconColor="text-indigo-600"
          iconBg="bg-indigo-50"
        />
        <StatCard
          title="RMs Submitted This Week"
          value={stats.rmsSubmitted}
          subtitle="Regional reports received"
          icon={CheckCircle}
          iconColor="text-green-600"
          iconBg="bg-green-50"
        />
        <StatCard
          title="RMs Missed This Week"
          value={stats.rmsMissed}
          subtitle="Outstanding reports"
          icon={XCircle}
          iconColor="text-red-600"
          iconBg="bg-red-50"
        />
        <StatCard
          title="Unresolved Escalations"
          value={stats.unresolvedEscalations}
          subtitle="Awaiting GM review"
          icon={AlertTriangle}
          iconColor="text-orange-600"
          iconBg="bg-orange-50"
        />
      </div>

      {/* RM Report Status Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Regional Manager Report Status</CardTitle>
            <Link href="/general-manager/escalations">
              <Button size="sm" variant="ghost">
                View All Escalations
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rmReports.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState
                icon={Users}
                title="No regions assigned"
                description="No regions are currently assigned to you."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Region</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">RM Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">This Week&apos;s Report</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted At</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {rmReports.map(row => (
                    <tr key={row.regionId} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{row.regionName}</td>
                      <td className="px-6 py-3 text-sm text-gray-700">
                        {row.rmName === 'Unassigned' ? (
                          <span className="text-gray-400 italic">Unassigned</span>
                        ) : row.rmName}
                      </td>
                      <td className="px-6 py-3">
                        {row.escalationStatus ? (
                          <StatusBadge status={row.escalationStatus} />
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            Not Submitted
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500">
                        {row.submittedAt ? formatDateTime(row.submittedAt) : '—'}
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          {row.escalationId && (
                            <Link href={`/general-manager/escalations/${row.escalationId}`}>
                              <Button size="sm" variant="ghost">
                                <Eye className="h-3.5 w-3.5" />
                                Review
                              </Button>
                            </Link>
                          )}
                          {(!row.escalationStatus || row.escalationStatus === 'draft') && row.rmId && (
                            <Button
                              size="sm"
                              variant="outline"
                              loading={remindLoading === row.rmId}
                              onClick={() => handleRemind(row.rmId, row.rmName)}
                            >
                              <Bell className="h-3.5 w-3.5" />
                              Remind
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

      {/* Branch Compliance by Region */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Branch Compliance by Region</CardTitle>
            <Link href="/general-manager/regions">
              <Button size="sm" variant="ghost">
                Detailed View
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {regionCompliance.length === 0 ? (
            <EmptyState
              icon={BarChart2}
              title="No compliance data"
              description="No expected submissions found for this week."
            />
          ) : (
            <div className="space-y-4">
              {regionCompliance.map(rc => (
                <div key={rc.regionId} className="flex items-center gap-4">
                  <div className="w-40 flex-shrink-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{rc.regionName}</p>
                    <p className="text-xs text-gray-500">{rc.submitted}/{rc.total} submitted</p>
                  </div>
                  <div className="flex-1">
                    <ComplianceBar rate={rc.rate} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Overdue Actions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-red-500" />
              <CardTitle>Overdue Actions</CardTitle>
            </div>
            <Link href="/general-manager/actions">
              <Button size="sm" variant="ghost">
                All Actions
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {overdueActions.length === 0 ? (
            <div className="px-6 py-8">
              <EmptyState
                icon={CheckCircle}
                title="No overdue actions"
                description="All actions in your regions are within due date."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Store</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Region</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Due Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {overdueActions.map(action => (
                    <tr key={action.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900 max-w-[200px] truncate">{action.title}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{action.store_name}</td>
                      <td className="px-6 py-3 text-sm text-gray-500">{action.region_name}</td>
                      <td className="px-6 py-3 text-sm text-red-600 font-medium">{formatDate(action.due_date)}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[action.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                          {action.priority.charAt(0).toUpperCase() + action.priority.slice(1)}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        <StatusBadge status={action.status} />
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
