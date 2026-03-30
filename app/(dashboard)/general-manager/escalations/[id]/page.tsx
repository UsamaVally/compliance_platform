'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ChevronLeft,
  CheckCircle,
  XCircle,
  RotateCcw,
  FileText,
  AlertTriangle,
  ClipboardList,
  User,
  Clock,
} from 'lucide-react'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { LoadingPage } from '@/components/ui/loading'
import { formatDate, formatDateTime } from '@/lib/utils'

interface MissedEntry {
  store_name: string
  manager_name: string
  due_date: string
  reason: string
  action_taken: string
}

interface SpotCheckEntry {
  store_name: string
  score: number | null
  pass_fail: boolean | null
}

interface UnresolvedIssue {
  title: string
  status: string
  priority: string
  store_name: string
}

interface EscalationContent {
  overall_compliance_rate?: number
  missed_entries?: MissedEntry[]
  spot_checks?: SpotCheckEntry[]
  unresolved_issues?: UnresolvedIssue[]
  rm_comments?: string
  action_items_for_gm?: string
}

interface AuditEntry {
  id: string
  action: string
  created_at: string
  user_id: string | null
  new_data: Record<string, unknown> | null
  actor_name?: string
}

interface EscalationDetail {
  id: string
  period_start: string
  period_end: string
  status: string
  submitted_at: string | null
  reviewed_at: string | null
  review_notes: string | null
  content: EscalationContent
  submitted_by: string
  rm_name: string
  reviewed_by: string | null
  reviewer_name: string | null
}

export default function GMEscalationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile, loading: profileLoading } = useProfile()
  const router = useRouter()

  const [escalation, setEscalation] = useState<EscalationDetail | null>(null)
  const [auditTrail, setAuditTrail] = useState<AuditEntry[]>([])
  const [gmNotes, setGmNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState('')

  // Modals
  const [rejectModal, setRejectModal] = useState(false)
  const [sendBackModal, setSendBackModal] = useState(false)
  const [modalNotes, setModalNotes] = useState('')
  const [approveConfirm, setApproveConfirm] = useState(false)

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

      // Fetch RM profile
      const { data: rmProfile } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('id', escData.submitted_by)
        .single()

      // Fetch reviewer profile if exists
      let reviewerName: string | null = null
      if (escData.reviewed_by) {
        const { data: revProfile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', escData.reviewed_by)
          .single()
        reviewerName = revProfile?.full_name ?? null
      }

      // Audit trail
      const { data: audits } = await supabase
        .from('audit_logs')
        .select('id, action, created_at, user_id, new_data')
        .eq('entity_type', 'escalation')
        .eq('entity_id', id)
        .order('created_at', { ascending: false })
        .limit(20)

      // Enrich audit entries with actor names
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

      setEscalation({
        id: escData.id,
        period_start: escData.period_start,
        period_end: escData.period_end,
        status: escData.status,
        submitted_at: escData.submitted_at,
        reviewed_at: escData.reviewed_at,
        review_notes: escData.review_notes,
        content: (escData.content as EscalationContent) ?? {},
        submitted_by: escData.submitted_by,
        rm_name: rmProfile?.full_name ?? 'Unknown',
        reviewed_by: escData.reviewed_by,
        reviewer_name: reviewerName,
      })
      setGmNotes(escData.review_notes ?? '')
      setAuditTrail(enrichedAudit)
      setLoading(false)
    }
    fetchData()
  }, [id, profile])

  async function performAction(newStatus: 'approved' | 'rejected', notes: string) {
    if (!escalation || !profile) return
    setActionLoading(true)
    setError('')
    const supabase = createClient()

    const { error: updateError } = await supabase
      .from('escalations')
      .update({
        status: newStatus,
        reviewed_by: profile.id,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || gmNotes || null,
      })
      .eq('id', escalation.id)

    if (updateError) {
      setError('Failed to update escalation. Please try again.')
      setActionLoading(false)
      return
    }

    // Audit log
    await supabase.from('audit_logs').insert({
      organisation_id: profile.organisation_id,
      user_id: profile.id,
      action: newStatus === 'approved' ? 'escalation_approved' : 'escalation_rejected',
      entity_type: 'escalation',
      entity_id: escalation.id,
      new_data: { status: newStatus, notes },
    })

    // Notify RM
    await supabase.from('notifications').insert({
      organisation_id: profile.organisation_id,
      user_id: escalation.submitted_by,
      type: 'escalation_reviewed',
      title: `Your regional report has been ${newStatus}`,
      message: notes || `Your report for ${formatDate(escalation.period_start)} – ${formatDate(escalation.period_end)} has been ${newStatus} by the GM.`,
      related_entity_type: 'escalation',
      related_entity_id: escalation.id,
    })

    setActionLoading(false)
    router.push('/general-manager/escalations')
  }

  async function handleApprove() {
    await performAction('approved', gmNotes)
  }

  async function handleReject() {
    if (!modalNotes.trim()) {
      setError('Please provide a rejection reason.')
      return
    }
    await performAction('rejected', modalNotes)
    setRejectModal(false)
  }

  async function handleSendBack() {
    if (!modalNotes.trim()) {
      setError('Please provide correction notes.')
      return
    }
    await performAction('rejected', modalNotes)
    setSendBackModal(false)
  }

  if (profileLoading || loading) return <LoadingPage />
  if (!escalation) {
    return (
      <div className="p-6 text-center text-gray-500">
        Escalation not found.{' '}
        <Link href="/general-manager/escalations" className="text-indigo-600 hover:underline">Go back</Link>
      </div>
    )
  }

  const content = escalation.content
  const isReviewable = escalation.status === 'submitted' || escalation.status === 'under_review'

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Back */}
      <Link href="/general-manager/escalations">
        <Button variant="ghost" size="sm">
          <ChevronLeft className="h-4 w-4" />
          Back to Escalations
        </Button>
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Regional Escalation Report</h1>
          <p className="text-sm text-gray-500 mt-1">
            Submitted by {escalation.rm_name} · {formatDate(escalation.period_start)} – {formatDate(escalation.period_end)}
          </p>
        </div>
        <StatusBadge status={escalation.status} />
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
                {formatDate(escalation.period_start)} – {formatDate(escalation.period_end)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Submitted By</p>
              <p className="text-sm font-semibold text-gray-900 mt-1 flex items-center gap-1">
                <User className="h-3.5 w-3.5 text-gray-400" />
                {escalation.rm_name}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Submitted At</p>
              <p className="text-sm font-semibold text-gray-900 mt-1">
                {escalation.submitted_at ? formatDateTime(escalation.submitted_at) : '—'}
              </p>
            </div>
            {content.overall_compliance_rate !== undefined && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Overall Compliance</p>
                <p className={`text-2xl font-bold mt-1 ${content.overall_compliance_rate >= 90 ? 'text-green-600' : content.overall_compliance_rate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {content.overall_compliance_rate}%
                </p>
              </div>
            )}
            {escalation.reviewer_name && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Reviewed By</p>
                <p className="text-sm font-semibold text-gray-900 mt-1">{escalation.reviewer_name}</p>
              </div>
            )}
            {escalation.reviewed_at && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Reviewed At</p>
                <p className="text-sm font-semibold text-gray-900 mt-1">{formatDateTime(escalation.reviewed_at)}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Missed Submissions */}
      {content.missed_entries && content.missed_entries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              Missed Submissions ({content.missed_entries.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Store</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Manager</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Due Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action Taken</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {content.missed_entries.map((entry, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{entry.store_name}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{entry.manager_name}</td>
                      <td className="px-6 py-3 text-sm text-gray-500">{formatDate(entry.due_date)}</td>
                      <td className="px-6 py-3 text-sm text-gray-700">{entry.reason.replace(/_/g, ' ')}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{entry.action_taken || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Spot Checks */}
      {content.spot_checks && content.spot_checks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-blue-500" />
              Spot Check Results ({content.spot_checks.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Store</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Score</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Result</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {content.spot_checks.map((sc, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{sc.store_name}</td>
                      <td className="px-6 py-3 text-sm text-gray-700">{sc.score != null ? `${sc.score}%` : '—'}</td>
                      <td className="px-6 py-3">
                        {sc.pass_fail != null ? (
                          sc.pass_fail
                            ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2.5 py-0.5 rounded-full"><CheckCircle className="h-3 w-3" /> Pass</span>
                            : <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 px-2.5 py-0.5 rounded-full"><XCircle className="h-3 w-3" /> Fail</span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Unresolved Issues */}
      {content.unresolved_issues && content.unresolved_issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              Unresolved Issues ({content.unresolved_issues.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Issue</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Store</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {content.unresolved_issues.map((issue, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{issue.title}</td>
                      <td className="px-6 py-3 text-sm text-gray-600">{issue.store_name}</td>
                      <td className="px-6 py-3 text-sm text-gray-700 capitalize">{issue.priority}</td>
                      <td className="px-6 py-3"><StatusBadge status={issue.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* RM Comments */}
      {(content.rm_comments || content.action_items_for_gm) && (
        <Card>
          <CardHeader>
            <CardTitle>RM Comments & Action Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {content.rm_comments && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Comments</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{content.rm_comments}</p>
              </div>
            )}
            {content.action_items_for_gm && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Action Items Requested from GM</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{content.action_items_for_gm}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* GM Notes */}
      <Card>
        <CardHeader>
          <CardTitle>GM Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={gmNotes}
            onChange={e => setGmNotes(e.target.value)}
            placeholder="Add your review notes and comments here..."
            rows={4}
            disabled={!isReviewable}
          />
        </CardContent>
      </Card>

      {/* GM Action Bar */}
      {isReviewable && (
        <div className="flex items-center justify-end gap-3 flex-wrap bg-white border border-gray-200 rounded-xl px-6 py-4">
          <p className="text-sm text-gray-500 flex-1">Review this escalation report and take action</p>
          <Button
            variant="outline"
            onClick={() => { setModalNotes(''); setSendBackModal(true); setError('') }}
            disabled={actionLoading}
          >
            <RotateCcw className="h-4 w-4" />
            Send Back
          </Button>
          <Button
            variant="danger"
            onClick={() => { setModalNotes(''); setRejectModal(true); setError('') }}
            disabled={actionLoading}
          >
            <XCircle className="h-4 w-4" />
            Reject
          </Button>
          <Button
            variant="primary"
            loading={actionLoading && approveConfirm}
            onClick={() => { setApproveConfirm(true); handleApprove() }}
            disabled={actionLoading}
          >
            <CheckCircle className="h-4 w-4" />
            Approve
          </Button>
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
                  {entry.new_data && typeof entry.new_data === 'object' && !!(entry.new_data as Record<string, unknown>).notes && (
                    <p className="text-xs text-gray-600 mt-0.5 italic">
                      &quot;{String((entry.new_data as Record<string, unknown>).notes)}&quot;
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Reject Modal */}
      <Modal isOpen={rejectModal} onClose={() => setRejectModal(false)} title="Reject Escalation Report" size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Provide a reason for rejection. The RM will be notified and may need to revise and resubmit.
          </p>
          <Textarea
            label="Rejection Reason"
            required
            value={modalNotes}
            onChange={e => setModalNotes(e.target.value)}
            placeholder="Explain why this report is being rejected..."
            rows={4}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setRejectModal(false)}>Cancel</Button>
            <Button variant="danger" loading={actionLoading} onClick={handleReject}>
              <XCircle className="h-4 w-4" />
              Confirm Reject
            </Button>
          </div>
        </div>
      </Modal>

      {/* Send Back Modal */}
      <Modal isOpen={sendBackModal} onClose={() => setSendBackModal(false)} title="Send Back for Correction" size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Provide correction notes. The RM will need to update and resubmit their report.
          </p>
          <Textarea
            label="Correction Notes"
            required
            value={modalNotes}
            onChange={e => setModalNotes(e.target.value)}
            placeholder="Describe what needs to be corrected..."
            rows={4}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setSendBackModal(false)}>Cancel</Button>
            <Button variant="primary" loading={actionLoading} onClick={handleSendBack}>
              <RotateCcw className="h-4 w-4" />
              Send Back
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
