'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  AlertTriangle,
  Download,
  Flag,
  History,
  RefreshCw,
  Search,
  ShieldAlert,
  TrendingDown,
  Users,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge } from '@/components/ui/status-badge'
import { StatCard } from '@/components/ui/stat-card'
import { exportToCSV } from '@/lib/export'
import { formatDate, formatDateTime, cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OffenderRow {
  store_id: string
  store_name: string
  store_code: string
  manager_name: string
  manager_id: string
  region: string
  miss_count: number
  last_miss_date: string
  action_status: string | null
  action_id: string | null
  missed_records: any[]
}

interface FlagModalState {
  open: boolean
  store: OffenderRow | null
  title: string
  due_date: string
  assigned_to: string
  notes: string
  submitting: boolean
}

interface HistoryModalState {
  open: boolean
  store: OffenderRow | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWindowStart(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().split('T')[0]
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RepeatOffendersPage() {
  const supabase = createClient()

  // ── Filters ──
  const [threshold, setThreshold] = useState(3)
  const [windowDays, setWindowDays] = useState(30)
  const [regionFilter, setRegionFilter] = useState('')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [regions, setRegions] = useState<{ value: string; label: string }[]>([])

  // ── Data ──
  const [offenders, setOffenders] = useState<OffenderRow[]>([])
  const [loading, setLoading] = useState(true)

  // ── Modals ──
  const [flagModal, setFlagModal] = useState<FlagModalState>({
    open: false, store: null, title: '', due_date: '', assigned_to: '', notes: '', submitting: false,
  })
  const [historyModal, setHistoryModal] = useState<HistoryModalState>({ open: false, store: null })

  // ── Fetch regions ──
  useEffect(() => {
    async function loadRegions() {
      const { data } = await supabase.from('regions').select('id, name').order('name')
      if (data) {
        setRegions([
          { value: '', label: 'All Regions' },
          ...data.map((r: any) => ({ value: r.id, label: r.name })),
        ])
      }
    }
    loadRegions()
  }, [])

  // ── Fetch offenders ──
  const fetchOffenders = useCallback(async () => {
    setLoading(true)

    const windowStart = dateFrom || getWindowStart(windowDays)
    const windowEnd = dateTo || new Date().toISOString().split('T')[0]

    // Get all missed expected_submissions in the window
    let query = supabase
      .from('expected_submissions')
      .select(`
        id,
        store_id,
        due_date,
        stores!inner(id, name, code, region_id, regions(name), profiles!store_manager_id(id, full_name))
      `)
      .eq('status', 'missed')
      .gte('due_date', windowStart)
      .lte('due_date', windowEnd)

    if (regionFilter) {
      query = query.eq('stores.region_id', regionFilter)
    }

    const { data: missedData, error } = await query

    if (error) {
      console.error('Error fetching missed submissions:', error)
      setLoading(false)
      return
    }

    // Group by store_id
    const grouped: Record<string, any[]> = {}
    for (const row of missedData ?? []) {
      if (!grouped[row.store_id]) grouped[row.store_id] = []
      grouped[row.store_id].push(row)
    }

    // Get open actions per store
    const storeIds = Object.keys(grouped)
    let actionMap: Record<string, { status: string; id: string }> = {}
    if (storeIds.length > 0) {
      const { data: actions } = await supabase
        .from('actions')
        .select('id, store_id, status')
        .in('store_id', storeIds)
        .in('status', ['open', 'in_progress'])
        .order('created_at', { ascending: false })

      for (const a of actions ?? []) {
        if (!actionMap[a.store_id]) {
          actionMap[a.store_id] = { status: a.status, id: a.id }
        }
      }
    }

    // Build offender rows
    const rows: OffenderRow[] = []
    for (const [storeId, records] of Object.entries(grouped)) {
      if (records.length < threshold) continue

      const firstRecord = records[0]
      const store = firstRecord.stores as any
      const sortedByDate = [...records].sort((a, b) =>
        new Date(b.due_date).getTime() - new Date(a.due_date).getTime()
      )

      rows.push({
        store_id: storeId,
        store_name: store?.name ?? 'Unknown',
        store_code: store?.code ?? '',
        manager_name: store?.profiles?.full_name ?? 'Unassigned',
        manager_id: store?.profiles?.id ?? '',
        region: store?.regions?.name ?? 'Unknown',
        miss_count: records.length,
        last_miss_date: sortedByDate[0]?.due_date ?? '',
        action_status: actionMap[storeId]?.status ?? null,
        action_id: actionMap[storeId]?.id ?? null,
        missed_records: sortedByDate,
      })
    }

    // Sort by miss count descending
    rows.sort((a, b) => b.miss_count - a.miss_count)
    setOffenders(rows)
    setLoading(false)
  }, [threshold, windowDays, regionFilter, dateFrom, dateTo])

  useEffect(() => {
    fetchOffenders()
  }, [fetchOffenders])

  // ── Stats ──
  const totalRepeatOffenders = offenders.length
  const totalMisses = offenders.reduce((s, o) => s + o.miss_count, 0)
  const highestMissCount = offenders.length > 0 ? offenders[0].miss_count : 0
  const storesWithOpenActions = offenders.filter(o => o.action_status !== null).length

  // ── Chart data: top 10 ──
  const chartData = offenders.slice(0, 10).map(o => ({
    name: o.store_code || o.store_name.slice(0, 10),
    misses: o.miss_count,
  }))

  // ── Flag for action ──
  function openFlagModal(store: OffenderRow) {
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 7)
    setFlagModal({
      open: true,
      store,
      title: `Compliance Action - ${store.store_name} (${store.miss_count} misses)`,
      due_date: dueDate.toISOString().split('T')[0],
      assigned_to: store.manager_id,
      notes: `Store ${store.store_name} has missed ${store.miss_count} submissions in the past ${windowDays} days. Immediate review and corrective action required.`,
      submitting: false,
    })
  }

  async function submitFlagAction() {
    if (!flagModal.store) return
    setFlagModal(prev => ({ ...prev, submitting: true }))

    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from('actions').insert({
      title: flagModal.title,
      store_id: flagModal.store.store_id,
      assigned_to: flagModal.assigned_to || null,
      due_date: flagModal.due_date || null,
      notes: flagModal.notes,
      status: 'open',
      created_by: user?.id,
      source: 'repeat_offender_flag',
    })

    setFlagModal(prev => ({ ...prev, submitting: false, open: false }))
    fetchOffenders()
  }

  // ── Export CSV ──
  function handleExport() {
    const rows = offenders.map(o => ({
      Store: o.store_name,
      Code: o.store_code,
      Manager: o.manager_name,
      Region: o.region,
      'Misses in Period': o.miss_count,
      'Last Miss Date': o.last_miss_date,
      'Action Status': o.action_status ?? 'None',
    }))
    exportToCSV(rows, 'repeat-offenders')
  }

  // ── Row color ──
  function rowBg(count: number) {
    if (count >= threshold) return 'bg-red-50 hover:bg-red-100'
    if (count >= threshold - 1) return 'bg-yellow-50 hover:bg-yellow-100'
    return 'hover:bg-gray-50'
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-red-500" />
            Repeat Offender Tracking
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Identify stores repeatedly missing scheduled submissions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchOffenders} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={offenders.length === 0}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* ── Filters ── */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Miss Threshold</label>
              <input
                type="number"
                min={1}
                max={20}
                value={threshold}
                onChange={e => setThreshold(Number(e.target.value))}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Within Days</label>
              <input
                type="number"
                min={7}
                max={365}
                value={windowDays}
                onChange={e => setWindowDays(Number(e.target.value))}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <Select
              label="Region"
              value={regionFilter}
              onChange={e => setRegionFilter(e.target.value)}
              options={regions.length ? regions : [{ value: '', label: 'All Regions' }]}
            />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date To</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <Button onClick={fetchOffenders} loading={loading} variant="primary" className="w-full">
              <Search className="h-4 w-4" />
              Apply Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Stats ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Repeat Offenders"
          value={totalRepeatOffenders}
          subtitle={`Stores with ${threshold}+ misses`}
          icon={AlertTriangle}
          iconColor="text-red-600"
          iconBg="bg-red-50"
        />
        <StatCard
          title="Total Misses in Period"
          value={totalMisses}
          subtitle={`Last ${windowDays} days`}
          icon={TrendingDown}
          iconColor="text-orange-600"
          iconBg="bg-orange-50"
        />
        <StatCard
          title="Highest Single Store"
          value={highestMissCount}
          subtitle="Worst performing store"
          icon={ShieldAlert}
          iconColor="text-red-700"
          iconBg="bg-red-100"
        />
        <StatCard
          title="Stores With Open Actions"
          value={storesWithOpenActions}
          subtitle="Already flagged"
          icon={Users}
          iconColor="text-indigo-600"
          iconBg="bg-indigo-50"
        />
      </div>

      {/* ── Bar Chart: Top 10 ── */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top 10 Stores by Miss Count</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip formatter={(v: any) => [v, 'Missed Submissions']} />
                <Bar dataKey="misses" name="Misses" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Main Table ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Repeat Offender Stores</CardTitle>
            <span className="text-sm text-gray-500">
              {offenders.length} store{offenders.length !== 1 ? 's' : ''} found
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="h-6 w-6 animate-spin text-indigo-400" />
            </div>
          ) : offenders.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title="No repeat offenders found"
              description={`No stores have missed ${threshold} or more submissions in the selected period.`}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {['Store', 'Manager', 'Region', 'Misses', 'Last Miss', 'Action Status', 'Actions'].map(h => (
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
                  {offenders.map(row => (
                    <tr key={row.store_id} className={cn('transition-colors', rowBg(row.miss_count))}>
                      <td className="px-5 py-3">
                        <div className="font-medium text-sm text-gray-900">{row.store_name}</div>
                        {row.store_code && (
                          <div className="text-xs text-gray-500">{row.store_code}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-700">{row.manager_name}</td>
                      <td className="px-5 py-3 text-sm text-gray-700">{row.region}</td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold',
                            row.miss_count >= threshold
                              ? 'bg-red-100 text-red-700'
                              : 'bg-yellow-100 text-yellow-700'
                          )}
                        >
                          {row.miss_count}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">
                        {row.last_miss_date ? formatDate(row.last_miss_date) : '—'}
                      </td>
                      <td className="px-5 py-3">
                        {row.action_status ? (
                          <StatusBadge status={row.action_status} />
                        ) : (
                          <span className="text-xs text-gray-400">No action</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => openFlagModal(row)}
                          >
                            <Flag className="h-3.5 w-3.5" />
                            Flag
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setHistoryModal({ open: true, store: row })}
                          >
                            <History className="h-3.5 w-3.5" />
                            History
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

      {/* ── Flag for Action Modal ── */}
      <Modal
        isOpen={flagModal.open}
        onClose={() => setFlagModal(prev => ({ ...prev, open: false }))}
        title={`Flag for Action — ${flagModal.store?.store_name}`}
        size="lg"
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            <strong>{flagModal.store?.store_name}</strong> has missed{' '}
            <strong>{flagModal.store?.miss_count}</strong> submissions in the past {windowDays} days.
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Action Title</label>
            <input
              type="text"
              value={flagModal.title}
              onChange={e => setFlagModal(prev => ({ ...prev, title: e.target.value }))}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assigned To (User ID)</label>
            <input
              type="text"
              value={flagModal.assigned_to}
              onChange={e => setFlagModal(prev => ({ ...prev, assigned_to: e.target.value }))}
              placeholder="Manager profile ID (pre-filled if available)"
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
            <input
              type="date"
              value={flagModal.due_date}
              onChange={e => setFlagModal(prev => ({ ...prev, due_date: e.target.value }))}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={3}
              value={flagModal.notes}
              onChange={e => setFlagModal(prev => ({ ...prev, notes: e.target.value }))}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
            <Button
              variant="outline"
              onClick={() => setFlagModal(prev => ({ ...prev, open: false }))}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={flagModal.submitting}
              onClick={submitFlagAction}
            >
              <Flag className="h-4 w-4" />
              Create Action
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── History Modal ── */}
      <Modal
        isOpen={historyModal.open}
        onClose={() => setHistoryModal({ open: false, store: null })}
        title={`Miss History — ${historyModal.store?.store_name}`}
        size="xl"
      >
        {historyModal.store && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span>Manager: <strong>{historyModal.store.manager_name}</strong></span>
              <span>Region: <strong>{historyModal.store.region}</strong></span>
              <span className="ml-auto text-red-600 font-semibold">
                {historyModal.store.miss_count} total misses in period
              </span>
            </div>

            {/* Timeline */}
            <div className="relative pl-6">
              <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-red-200" />
              <div className="space-y-3">
                {historyModal.store.missed_records.map((record: any, i: number) => (
                  <div key={record.id ?? i} className="relative">
                    <div className="absolute -left-4 top-1.5 w-3 h-3 rounded-full bg-red-400 border-2 border-white" />
                    <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-red-800">
                          Missed — {record.due_date ? formatDate(record.due_date) : '—'}
                        </span>
                        <span className="text-xs text-red-500 bg-red-100 px-2 py-0.5 rounded-full">
                          Missed
                        </span>
                      </div>
                      {record.schedules?.name && (
                        <p className="text-xs text-red-600 mt-1">Schedule: {record.schedules.name}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-gray-100">
              <Button variant="outline" onClick={() => setHistoryModal({ open: false, store: null })}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
