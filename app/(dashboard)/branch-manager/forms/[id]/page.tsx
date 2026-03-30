'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { CheckCircle, AlertCircle, ChevronLeft, Save, Send } from 'lucide-react'
import { CameraCapture } from '@/components/ui/camera-capture'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { LoadingPage } from '@/components/ui/loading'
import { formatDateTime } from '@/lib/utils'
import type {
  ExpectedSubmission,
  FormTemplate,
  FormSection,
  FormQuestion,
  Submission,
  SubmissionAnswer,
  Store,
  Schedule,
} from '@/lib/types'
import Link from 'next/link'

type SectionWithQuestions = FormSection & {
  form_questions: FormQuestion[]
}

type TemplateWithSections = FormTemplate & {
  form_sections: SectionWithQuestions[]
}

type ExpectedWithDetails = ExpectedSubmission & {
  stores: Store | null
  schedules: (Schedule & { form_templates: TemplateWithSections | null }) | null
}

type ExistingSubmission = Submission & {
  submission_answers: SubmissionAnswer[]
}

type AnswerMap = Record<string, string>
type CommentMap = Record<string, string>
type PhotoMap = Record<string, File>
type PhotoPreviewMap = Record<string, string>
type ErrorMap = Record<string, string>
type NoPhotoUrlMap = Record<string, string>

export default function BranchManagerFormPage() {
  const params = useParams()
  const router = useRouter()
  const expectedId = params.id as string

  const { profile, loading: profileLoading } = useProfile()

  const [expectedSubmission, setExpectedSubmission] = useState<ExpectedWithDetails | null>(null)
  const [template, setTemplate] = useState<TemplateWithSections | null>(null)
  const [existingSubmission, setExistingSubmission] = useState<ExistingSubmission | null>(null)
  const [loading, setLoading] = useState(true)
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [comments, setComments] = useState<CommentMap>({})
  const [photos, setPhotos] = useState<PhotoMap>({})
  const [photoPreviews, setPhotoPreviews] = useState<PhotoPreviewMap>({})
  const [noPhotos, setNoPhotos] = useState<PhotoMap>({})
  const [noPhotoPreviews, setNoPhotoPreviews] = useState<PhotoPreviewMap>({})
  const [errors, setErrors] = useState<ErrorMap>({})
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<{ submittedAt: string; submissionId: string } | null>(null)



  useEffect(() => {
    if (!profile || !expectedId) return

    async function fetchData() {
      const supabase = createClient()

      // Fetch expected submission with all details
      const { data: expected } = await supabase
        .from('expected_submissions')
        .select('*, stores(*), schedules(*, form_templates!schedules_template_id_fkey(*, form_sections(*, form_questions(*))))')
        .eq('id', expectedId)
        .single()

      if (!expected) {
        setLoading(false)
        return
      }

      setExpectedSubmission(expected as ExpectedWithDetails)

      const tmpl = expected.schedules?.form_templates as TemplateWithSections | null | undefined
      if (tmpl) {
        // Sort sections and questions by order_index
        const sortedTemplate = {
          ...tmpl,
          form_sections: [...(tmpl.form_sections ?? [])].sort((a, b) => a.order_index - b.order_index).map(sec => ({
            ...sec,
            form_questions: [...(sec.form_questions ?? [])].sort((a, b) => a.order_index - b.order_index),
          })),
        }
        setTemplate(sortedTemplate)
      }

      // Check if there's an existing submission for this expected_submission
      const { data: existing } = await supabase
        .from('submissions')
        .select('*, submission_answers(*)')
        .eq('expected_submission_id', expectedId)
        .in('status', ['due', 'submitted_on_time', 'submitted_late', 'under_review', 'approved', 'rejected', 'closed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existing) {
        setExistingSubmission(existing as ExistingSubmission)

        // Pre-fill answers from existing submission
        if (existing.submission_answers?.length) {
          const prefilled: AnswerMap = {}
          const prefilledComments: CommentMap = {}
          for (const answer of existing.submission_answers) {
            if (answer.answer_text) {
              prefilled[answer.question_id] = answer.answer_text
            } else if (answer.answer_value !== null && answer.answer_value !== undefined) {
              prefilled[answer.question_id] = String(answer.answer_value)
            }
            const av = answer.answer_value as { comment?: string } | null
            if (av?.comment) {
              prefilledComments[answer.question_id] = av.comment
            }
          }
          setAnswers(prefilled)
          setComments(prefilledComments)
        } else if (existing.draft_data && typeof existing.draft_data === 'object' && !Array.isArray(existing.draft_data)) {
          const draft = existing.draft_data as { answers?: AnswerMap; comments?: CommentMap } | AnswerMap
          if ('answers' in draft && draft.answers) {
            setAnswers(draft.answers as AnswerMap)
            setComments((draft as { answers: AnswerMap; comments?: CommentMap }).comments ?? {})
          } else {
            // Legacy flat format
            setAnswers(draft as AnswerMap)
          }
        }
      }

      setLoading(false)
    }

    fetchData()
  }, [profile, expectedId])

  function handleAnswer(questionId: string, value: string) {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
    if (errors[questionId]) {
      setErrors(prev => { const next = { ...prev }; delete next[questionId]; return next })
    }
  }

  function handleComment(questionId: string, value: string) {
    setComments(prev => ({ ...prev, [questionId]: value }))
  }

  function handleNoPhoto(questionId: string, file: File | null) {
    if (!file) return
    setNoPhotos(prev => ({ ...prev, [questionId]: file }))
    setNoPhotoPreviews(prev => ({ ...prev, [questionId]: URL.createObjectURL(file) }))
  }

  function handlePhoto(questionId: string, file: File | null) {
    if (!file) return
    setPhotos(prev => ({ ...prev, [questionId]: file }))
    const url = URL.createObjectURL(file)
    setPhotoPreviews(prev => ({ ...prev, [questionId]: url }))
    if (errors[questionId]) {
      setErrors(prev => { const next = { ...prev }; delete next[questionId]; return next })
    }
  }

  function validateRequired(): boolean {
    if (!template) return false
    const newErrors: ErrorMap = {}
    for (const section of template.form_sections) {
      for (const question of section.form_questions) {
        if (question.question_type === 'photo') {
          if (!question.is_required) continue
          const hasExistingPhoto = existingSubmission?.submission_answers.some(
            a => a.question_id === question.id && a.answer_text
          )
          if (!photos[question.id] && !hasExistingPhoto) {
            newErrors[question.id] = 'This field is required'
          }
        } else if (question.question_type === 'yes_no') {
          const val = answers[question.id]
          if (question.is_required && (!val || val.trim() === '')) {
            newErrors[question.id] = 'This field is required'
          } else if (val === 'No') {
            const hasExistingNoPhoto = existingSubmission?.submission_answers.some(
              a => a.question_id === question.id && (a.answer_value as { no_photo_url?: string } | null)?.no_photo_url
            )
            if (!noPhotos[question.id] && !hasExistingNoPhoto) {
              newErrors[question.id] = 'A photo is required when answering No'
            }
          }
        } else {
          if (!question.is_required) continue
          const val = answers[question.id]
          if (!val || val.trim() === '') {
            newErrors[question.id] = 'This field is required'
          }
        }
      }
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSaveDraft() {
    if (!profile || !template || !expectedSubmission) return
    setSaving(true)

    try {
      const supabase = createClient()
      const now = new Date().toISOString()

      const draftData = { answers, comments }

      if (existingSubmission && existingSubmission.draft_data !== null && existingSubmission.submitted_at === null) {
        // Update existing draft (draft_data set, not yet submitted)
        await supabase
          .from('submissions')
          .update({ draft_data: draftData, updated_at: now })
          .eq('id', existingSubmission.id)
      } else if (!existingSubmission) {
        // Create new draft
        await supabase.from('submissions').insert({
          expected_submission_id: expectedId,
          organisation_id: profile.organisation_id,
          store_id: expectedSubmission.store_id,
          submitted_by: profile.id,
          form_template_id: template.id,
          status: 'due' as const,
          is_late: false,
          draft_data: draftData,
        })
      }
    } catch (err) {
      console.error('Save draft error:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit() {
    if (!profile || !template || !expectedSubmission) return
    if (!validateRequired()) {
      // Scroll to first error
      const firstErrorId = Object.keys(errors)[0]
      if (firstErrorId) {
        document.getElementById(`q-${firstErrorId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      return
    }

    setSubmitting(true)

    try {
      const supabase = createClient()
      const now = new Date()
      const nowISO = now.toISOString()

      const newStatus = 'submitted_on_time'

      let submissionId: string

      if (existingSubmission && (existingSubmission.submitted_at === null || existingSubmission.status === 'rejected')) {
        // Update existing record
        const { data: updated } = await supabase
          .from('submissions')
          .update({
            status: newStatus,
            submitted_at: nowISO,
            is_late: false,
            draft_data: null,
            updated_at: nowISO,
          })
          .eq('id', existingSubmission.id)
          .select('id')
          .single()
        submissionId = updated?.id ?? existingSubmission.id
      } else {
        // Create new submission record
        const { data: created, error: createErr } = await supabase
          .from('submissions')
          .insert({
            expected_submission_id: expectedId,
            organisation_id: profile.organisation_id,
            store_id: expectedSubmission.store_id,
            submitted_by: profile.id,
            form_template_id: template.id,
            status: newStatus,
            submitted_at: nowISO,
            is_late: false,
          })
          .select('id')
          .single()

        if (createErr || !created) {
          throw new Error(createErr?.message ?? 'Failed to create submission')
        }
        submissionId = created.id
      }

      // Upload photos to Supabase storage and create attachment records
      const photoAnswers: AnswerMap = {}
      for (const [questionId, file] of Object.entries(photos)) {
        const filePath = `submissions/${submissionId}/${questionId}/${file.name}`
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('compliance-attachments')
          .upload(filePath, file, { upsert: true })

        if (!uploadErr && uploadData) {
          const { data: { publicUrl } } = supabase.storage
            .from('compliance-attachments')
            .getPublicUrl(filePath)

          await supabase.from('attachments').insert({
            organisation_id: profile.organisation_id,
            entity_type: 'submission',
            entity_id: submissionId,
            file_name: file.name,
            file_url: publicUrl,
            file_size: file.size,
            mime_type: file.type,
            uploaded_by: profile.id,
          })

          photoAnswers[questionId] = publicUrl
        }
      }

      // Upload "No" evidence photos and store their URLs
      const noPhotoUrls: NoPhotoUrlMap = {}
      for (const [questionId, file] of Object.entries(noPhotos)) {
        const filePath = `submissions/${submissionId}/${questionId}_evidence/${file.name}`
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('compliance-attachments')
          .upload(filePath, file, { upsert: true })

        if (!uploadErr && uploadData) {
          const { data: { publicUrl } } = supabase.storage
            .from('compliance-attachments')
            .getPublicUrl(filePath)

          await supabase.from('attachments').insert({
            organisation_id: profile.organisation_id,
            entity_type: 'submission',
            entity_id: submissionId,
            file_name: file.name,
            file_url: publicUrl,
            file_size: file.size,
            mime_type: file.type,
            uploaded_by: profile.id,
          })

          noPhotoUrls[questionId] = publicUrl
        }
      }

      // Insert submission answers
      const answerInserts = []
      for (const section of template.form_sections) {
        for (const question of section.form_questions) {
          const textAnswer = photoAnswers[question.id] ?? answers[question.id]
          if (textAnswer !== undefined && textAnswer !== null && textAnswer !== '') {
            const answerValue: Record<string, string> = {}
            if (noPhotoUrls[question.id]) answerValue.no_photo_url = noPhotoUrls[question.id]
            if (comments[question.id]?.trim()) answerValue.comment = comments[question.id].trim()
            answerInserts.push({
              submission_id: submissionId,
              question_id: question.id,
              answer_text: textAnswer,
              answer_value: Object.keys(answerValue).length > 0 ? answerValue : null,
            })
          }
        }
      }

      if (answerInserts.length > 0) {
        // Remove old answers if resubmitting
        if (existingSubmission) {
          await supabase.from('submission_answers').delete().eq('submission_id', submissionId)
        }
        await supabase.from('submission_answers').insert(answerInserts)
      }

      // Update expected submission status
      await supabase
        .from('expected_submissions')
        .update({ status: newStatus })
        .eq('id', expectedId)

      setSuccess({ submittedAt: nowISO, submissionId })
    } catch (err) {
      console.error('Submit error:', err)
      alert('An error occurred while submitting. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (profileLoading || loading) return <LoadingPage />

  if (!expectedSubmission || !template) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 text-red-600 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm font-medium">Form not found or you do not have access to this submission.</p>
        </div>
      </div>
    )
  }

  // Locked if the window has closed (missed) — cannot submit anymore
  const isMissed = expectedSubmission.status === 'missed'

  // Read-only view for already-submitted (not rejected) or missed
  const isReadOnly = isMissed || (
    existingSubmission !== null &&
    existingSubmission.status !== 'rejected' &&
    existingSubmission.submitted_at !== null
  )

  // Success state
  if (success) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center">
          <div className="flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mx-auto mb-4">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Form Submitted Successfully</h2>
          <p className="text-sm text-gray-600 mb-6">Your compliance form has been submitted and recorded.</p>

          {/* Proof of submission */}
          <div className="bg-white border border-green-200 rounded-xl p-4 text-left space-y-2 text-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Proof of Submission</p>
            <div className="flex justify-between">
              <span className="text-gray-500">Submission ID</span>
              <span className="font-mono text-xs text-gray-700">{success.submissionId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Submitted At</span>
              <span className="text-gray-700">{formatDateTime(success.submittedAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Store</span>
              <span className="text-gray-700">{expectedSubmission.stores?.name ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Submitted By</span>
              <span className="text-gray-700">{profile?.full_name ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Form</span>
              <span className="text-gray-700">{template.name}</span>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <Link href={`/branch-manager/submissions/${success.submissionId}`} className="flex-1">
              <Button variant="outline" className="w-full">View Submission</Button>
            </Link>
            <Link href="/branch-manager" className="flex-1">
              <Button className="w-full">Back to Dashboard</Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/branch-manager">
          <Button variant="ghost" size="sm" className="gap-1">
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 truncate">{template.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {expectedSubmission.stores?.name} ·{' '}
            Due {expectedSubmission.due_date}
            {expectedSubmission.due_time && ` at ${expectedSubmission.due_time.slice(0, 5)}`}
          </p>
        </div>
        <StatusBadge status={existingSubmission?.status ?? expectedSubmission.status} />
      </div>

      {/* Missed banner */}
      {isMissed && (
        <div className="flex gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">Submission Window Closed</p>
            <p className="text-sm text-red-600 mt-0.5">
              The deadline has passed. This form is now locked and cannot be submitted.
            </p>
          </div>
        </div>
      )}

      {/* Rejected banner */}
      {!isMissed && existingSubmission?.status === 'rejected' && existingSubmission.review_notes && (
        <div className="flex gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">Submission Rejected</p>
            <p className="text-sm text-red-600 mt-0.5">{existingSubmission.review_notes}</p>
          </div>
        </div>
      )}

      {/* Submitted notice */}
      {!isMissed && isReadOnly && (
        <div className="flex gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
          <CheckCircle className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-blue-700">Submitted</p>
            <p className="text-sm text-blue-600 mt-0.5">
              This form was submitted on{' '}
              {existingSubmission?.submitted_at ? formatDateTime(existingSubmission.submitted_at) : '—'}.
              View only.
            </p>
          </div>
        </div>
      )}

      {/* Template description */}
      {template.description && (
        <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3 border border-gray-200">
          {template.description}
        </p>
      )}

      {/* Form sections */}
      {template.form_sections.map(section => (
        <Card key={section.id}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {section.form_questions.map(question => {
              const existingAnswer = existingSubmission?.submission_answers.find(a => a.question_id === question.id)
              const currentValue = answers[question.id] ?? existingAnswer?.answer_text ?? ''
              const error = errors[question.id]

              // Conditional display: only show if parent question has the required answer
              const opts = (question.options && typeof question.options === 'object' && !Array.isArray(question.options))
                ? question.options as { conditional_on?: string; show_when?: string }
                : null
              if (opts?.conditional_on) {
                const parentAnswer = answers[opts.conditional_on] ??
                  existingSubmission?.submission_answers.find(a => a.question_id === opts.conditional_on)?.answer_text ?? ''
                if (parentAnswer !== opts.show_when) return null
              }

              return (
                <div key={question.id} id={`q-${question.id}`} className="space-y-1.5">
                  <label className="block text-sm font-medium text-gray-700">
                    {question.question_text}
                    {question.is_required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  {question.help_text && (
                    <p className="text-xs text-gray-500">{question.help_text}</p>
                  )}

                  {/* Text */}
                  {question.question_type === 'text' && (
                    isReadOnly ? (
                      <p className="text-sm text-gray-900 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 min-h-[38px]">{currentValue || '—'}</p>
                    ) : (
                      <Input
                        value={currentValue}
                        onChange={e => handleAnswer(question.id, e.target.value)}
                        error={error}
                        placeholder="Enter your answer"
                      />
                    )
                  )}

                  {/* Textarea */}
                  {question.question_type === 'textarea' && (
                    isReadOnly ? (
                      <p className="text-sm text-gray-900 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 whitespace-pre-wrap min-h-[80px]">{currentValue || '—'}</p>
                    ) : (
                      <Textarea
                        value={currentValue}
                        onChange={e => handleAnswer(question.id, e.target.value)}
                        error={error}
                        placeholder="Enter your answer"
                        rows={4}
                      />
                    )
                  )}

                  {/* Yes/No */}
                  {question.question_type === 'yes_no' && (() => {
                    const noPhotoUrl = (existingAnswer?.answer_value as { no_photo_url?: string } | null)?.no_photo_url
                    return (
                      <div className="space-y-3">
                        <div className="flex gap-4">
                          {['Yes', 'No'].map(option => {
                            const isSelected = currentValue === option
                            return (
                              <label
                                key={option}
                                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border cursor-pointer text-sm font-medium transition-colors ${
                                  isSelected
                                    ? option === 'Yes'
                                      ? 'bg-green-50 border-green-400 text-green-700'
                                      : 'bg-red-50 border-red-400 text-red-700'
                                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                                } ${isReadOnly ? 'cursor-default' : ''}`}
                              >
                                <input
                                  type="radio"
                                  name={`q-${question.id}`}
                                  value={option}
                                  checked={isSelected}
                                  onChange={() => !isReadOnly && handleAnswer(question.id, option)}
                                  disabled={isReadOnly}
                                  className="sr-only"
                                />
                                {option}
                              </label>
                            )
                          })}
                        </div>

                        {/* Inline photo when No is selected */}
                        {currentValue === 'No' && !isReadOnly && (
                          <div className="pl-1 space-y-2">
                            <p className="text-xs font-medium text-red-600">Photo evidence required</p>
                            <CameraCapture
                              onCapture={file => handleNoPhoto(question.id, file)}
                              preview={noPhotoPreviews[question.id] ?? null}
                              label={noPhotos[question.id] ? 'Retake photo' : 'Take photo as evidence'}
                              error={!!errors[question.id]}
                              className="border-red-200 bg-red-50 hover:border-red-400"
                            />
                          </div>
                        )}

                        {/* Read-only: show evidence photo if it was submitted */}
                        {isReadOnly && currentValue === 'No' && noPhotoUrl && (
                          <div className="pl-1 space-y-1">
                            <p className="text-xs font-medium text-gray-500">Photo evidence</p>
                            <a href={noPhotoUrl} target="_blank" rel="noopener noreferrer">
                              <Image
                                src={noPhotoUrl}
                                alt="Evidence photo"
                                width={300}
                                height={200}
                                className="rounded-lg border border-gray-200 object-cover max-h-48 cursor-pointer hover:opacity-90 transition"
                              />
                            </a>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {/* Multiple choice */}
                  {question.question_type === 'multiple_choice' && (
                    <div className="space-y-2">
                      {(question.options as string[] | null ?? []).map((option: string) => {
                        const isSelected = currentValue === option
                        return (
                          <label
                            key={option}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border cursor-pointer text-sm transition-colors ${
                              isSelected ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                            } ${isReadOnly ? 'cursor-default' : ''}`}
                          >
                            <input
                              type="radio"
                              name={`q-${question.id}`}
                              value={option}
                              checked={isSelected}
                              onChange={() => !isReadOnly && handleAnswer(question.id, option)}
                              disabled={isReadOnly}
                              className="h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
                            />
                            {option}
                          </label>
                        )
                      })}
                    </div>
                  )}

                  {/* Number */}
                  {question.question_type === 'number' && (
                    isReadOnly ? (
                      <p className="text-sm text-gray-900 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 min-h-[38px]">{currentValue || '—'}</p>
                    ) : (
                      <Input
                        type="number"
                        value={currentValue}
                        onChange={e => handleAnswer(question.id, e.target.value)}
                        error={error}
                        placeholder="0"
                      />
                    )
                  )}

                  {/* Date */}
                  {question.question_type === 'date' && (
                    isReadOnly ? (
                      <p className="text-sm text-gray-900 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 min-h-[38px]">{currentValue || '—'}</p>
                    ) : (
                      <Input
                        type="date"
                        value={currentValue}
                        onChange={e => handleAnswer(question.id, e.target.value)}
                        error={error}
                      />
                    )
                  )}

                  {/* Signature (text-based) */}
                  {question.question_type === 'signature' && (
                    isReadOnly ? (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 min-h-[38px]">
                        <p className="text-sm text-gray-700 font-medium italic">{currentValue || '—'}</p>
                        {currentValue && <p className="text-xs text-gray-400 mt-0.5">Digital signature</p>}
                      </div>
                    ) : (
                      <Input
                        value={currentValue}
                        onChange={e => handleAnswer(question.id, e.target.value)}
                        error={error}
                        placeholder="Type your full name as signature"
                      />
                    )
                  )}

                  {/* Photo upload */}
                  {question.question_type === 'photo' && (
                    <div className="space-y-2">
                      {isReadOnly ? (
                        currentValue ? (
                          <a href={currentValue} target="_blank" rel="noopener noreferrer">
                            <Image
                              src={currentValue}
                              alt="Uploaded photo"
                              width={300}
                              height={200}
                              className="rounded-lg border border-gray-200 object-cover max-h-48 cursor-pointer hover:opacity-90 transition"
                            />
                          </a>
                        ) : (
                          <p className="text-sm text-gray-400 italic">No photo uploaded</p>
                        )
                      ) : (
                        <CameraCapture
                          onCapture={file => handlePhoto(question.id, file)}
                          preview={photoPreviews[question.id] ?? (currentValue || null)}
                          label={photos[question.id] ? 'Retake photo' : 'Tap to take a photo'}
                          error={!!error}
                        />
                      )}
                    </div>
                  )}

                  {error && (
                    <p className="text-xs text-red-600 flex items-center gap-1 mt-1">
                      <AlertCircle className="h-3 w-3" /> {error}
                    </p>
                  )}

                  {/* Per-question comment */}
                  {isReadOnly ? (
                    (existingAnswer?.answer_value as { comment?: string } | null)?.comment ? (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-gray-500 mb-1">Comment</p>
                        <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 border border-gray-200 whitespace-pre-wrap">
                          {(existingAnswer?.answer_value as { comment?: string }).comment}
                        </p>
                      </div>
                    ) : null
                  ) : (
                    <div className="mt-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Comment <span className="text-gray-400 font-normal">(optional)</span></label>
                      <textarea
                        value={comments[question.id] ?? ''}
                        onChange={e => handleComment(question.id, e.target.value)}
                        placeholder="Add a comment..."
                        rows={2}
                        className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-gray-700 placeholder-gray-400"
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      ))}

      {/* Action buttons */}
      {!isReadOnly && (
        <div className="flex items-center justify-between gap-3 py-4 border-t border-gray-200 bg-gray-50 rounded-xl px-4 sticky bottom-4">
          <Button
            variant="outline"
            size="md"
            onClick={handleSaveDraft}
            loading={saving}
            disabled={submitting}
          >
            <Save className="h-4 w-4" />
            Save Draft
          </Button>
          <div className="flex gap-3">
            <Link href="/branch-manager">
              <Button variant="ghost" size="md" disabled={submitting || saving}>
                Cancel
              </Button>
            </Link>
            <Button
              size="md"
              onClick={handleSubmit}
              loading={submitting}
              disabled={saving}
            >
              <Send className="h-4 w-4" />
              {existingSubmission?.status === 'rejected' ? 'Resubmit' : 'Submit Form'}
            </Button>
          </div>
        </div>
      )}

      {isReadOnly && (
        <div className="flex justify-end gap-3 pb-6">
          <Link href="/branch-manager">
            <Button variant="outline">Back to Dashboard</Button>
          </Link>
          <Link href={`/branch-manager/submissions/${existingSubmission?.id}`}>
            <Button>View Submission Details</Button>
          </Link>
        </div>
      )}
    </div>
  )
}
