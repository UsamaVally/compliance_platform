'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  PieChart, Pie, Cell,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { Download, Filter, Loader2, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useProfile } from '@/lib/hooks/useProfile'
import { exportToCSV } from '@/lib/export'
import { formatDate } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MissedRow {
  id: string
  store_name: string
  manager_name: string
  date: string
  scheduled_time: string | null
  reason: string
  reason_notes: string | null
  action_taken: string | null
  status: string
}

interface TrendPoint { week: string; count: number }
interface ReasonSlice { name: string; value: number; color: string }

const REASON_COLORS: Record<string, string> = {
  manager_absent: '#ef4444',
  technical_issue: '#3b82f6',
  store_closed: '#8b5cf6',
  power_outage: '#f59e0b',
  internet_outage: '#06b6d4',
  operational_emergency: '#f97316',
  other: '#6b7280',
}

const REASON_LABELS: Record<string, string> = {
  manager_absent: 'Manager Absent',
  technical_issue: 'Technical Issue',
  store_closed: 'Store Closed',
  power_outage: 'Power Outage',
  internet_outage: 'Internet Outage',
  operational_emergency: 'Operational Emergency',
  other: 'Other',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MissedReportPage() {
  const { profile } = useProfile()
  const supabase = createClient()

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [regionFilter, setRegionFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [reasonFilter, setReasonFilter] = useState('')

  const [regions, setRegions] = useState<{ id: string; name: string }[]>([])
  const [stores, setStores] = useState<{ id: string; name: string }[]>([])
  const [rows, setRows] = useState<MissedRow[]>([])
  const [trendData, setTrendData] = useState<TrendPoint[]>([])
  const [reasonData, setReasonData] = useState<ReasonSlice[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!profile) return
    supabase.from('regions').select('id, name').then(({ data }) => setRegions(data ?? []))
    supabase.from('stores').select('id, name').eq('is_active', true).then(({ data }) => setStores(data ?? []))
  }, [profile])

  const fetchData = useCallback(async () => {
    setLoading(true)

    // Missed expected submissions
    let query = supabase
      .from('expected_submissions')
      .select(`
        id, due_date, due_time, status,
        store_id,
        stores(name, region_id, regions(name)),
        profiles!assigned_user_id(full_name),
        schedules(name)
      `)
      .eq('status', 'missed')
      .gte('due_date', dateFrom)
      .lte('due_date', dateTo)
      .order('due_date', { ascending: false })

    if (storeFilter) query = query.eq('store_id', storeFilter)

    const { data: expected } = await query

    // Missed entries from escalations for reason data
    const { data: entries } = await supabase
      .from('missed_submission_entries')
      .select(`
        id, reason, reason_notes, action_taken,
        store_id, manager_id,
        stores(name),
        profiles!manager_id(full_name),
        expected_submission_id,
        escalations(status)
      `)
      .gte('escalations.period_start', dateFrom)
      .lte('escalations.period_end', dateTo)

    type EntryRow = {
      id: string
      reason: string
      reason_notes: string | null
      action_taken: string | null
      store_id: string
      manager_id: string | null
      stores: { name: string } | null
      profiles: { full_name: string } | null
      expected_submission_id: string | null
      escalations: { status: string } | null
    }

    const rowsMap: Record<string, MissedRow> = {}
    for (const e of (expected ?? []) as any[]) {
      const storeRegion = e.stores?.regions?.name ?? ''
      if (regionFilter && storeRegion !== regionFilter) continue
      rowsMap[e.id] = {
        id: e.id,
        store_name: e.stores?.name ?? '—',
        manager_name: e.profiles?.full_name ?? '—',
        date: e.due_date,
        scheduled_time: e.due_time,
        reason: '—',
        reason_notes: null,
        action_taken: null,
        status: e.status,
      }
    }

    // Overlay reason data from missed_submission_entries
    for (const entry of (entries ?? []) as unknown as EntryRow[]) {
      if (entry.expected_submission_id && rowsMap[entry.expected_submission_id]) {
        rowsMap[entry.expected_submission_id].reason = entry.reason
        rowsMap[entry.expected_submission_id].reason_notes = entry.reason_notes
        rowsMap[entry.expected_submission_id].action_taken = entry.action_taken
        rowsMap[entry.expected_submission_id].status = entry.escalations?.status ?? 'missed'
      }
    }

    let result = Object.values(rowsMap)
    if (reasonFilter) result = result.filter(r => r.reason === reasonFilter)
    setRows(result)

    // Reason breakdown pie
    const reasonCounts: Record<string, number> = {}
    for (const r of result) {
      const key = r.reason === '—' ? 'other' : r.reason
      reasonCounts[key] = (reasonCounts[key] ?? 0) + 1
    }
    setReasonData(
      Object.entries(reasonCounts)
        .map(([k, v]) => ({ name: REASON_LABELS[k] ?? k, value: v, color: REASON_COLORS[k] ?? '#6b7280' }))
        .sort((a, b) => b.value - a.value)
    )

    // Trend: weekly missed over last 8 weeks
    const trend: TrendPoint[] = []
    const now = new Date()
    for (let i = 7; i >= 0; i--) {
      const ws = new Date(now)
      ws.setDate(now.getDate() - i * 7 - now.getDay())
      const we = new Date(ws); we.setDate(ws.getDate() + 6)
      const wsStr = ws.toISOString().split('T')[0]
      const weStr = we.toISOString().split('T')[0]
      const { count } = await supabase
        .from('expected_submissions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'missed')
        .gte('due_date', wsStr)
        .lte('due_date', weStr)
      trend.push({ week: `W-${i === 0 ? 'now' : i}`, count: count ?? 0 })
    }
    setTrendData(trend)

    setLoading(false)
  }, [dateFrom, dateTo, regionFilter, storeFilter, reasonFilter, supabase])

  useEffect(() => { if (profile) fetchData() }, [profile, fetchData])

  const handleExport = () => {
    exportToCSV(rows.map(r => ({
      Store: r.store_name,
      Manager: r.manager_name,
      Date: r.date,
      'Scheduled Time': r.scheduled_time ?? '',
      Reason: REASON_LABELS[r.reason] ?? r.reason,
      Notes: r.reason_notes ?? '',
      'Action Taken': r.action_taken ?? '',
      Status: r.status,
    })), 'missed-submissions-report')
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <XCircle className="h-6 w-6 text-red-500" />
            Missed Submissions Report
          </h1>
          <p className="text-sm text-gray-500 mt-1">Analyse missed submissions by store, reason and trend.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Region</label>
              <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">All Regions</option>
                {regions.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Store</label>
              <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">All Stores</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Reason</label>
              <select value={reasonFilter} onChange={e => setReasonFilter(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">All Reasons</option>
                {Object.entries(REASON_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4">
            <Button size="sm" variant="primary" onClick={fetchData} loading={loading}>
              <Filter className="h-4 w-4" />
              Apply Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Reason Pie */}
        <Card>
          <CardHeader><CardTitle>Missed by Reason</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={reasonData} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                  {reasonData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Trend Line */}
        <Card>
          <CardHeader><CardTitle>Missed Submissions Trend</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="count" name="Missed" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Missed Submissions Detail</CardTitle>
            <span className="text-sm text-gray-500">{rows.length} records</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <XCircle className="h-10 w-10 text-gray-200 mb-3" />
              <p className="text-sm text-gray-500">No missed submissions found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {['Store', 'Manager', 'Date', 'Scheduled Time', 'Reason', 'Action Taken', 'Status'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {rows.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 text-sm font-medium text-gray-900">{r.store_name}</td>
                      <td className="px-5 py-3 text-sm text-gray-600">{r.manager_name}</td>
                      <td className="px-5 py-3 text-sm text-gray-500">{formatDate(r.date)}</td>
                      <td className="px-5 py-3 text-sm text-gray-500">{r.scheduled_time ?? '—'}</td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ backgroundColor: `${REASON_COLORS[r.reason] ?? '#6b7280'}20`, color: REASON_COLORS[r.reason] ?? '#6b7280' }}>
                          {REASON_LABELS[r.reason] ?? r.reason}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-500 max-w-xs truncate">{r.action_taken ?? '—'}</td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 capitalize">
                          {r.status.replace(/_/g, ' ')}
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
