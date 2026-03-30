'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart2,
  CheckCircle,
  Download,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  XCircle,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { ComplianceBar } from '@/components/ui/compliance-bar'
import { exportToPDF, tableToHTML } from '@/lib/export'
import { formatDate, getComplianceColor, cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type DateRange = '7d' | '30d' | '90d' | 'custom'

interface WeeklyTrend {
  week: string
  compliance: number
}

interface WeeklyStack {
  week: string
  on_time: number
  late: number
  missed: number
}

interface RegionalRow {
  region_id: string
  region: string
  gm: string
  expected: number
  submitted: number
  missed: number
  compliance: number
  trend: number // vs previous period
}

interface StoreRow {
  store_id: string
  name: string
  code: string
  expected: number
  submitted: number
  compliance: number
}

interface ActionPie {
  name: string
  value: number
  color: string
}

const PIE_COLORS: Record<string, string> = {
  open: '#ef4444',
  in_progress: '#3b82f6',
  resolved: '#10b981',
  closed: '#6b7280',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDateRange(preset: DateRange, customFrom?: string, customTo?: string): { from: string; to: string } {
  const to = new Date()
  const toStr = to.toISOString().split('T')[0]

  if (preset === '7d') {
    const from = new Date(to); from.setDate(to.getDate() - 7)
    return { from: from.toISOString().split('T')[0], to: toStr }
  }
  if (preset === '30d') {
    const from = new Date(to); from.setDate(to.getDate() - 30)
    return { from: from.toISOString().split('T')[0], to: toStr }
  }
  if (preset === '90d') {
    const from = new Date(to); from.setDate(to.getDate() - 90)
    return { from: from.toISOString().split('T')[0], to: toStr }
  }
  return { from: customFrom ?? toStr, to: customTo ?? toStr }
}

function compliance(submitted: number, expected: number): number {
  if (expected === 0) return 0
  return Math.round((submitted / expected) * 100)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EnterpriseAnalyticsPage() {
  const supabase = createClient()

  // ── Date range ──
  const [preset, setPreset] = useState<DateRange>('30d')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [loading, setLoading] = useState(true)

  // ── KPI ──
  const [overallRate, setOverallRate] = useState(0)
  const [totalSubmissions, setTotalSubmissions] = useState(0)
  const [totalMissed, setTotalMissed] = useState(0)
  const [openActions, setOpenActions] = useState(0)

  // ── Charts ──
  const [trendData, setTrendData] = useState<WeeklyTrend[]>([])
  const [stackData, setStackData] = useState<WeeklyStack[]>([])
  const [actionPieData, setActionPieData] = useState<ActionPie[]>([])

  // ── Tables ──
  const [regionalData, setRegionalData] = useState<RegionalRow[]>([])
  const [topStores, setTopStores] = useState<StoreRow[]>([])
  const [bottomStores, setBottomStores] = useState<StoreRow[]>([])
  const [repeatOffenders, setRepeatOffenders] = useState<any[]>([])

  const { from, to } = getDateRange(preset, customFrom, customTo)

  const fetchAll = useCallback(async () => {
    setLoading(true)

    // ── 1. KPIs ──
    const { data: allExpected } = await supabase
      .from('expected_submissions')
      .select('status, store_id')
      .gte('due_date', from)
      .lte('due_date', to)

    const total = allExpected?.length ?? 0
    const submitted = allExpected?.filter(e =>
      e.status === 'submitted_on_time' || e.status === 'submitted_late'
    ).length ?? 0
    const missed = allExpected?.filter(e => e.status === 'missed').length ?? 0

    setOverallRate(compliance(submitted, total))
    setTotalSubmissions(submitted)
    setTotalMissed(missed)

    // ── 2. Open actions ──
    const { count: actionCount } = await supabase
      .from('actions')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'in_progress'])

    setOpenActions(actionCount ?? 0)

    // ── 3. Weekly compliance trend (last 26 weeks from today) ──
    const weekTrends: WeeklyTrend[] = []
    const now = new Date()
    for (let i = 25; i >= 0; i--) {
      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - i * 7)
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekStart.getDate() + 6)
      const label = `W${26 - i}`
      const wStart = weekStart.toISOString().split('T')[0]
      const wEnd = weekEnd.toISOString().split('T')[0]

      const { data: wData } = await supabase
        .from('expected_submissions')
        .select('status')
        .gte('due_date', wStart)
        .lte('due_date', wEnd)

      const wTotal = wData?.length ?? 0
      const wSub = wData?.filter(e =>
        e.status === 'submitted_on_time' || e.status === 'submitted_late'
      ).length ?? 0

      weekTrends.push({ week: label, compliance: compliance(wSub, wTotal) })
    }
    setTrendData(weekTrends)

    // ── 4. Stacked bar: last 8 weeks ──
    const stackRows: WeeklyStack[] = []
    for (let i = 7; i >= 0; i--) {
      const ws = new Date(now)
      ws.setDate(now.getDate() - i * 7)
      ws.setDate(ws.getDate() - ws.getDay())
      const we = new Date(ws); we.setDate(ws.getDate() + 6)
      const label = `W-${i === 0 ? 'now' : i}`

      const { data: wData } = await supabase
        .from('expected_submissions')
        .select('status')
        .gte('due_date', ws.toISOString().split('T')[0])
        .lte('due_date', we.toISOString().split('T')[0])

      stackRows.push({
        week: label,
        on_time: wData?.filter(e => e.status === 'submitted_on_time').length ?? 0,
        late: wData?.filter(e => e.status === 'submitted_late').length ?? 0,
        missed: wData?.filter(e => e.status === 'missed').length ?? 0,
      })
    }
    setStackData(stackRows)

    // ── 5. Action pie ──
    const { data: actions } = await supabase.from('actions').select('status')
    const aCounts: Record<string, number> = { open: 0, in_progress: 0, resolved: 0, closed: 0 }
    for (const a of actions ?? []) {
      if (a.status in aCounts) aCounts[a.status]++
    }
    setActionPieData(
      Object.entries(aCounts).map(([key, val]) => ({
        name: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        value: val,
        color: PIE_COLORS[key] ?? '#9ca3af',
      }))
    )

    // ── 6. Regional performance ──
    const { data: regions } = await supabase
      .from('regions')
      .select('id, name, profiles!gm_id(full_name)')

    const { data: regExpected } = await supabase
      .from('expected_submissions')
      .select('status, store_id, stores!inner(region_id)')
      .gte('due_date', from)
      .lte('due_date', to)

    // Previous period for trend
    const prevFrom = new Date(from)
    prevFrom.setDate(prevFrom.getDate() - (new Date(to).getTime() - new Date(from).getTime()) / 86400000)
    const { data: prevRegExpected } = await supabase
      .from('expected_submissions')
      .select('status, store_id, stores!inner(region_id)')
      .gte('due_date', prevFrom.toISOString().split('T')[0])
      .lte('due_date', from)

    const regRows: RegionalRow[] = (regions ?? []).map((r: any) => {
      const rExp = regExpected?.filter((e: any) => e.stores?.region_id === r.id) ?? []
      const rSub = rExp.filter(e => e.status === 'submitted_on_time' || e.status === 'submitted_late').length
      const rMissed = rExp.filter(e => e.status === 'missed').length
      const rate = compliance(rSub, rExp.length)

      const prevExp = prevRegExpected?.filter((e: any) => e.stores?.region_id === r.id) ?? []
      const prevSub = prevExp.filter(e => e.status === 'submitted_on_time' || e.status === 'submitted_late').length
      const prevRate = compliance(prevSub, prevExp.length)

      return {
        region_id: r.id,
        region: r.name,
        gm: r.profiles?.full_name ?? 'Unassigned',
        expected: rExp.length,
        submitted: rSub,
        missed: rMissed,
        compliance: rate,
        trend: rate - prevRate,
      }
    })
    setRegionalData(regRows)

    // ── 7. Top/Bottom stores ──
    const { data: stores } = await supabase
      .from('stores')
      .select('id, name, code')

    const { data: storeExpected } = await supabase
      .from('expected_submissions')
      .select('status, store_id')
      .gte('due_date', from)
      .lte('due_date', to)

    const storeRows: StoreRow[] = (stores ?? []).map((s: any) => {
      const sExp = storeExpected?.filter(e => e.store_id === s.id) ?? []
      const sSub = sExp.filter(e => e.status === 'submitted_on_time' || e.status === 'submitted_late').length
      return {
        store_id: s.id,
        name: s.name,
        code: s.code ?? '',
        expected: sExp.length,
        submitted: sSub,
        compliance: compliance(sSub, sExp.length),
      }
    }).filter(s => s.expected > 0)

    const sorted = [...storeRows].sort((a, b) => b.compliance - a.compliance)
    setTopStores(sorted.slice(0, 5))
    setBottomStores([...sorted].reverse().slice(0, 5))

    // ── 8. Repeat offenders (3+ misses) ──
    const missMap: Record<string, { count: number; name: string; code: string }> = {}
    for (const e of allExpected ?? []) {
      if (e.status !== 'missed') continue
      if (!missMap[e.store_id]) {
        const s = stores?.find((st: any) => st.id === e.store_id)
        missMap[e.store_id] = { count: 0, name: s?.name ?? 'Unknown', code: s?.code ?? '' }
      }
      missMap[e.store_id].count++
    }
    const offenders = Object.entries(missMap)
      .filter(([, v]) => v.count >= 3)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([id, v]) => ({ store_id: id, ...v }))
    setRepeatOffenders(offenders)

    setLoading(false)
  }, [from, to])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  function handleExportPDF() {
    const html = `
      <h2>KPIs</h2>
      ${tableToHTML(
        ['Compliance Rate', 'Submissions', 'Missed', 'Open Actions'],
        [[`${overallRate}%`, String(totalSubmissions), String(totalMissed), String(openActions)]]
      )}
      <h2>Regional Performance</h2>
      ${tableToHTML(
        ['Region', 'GM', 'Expected', 'Submitted', 'Missed', 'Compliance %'],
        regionalData.map(r => [r.region, r.gm, String(r.expected), String(r.submitted), String(r.missed), `${r.compliance}%`])
      )}
      <h2>Repeat Offenders</h2>
      ${tableToHTML(
        ['Store', 'Code', 'Misses'],
        repeatOffenders.map(r => [r.name, r.code, String(r.count)])
      )}
    `
    exportToPDF(`Enterprise Analytics — ${from} to ${to}`, html)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart2 className="h-6 w-6 text-indigo-600" />
            Enterprise Analytics
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Platform-wide compliance overview and performance intelligence.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(['7d', '30d', '90d'] as DateRange[]).map(p => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg font-medium transition-colors',
                preset === p
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              )}
            >
              {p === '7d' ? 'Last 7 Days' : p === '30d' ? 'Last 30 Days' : 'Last 90 Days'}
            </button>
          ))}
          <button
            onClick={() => setPreset('custom')}
            className={cn(
              'px-3 py-1.5 text-sm rounded-lg font-medium transition-colors',
              preset === 'custom'
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            )}
          >
            Custom
          </button>
          {preset === 'custom' && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </>
          )}
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPDF}>
            <Download className="h-4 w-4" />
            Export PDF
          </Button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-8 w-8 animate-spin text-indigo-400" />
          <span className="ml-3 text-gray-500 text-sm">Loading analytics…</span>
        </div>
      )}

      {!loading && (
        <>
          {/* ── Section 1: KPIs ── */}
          <section>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Overall Compliance Rate"
                value={`${overallRate}%`}
                subtitle={`${from} – ${to}`}
                icon={CheckCircle}
                iconColor={overallRate >= 90 ? 'text-green-600' : overallRate >= 70 ? 'text-yellow-600' : 'text-red-600'}
                iconBg={overallRate >= 90 ? 'bg-green-50' : overallRate >= 70 ? 'bg-yellow-50' : 'bg-red-50'}
              />
              <StatCard
                title="Total Submissions"
                value={totalSubmissions.toLocaleString()}
                subtitle="On-time + late"
                icon={Activity}
                iconColor="text-indigo-600"
                iconBg="bg-indigo-50"
              />
              <StatCard
                title="Total Missed"
                value={totalMissed.toLocaleString()}
                subtitle="Missed submissions"
                icon={XCircle}
                iconColor="text-red-600"
                iconBg="bg-red-50"
              />
              <StatCard
                title="Open Actions"
                value={openActions.toLocaleString()}
                subtitle="Open or in-progress"
                icon={AlertTriangle}
                iconColor="text-orange-600"
                iconBg="bg-orange-50"
              />
            </div>
          </section>

          {/* ── Section 2: Compliance Trend ── */}
          <section>
            <Card>
              <CardHeader>
                <CardTitle>Compliance Trend — Last 26 Weeks</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={trendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="complianceGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} interval={3} />
                    <YAxis
                      domain={[0, 100]}
                      tickFormatter={v => `${v}%`}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(v: any) => [`${v}%`, 'Compliance Rate']}
                      labelFormatter={label => `Week: ${label}`}
                    />
                    <Area
                      type="monotone"
                      dataKey="compliance"
                      name="Compliance %"
                      stroke="#6366f1"
                      strokeWidth={2.5}
                      fill="url(#complianceGrad)"
                      dot={false}
                      activeDot={{ r: 5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </section>

          {/* ── Section 3: Stacked Bar + Pie ── */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Submissions by Status — Last 8 Weeks</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={stackData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="on_time" name="On Time" stackId="a" fill="#10b981" />
                    <Bar dataKey="late" name="Late" stackId="a" fill="#f59e0b" />
                    <Bar dataKey="missed" name="Missed" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Action Status Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={actionPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={105}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {actionPieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any, name: any) => [v, name]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </section>

          {/* ── Section 4: Regional Performance ── */}
          <section>
            <Card>
              <CardHeader>
                <CardTitle>Regional Performance</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-100">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Region', 'GM', 'Expected', 'Submitted', 'Missed', 'Compliance', 'Trend vs Prev'].map(h => (
                          <th
                            key={h}
                            className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {regionalData.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-400">
                            No regional data available for the selected period.
                          </td>
                        </tr>
                      ) : (
                        regionalData.map(r => (
                          <tr key={r.region_id} className="hover:bg-gray-50">
                            <td className="px-5 py-3 font-medium text-sm text-gray-900">{r.region}</td>
                            <td className="px-5 py-3 text-sm text-gray-600">{r.gm}</td>
                            <td className="px-5 py-3 text-sm text-gray-600">{r.expected}</td>
                            <td className="px-5 py-3 text-sm text-gray-600">{r.submitted}</td>
                            <td className="px-5 py-3 text-sm text-gray-600">{r.missed}</td>
                            <td className="px-5 py-3 min-w-[140px]">
                              <ComplianceBar rate={r.compliance} />
                            </td>
                            <td className="px-5 py-3">
                              {r.trend === 0 ? (
                                <span className="text-xs text-gray-400">—</span>
                              ) : (
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-1 text-xs font-semibold',
                                    r.trend > 0 ? 'text-green-600' : 'text-red-600'
                                  )}
                                >
                                  {r.trend > 0 ? (
                                    <TrendingUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <TrendingDown className="h-3.5 w-3.5" />
                                  )}
                                  {r.trend > 0 ? '+' : ''}{r.trend}%
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* ── Section 5: Top & Bottom Stores ── */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top 5 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                  Top 5 Performing Stores
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {topStores.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No store data available.</p>
                ) : (
                  topStores.map((s, i) => (
                    <div key={s.store_id} className="flex items-center gap-3">
                      <span className="text-sm font-bold text-gray-400 w-5 text-right">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-sm font-medium text-gray-900 truncate">{s.name}</span>
                          <span className="text-xs text-gray-500 ml-2 shrink-0">{s.code}</span>
                        </div>
                        <ComplianceBar rate={s.compliance} showLabel={false} />
                      </div>
                      <span className={cn('text-sm font-bold w-12 text-right', getComplianceColor(s.compliance))}>
                        {s.compliance}%
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Bottom 5 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-red-600" />
                  Bottom 5 Stores
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {bottomStores.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No store data available.</p>
                ) : (
                  bottomStores.map((s, i) => (
                    <div key={s.store_id} className="flex items-center gap-3">
                      <span className="text-sm font-bold text-gray-400 w-5 text-right">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-sm font-medium text-gray-900 truncate">{s.name}</span>
                          <span className="text-xs text-gray-500 ml-2 shrink-0">{s.code}</span>
                        </div>
                        <ComplianceBar rate={s.compliance} showLabel={false} />
                      </div>
                      <span className={cn('text-sm font-bold w-12 text-right', getComplianceColor(s.compliance))}>
                        {s.compliance}%
                      </span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </section>

          {/* ── Section 6: Repeat Offenders Alert ── */}
          <section>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  Repeat Offenders Alert
                  <span className="ml-auto text-xs font-normal text-gray-500">
                    3+ misses in selected period
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {repeatOffenders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <CheckCircle className="h-8 w-8 text-green-400 mb-2" />
                    <p className="text-sm text-gray-500">No repeat offenders in the selected period.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-red-100">
                      <thead className="bg-red-50">
                        <tr>
                          {['Store', 'Code', 'Misses in Period', 'Risk Level'].map(h => (
                            <th
                              key={h}
                              className="px-5 py-3 text-left text-xs font-semibold text-red-700 uppercase tracking-wider"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-red-50 bg-white">
                        {repeatOffenders.map(r => (
                          <tr key={r.store_id} className="bg-red-50/40 hover:bg-red-50">
                            <td className="px-5 py-3 font-medium text-sm text-gray-900">{r.name}</td>
                            <td className="px-5 py-3 text-sm text-gray-600">{r.code}</td>
                            <td className="px-5 py-3">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                                {r.count}
                              </span>
                            </td>
                            <td className="px-5 py-3">
                              <span
                                className={cn(
                                  'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold',
                                  r.count >= 7
                                    ? 'bg-red-200 text-red-900'
                                    : r.count >= 5
                                    ? 'bg-orange-100 text-orange-800'
                                    : 'bg-yellow-100 text-yellow-800'
                                )}
                              >
                                {r.count >= 7 ? 'Critical' : r.count >= 5 ? 'High' : 'Medium'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  )
}
