'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  BarChart2,
  Users,
  MapPin,
  Store as StoreIcon,
  AlertTriangle,
  FileText,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Eye,
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

interface GMReportRow {
  gmId: string
  gmName: string
  regionCount: number
  reportStatus: string | null
  reportId: string | null
  complianceRate: number
  submittedAt: string | null
}

interface RegionComplianceRow {
  regionId: string
  regionName: string
  gmName: string | null
  rate: number
  submitted: number
  total: number
}

interface CriticalAlert {
  id: string
  type: 'missed_store' | 'overdue_escalation' | 'overdue_action'
  title: string
  description: string
  severity: 'high' | 'critical'
}

interface LeaderboardEntry {
  storeId: string
  storeName: string
  regionName: string
  rate: number
  submitted: number
  total: number
}

interface DashboardStats {
  overallCompliance: number
  activeGMs: number
  totalRegions: number
  totalStores: number
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

export default function HigherSupervisionDashboard() {
  const { profile, loading: profileLoading } = useProfile()
  const [stats, setStats] = useState<DashboardStats>({
    overallCompliance: 0, activeGMs: 0, totalRegions: 0, totalStores: 0,
  })
  const [gmReports, setGmReports] = useState<GMReportRow[]>([])
  const [regionCompliance, setRegionCompliance] = useState<RegionComplianceRow[]>([])
  const [criticalAlerts, setCriticalAlerts] = useState<CriticalAlert[]>([])
  const [topStores, setTopStores] = useState<LeaderboardEntry[]>([])
  const [bottomStores, setBottomStores] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    async function fetchData() {
      const supabase = createClient()
      const { start, end } = getWeekBounds()
      const today = new Date().toISOString().split('T')[0]

      // All GMs
      const { data: gmsData } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'general_manager')
        .eq('is_active', true)

      const gms = (gmsData ?? []) as { id: string; full_name: string }[]

      // All regions
      const { data: regionsData } = await supabase
        .from('regions')
        .select('id, name, general_manager_id')

      const regions = (regionsData ?? []) as { id: string; name: string; general_manager_id: string | null }[]
      const regionIds = regions.map(r => r.id)

      // All stores
      const { data: storesData } = await supabase
        .from('stores')
        .select('id, name, region_id')
        .eq('is_active', true)

      const stores = (storesData ?? []) as { id: string; name: string; region_id: string | null }[]
      const storeIds = stores.map(s => s.id)

      // This week's expected submissions
      const { data: expectedData } = await supabase
        .from('expected_submissions')
        .select('store_id, status')
        .in('store_id', storeIds.length > 0 ? storeIds : ['_none_'])
        .gte('due_date', start)
        .lte('due_date', end)

      type ExpRow = { store_id: string; status: string }
      const expected = (expectedData ?? []) as ExpRow[]

      // Compute per-store stats
      const storeStatMap: Record<string, { total: number; submitted: number; missed: number }> = {}
      for (const s of stores) storeStatMap[s.id] = { total: 0, submitted: 0, missed: 0 }
      for (const e of expected) {
        const stat = storeStatMap[e.store_id]
        if (!stat) continue
        stat.total++
        if (e.status === 'submitted_on_time' || e.status === 'submitted_late') stat.submitted++
        if (e.status === 'missed') stat.missed++
      }

      // Overall compliance
      const totalExp = expected.length
      const totalSub = expected.filter(e => e.status === 'submitted_on_time' || e.status === 'submitted_late').length
      const overallRate = totalExp > 0 ? Math.round((totalSub / totalExp) * 100) : 0

      // Per-region compliance
      const regionStatMap: Record<string, { total: number; submitted: number }> = {}
      for (const r of regions) regionStatMap[r.id] = { total: 0, submitted: 0 }
      for (const s of stores) {
        if (!s.region_id) continue
        const stat = storeStatMap[s.id]
        const rc = regionStatMap[s.region_id]
        if (!rc || !stat) continue
        rc.total += stat.total
        rc.submitted += stat.submitted
      }

      // GM region counts
      const gmRegionCount: Record<string, number> = {}
      for (const r of regions) {
        if (r.general_manager_id) {
          gmRegionCount[r.general_manager_id] = (gmRegionCount[r.general_manager_id] ?? 0) + 1
        }
      }

      // This week's GM reports
      const gmIds = gms.map(g => g.id)
      const { data: gmEscsData } = await supabase
        .from('escalations')
        .select('id, submitted_by, status, submitted_at')
        .in('submitted_by', gmIds.length > 0 ? gmIds : ['_none_'])
        .eq('escalation_type', 'gm_report')
        .gte('period_start', start)
        .lte('period_end', end)
        .order('submitted_at', { ascending: false, nullsFirst: false })

      type GmEscRow = { id: string; submitted_by: string; status: string; submitted_at: string | null }
      const gmEscs = (gmEscsData ?? []) as GmEscRow[]
      const gmToEsc: Record<string, GmEscRow> = {}
      for (const e of gmEscs) {
        if (!gmToEsc[e.submitted_by]) gmToEsc[e.submitted_by] = e
      }

      // Compute per-GM compliance from their regions
      const gmComplianceMap: Record<string, { total: number; submitted: number }> = {}
      for (const r of regions) {
        if (!r.general_manager_id) continue
        if (!gmComplianceMap[r.general_manager_id]) gmComplianceMap[r.general_manager_id] = { total: 0, submitted: 0 }
        const rs = regionStatMap[r.id]
        if (rs) {
          gmComplianceMap[r.general_manager_id].total += rs.total
          gmComplianceMap[r.general_manager_id].submitted += rs.submitted
        }
      }

      const gmRows: GMReportRow[] = gms.map(gm => {
        const esc = gmToEsc[gm.id]
        const comp = gmComplianceMap[gm.id] ?? { total: 0, submitted: 0 }
        return {
          gmId: gm.id,
          gmName: gm.full_name,
          regionCount: gmRegionCount[gm.id] ?? 0,
          reportStatus: esc?.status ?? null,
          reportId: esc?.id ?? null,
          complianceRate: comp.total > 0 ? Math.round((comp.submitted / comp.total) * 100) : 0,
          submittedAt: esc?.submitted_at ?? null,
        }
      })
      setGmReports(gmRows)

      // Region compliance rows
      const gmIdToName = Object.fromEntries(gms.map(g => [g.id, g.full_name]))
      const regionRows: RegionComplianceRow[] = regions.map(r => {
        const rs = regionStatMap[r.id] ?? { total: 0, submitted: 0 }
        return {
          regionId: r.id,
          regionName: r.name,
          gmName: r.general_manager_id ? (gmIdToName[r.general_manager_id] ?? '—') : '—',
          rate: rs.total > 0 ? Math.round((rs.submitted / rs.total) * 100) : 0,
          submitted: rs.submitted,
          total: rs.total,
        }
      }).sort((a, b) => b.rate - a.rate)
      setRegionCompliance(regionRows)

      // Critical alerts
      const alerts: CriticalAlert[] = []

      // Stores with 3+ missed submissions
      const missedStores = stores
        .filter(s => (storeStatMap[s.id]?.missed ?? 0) >= 3)
        .map(s => ({
          id: s.id,
          type: 'missed_store' as const,
          title: `${s.name} — ${storeStatMap[s.id].missed} missed submissions`,
          description: 'This store has missed 3 or more submissions this week.',
          severity: (storeStatMap[s.id].missed >= 5 ? 'critical' : 'high') as 'high' | 'critical',
        }))
      alerts.push(...missedStores)

      // Overdue escalations (submitted but not reviewed within 2 days)
      const twoDaysAgo = new Date()
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
      const { data: overdueEscs } = await supabase
        .from('escalations')
        .select('id, submitted_by, escalation_type, submitted_at')
        .in('status', ['submitted', 'under_review'])
        .lt('submitted_at', twoDaysAgo.toISOString())
        .limit(5)

      for (const e of (overdueEscs ?? []) as { id: string; submitted_by: string; escalation_type: string; submitted_at: string }[]) {
        alerts.push({
          id: e.id,
          type: 'overdue_escalation',
          title: `${e.escalation_type === 'gm_report' ? 'GM Report' : 'Regional Report'} — overdue review`,
          description: `Submitted ${formatDateTime(e.submitted_at)} — awaiting review for 2+ days.`,
          severity: 'high',
        })
      }

      // Overdue actions (high/critical past due date)
      const { data: overdueActs } = await supabase
        .from('actions')
        .select('id, title, priority')
        .lt('due_date', today)
        .in('priority', ['high', 'critical'])
        .not('status', 'in', '("resolved","verified","closed")')
        .limit(5)

      for (const a of (overdueActs ?? []) as { id: string; title: string; priority: string }[]) {
        alerts.push({
          id: a.id,
          type: 'overdue_action',
          title: `Action overdue: ${a.title}`,
          description: `Priority: ${a.priority}`,
          severity: a.priority === 'critical' ? 'critical' : 'high',
        })
      }

      setCriticalAlerts(alerts.slice(0, 10))

      // Leaderboard
      const storeLeaderboard: LeaderboardEntry[] = stores
        .filter(s => (storeStatMap[s.id]?.total ?? 0) > 0)
        .map(s => {
          const stat = storeStatMap[s.id]
          const region = regions.find(r => r.id === s.region_id)
          return {
            storeId: s.id,
            storeName: s.name,
            regionName: region?.name ?? '—',
            rate: Math.round((stat.submitted / stat.total) * 100),
            submitted: stat.submitted,
            total: stat.total,
          }
        })
        .sort((a, b) => b.rate - a.rate)

      setTopStores(storeLeaderboard.slice(0, 5))
      setBottomStores([...storeLeaderboard].reverse().slice(0, 5))

      setStats({
        overallCompliance: overallRate,
        activeGMs: gms.length,
        totalRegions: regions.length,
        totalStores: stores.length,
      })
      setLoading(false)
    }
    fetchData()
  }, [profile])

  if (profileLoading || loading) return <LoadingPage />

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Higher Supervision Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            {profile?.full_name && ` · Welcome back, ${profile.full_name}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/higher-supervision/overview">
            <Button size="sm" variant="outline">
              <BarChart2 className="h-4 w-4" />
              Full Overview
            </Button>
          </Link>
          <Link href="/higher-supervision/gm-reports">
            <Button size="sm" variant="primary">
              <FileText className="h-4 w-4" />
              Review GM Reports
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Overall Compliance Rate"
          value={`${stats.overallCompliance}%`}
          subtitle="All submissions this week"
          icon={BarChart2}
          iconColor={stats.overallCompliance >= 90 ? 'text-green-600' : stats.overallCompliance >= 70 ? 'text-yellow-600' : 'text-red-600'}
          iconBg={stats.overallCompliance >= 90 ? 'bg-green-50' : stats.overallCompliance >= 70 ? 'bg-yellow-50' : 'bg-red-50'}
        />
        <StatCard
          title="Active GMs"
          value={stats.activeGMs}
          subtitle="General Managers"
          icon={Users}
          iconColor="text-indigo-600"
          iconBg="bg-indigo-50"
        />
        <StatCard
          title="Total Regions"
          value={stats.totalRegions}
          subtitle="Across organisation"
          icon={MapPin}
          iconColor="text-blue-600"
          iconBg="bg-blue-50"
        />
        <StatCard
          title="Total Stores"
          value={stats.totalStores}
          subtitle="Active stores"
          icon={StoreIcon}
          iconColor="text-purple-600"
          iconBg="bg-purple-50"
        />
      </div>

      {/* Critical Alerts */}
      {criticalAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <CardTitle>Critical Alerts</CardTitle>
              <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                {criticalAlerts.length}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {criticalAlerts.map(alert => (
              <div
                key={`${alert.type}-${alert.id}`}
                className={`flex items-start gap-3 p-3 rounded-lg border ${
                  alert.severity === 'critical'
                    ? 'border-red-200 bg-red-50'
                    : 'border-orange-200 bg-orange-50'
                }`}
              >
                <AlertTriangle className={`h-4 w-4 flex-shrink-0 mt-0.5 ${alert.severity === 'critical' ? 'text-red-500' : 'text-orange-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${alert.severity === 'critical' ? 'text-red-800' : 'text-orange-800'}`}>{alert.title}</p>
                  <p className={`text-xs mt-0.5 ${alert.severity === 'critical' ? 'text-red-600' : 'text-orange-600'}`}>{alert.description}</p>
                </div>
                <span className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                  alert.severity === 'critical' ? 'bg-red-200 text-red-800' : 'bg-orange-200 text-orange-800'
                }`}>
                  {alert.severity}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* GM Report Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>GM Report Status</CardTitle>
            <Link href="/higher-supervision/gm-reports">
              <Button size="sm" variant="ghost">
                All Reports
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {gmReports.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState icon={Users} title="No GMs found" description="No General Managers are active." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">GM Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Regions</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">This Week&apos;s Report</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Compliance %</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted At</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {gmReports.map(row => (
                    <tr key={row.gmId} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{row.gmName}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{row.regionCount}</td>
                      <td className="px-6 py-3">
                        {row.reportStatus ? (
                          <StatusBadge status={row.reportStatus} />
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                            Not Submitted
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <span className={`text-sm font-semibold ${row.complianceRate >= 90 ? 'text-green-600' : row.complianceRate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {row.complianceRate}%
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500">
                        {row.submittedAt ? formatDateTime(row.submittedAt) : '—'}
                      </td>
                      <td className="px-6 py-3">
                        {row.reportId && (
                          <Link href={`/higher-supervision/gm-reports/${row.reportId}`}>
                            <Button size="sm" variant="ghost">
                              <Eye className="h-3.5 w-3.5" />
                              Review
                            </Button>
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Compliance by Region */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Compliance by Region</CardTitle>
            <Link href="/higher-supervision/overview">
              <Button size="sm" variant="ghost">
                Full Drill-down
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {regionCompliance.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState icon={MapPin} title="No regions found" description="No regions configured." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Region</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">GM</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submissions</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">Compliance</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {regionCompliance.map(rc => (
                    <tr key={rc.regionId} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{rc.regionName}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{rc.gmName}</td>
                      <td className="px-6 py-3 text-sm text-gray-500">{rc.submitted}/{rc.total}</td>
                      <td className="px-6 py-3 min-w-[180px]">
                        <ComplianceBar rate={rc.rate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Performance Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top 5 */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <CardTitle>Top 5 Stores</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {topStores.length === 0 ? (
              <EmptyState icon={StoreIcon} title="No data available" description="No store data for this week." />
            ) : (
              <ol className="space-y-3">
                {topStores.map((store, i) => (
                  <li key={store.storeId} className="flex items-center gap-3">
                    <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-yellow-400 text-yellow-900' : i === 1 ? 'bg-gray-300 text-gray-700' : i === 2 ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{store.storeName}</p>
                      <p className="text-xs text-gray-500">{store.regionName} · {store.submitted}/{store.total}</p>
                    </div>
                    <span className="flex-shrink-0 text-sm font-bold text-green-600">{store.rate}%</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Bottom 5 */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-500" />
              <CardTitle>Bottom 5 Stores</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {bottomStores.length === 0 ? (
              <EmptyState icon={StoreIcon} title="No data available" description="No store data for this week." />
            ) : (
              <ol className="space-y-3">
                {bottomStores.map((store, i) => (
                  <li key={store.storeId} className="flex items-center gap-3">
                    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{store.storeName}</p>
                      <p className="text-xs text-gray-500">{store.regionName} · {store.submitted}/{store.total}</p>
                    </div>
                    <span className="flex-shrink-0 text-sm font-bold text-red-600">{store.rate}%</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
