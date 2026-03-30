'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Activity,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { EmptyState } from '@/components/ui/empty-state'
import { exportToCSV } from '@/lib/export'
import { formatDateTime, formatDate, cn } from '@/lib/utils'

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20

const ACTION_TYPE_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'submission_created', label: 'Submission Created' },
  { value: 'submission_draft_saved', label: 'Draft Saved' },
  { value: 'escalation_submitted', label: 'Escalation Submitted' },
  { value: 'action_created', label: 'Action Created' },
  { value: 'action_updated', label: 'Action Updated' },
  { value: 'user_invited', label: 'User Invited' },
  { value: 'store_created', label: 'Store Created' },
  { value: 'login', label: 'Login' },
]

const ENTITY_TYPE_OPTIONS = [
  { value: '', label: 'All Entities' },
  { value: 'submissions', label: 'Submissions' },
  { value: 'escalations', label: 'Escalations' },
  { value: 'actions', label: 'Actions' },
  { value: 'profiles', label: 'Profiles' },
  { value: 'stores', label: 'Stores' },
]

function formatActionLabel(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuditTrailPage() {
  const supabase = createClient()

  // ── Filters ──
  const [userSearch, setUserSearch] = useState('')
  const [actionType, setActionType] = useState('')
  const [entityType, setEntityType] = useState('')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])

  // ── Data ──
  const [logs, setLogs] = useState<any[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // ── Stats ──
  const [todayLogs, setTodayLogs] = useState(0)
  const [uniqueUsersToday, setUniqueUsersToday] = useState(0)
  const [mostActiveUser, setMostActiveUser] = useState('—')

  // ── Fetch logs ──
  const fetchLogs = useCallback(async (pageNum = 0) => {
    setLoading(true)

    const from = pageNum * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabase
      .from('audit_logs')
      .select(`
        *,
        profiles(full_name, email, role)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)

    if (actionType) query = query.eq('action', actionType)
    if (entityType) query = query.eq('entity_type', entityType)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) {
      const toEnd = dateTo + 'T23:59:59'
      query = query.lte('created_at', toEnd)
    }

    const { data, count, error } = await query

    if (!error) {
      let filtered = data ?? []

      // Client-side filter for user search (full_name)
      if (userSearch.trim()) {
        const lower = userSearch.toLowerCase()
        filtered = filtered.filter((log: any) =>
          log.profiles?.full_name?.toLowerCase().includes(lower) ||
          log.profiles?.email?.toLowerCase().includes(lower)
        )
      }

      setLogs(filtered)
      setTotalCount(count ?? 0)
    }

    setLoading(false)
  }, [actionType, entityType, dateFrom, dateTo, userSearch])

  // ── Fetch today stats ──
  const fetchTodayStats = useCallback(async () => {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('audit_logs')
      .select('user_id, profiles(full_name)')
      .gte('created_at', today)

    if (!data) return

    setTodayLogs(data.length)

    const userSet = new Set(data.map((l: any) => l.user_id))
    setUniqueUsersToday(userSet.size)

    const userCounts: Record<string, { name: string; count: number }> = {}
    for (const log of data) {
      const uid = log.user_id ?? 'unknown'
      const name = (log as any).profiles?.full_name ?? 'Unknown'
      if (!userCounts[uid]) userCounts[uid] = { name, count: 0 }
      userCounts[uid].count++
    }
    const top = Object.values(userCounts).sort((a, b) => b.count - a.count)[0]
    setMostActiveUser(top ? `${top.name} (${top.count})` : '—')
  }, [])

  useEffect(() => {
    setPage(0)
    fetchLogs(0)
    fetchTodayStats()
  }, [fetchLogs, fetchTodayStats])

  function handleApplyFilters() {
    setPage(0)
    fetchLogs(0)
  }

  function handlePageChange(newPage: number) {
    setPage(newPage)
    fetchLogs(newPage)
  }

  function toggleRow(id: string) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleExport() {
    const rows = logs.map(log => ({
      Timestamp: formatDateTime(log.created_at),
      User: log.profiles?.full_name ?? 'Unknown',
      Role: log.profiles?.role ?? '—',
      Action: formatActionLabel(log.action ?? ''),
      'Entity Type': log.entity_type ?? '—',
      Description: log.description ?? '—',
    }))
    exportToCSV(rows, 'audit-trail')
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-indigo-600" />
            Audit Trail
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Complete log of all system actions and changes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { setPage(0); fetchLogs(0); fetchTodayStats() }} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={logs.length === 0}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Log Entries Today"
          value={todayLogs}
          subtitle="All actions recorded today"
          icon={Activity}
          iconColor="text-indigo-600"
          iconBg="bg-indigo-50"
        />
        <StatCard
          title="Unique Users Today"
          value={uniqueUsersToday}
          subtitle="Distinct users active today"
          icon={Users}
          iconColor="text-green-600"
          iconBg="bg-green-50"
        />
        <StatCard
          title="Most Active User"
          value={mostActiveUser}
          subtitle="Today's highest activity"
          icon={Activity}
          iconColor="text-orange-600"
          iconBg="bg-orange-50"
        />
      </div>

      {/* ── Filters ── */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <Input
              label="User Search"
              placeholder="Search by name or email…"
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
            />
            <Select
              label="Action Type"
              value={actionType}
              onChange={e => setActionType(e.target.value)}
              options={ACTION_TYPE_OPTIONS}
            />
            <Select
              label="Entity Type"
              value={entityType}
              onChange={e => setEntityType(e.target.value)}
              options={ENTITY_TYPE_OPTIONS}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date To</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <Button onClick={handleApplyFilters} loading={loading} variant="primary" className="w-full">
              <Search className="h-4 w-4" />
              Apply Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Table ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Audit Log Entries</CardTitle>
            <span className="text-sm text-gray-500">
              {totalCount.toLocaleString()} total entries
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="h-6 w-6 animate-spin text-indigo-400" />
            </div>
          ) : logs.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No audit entries found"
              description="No log entries match your current filters."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="w-8 px-3 py-3" />
                      {['Timestamp', 'User', 'Role', 'Action', 'Entity Type', 'Description'].map(h => (
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
                    {logs.map(log => {
                      const isExpanded = expandedRows.has(log.id)
                      const hasDetails = log.old_data || log.new_data
                      return (
                        <>
                          <tr
                            key={log.id}
                            className={cn(
                              'hover:bg-gray-50 transition-colors',
                              hasDetails && 'cursor-pointer'
                            )}
                            onClick={() => hasDetails && toggleRow(log.id)}
                          >
                            <td className="px-3 py-3 text-center">
                              {hasDetails ? (
                                isExpanded
                                  ? <ChevronDown className="h-4 w-4 text-gray-400 mx-auto" />
                                  : <ChevronRight className="h-4 w-4 text-gray-400 mx-auto" />
                              ) : null}
                            </td>
                            <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">
                              {log.created_at ? formatDateTime(log.created_at) : '—'}
                            </td>
                            <td className="px-5 py-3">
                              <div className="text-sm font-medium text-gray-900">
                                {log.profiles?.full_name ?? 'System'}
                              </div>
                              <div className="text-xs text-gray-400">{log.profiles?.email ?? ''}</div>
                            </td>
                            <td className="px-5 py-3">
                              <span className="text-xs font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                                {log.profiles?.role ?? '—'}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-sm text-gray-700">
                              {formatActionLabel(log.action ?? '—')}
                            </td>
                            <td className="px-5 py-3">
                              {log.entity_type ? (
                                <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                                  {log.entity_type}
                                </span>
                              ) : '—'}
                            </td>
                            <td className="px-5 py-3 text-sm text-gray-600 max-w-xs">
                              <span className="line-clamp-2">
                                {log.description ?? '—'}
                              </span>
                            </td>
                          </tr>

                          {/* ── Expanded Row: JSON diff ── */}
                          {isExpanded && hasDetails && (
                            <tr key={`${log.id}-expanded`} className="bg-gray-50">
                              <td />
                              <td colSpan={6} className="px-5 py-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  {log.old_data && (
                                    <div>
                                      <p className="text-xs font-semibold text-red-700 mb-2 uppercase tracking-wide">
                                        Previous Data
                                      </p>
                                      <pre className="text-xs bg-red-50 border border-red-200 rounded-lg p-3 overflow-x-auto text-red-800 whitespace-pre-wrap max-h-56">
                                        {JSON.stringify(log.old_data, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                  {log.new_data && (
                                    <div>
                                      <p className="text-xs font-semibold text-green-700 mb-2 uppercase tracking-wide">
                                        New Data
                                      </p>
                                      <pre className="text-xs bg-green-50 border border-green-200 rounded-lg p-3 overflow-x-auto text-green-800 whitespace-pre-wrap max-h-56">
                                        {JSON.stringify(log.new_data, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* ── Pagination ── */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 bg-gray-50">
                  <p className="text-sm text-gray-500">
                    Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of{' '}
                    {totalCount.toLocaleString()} entries
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page === 0 || loading}
                      onClick={() => handlePageChange(page - 1)}
                    >
                      Previous
                    </Button>
                    <span className="text-sm text-gray-600 px-2">
                      Page {page + 1} of {totalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page >= totalPages - 1 || loading}
                      onClick={() => handlePageChange(page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
