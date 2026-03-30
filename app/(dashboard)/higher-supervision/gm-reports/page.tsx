'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { FileText, Eye, CheckCircle, XCircle, Archive, Filter } from 'lucide-react'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Modal } from '@/components/ui/modal'
import { LoadingPage, LoadingCard } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate, formatDateTime } from '@/lib/utils'

interface GMReportRow {
  id: string
  period_start: string
  period_end: string
  status: string
  submitted_at: string | null
  submitted_by: string
  gm_name: string
  region_count: number
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'closed', label: 'Closed' },
  { value: 'draft', label: 'Draft' },
]

type ActionType = 'approve' | 'reject' | 'close' | null

export default function HSGMReportsPage() {
  const { profile, loading: profileLoading } = useProfile()
  const [reports, setReports] = useState<GMReportRow[]>([])
  const [loading, setLoading] = useState(true)

  const [gmOptions, setGmOptions] = useState<{ value: string; label: string }[]>([])
  const [gmFilter, setGmFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  // Action modal
  const [actionModal, setActionModal] = useState<{ open: boolean; reportId: string | null; type: ActionType }>({
    open: false, reportId: null, type: null,
  })
  const [actionNotes, setActionNotes] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState('')

  const fetchData = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const supabase = createClient()

    // All GMs
    const { data: gmsData } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'general_manager')
    const gms = (gmsData ?? []) as { id: string; full_name: string }[]
    const gmMap = Object.fromEntries(gms.map(g => [g.id, g.full_name]))
    const gmIds = gms.map(g => g.id)
    setGmOptions([{ value: '', label: 'All GMs' }, ...gms.map(g => ({ value: g.id, label: g.full_name }))])

    // Region counts per GM
    const { data: regionsData } = await supabase
      .from('regions')
      .select('id, general_manager_id')
    const regions = (regionsData ?? []) as { id: string; general_manager_id: string | null }[]
    const gmRegionCount: Record<string, number> = {}
    for (const r of regions) {
      if (r.general_manager_id) gmRegionCount[r.general_manager_id] = (gmRegionCount[r.general_manager_id] ?? 0) + 1
    }

    if (gmIds.length === 0) { setReports([]); setLoading(false); return }

    const targetGMs = gmFilter ? [gmFilter] : gmIds

    let query = supabase
      .from('escalations')
      .select('id, submitted_by, status, submitted_at, period_start, period_end')
      .eq('escalation_type', 'gm_report')
      .in('submitted_by', targetGMs)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    if (statusFilter) query = query.eq('status', statusFilter)
    if (fromDate) query = query.gte('period_start', fromDate)
    if (toDate) query = query.lte('period_end', toDate)

    const { data: escsData } = await query
    type EscRow = { id: string; submitted_by: string; status: string; submitted_at: string | null; period_start: string; period_end: string }
    const escs = (escsData ?? []) as EscRow[]

    const rows: GMReportRow[] = escs.map(e => ({
      id: e.id,
      period_start: e.period_start,
      period_end: e.period_end,
      status: e.status,
      submitted_at: e.submitted_at,
      submitted_by: e.submitted_by,
      gm_name: gmMap[e.submitted_by] ?? 'Unknown',
      region_count: gmRegionCount[e.submitted_by] ?? 0,
    }))

    setReports(rows)
    setLoading(false)
  }, [profile, gmFilter, statusFilter, fromDate, toDate])

  useEffect(() => {
    if (profile) fetchData()
  }, [profile, fetchData])

  async function handleAction() {
    if (!actionModal.reportId || !profile || !actionModal.type) return
    setActionLoading(true)
    setActionError('')
    const supabase = createClient()

    const statusMap: Record<string, string> = {
      approve: 'approved',
      reject: 'rejected',
      close: 'closed',
    }
    const newStatus = statusMap[actionModal.type]

    const { error } = await supabase
      .from('escalations')
      .update({
        status: newStatus,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        review_notes: actionNotes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', actionModal.reportId)

    if (error) {
      setActionError('Failed to update report. Please try again.')
      setActionLoading(false)
      return
    }

    await supabase.from('audit_logs').insert({
      organisation_id: profile.organisation_id,
      user_id: profile.id,
      action: `gm_report_${actionModal.type}d`,
      entity_type: 'escalation',
      entity_id: actionModal.reportId,
      new_data: { status: newStatus, notes: actionNotes },
    })

    // Notify GM
    const report = reports.find(r => r.id === actionModal.reportId)
    if (report) {
      await supabase.from('notifications').insert({
        organisation_id: profile.organisation_id,
        user_id: report.submitted_by,
        type: 'gm_report_reviewed',
        title: `Your GM report has been ${newStatus}`,
        message: actionNotes.trim() || `Your GM report for ${formatDate(report.period_start)} – ${formatDate(report.period_end)} has been ${newStatus}.`,
        related_entity_type: 'escalation',
        related_entity_id: report.id,
      })
    }

    setActionLoading(false)
    setActionModal({ open: false, reportId: null, type: null })
    setActionNotes('')
    fetchData()
  }

  function openAction(reportId: string, type: ActionType) {
    setActionModal({ open: true, reportId, type })
    setActionNotes('')
    setActionError('')
  }

  const modalTitle = {
    approve: 'Approve GM Report',
    reject: 'Reject GM Report',
    close: 'Close GM Report',
    null: '',
  }

  if (profileLoading) return <LoadingPage />

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">GM Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Review and action weekly GM summary reports</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
            <Filter className="h-4 w-4" />
            <span className="font-medium">Filters</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <select
              value={gmFilter}
              onChange={e => setGmFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {gmOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} placeholder="From date" />
            <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} placeholder="To date" />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            GM Reports
            {reports.length > 0 && (
              <span className="text-sm font-normal text-gray-500 ml-1">({reports.length})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <LoadingCard />
          ) : reports.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState
                icon={FileText}
                title="No GM reports found"
                description="No GM reports match your current filters."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Period</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">GM Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Regions Covered</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted At</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {reports.map(report => {
                    const isReviewable = report.status === 'submitted' || report.status === 'under_review'
                    return (
                      <tr key={report.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-3 text-sm text-gray-900 whitespace-nowrap">
                          {formatDate(report.period_start)} – {formatDate(report.period_end)}
                        </td>
                        <td className="px-6 py-3 text-sm font-medium text-gray-900">{report.gm_name}</td>
                        <td className="px-6 py-3 text-sm text-gray-600">{report.region_count}</td>
                        <td className="px-6 py-3 text-sm text-gray-500">
                          {report.submitted_at ? formatDateTime(report.submitted_at) : <span className="text-gray-400">Not submitted</span>}
                        </td>
                        <td className="px-6 py-3">
                          <StatusBadge status={report.status} />
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Link href={`/higher-supervision/gm-reports/${report.id}`}>
                              <Button size="sm" variant="ghost">
                                <Eye className="h-3.5 w-3.5" />
                                Review
                              </Button>
                            </Link>
                            {isReviewable && (
                              <>
                                <Button size="sm" variant="outline" className="text-green-700 border-green-300 hover:bg-green-50"
                                  onClick={() => openAction(report.id, 'approve')}>
                                  <CheckCircle className="h-3.5 w-3.5" />
                                  Approve
                                </Button>
                                <Button size="sm" variant="outline" className="text-red-700 border-red-300 hover:bg-red-50"
                                  onClick={() => openAction(report.id, 'reject')}>
                                  <XCircle className="h-3.5 w-3.5" />
                                  Reject
                                </Button>
                              </>
                            )}
                            {(report.status === 'approved' || report.status === 'rejected') && (
                              <Button size="sm" variant="outline"
                                onClick={() => openAction(report.id, 'close')}>
                                <Archive className="h-3.5 w-3.5" />
                                Close
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Modal */}
      <Modal
        isOpen={actionModal.open}
        onClose={() => setActionModal({ open: false, reportId: null, type: null })}
        title={modalTitle[actionModal.type ?? 'null']}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {actionModal.type === 'approve' && 'Confirm you want to approve this GM report. The GM will be notified.'}
            {actionModal.type === 'reject' && 'Provide a reason for rejection. The GM will be notified.'}
            {actionModal.type === 'close' && 'Close this report to archive it. No further actions will be possible.'}
          </p>
          <Textarea
            label={actionModal.type === 'approve' ? 'Notes (optional)' : 'Notes'}
            required={actionModal.type !== 'approve'}
            value={actionNotes}
            onChange={e => setActionNotes(e.target.value)}
            placeholder={
              actionModal.type === 'approve' ? 'Any additional comments...' :
              actionModal.type === 'reject' ? 'Explain why this report is being rejected...' :
              'Closure notes...'
            }
            rows={3}
          />
          {actionError && <p className="text-sm text-red-600">{actionError}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setActionModal({ open: false, reportId: null, type: null })}>Cancel</Button>
            <Button
              variant={actionModal.type === 'reject' ? 'danger' : 'primary'}
              loading={actionLoading}
              onClick={handleAction}
            >
              {actionModal.type === 'approve' && <><CheckCircle className="h-4 w-4" />Approve</>}
              {actionModal.type === 'reject' && <><XCircle className="h-4 w-4" />Reject</>}
              {actionModal.type === 'close' && <><Archive className="h-4 w-4" />Close Report</>}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
