'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Search, Download, ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingPage, LoadingCard } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { Submission, Store, FormTemplate, SubmissionStatus } from '@/lib/types'

type SubmissionRow = Submission & {
  stores: Store | null
  form_templates: FormTemplate | null
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'submitted_on_time', label: 'Submitted On Time' },
  { value: 'submitted_late', label: 'Submitted Late' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'closed', label: 'Closed' },
]

const PAGE_SIZE = 10

export default function SubmissionHistoryPage() {
  const { profile, loading: profileLoading } = useProfile()

  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [storeId, setStoreId] = useState<string | null>(null)

  // Filters
  const [statusFilter, setStatusFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const fetchSubmissions = useCallback(async (sid: string) => {
    setLoading(true)
    const supabase = createClient()

    let query = supabase
      .from('submissions')
      .select('*, stores(*), form_templates(*)', { count: 'exact' })
      .eq('store_id', sid)
      .order('created_at', { ascending: false })

    if (statusFilter) {
      query = query.eq('status', statusFilter as SubmissionStatus)
    }
    if (fromDate) {
      query = query.gte('created_at', fromDate)
    }
    if (toDate) {
      // Include full day
      query = query.lte('created_at', `${toDate}T23:59:59.999Z`)
    }

    // Pagination
    const from = (page - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    query = query.range(from, to)

    const { data, count } = await query

    let rows = (data ?? []) as SubmissionRow[]

    // Client-side search by store name
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(r => r.stores?.name?.toLowerCase().includes(q) || r.form_templates?.name?.toLowerCase().includes(q))
    }

    setSubmissions(rows)
    setTotalCount(count ?? 0)
    setLoading(false)
  }, [statusFilter, fromDate, toDate, search, page])

  // Get store assignment first
  useEffect(() => {
    if (!profile) return
    async function getStore() {
      const supabase = createClient()
      const { data } = await supabase
        .from('user_store_assignments')
        .select('store_id')
        .eq('user_id', profile.id)
        .eq('is_primary', true)
        .single()
      if (data?.store_id) {
        setStoreId(data.store_id)
      } else {
        setLoading(false)
      }
    }
    getStore()
  }, [profile])

  useEffect(() => {
    if (!storeId) return
    fetchSubmissions(storeId)
  }, [storeId, fetchSubmissions])

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  function handleFilterChange() {
    setPage(1)
  }

  function exportCSV() {
    if (!submissions.length) return

    const headers = ['Date', 'Form Name', 'Status', 'Submitted At', 'Is Late', 'Store']
    const rows = submissions.map(s => [
      formatDate(s.created_at),
      s.form_templates?.name ?? '',
      s.status,
      s.submitted_at ? formatDateTime(s.submitted_at) : '',
      s.is_late ? 'Yes' : 'No',
      s.stores?.name ?? '',
    ])

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `submissions-${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (profileLoading) return <LoadingPage />

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Submission History</h1>
          <p className="text-sm text-gray-500 mt-1">All compliance form submissions for your store</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCSV} disabled={submissions.length === 0}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search by store or form..."
                value={search}
                onChange={e => { setSearch(e.target.value); handleFilterChange() }}
                className="block w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); handleFilterChange() }}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {/* From date */}
            <Input
              type="date"
              value={fromDate}
              onChange={e => { setFromDate(e.target.value); handleFilterChange() }}
              placeholder="From date"
            />

            {/* To date */}
            <Input
              type="date"
              value={toDate}
              onChange={e => { setToDate(e.target.value); handleFilterChange() }}
              placeholder="To date"
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              Submissions{' '}
              {totalCount > 0 && (
                <span className="text-sm font-normal text-gray-500 ml-1">({totalCount} total)</span>
              )}
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <LoadingCard />
          ) : submissions.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState
                icon={ClipboardList}
                title="No submissions found"
                description="No submissions match your current filters. Try adjusting the search or date range."
              />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Form Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted At</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Late</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {submissions.map(submission => (
                      <tr key={submission.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3 text-sm text-gray-700 whitespace-nowrap">
                          {formatDate(submission.created_at)}
                        </td>
                        <td className="px-6 py-3 text-sm text-gray-900 max-w-xs">
                          <div className="truncate">{submission.form_templates?.name ?? '—'}</div>
                          <div className="text-xs text-gray-400 truncate">{submission.stores?.name ?? '—'}</div>
                        </td>
                        <td className="px-6 py-3">
                          <StatusBadge status={submission.status} />
                        </td>
                        <td className="px-6 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {submission.submitted_at ? formatDateTime(submission.submitted_at) : '—'}
                        </td>
                        <td className="px-6 py-3 text-sm">
                          {submission.is_late ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Late</span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">On Time</span>
                          )}
                        </td>
                        <td className="px-6 py-3">
                          <Link href={`/branch-manager/submissions/${submission.id}`}>
                            <Button size="sm" variant="ghost">View</Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
                  <p className="text-sm text-gray-500">
                    Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <span className="text-sm text-gray-700 px-2">
                      Page {page} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
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
