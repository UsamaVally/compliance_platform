'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft,
  CheckCircle,
  XCircle,
  MessageSquare,
  Archive,
  FileText,
  BarChart2,
  Store as StoreIcon,
  AlertTriangle,
  User,
  Clock,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
} from 'lucide-react'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { ComplianceBar } from '@/components/ui/compliance-bar'
import { LoadingPage } from '@/components/ui/loading'
import { formatDate, formatDateTime } from '@/lib/utils'

interface RMPerformanceEntry {
  rm_name: string
  region_name: string
  submitted: boolean
  on_time: boolean | null
  action_taken: string
}

interface BranchMissedEntry {
  store_name: string
  region_name: string
  missed_count: number
}

interface UnresolvedIssue {
  id: string
  type: string
  title: string
  status: string
  resolved?: boolean
}

interface RegionTrend {
  region_name: string
  this_week: number
  last_week: number
}

interface GMReportContent {
  rm_performance?: RMPerformanceEntry[]
  branch_missed?: BranchMissedEntry[]
  unresolved_issues?: UnresolvedIssue[]
  escalation_notes?: string
  overall_compliance_this_week?: number
  overall_compliance_last_week?: number
  region_trends?: RegionTrend[]
  summary_comments?: string
  action_items_for_hs?: string
}

interface AuditEntry {
  id: string
  action: string
  created_at: string
  user_id: string | null
  new_data: Record<string, unknown> | null
  actor_name?: string
}

interface ReportDetail {
  id: string
  period_start: string
  period_end: string
  status: string
  submitted_at: string | null
  reviewed_at: string | null
  review_notes: string | null
  content: GMReportContent
  submitted_by: string
  gm_name: string
  reviewed_by: string | null
  reviewer_name: string | null
}

type ActionType = 'approve' | 'reject' | 'clarification' | 'close' | null

export default function HSGMReportDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile, loading: profileLoading } = useProfile()
  const router = useRouter()

  const [report, setReport] = useState<ReportDetail | null>(null)
  const [auditTrail, setAuditTrail] = useState<AuditEntry[]>([])
  const [hsDirectives, setHsDirectives] = useState('')
  const [localIssues, setLocalIssues] = useState<UnresolvedIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')

  // Modals
  const [actionModal, setActionModal] = useState<{ open: boolean; type: ActionType }>({ open: false, type: null })
  const [modalNotes, setModalNotes] = useState('')

  useEffect(() => {
    if (!id || !profile) return
    async function fetchData() {
      const supabase = createClient()

      const { data: escData } = await supabase
        .from('escalations')
        .select('id, period_start, period_end, status, submitted_at, reviewed_at, review_notes, content, submitted_by, reviewed_by')
        .eq('id', id)
        .single()

      if (!escData) { setLoading(false); return }

      const { data: gmProfile } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('id', escData.submitted_by)
        .single()

      let reviewerName: string | null = null
      if (escData.reviewed_by) {
        const { data: revProfile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', escData.reviewed_by)
          .single()
        reviewerName = revProfile?.full_name ?? null
      }

      const { data: audits } = await supabase
        .from('audit_logs')
        .select('id, action, created_at, user_id, new_data')
        .eq('entity_type', 'escalation')
        .eq('entity_id', id)
        .order('created_at', { ascending: false })
        .limit(20)

      const auditList = (audits ?? []) as AuditEntry[]
      const userIds = [...new Set(auditList.map(a => a.user_id).filter(Boolean) as string[])]
      let userMap: Record<string, string> = {}
      if (userIds.length > 0) {
        const { data: usersData } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds)
        for (const u of (usersData ?? []) as { id: string; full_name: string }[]) {
          userMap[u.id] = u.full_name
        }
      }
      const enrichedAudit = auditList.map(a => ({
        ...a,
        actor_name: a.user_id ? (userMap[a.user_id] ?? 'Unknown') : 'System',
      }))

      const content = (escData.content as GMReportContent) ?? {}
      const issues = (content.unresolved_issues ?? []).map(i => ({ ...i, resolved: i.resolved ?? false }))

      setReport({
        id: escData.id,
        period_start: escData.period_start,
        period_end: escData.period_end,
        status: escData.status,
        submitted_at: escData.submitted_at,
        reviewed_at: escData.reviewed_at,
        review_notes: escData.review_notes,
        content,
        submitted_by: escData.submitted_by,
        gm_name: gmProfile?.full_name ?? 'Unknown',
        reviewed_by: escData.reviewed_by,
        reviewer_name: reviewerName,
      })
      setLocalIssues(issues)
      setHsDirectives(escData.review_notes ?? '')
      setAuditTrail(enrichedAudit)
      setLoading(false)
    }
    fetchData()
  }, [id, profile])

  async function handleAction(type: ActionType, notes: string) {
    if (!report || !profile || !type) return
    setActionLoading(true)
    setError('')
    const supabase = createClient()

    const statusMap: Record<string, string> = {
      approve: 'approved',
      reject: 'rejected',
      clarification: 'under_review',
      close: 'closed',
    }
    const newStatus = statusMap[type]

    // Update issues if closing
    let updatedContent = { ...report.content }
    if (type === 'close') {
      updatedContent = {
        ...updatedContent,
        unresolved_issues: localIssues,
      }
    }

    const { error: updateError } = await supabase
      .from('escalations')
      .update({
        status: newStatus,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || hsDirectives || null,
        content: updatedContent,
        updated_at: new Date().toISOString(),
      })
      .eq('id', report.id)

    if (updateError) {
      setError('Failed to update report. Please try again.')
      setActionLoading(false)
      return
    }

    await supabase.from('audit_logs').insert({
      organisation_id: profile.organisation_id,
      user_id: profile.id,
      action: `gm_report_${type}d`,
      entity_type: 'escalation',
      entity_id: report.id,
      new_data: { status: newStatus, notes, directives: hsDirectives },
    })

    await supabase.from('notifications').insert({
      organisation_id: profile.organisation_id,
      user_id: report.submitted_by,
      type: 'gm_report_reviewed',
      title: `Your GM report has been ${newStatus}`,
      message: notes || hsDirectives || `Your GM report for ${formatDate(report.period_start)} – ${formatDate(report.period_end)} has been ${newStatus}.`,
      related_entity_type: 'escalation',
      related_entity_id: report.id,
    })

    setActionLoading(false)
    router.push('/higher-supervision/gm-reports')
  }

  function openModal(type: ActionType) {
    setActionModal({ open: true, type })
    setModalNotes('')
    setError('')
  }

  if (profileLoading || loading) return <LoadingPage />
  if (!report) {
    return (
      <div className="p-6 text-center text-gray-500">
        Report not found.{' '}
        <Link href="/higher-supervision/gm-reports" className="text-indigo-600 hover:underline">Go back</Link>
      </div>
    )
  }

  const content = report.content
  const isReviewable = report.status === 'submitted' || report.status === 'under_review'
  const trendDiff = (content.overall_compliance_this_week ?? 0) - (content.overall_compliance_last_week ?? 0)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <Link href="/higher-supervision/gm-reports">
        <Button variant="ghost" size="sm">
          <ChevronLeft className="h-4 w-4" />
          Back to GM Reports
        </Button>
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">GM Report Review</h1>
          <p className="text-sm text-gray-500 mt-1">
            Submitted by {report.gm_name} · {formatDate(report.period_start)} – {formatDate(report.period_end)}
          </p>
        </div>
        <StatusBadge status={report.status} />
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Report Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-indigo-500" />
            Report Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Report Period</p>
              <p className="text-sm font-semibold text-gray-900 mt-1">
                {formatDate(report.period_start)} – {formatDate(report.period_end)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Submitted By</p>
              <p className="text-sm font-semibold text-gray-900 mt-1 flex items-center gap-1">
                <User className="h-3.5 w-3.5 text-gray-400" />
                {report.gm_name}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Submitted At</p>
              <p className="text-sm font-semibold text-gray-900 mt-1">
                {report.submitted_at ? formatDateTime(report.submitted_at) : '—'}
              </p>
            </div>
            {content.overall_compliance_this_week !== undefined && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Compliance This Week</p>
                <p className={`text-2xl font-bold mt-1 flex items-center gap-2 ${content.overall_compliance_this_week >= 90 ? 'text-green-600' : content.overall_compliance_this_week >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {content.overall_compliance_this_week}%
                  {trendDiff !== 0 && (
                    <span className={`text-sm font-medium flex items-center gap-0.5 ${trendDiff > 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {trendDiff > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      {trendDiff > 0 ? '+' : ''}{trendDiff}%
                    </span>
                  )}
                </p>
              </div>
            )}
            {report.reviewer_name && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Reviewed By</p>
                <p className="text-sm font-semibold text-gray-900 mt-1">{report.reviewer_name}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Regional Performance */}
      {content.rm_performance && content.rm_performance.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-blue-500" />
              Regional Manager Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">RM Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Region</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Submitted</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">On Time</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">GM Action Taken</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {content.rm_performance.map((rm, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{rm.rm_name}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{rm.region_name}</td>
                      <td className="px-6 py-3">
                        {rm.submitted
                          ? <span className="text-xs font-medium text-green-700 bg-green-100 px-2.5 py-0.5 rounded-full">Yes</span>
                          : <span className="text-xs font-medium text-red-700 bg-red-100 px-2.5 py-0.5 rounded-full">No</span>
                        }
                      </td>
                      <td className="px-6 py-3">
                        {rm.on_time == null ? '—' : rm.on_time
                          ? <span className="text-xs font-medium text-green-700 bg-green-100 px-2.5 py-0.5 rounded-full">On Time</span>
                          : <span className="text-xs font-medium text-yellow-700 bg-yellow-100 px-2.5 py-0.5 rounded-full">Late</span>
                        }
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-600">{rm.action_taken || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Branch Compliance Summary */}
      {content.branch_missed && content.branch_missed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <StoreIcon className="h-4 w-4 text-orange-500" />
              Branch Compliance Summary — Missed Submissions
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Store</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Region</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Missed Count</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {content.branch_missed.map((b, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{b.store_name}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{b.region_name}</td>
                      <td className="px-6 py-3 text-sm text-red-700 font-semibold">{b.missed_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compliance Trends */}
      {content.region_trends && content.region_trends.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              Compliance Trends by Region
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {content.region_trends.map((rt, i) => {
                const diff = rt.this_week - rt.last_week
                return (
                  <div key={i} className="flex items-center gap-4">
                    <div className="w-32 flex-shrink-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{rt.region_name}</p>
                      <p className="text-xs text-gray-500">Last: {rt.last_week}%</p>
                    </div>
                    <div className="flex-1">
                      <ComplianceBar rate={rt.this_week} />
                    </div>
                    <span className={`flex-shrink-0 text-xs font-medium flex items-center gap-0.5 ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {diff >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      {diff >= 0 ? '+' : ''}{diff}%
                    </span>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unresolved Issues */}
      {localIssues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              Unresolved Issues
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {localIssues.map((issue, i) => (
                <div key={issue.id} className={`flex items-center gap-3 p-3 rounded-lg border ${issue.resolved ? 'border-green-200 bg-green-50/50' : 'border-gray-200 bg-white'}`}>
                  <StatusBadge status={issue.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{issue.title}</p>
                    <p className="text-xs text-gray-500 capitalize">{issue.type}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={issue.resolved ? 'ghost' : 'outline'}
                    onClick={() => {
                      const updated = [...localIssues]
                      updated[i] = { ...updated[i], resolved: !issue.resolved }
                      setLocalIssues(updated)
                    }}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {issue.resolved ? 'Resolved' : 'Mark Resolved'}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* GM Comments */}
      {(content.summary_comments || content.action_items_for_hs || content.escalation_notes) && (
        <Card>
          <CardHeader>
            <CardTitle>GM Summary & Action Requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {content.summary_comments && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Summary Comments</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{content.summary_comments}</p>
              </div>
            )}
            {content.action_items_for_hs && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Action Items Requested from HS</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{content.action_items_for_hs}</p>
              </div>
            )}
            {content.escalation_notes && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Escalation Notes</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{content.escalation_notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* HS Directives */}
      <Card>
        <CardHeader>
          <CardTitle>HS Directives & Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={hsDirectives}
            onChange={e => setHsDirectives(e.target.value)}
            placeholder="Enter instructions, directives, or guidance to send down the chain..."
            rows={4}
            disabled={!isReviewable && report.status !== 'approved'}
          />
        </CardContent>
      </Card>

      {/* HS Action Bar */}
      {(isReviewable || report.status === 'approved' || report.status === 'rejected') && (
        <div className="flex items-center justify-end gap-3 flex-wrap bg-white border border-gray-200 rounded-xl px-6 py-4">
          <p className="text-sm text-gray-500 flex-1">Take action on this GM report</p>
          {(report.status === 'approved' || report.status === 'rejected') && (
            <Button variant="outline" onClick={() => openModal('close')} disabled={actionLoading}>
              <Archive className="h-4 w-4" />
              Close
            </Button>
          )}
          {isReviewable && (
            <>
              <Button variant="outline" onClick={() => openModal('clarification')} disabled={actionLoading}>
                <MessageSquare className="h-4 w-4" />
                Request Clarification
              </Button>
              <Button variant="danger" onClick={() => openModal('reject')} disabled={actionLoading}>
                <XCircle className="h-4 w-4" />
                Reject
              </Button>
              <Button variant="primary" loading={actionLoading} onClick={() => handleAction('approve', hsDirectives)} disabled={actionLoading}>
                <CheckCircle className="h-4 w-4" />
                Approve
              </Button>
            </>
          )}
        </div>
      )}

      {/* Audit Trail */}
      {auditTrail.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-500" />
              Audit Trail
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative border-l border-gray-200 space-y-4 ml-2">
              {auditTrail.map(entry => (
                <li key={entry.id} className="pl-5">
                  <div className="absolute -left-1.5 w-3 h-3 bg-indigo-400 rounded-full border-2 border-white" />
                  <p className="text-sm font-medium text-gray-900">{entry.action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</p>
                  <p className="text-xs text-gray-500">{entry.actor_name} · {formatDateTime(entry.created_at)}</p>
                  {!!(entry.new_data as Record<string, unknown> | null)?.notes && (
                    <p className="text-xs text-gray-600 mt-0.5 italic">&quot;{String((entry.new_data as Record<string, unknown>).notes)}&quot;</p>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Action Modal */}
      <Modal
        isOpen={actionModal.open}
        onClose={() => setActionModal({ open: false, type: null })}
        title={
          actionModal.type === 'approve' ? 'Approve GM Report' :
          actionModal.type === 'reject' ? 'Reject GM Report' :
          actionModal.type === 'clarification' ? 'Request Clarification' :
          'Close GM Report'
        }
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {actionModal.type === 'approve' && 'Confirm approval. The GM will be notified.'}
            {actionModal.type === 'reject' && 'Provide rejection reason. The GM will be notified.'}
            {actionModal.type === 'clarification' && 'Specify what clarification is needed. The report will be set to Under Review.'}
            {actionModal.type === 'close' && 'Close this report. All resolved issues will be archived.'}
          </p>
          <Textarea
            label={actionModal.type === 'approve' ? 'Notes (optional)' : 'Notes'}
            required={actionModal.type !== 'approve' && actionModal.type !== 'close'}
            value={modalNotes}
            onChange={e => setModalNotes(e.target.value)}
            placeholder={
              actionModal.type === 'reject' ? 'Explain the rejection reason...' :
              actionModal.type === 'clarification' ? 'What needs to be clarified or corrected?' :
              actionModal.type === 'close' ? 'Closure notes...' : 'Additional comments...'
            }
            rows={4}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setActionModal({ open: false, type: null })}>Cancel</Button>
            <Button
              variant={actionModal.type === 'reject' ? 'danger' : 'primary'}
              loading={actionLoading}
              onClick={() => handleAction(actionModal.type, modalNotes)}
            >
              {actionModal.type === 'approve' && <><CheckCircle className="h-4 w-4" />Approve</>}
              {actionModal.type === 'reject' && <><XCircle className="h-4 w-4" />Reject</>}
              {actionModal.type === 'clarification' && <><MessageSquare className="h-4 w-4" />Request Clarification</>}
              {actionModal.type === 'close' && <><Archive className="h-4 w-4" />Close Report</>}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
