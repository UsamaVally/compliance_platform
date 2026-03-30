'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  BarChart2,
  FileText,
  Download,
  RefreshCw,
  TrendingUp,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react'
import {
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useProfile } from '@/lib/hooks/useProfile'
import { exportToCSV } from '@/lib/export'
import { formatDate } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = 'overview' | 'compliance' | 'missed' | 'actions' | 'export'

interface WeeklyPoint { week: string; rate: number }
interface StatusBar { status: string; on_time: number; late: number; missed: number }
interface ActionPie { name: string; value: number; color: string }

interface ReportType {
  key: string
  label: string
  minRole?: string
  href?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'missed', label: 'Missed' },
  { key: 'actions', label: 'Actions' },
  { key: 'export', label: 'Export' },
]

const REPORT_TYPES: ReportType[] = [
  { key: 'submission_compliance', label: 'Submission Compliance Report', href: '/dashboard/reports/compliance' },
  { key: 'missed_submissions', label: 'Missed Submissions Report', href: '/dashboard/reports/missed' },
  { key: 'repeat_offenders', label: 'Repeat Offenders Report', href: '/dashboard/reports/repeat-offenders' },
  { key: 'action_status', label: 'Action Status Report' },
  { key: 'spot_check', label: 'Spot Check Results Report' },
  { key: 'regional_performance', label: 'Regional Performance Report', minRole: 'regional_manager' },
  { key: 'overall_trend', label: 'Overall Compliance Trend', minRole: 'general_manager' },
]

const PIE_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981']

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { profile } = useProfile()
  const supabase = createClient()

  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [selectedReport, setSelectedReport] = useState('submission_compliance')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])

  const [weeklyData, setWeeklyData] = useState<WeeklyPoint[]>([])
  const [statusData, setStatusData] = useState<StatusBar[]>([])
  const [actionPieData, setActionPieData] = useState<ActionPie[]>([])
  const [savedReports, setSavedReports] = useState<any[]>([])
  const [generating, setGenerating] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadOverviewData()
  }, [])

  async function loadOverviewData() {
    setLoading(true)
    // Weekly compliance for last 12 weeks
    const weeks: WeeklyPoint[] = []
    const now = new Date()
    for (let i = 11; i >= 0; i--) {
      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - i * 7 - now.getDay())
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekStart.getDate() + 6)
      const label = `W${12 - i}`

      const { data: exp } = await supabase
        .from('expected_submissions')
        .select('status')
        .gte('due_date', weekStart.toISOString().split('T')[0])
        .lte('due_date', weekEnd.toISOString().split('T')[0])

      const total = exp?.length ?? 0
      const submitted = exp?.filter(e => e.status === 'submitted_on_time' || e.status === 'submitted_late').length ?? 0
      weeks.push({ week: label, rate: total > 0 ? Math.round((submitted / total) * 100) : 0 })
    }
    setWeeklyData(weeks)

    // Status bar data (last 4 weeks)
    const barData: StatusBar[] = []
    for (let i = 3; i >= 0; i--) {
      const ws = new Date(now)
      ws.setDate(now.getDate() - i * 7 - now.getDay())
      const we = new Date(ws); we.setDate(ws.getDate() + 6)
      const label = `W-${i === 0 ? 'now' : i}`
      const { data: exp } = await supabase
        .from('expected_submissions')
        .select('status')
        .gte('due_date', ws.toISOString().split('T')[0])
        .lte('due_date', we.toISOString().split('T')[0])
      barData.push({
        status: label,
        on_time: exp?.filter(e => e.status === 'submitted_on_time').length ?? 0,
        late: exp?.filter(e => e.status === 'submitted_late').length ?? 0,
        missed: exp?.filter(e => e.status === 'missed').length ?? 0,
      })
    }
    setStatusData(barData)

    // Action pie
    const { data: actions } = await supabase.from('actions').select('status')
    const counts: Record<string, number> = { open: 0, in_progress: 0, resolved: 0, closed: 0 }
    for (const a of actions ?? []) {
      if (a.status in counts) counts[a.status]++
      else counts[a.status] = 1
    }
    setActionPieData([
      { name: 'Open', value: counts.open, color: PIE_COLORS[0] },
      { name: 'In Progress', value: counts.in_progress, color: PIE_COLORS[1] },
      { name: 'Resolved', value: counts.resolved, color: PIE_COLORS[2] },
      { name: 'Closed', value: counts.closed, color: PIE_COLORS[3] },
    ])

    setLoading(false)
  }

  async function handleGenerate() {
    const type = REPORT_TYPES.find(r => r.key === selectedReport)
    if (type?.href) {
      window.location.href = type.href
      return
    }
    setGenerating(true)
    // Query data based on report type
    const { data: submissions } = await supabase
      .from('expected_submissions')
      .select('*, stores(name, code)')
      .gte('due_date', dateFrom)
      .lte('due_date', dateTo)
    const report = {
      id: crypto.randomUUID(),
      type: selectedReport,
      label: REPORT_TYPES.find(r => r.key === selectedReport)?.label ?? selectedReport,
      from: dateFrom,
      to: dateTo,
      generated_at: new Date().toISOString(),
      row_count: submissions?.length ?? 0,
      data: submissions ?? [],
    }
    setSavedReports(prev => [report, ...prev].slice(0, 10))
    setGenerating(false)
    setActiveTab('export')
  }

  const canAccessReport = (r: ReportType) => {
    if (!r.minRole) return true
    const roleOrder = ['branch_manager', 'regional_manager', 'general_manager', 'higher_supervision', 'admin']
    const userIdx = roleOrder.indexOf(profile?.role ?? '')
    const minIdx = roleOrder.indexOf(r.minRole)
    return userIdx >= minIdx
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <BarChart2 className="h-6 w-6 text-indigo-600" />
            Reports & Analytics
          </h1>
          <p className="text-sm text-gray-500 mt-1">Generate, view and export compliance reports.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/higher-supervision/analytics">
            <Button size="sm" variant="outline">
              <TrendingUp className="h-4 w-4" />
              Enterprise Analytics
            </Button>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-1 overflow-x-auto scrollbar-hide">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Overview Tab ────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
            </div>
          ) : (
            <>
              {/* Line Chart: Weekly Compliance */}
              <Card>
                <CardHeader>
                  <CardTitle>Weekly Compliance % — Last 12 Weeks</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={weeklyData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                      <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 12 }} />
                      <Tooltip formatter={(v: any) => [`${v}%`, 'Compliance Rate']} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="rate"
                        name="Compliance %"
                        stroke="#6366f1"
                        strokeWidth={2.5}
                        dot={{ r: 4, fill: '#6366f1' }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Bar Chart: Submissions by Status */}
              <Card>
                <CardHeader>
                  <CardTitle>Submissions by Status — Last 4 Weeks</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={statusData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="status" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="on_time" name="On Time" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                      <Bar dataKey="late" name="Late" stackId="a" fill="#f59e0b" />
                      <Bar dataKey="missed" name="Missed" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Pie Chart: Action Status */}
              <Card>
                <CardHeader>
                  <CardTitle>Action Status Distribution</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center">
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={actionPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={110}
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
            </>
          )}
        </div>
      )}

      {/* ── Compliance Tab ──────────────────────────────────────── */}
      {activeTab === 'compliance' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-gray-600 mb-4">
                View detailed compliance breakdown by store and date range.
              </p>
              <Link href="/dashboard/reports/compliance">
                <Button variant="primary">
                  <FileText className="h-4 w-4" />
                  Open Compliance Report
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Missed Tab ──────────────────────────────────────────── */}
      {activeTab === 'missed' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-gray-600 mb-4">
                Analyse missed submissions by store, reason, and trend over time.
              </p>
              <div className="flex gap-3 flex-wrap">
                <Link href="/dashboard/reports/missed">
                  <Button variant="primary">
                    <XCircle className="h-4 w-4" />
                    Missed Submissions Report
                  </Button>
                </Link>
                <Link href="/dashboard/reports/repeat-offenders">
                  <Button variant="outline">
                    <Clock className="h-4 w-4" />
                    Repeat Offenders
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Actions Tab ─────────────────────────────────────────── */}
      {activeTab === 'actions' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-gray-600 mb-4">
                View open, in-progress, and resolved action items across all stores.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {actionPieData.map(d => (
                  <div key={d.name} className="rounded-xl border border-gray-100 p-4 text-center shadow-sm">
                    <p className="text-2xl font-bold" style={{ color: d.color }}>{d.value}</p>
                    <p className="text-sm text-gray-500 mt-1">{d.name}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Export Tab ──────────────────────────────────────────── */}
      {activeTab === 'export' && (
        <div className="space-y-6">
          {/* Generate Report */}
          <Card>
            <CardHeader>
              <CardTitle>Generate Report</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Report Type</label>
                  <select
                    value={selectedReport}
                    onChange={e => setSelectedReport(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {REPORT_TYPES.filter(canAccessReport).map(r => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date From</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date To</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <Button onClick={handleGenerate} loading={generating} variant="primary">
                <RefreshCw className="h-4 w-4" />
                Generate Report
              </Button>
            </CardContent>
          </Card>

          {/* Saved Reports */}
          <Card>
            <CardHeader>
              <CardTitle>Saved Reports</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {savedReports.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FileText className="h-10 w-10 text-gray-200 mb-3" />
                  <p className="text-sm text-gray-500">No reports generated yet.</p>
                  <p className="text-xs text-gray-400 mt-1">Generate a report above to see it here.</p>
                </div>
              ) : (
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Report</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date Range</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rows</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Generated</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">Download</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {savedReports.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 text-sm font-medium text-gray-900">{r.label}</td>
                        <td className="px-5 py-3 text-sm text-gray-500">
                          {formatDate(r.from)} – {formatDate(r.to)}
                        </td>
                        <td className="px-5 py-3 text-sm text-gray-500">{r.row_count}</td>
                        <td className="px-5 py-3 text-sm text-gray-500">{formatDate(r.generated_at)}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => exportToCSV(r.data, r.key)}
                            >
                              <Download className="h-3.5 w-3.5" />
                              CSV
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
