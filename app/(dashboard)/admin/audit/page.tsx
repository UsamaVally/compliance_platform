'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { ShieldCheck, ChevronDown, ChevronRight, Download } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/lib/hooks/useProfile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingPage } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDateTime } from '@/lib/utils'
import type { AuditLog } from '@/lib/types'

type AuditLogWithUser = AuditLog & {
  profiles: { full_name: string; email: string } | null
}

const ENTITY_TYPES = [
  'profiles', 'stores', 'regions', 'schedules', 'submissions',
  'expected_submissions', 'actions', 'notifications', 'organisations',
]

const ACTION_TYPES = [
  'user_updated', 'user_deactivated', 'user_activated',
  'store_created', 'store_updated', 'store_deactivated', 'store_activated',
  'region_created', 'region_updated',
  'schedule_created', 'schedule_updated',
  'submission_created', 'submission_draft_saved',
  'organisation_updated', 'organisation_data_reset',
  'action_created', 'action_updated',
]

export default function AuditPage() {
  const { profile: adminProfile, loading: profileLoading } = useProfile()

  const [logs, setLogs] = useState<AuditLogWithUser[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // Filters
  const [userFilter, setUserFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchLogs = useCallback(async () => {
    if (!adminProfile) return
    const supabase = createClient()

    let query = supabase
      .from('audit_logs')
      .select('*, profiles!user_id(full_name, email)')
      .eq('organisation_id', adminProfile.organisation_id)
      .order('created_at', { ascending: false })
      .limit(500)

    if (actionFilter) query = query.eq('action', actionFilter)
    if (entityFilter) query = query.eq('entity_type', entityFilter)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59')

    const { data } = await query
    setLogs((data ?? []) as AuditLogWithUser[])
    setLoading(false)
  }, [adminProfile, actionFilter, entityFilter, dateFrom, dateTo])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const filtered = logs.filter(log => {
    if (!userFilter) return true
    const name = log.profiles?.full_name?.toLowerCase() ?? ''
    const email = log.profiles?.email?.toLowerCase() ?? ''
    const search = userFilter.toLowerCase()
    return name.includes(search) || email.includes(search)
  })

  function toggleRow(id: string) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function formatJson(data: unknown): string {
    if (!data) return 'null'
    try {
      return JSON.stringify(data, null, 2)
    } catch {
      return String(data)
    }
  }

  function getChangesSummary(log: AuditLogWithUser): string {
    if (!log.new_data || typeof log.new_data !== 'object') return '—'
    const keys = Object.keys(log.new_data as object)
    if (keys.length === 0) return '—'
    return keys.slice(0, 3).join(', ') + (keys.length > 3 ? ` +${keys.length - 3} more` : '')
  }

  function exportCsv() {
    const headers = ['Date/Time', 'User', 'Action', 'Entity Type', 'Entity ID', 'Changes']
    const rows = filtered.map(log => [
      formatDateTime(log.created_at),
      log.profiles?.full_name ?? log.user_id ?? '',
      log.action,
      log.entity_type ?? '',
      log.entity_id ?? '',
      getChangesSummary(log),
    ])
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (profileLoading || loading) return <LoadingPage />

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Trail</h1>
          <p className="text-sm text-gray-500 mt-1">{filtered.length} entries</p>
        </div>
        <Button variant="outline" onClick={exportCsv}>
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <input
          type="text"
          placeholder="Filter by user…"
          value={userFilter}
          onChange={e => setUserFilter(e.target.value)}
          className="col-span-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <Select
          options={[{ value: '', label: 'All Actions' }, ...ACTION_TYPES.map(a => ({ value: a, label: a.replace(/_/g, ' ') }))]}
          placeholder="All Actions"
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
        />
        <Select
          options={[{ value: '', label: 'All Entities' }, ...ENTITY_TYPES.map(e => ({ value: e, label: e }))]}
          placeholder="All Entities"
          value={entityFilter}
          onChange={e => setEntityFilter(e.target.value)}
        />
        <Input
          type="date"
          label=""
          placeholder="From date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
        />
        <Input
          type="date"
          label=""
          placeholder="To date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState icon={ShieldCheck} title="No audit logs found" description="Try adjusting your filters." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-8 px-3 py-3" />
                    {['Date / Time', 'User', 'Action', 'Entity Type', 'Entity ID', 'Changes'].map(h => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {filtered.map(log => {
                    const isExpanded = expandedRows.has(log.id)
                    const hasDetails = log.old_data || log.new_data

                    return (
                      <React.Fragment key={log.id}>
                        <tr
                          className={`hover:bg-gray-50 transition-colors ${hasDetails ? 'cursor-pointer' : ''}`}
                          onClick={() => hasDetails && toggleRow(log.id)}
                        >
                          <td className="px-3 py-3 text-center">
                            {hasDetails && (
                              isExpanded
                                ? <ChevronDown className="h-3.5 w-3.5 text-gray-400 mx-auto" />
                                : <ChevronRight className="h-3.5 w-3.5 text-gray-400 mx-auto" />
                            )}
                          </td>
                          <td className="px-6 py-3 text-xs text-gray-500 whitespace-nowrap">
                            {formatDateTime(log.created_at)}
                          </td>
                          <td className="px-6 py-3 text-sm text-gray-700 whitespace-nowrap">
                            {log.profiles?.full_name ?? (
                              <span className="text-gray-400 italic">{log.user_id?.slice(0, 8) ?? 'System'}</span>
                            )}
                          </td>
                          <td className="px-6 py-3">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                              {log.action.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-sm text-gray-500">{log.entity_type ?? '—'}</td>
                          <td className="px-6 py-3 text-xs font-mono text-gray-400">
                            {log.entity_id ? log.entity_id.slice(0, 8) + '…' : '—'}
                          </td>
                          <td className="px-6 py-3 text-xs text-gray-500 max-w-xs truncate">
                            {getChangesSummary(log)}
                          </td>
                        </tr>

                        {isExpanded && hasDetails && (
                          <tr key={`${log.id}-detail`} className="bg-gray-50">
                            <td />
                            <td colSpan={6} className="px-6 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {log.old_data && (
                                  <div>
                                    <p className="text-xs font-semibold text-red-600 mb-2 uppercase tracking-wide">
                                      Before (old_data)
                                    </p>
                                    <pre className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 overflow-auto max-h-48 font-mono">
                                      {formatJson(log.old_data)}
                                    </pre>
                                  </div>
                                )}
                                {log.new_data && (
                                  <div>
                                    <p className="text-xs font-semibold text-green-600 mb-2 uppercase tracking-wide">
                                      After (new_data)
                                    </p>
                                    <pre className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 overflow-auto max-h-48 font-mono">
                                      {formatJson(log.new_data)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
