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
  Store,
  FormTemplate,
  FormSection,
  FormQuestion,
  Profile,
  ExpectedSubmission,
} from '@/lib/types'

type SectionWithQuestions = FormSection & { form_questions: FormQuestion[] }
type TemplateWithSections = FormTemplate & { form_sections: SectionWithQuestions[] }
type FullSubmission = Submission & {
  stores: Store | null
  form_templates: TemplateWithSections | null
  submitted_profile: Profile | null
  expected_submissions: Pick<ExpectedSubmission, 'id' | 'due_date' | 'due_time' | 'cutoff_time'> | null
}

function isPhotoUrl(value: string): boolean {
  return value.includes('/storage/v1/object/') || value.startsWith('http')
}

export default function RMSubmissionDetailPage() {
  const params = useParams()
  const submissionId = params.id as string
  const { profile, loading: profileLoading } = useProfile()
  const [submission, setSubmission] = useState<FullSubmission | null>(null)
  const [answers, setAnswers] = useState<SubmissionAnswer[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!submissionId || !profile) return

    async function fetchData() {
      const supabase = createClient()

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

      if (!sub) { setNotFound(true); setLoading(false); return }

      // Sort sections/questions
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

      const [{ data: answerData }, { data: attachmentData }] = await Promise.all([
        supabase.from('submission_answers').select('*').eq('submission_id', submissionId),
        supabase.from('attachments').select('*').eq('entity_type', 'submission').eq('entity_id', submissionId).order('created_at', { ascending: true }),
      ])

      setAnswers(answerData ?? [])
      setAttachments(attachmentData ?? [])
      setLoading(false)
    }

    fetchData()
  }, [submissionId, profile])

  if (profileLoading || loading) return <LoadingPage />

  if (notFound || !submission) {
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
  for (const a of answers) answerMap[a.question_id] = a

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link href="/regional-manager">
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
            <span className="flex items-center gap-1"><StoreIcon className="h-3.5 w-3.5" />{submission.stores?.name ?? '—'}</span>
            <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" />{submission.submitted_profile?.full_name ?? '—'}</span>
            {submission.submitted_at && (
              <span className="flex items-center gap-1">
                <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                {formatDateTime(submission.submitted_at)}
              </span>
            )}
          </p>
        </div>
      </div>

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
                <dt className="text-xs font-medium text-gray-500 uppercase tracking-wider">Scheduled Date</dt>
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

      {/* Form Answers */}
      {submission.form_templates?.form_sections?.map(section => (
        <Card key={section.id}>
          <CardHeader><CardTitle>{section.title}</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            {section.form_questions.map(question => {
              const answer = answerMap[question.id]
              const value = answer?.answer_text ?? (answer?.answer_value !== null && answer?.answer_value !== undefined ? String(answer.answer_value) : null)
              const av = answer?.answer_value as { no_photo_url?: string; comment?: string } | null

              return (
                <div key={question.id} className="space-y-1.5">
                  <p className="text-sm font-medium text-gray-700">
                    {question.question_text}
                    {question.is_required && <span className="text-red-400 ml-1">*</span>}
                  </p>

                  {question.question_type === 'photo' ? (
                    value && isPhotoUrl(value) ? (
                      <div className="relative w-fit">
                        <Image src={value} alt="Submitted photo" width={400} height={300} className="rounded-xl border border-gray-200 object-cover max-h-64 w-auto" />
                        <a href={value} target="_blank" rel="noopener noreferrer" download className="absolute top-2 right-2 bg-white border border-gray-200 rounded-lg p-1.5 hover:bg-gray-50 transition shadow-sm" title="Download">
                          <Download className="h-3.5 w-3.5 text-gray-600" />
                        </a>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 italic bg-gray-50 rounded-lg px-3 py-2 border border-gray-200">No photo uploaded</p>
                    )
                  ) : question.question_type === 'yes_no' ? (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        {['Yes', 'No'].map(opt => (
                          <span key={opt} className={`inline-flex items-center px-3 py-1 rounded-lg text-sm font-medium border ${
                            value === opt
                              ? opt === 'Yes' ? 'bg-green-50 border-green-400 text-green-700' : 'bg-red-50 border-red-400 text-red-700'
                              : 'bg-gray-50 border-gray-200 text-gray-400'
                          }`}>{opt}</span>
                        ))}
                      </div>
                      {value === 'No' && av?.no_photo_url && (
                        <div className="pl-1">
                          <p className="text-xs font-medium text-gray-500 mb-1">Photo evidence</p>
                          <a href={av.no_photo_url} target="_blank" rel="noopener noreferrer">
                            <Image src={av.no_photo_url} alt="Evidence photo" width={300} height={200} className="rounded-lg border border-gray-200 object-cover max-h-48 cursor-pointer hover:opacity-90 transition" />
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className={`text-sm bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 min-h-[38px] ${value ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                      {value ?? '— Not answered'}
                    </p>
                  )}

                  {av?.comment && (
                    <div className="pl-1">
                      <p className="text-xs font-medium text-gray-500">Comment</p>
                      <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 whitespace-pre-wrap mt-0.5">{av.comment}</p>
                    </div>
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
          <CardHeader><CardTitle>Attachments ({attachments.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {attachments.map(att => (
                <div key={att.id} className="group">
                  {att.mime_type?.startsWith('image/') ? (
                    <a href={att.file_url} target="_blank" rel="noopener noreferrer" download={att.file_name}>
                      <div className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                        <Image src={att.file_url} alt={att.file_name} fill className="object-cover group-hover:opacity-90 transition" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition flex items-center justify-center">
                          <Download className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition" />
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-gray-500 truncate">{att.file_name}</p>
                    </a>
                  ) : (
                    <a href={att.file_url} target="_blank" rel="noopener noreferrer" download={att.file_name} className="flex items-center gap-2 p-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition">
                      <Download className="h-4 w-4 text-gray-400 flex-shrink-0" />
                      <span className="text-xs text-gray-700 truncate">{att.file_name}</span>
                    </a>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="pb-6">
        <Link href="/regional-manager">
          <Button variant="outline">
            <ChevronLeft className="h-4 w-4" /> Back to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  )
}
