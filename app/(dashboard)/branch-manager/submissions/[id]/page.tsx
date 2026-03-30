'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  ChevronLeft,
  Download,
  AlertCircle,
  CheckCircle,
  Clock,
  User,
  Store as StoreIcon,
  Shield,
} from 'lucide-react'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingPage } from '@/components/ui/loading'
import { formatDate, formatDateTime } from '@/lib/utils'
import type {
  Submission,
  SubmissionAnswer,
  Attachment,
  Review,
  AuditLog,
  Store,
  FormTemplate,
  FormSection,
  FormQuestion,
  Profile,
  ExpectedSubmission,
} from '@/lib/types'

type SectionWithQuestions = FormSection & {
  form_questions: FormQuestion[]
}

type TemplateWithSections = FormTemplate & {
  form_sections: SectionWithQuestions[]
}

type FullSubmission = Submission & {
  stores: Store | null
  form_templates: TemplateWithSections | null
  submitted_profile: Profile | null
  expected_submissions: Pick<ExpectedSubmission, 'id' | 'due_date' | 'due_time' | 'cutoff_time'> | null
}

export default function SubmissionDetailPage() {
  const params = useParams()
  const submissionId = params.id as string

  const { profile, loading: profileLoading } = useProfile()

  const [submission, setSubmission] = useState<FullSubmission | null>(null)
  const [answers, setAnswers] = useState<SubmissionAnswer[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!submissionId) return

    async function fetchData() {
      const supabase = createClient()

      // Fetch submission with related data
      const { data: sub } = await supabase
        .from('submissions')
        .select(`
          *,
          stores(*),
          form_templates(*, form_sections(*, form_questions(*))),
          submitted_profile:profiles!submissions_submitted_by_fkey(*),
          expected_submissions(id, due_date, due_time, cutoff_time)
        `)
        .eq('id', submissionId)
        .single()

      if (!sub) {
        setLoading(false)
        return
      }

      // Sort sections and questions
      const tmpl = sub.form_templates as TemplateWithSections | null
      if (tmpl?.form_sections) {
        tmpl.form_sections = [...tmpl.form_sections]
          .sort((a, b) => a.order_index - b.order_index)
          .map(sec => ({
            ...sec,
            form_questions: [...(sec.form_questions ?? [])].sort((a, b) => a.order_index - b.order_index),
          }))
      }

      setSubmission(sub as FullSubmission)

      // Fetch answers
      const { data: answerData } = await supabase
        .from('submission_answers')
        .select('*')
        .eq('submission_id', submissionId)

      setAnswers(answerData ?? [])

      // Fetch attachments
      const { data: attachmentData } = await supabase
        .from('attachments')
        .select('*')
        .eq('entity_type', 'submission')
        .eq('entity_id', submissionId)
        .order('created_at', { ascending: true })

      setAttachments(attachmentData ?? [])

      // Fetch reviews
      const { data: reviewData } = await supabase
        .from('reviews')
        .select('*')
        .eq('submission_id', submissionId)
        .order('created_at', { ascending: false })

      setReviews(reviewData ?? [])

      // Fetch audit logs for this submission
      const { data: auditData } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('entity_type', 'submission')
        .eq('entity_id', submissionId)
        .order('created_at', { ascending: false })
        .limit(20)

      setAuditLogs(auditData ?? [])
      setLoading(false)
    }

    fetchData()
  }, [submissionId])

  if (profileLoading || loading) return <LoadingPage />

  if (!submission) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
          <p className="text-sm font-medium text-red-700">Submission not found or you do not have access.</p>
        </div>
      </div>
    )
  }

  const answerMap: Record<string, SubmissionAnswer> = {}
  for (const a of answers) {
    answerMap[a.question_id] = a
  }

  const isRejected = submission.status === 'rejected'
  const isReviewed = reviews.length > 0
  const latestReview = reviews[0] ?? null

  // Check if the submitted user is the current user (to allow resubmit)
  const canResubmit = isRejected && profile?.id === submission.submitted_by

  function getAnswerDisplay(question: FormQuestion): string {
    const answer = answerMap[question.id]
    if (!answer) return '—'
    return answer.answer_text ?? (answer.answer_value !== null ? String(answer.answer_value) : '—')
  }

  function isPhotoUrl(value: string): boolean {
    return /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|heic)/i.test(value) ||
      value.includes('/storage/v1/object/') ||
      value.startsWith('http')
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/branch-manager/submissions">
          <Button variant="ghost" size="sm" className="gap-1 mt-0.5">
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900 truncate">
              {submission.form_templates?.name ?? 'Form Submission'}
            </h1>
            <StatusBadge status={submission.status} />
            {submission.is_late && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                <Clock className="h-3 w-3" /> Late
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1">
              <StoreIcon className="h-3.5 w-3.5" />
              {submission.stores?.name ?? '—'}
            </span>
            <span className="flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              {submission.submitted_profile?.full_name ?? '—'}
            </span>
            {submission.submitted_at && (
              <span className="flex items-center gap-1">
                <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                {formatDateTime(submission.submitted_at)}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Rejected banner */}
      {isRejected && (
        <div className="flex gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-700">This submission was rejected</p>
            {submission.review_notes && (
              <p className="text-sm text-red-600 mt-1">{submission.review_notes}</p>
            )}
            {canResubmit && submission.expected_submissions?.id && (
              <div className="mt-3">
                <Link href={`/branch-manager/forms/${submission.expected_submissions.id}`}>
                  <Button size="sm" variant="danger">
                    Resubmit Form
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Proof of Submission */}
      {submission.submitted_at && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-indigo-600" />
              <CardTitle>Proof of Submission</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Submission ID</dt>
                <dd className="mt-1 text-sm font-mono text-gray-700 break-all">{submission.id}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted At</dt>
                <dd className="mt-1 text-sm text-gray-900 font-semibold">{formatDateTime(submission.submitted_at)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Store</dt>
                <dd className="mt-1 text-sm text-gray-700">{submission.stores?.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted By</dt>
                <dd className="mt-1 text-sm text-gray-700">{submission.submitted_profile?.full_name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Form</dt>
                <dd className="mt-1 text-sm text-gray-700">{submission.form_templates?.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Submission Date</dt>
                <dd className="mt-1 text-sm text-gray-700">
                  {submission.expected_submissions?.due_date
                    ? formatDate(submission.expected_submissions.due_date)
                    : formatDate(submission.created_at)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Review Result */}
      {isReviewed && latestReview && (
        <Card>
          <CardHeader>
            <CardTitle>Review Result</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 mb-4">
              {latestReview.pass_fail !== null && (
                <div className={`flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm ${
                  latestReview.pass_fail ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {latestReview.pass_fail
                    ? <CheckCircle className="h-4 w-4" />
                    : <AlertCircle className="h-4 w-4" />
                  }
                  {latestReview.pass_fail ? 'Pass' : 'Fail'}
                </div>
              )}
              {latestReview.score !== null && (
                <div className="text-sm text-gray-700">
                  Score: <span className="font-bold text-gray-900">{latestReview.score}%</span>
                </div>
              )}
              <div className="text-xs text-gray-400">
                Reviewed {formatDateTime(latestReview.created_at)}
              </div>
            </div>
            {latestReview.findings && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Findings</p>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">{latestReview.findings}</p>
              </div>
            )}
            {latestReview.corrective_action && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Corrective Action Required</p>
                <p className="text-sm text-gray-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">{latestReview.corrective_action}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Form Answers */}
      {submission.form_templates?.form_sections?.map(section => (
        <Card key={section.id}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {section.form_questions.map(question => {
              const answer = answerMap[question.id]
              const value = answer?.answer_text ?? (answer?.answer_value !== null && answer?.answer_value !== undefined ? String(answer.answer_value) : null)

              return (
                <div key={question.id} className="space-y-1">
                  <p className="text-sm font-medium text-gray-700">
                    {question.question_text}
                    {question.is_required && <span className="text-red-400 ml-1">*</span>}
                  </p>
                  {question.question_type === 'photo' ? (
                    value ? (
                      <div className="space-y-2">
                        {isPhotoUrl(value) ? (
                          <div className="relative">
                            <Image
                              src={value}
                              alt="Submitted photo"
                              width={400}
                              height={300}
                              className="rounded-xl border border-gray-200 object-cover max-h-64 w-auto"
                            />
                            <a
                              href={value}
                              target="_blank"
                              rel="noopener noreferrer"
                              download
                              className="absolute top-2 right-2 bg-white border border-gray-200 rounded-lg p-1.5 hover:bg-gray-50 transition shadow-sm"
                              title="Download photo"
                            >
                              <Download className="h-3.5 w-3.5 text-gray-600" />
                            </a>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 italic">{value}</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 italic bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">No photo uploaded</p>
                    )
                  ) : question.question_type === 'yes_no' ? (
                    <div className="flex gap-2">
                      {['Yes', 'No'].map(opt => (
                        <span
                          key={opt}
                          className={`inline-flex items-center px-3 py-1 rounded-lg text-sm font-medium border ${
                            value === opt
                              ? opt === 'Yes'
                                ? 'bg-green-50 border-green-400 text-green-700'
                                : 'bg-red-50 border-red-400 text-red-700'
                              : 'bg-gray-50 border-gray-200 text-gray-400'
                          }`}
                        >
                          {opt}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className={`text-sm bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 min-h-[38px] ${value ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                      {value ?? '— Not answered'}
                    </p>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      ))}

      {/* Attachments */}
      {attachments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Attachments ({attachments.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {attachments.map(attachment => {
                const isImage = attachment.mime_type?.startsWith('image/') ?? false
                return (
                  <div key={attachment.id} className="group relative">
                    {isImage ? (
                      <a href={attachment.file_url} target="_blank" rel="noopener noreferrer" download={attachment.file_name}>
                        <div className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                          <Image
                            src={attachment.file_url}
                            alt={attachment.file_name}
                            fill
                            className="object-cover group-hover:opacity-90 transition"
                          />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition flex items-center justify-center">
                            <Download className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition" />
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-gray-500 truncate">{attachment.file_name}</p>
                      </a>
                    ) : (
                      <a
                        href={attachment.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={attachment.file_name}
                        className="flex items-center gap-2 p-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition"
                      >
                        <Download className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        <span className="text-xs text-gray-700 truncate">{attachment.file_name}</span>
                      </a>
                    )}
                    {attachment.file_size && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {(attachment.file_size / 1024).toFixed(1)} KB
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Audit Trail */}
      {auditLogs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Audit Trail</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-gray-100">
              {auditLogs.map(log => {
                const newData = log.new_data as Record<string, unknown> | null
                const statusChange = newData?.status as string | undefined

                return (
                  <li key={log.id} className="flex items-start gap-3 px-6 py-3">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-indigo-50 flex items-center justify-center mt-0.5">
                      <Clock className="h-3.5 w-3.5 text-indigo-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700">
                        <span className="font-medium capitalize">{log.action.replace(/_/g, ' ')}</span>
                        {statusChange && (
                          <span className="ml-1 text-gray-500">
                            — status changed to <StatusBadge status={statusChange} className="ml-1" />
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(log.created_at)}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Footer actions */}
      <div className="flex justify-end gap-3 pb-6">
        <Link href="/branch-manager/submissions">
          <Button variant="outline">Back to History</Button>
        </Link>
        {canResubmit && submission.expected_submissions?.id && (
          <Link href={`/branch-manager/forms/${submission.expected_submissions.id}`}>
            <Button variant="danger">Resubmit Form</Button>
          </Link>
        )}
      </div>
    </div>
  )
}
