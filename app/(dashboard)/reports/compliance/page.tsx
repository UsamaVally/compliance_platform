'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Download, Filter, RefreshCw, Loader2, CheckCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { useProfile } from '@/lib/hooks/useProfile'
import { exportToCSV } from '@/lib/export'
import { getComplianceColor } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreRow {
  store_id: string
  store_name: string
  store_code: string
  region_name: string
  expected: number
  submitted: number
  missed: number
  late: number
  compliance: number
}

interface SummaryStats {
  total_expected: number
  total_submitted: number
  total_missed: number
  total_late: number
  compliance_rate: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function complianceBadgeClass(rate: number) {
  if (rate >= 90) return 'bg-green-100 text-green-700 font-semibold'
  if (rate >= 70) return 'bg-yellow-100 text-yellow-700 font-semibold'
  return 'bg-red-100 text-red-700 font-semibold'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ComplianceReportPage() {
  const { profile } = useProfile()
  const supabase = createClient()

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [regionFilter, setRegionFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')

  const [regions, setRegions] = useState<{ id: string; name: string }[]>([])
  const [stores, setStores] = useState<{ id: string; name: string; region_id: string | null }[]>([])
  const [rows, setRows] = useState<StoreRow[]>([])
  const [summary, setSummary] = useState<SummaryStats>({ total_expected: 0, total_submitted: 0, total_missed: 0, total_late: 0, compliance_rate: 0 })
  const [loading, setLoading] = useState(false)

  const isRM = ['regional_manager', 'general_manager', 'higher_supervision', 'admin'].includes(profile?.role ?? '')

  useEffect(() => {
    if (!profile) return
    supabase.from('regions').select('id, name').then(({ data }) => setRegions(data ?? []))
    supabase.from('stores').select('id, name, region_id').eq('is_active', true).then(({ data }) => setStores(data ?? []))
  }, [profile])

  const fetchReport = useCallback(async () => {
    setLoading(true)

    let query = supabase
      .from('expected_submissions')
      .select('store_id, status, stores(id, name, code, region_id, regions(name))')
      .gte('due_date', dateFrom)
      .lte('due_date', dateTo)

    if (storeFilter) query = query.eq('store_id', storeFilter)

    const { data } = await query

    type Row = {
      store_id: string
      status: string
      stores: { id: string; name: string; code: string; region_id: string | null; regions: { name: string } | null } | null
    }

    const storeMap: Record<string, StoreRow> = {}
    for (const r of (data ?? []) as unknown as Row[]) {
      const sid = r.store_id
      if (!storeMap[sid]) {
        const regionName = (r.stores as any)?.regions?.name ?? '—'
        if (regionFilter && !regionName.includes(regionFilter)) continue
        storeMap[sid] = {
          store_id: sid,
          store_name: r.stores?.name ?? sid,
          store_code: r.stores?.code ?? '',
          region_name: regionName,
          expected: 0, submitted: 0, missed: 0, late: 0, compliance: 0,
        }
      }
      const sr = storeMap[sid]
      sr.expected++
      if (r.status === 'submitted_on_time') { sr.submitted++; }
      if (r.status === 'submitted_late') { sr.submitted++; sr.late++ }
      if (r.status === 'missed') sr.missed++
    }

    const result = Object.values(storeMap).map(sr => ({
      ...sr,
      compliance: sr.expected > 0 ? Math.round((sr.submitted / sr.expected) * 100) : 0,
    })).sort((a, b) => b.compliance - a.compliance)

    setRows(result)

    const totExp = result.reduce((s, r) => s + r.expected, 0)
    const totSub = result.reduce((s, r) => s + r.submitted, 0)
    const totMissed = result.reduce((s, r) => s + r.missed, 0)
    const totLate = result.reduce((s, r) => s + r.late, 0)
    setSummary({
      total_expected: totExp,
      total_submitted: totSub,
      total_missed: totMissed,
      total_late: totLate,
      compliance_rate: totExp > 0 ? Math.round((totSub / totExp) * 100) : 0,
    })

    setLoading(false)
  }, [dateFrom, dateTo, regionFilter, storeFilter, supabase])

  useEffect(() => { if (profile) fetchReport() }, [profile, fetchReport])

  const handleExport = () => {
    exportToCSV(rows.map(r => ({
      Store: r.store_name,
      Code: r.store_code,
      Region: r.region_name,
      Expected: r.expected,
      Submitted: r.submitted,
      Missed: r.missed,
      Late: r.late,
      'Compliance %': r.compliance,
    })), 'compliance-report')
  }

  const chartData = rows.slice(0, 20).map(r => ({ name: r.store_code || r.store_name, compliance: r.compliance }))

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Report</h1>
          <p className="text-sm text-gray-500 mt-1">Submission compliance by store and date range.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date To</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            {isRM && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Region</label>
                <select
                  value={regionFilter}
                  onChange={e => setRegionFilter(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">All Regions</option>
                  {regions.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Store</label>
              <select
                value={storeFilter}
                onChange={e => setStoreFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">All Stores</option>
                {stores
                  .filter(s => !regionFilter || (regions.find(r => r.name === regionFilter)?.id === s.region_id))
                  .map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4">
            <Button size="sm" variant="primary" onClick={fetchReport} loading={loading}>
              <Filter className="h-4 w-4" />
              Apply Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Expected" value={summary.total_expected} icon={RefreshCw} iconColor="text-blue-600" iconBg="bg-blue-50" />
        <StatCard title="Submitted" value={summary.total_submitted} icon={CheckCircle} iconColor="text-green-600" iconBg="bg-green-50" />
        <StatCard title="Missed" value={summary.total_missed} icon={RefreshCw} iconColor="text-red-600" iconBg="bg-red-50" />
        <StatCard title="Late" value={summary.total_late} icon={RefreshCw} iconColor="text-yellow-600" iconBg="bg-yellow-50" />
        <StatCard
          title="Compliance %"
          value={`${summary.compliance_rate}%`}
          icon={CheckCircle}
          iconColor={summary.compliance_rate >= 90 ? 'text-green-600' : summary.compliance_rate >= 70 ? 'text-yellow-600' : 'text-red-600'}
          iconBg={summary.compliance_rate >= 90 ? 'bg-green-50' : summary.compliance_rate >= 70 ? 'bg-yellow-50' : 'bg-red-50'}
        />
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Compliance % by Store (Top 20)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-40} textAnchor="end" interval={0} />
                <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: any) => [`${v}%`, 'Compliance']} />
                <Bar dataKey="compliance" name="Compliance %" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Store Breakdown</CardTitle>
            <span className="text-sm text-gray-500">{rows.length} stores</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle className="h-10 w-10 text-gray-200 mb-3" />
              <p className="text-sm text-gray-500">No data found for the selected filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {['Store', 'Region', 'Expected', 'Submitted', 'Missed', 'Late', 'Compliance %'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {rows.map(r => (
                    <tr key={r.store_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 text-sm font-medium text-gray-900">
                        {r.store_name}
                        {r.store_code && <span className="ml-1 text-xs text-gray-400">({r.store_code})</span>}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-500">{r.region_name}</td>
                      <td className="px-5 py-3 text-sm text-gray-700">{r.expected}</td>
                      <td className="px-5 py-3 text-sm text-green-600 font-medium">{r.submitted}</td>
                      <td className="px-5 py-3 text-sm text-red-600 font-medium">{r.missed}</td>
                      <td className="px-5 py-3 text-sm text-yellow-600 font-medium">{r.late}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs ${complianceBadgeClass(r.compliance)}`}>
                          {r.compliance}%
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
    </div>
  )
}
