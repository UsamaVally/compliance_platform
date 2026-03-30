'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, Trash2, ChevronUp, ChevronDown, ChevronLeft,
  GripVertical, Edit2, Check, X, Eye, EyeOff,
  MessageSquare, Camera, CheckCircle2, XCircle,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/lib/hooks/useProfile'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { Card, CardContent } from '@/components/ui/card'
import { LoadingPage } from '@/components/ui/loading'
import type { FormTemplate, FormSection, FormQuestion } from '@/lib/types'

// Options stored in the question's options JSON field for yes/no questions
interface YesNoOptions {
  require_photo_if_no: boolean
  comment_mode: 'required' | 'optional' | 'none'
}

type QuestionWithOptions = FormQuestion & {
  yes_no_options?: YesNoOptions
}

type SectionWithQuestions = FormSection & {
  form_questions: QuestionWithOptions[]
}

const DEFAULT_YES_NO_OPTIONS: YesNoOptions = {
  require_photo_if_no: true,
  comment_mode: 'optional',
}

const COMMENT_MODE_LABELS = {
  required: 'Comments — Required',
  optional: 'Comments — Optional',
  none: 'No Comments',
}

function parseYesNoOptions(q: FormQuestion): YesNoOptions {
  if (!q.options || typeof q.options !== 'object' || Array.isArray(q.options)) {
    return DEFAULT_YES_NO_OPTIONS
  }
  const opts = q.options as Record<string, unknown>
  return {
    require_photo_if_no: opts.require_photo_if_no !== false,
    comment_mode: (opts.comment_mode as YesNoOptions['comment_mode']) ?? 'optional',
  }
}

const emptyQuestion = {
  question_text: '',
  require_photo_if_no: true,
  comment_mode: 'optional' as YesNoOptions['comment_mode'],
}

export default function FormBuilderPage() {
  const { id: templateId } = useParams<{ id: string }>()
  const { profile, loading: profileLoading } = useProfile()

  const [template, setTemplate] = useState<FormTemplate | null>(null)
  const [sections, setSections] = useState<SectionWithQuestions[]>([])
  const [loading, setLoading] = useState(true)
  const [previewMode, setPreviewMode] = useState(false)

  // Template meta editing
  const [editingMeta, setEditingMeta] = useState(false)
  const [metaName, setMetaName] = useState('')
  const [metaDesc, setMetaDesc] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)

  // Question modal
  const [questionModal, setQuestionModal] = useState<{
    open: boolean
    editing: QuestionWithOptions | null
  }>({ open: false, editing: null })
  const [qForm, setQForm] = useState(emptyQuestion)
  const [savingQuestion, setSavingQuestion] = useState(false)
  const [qError, setQError] = useState('')

  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; text: string } | null>(null)

  const fetchData = useCallback(async () => {
    if (!profile || !templateId) return
    const supabase = createClient()

    const { data: tmpl } = await supabase
      .from('form_templates')
      .select('*')
      .eq('id', templateId)
      .eq('organisation_id', profile.organisation_id)
      .single()

    if (!tmpl) { setLoading(false); return }
    setTemplate(tmpl)
    setMetaName(tmpl.name)
    setMetaDesc(tmpl.description ?? '')

    const { data: secs } = await supabase
      .from('form_sections')
      .select('*, form_questions(*)')
      .eq('template_id', templateId)
      .order('order_index')

    const enrichedSections = (secs ?? []).map(s => ({
      ...s,
      form_questions: [...(s.form_questions ?? [])]
        .sort((a, b) => a.order_index - b.order_index)
        .map(q => ({ ...q, yes_no_options: parseYesNoOptions(q) })),
    }))

    setSections(enrichedSections)
    setLoading(false)
  }, [profile, templateId])

  useEffect(() => { fetchData() }, [fetchData])

  // Ensure there's always a default section
  async function ensureDefaultSection(): Promise<string> {
    if (sections.length > 0) return sections[0].id
    const supabase = createClient()
    const { data } = await supabase
      .from('form_sections')
      .insert({ template_id: templateId, title: 'Questions', order_index: 0 })
      .select('id')
      .single()
    await fetchData()
    return data?.id ?? ''
  }

  // ── Template meta ──────────────────────────────────────────
  async function saveMeta() {
    if (!metaName.trim()) return
    setSavingMeta(true)
    const supabase = createClient()
    await supabase
      .from('form_templates')
      .update({ name: metaName.trim(), description: metaDesc.trim() || null })
      .eq('id', templateId)
    setTemplate(prev => prev ? { ...prev, name: metaName.trim(), description: metaDesc.trim() || null } : prev)
    setEditingMeta(false)
    setSavingMeta(false)
  }

  // ── Questions ─────────────────────────────────────────────
  function openAddQuestion() {
    setQForm(emptyQuestion)
    setQError('')
    setQuestionModal({ open: true, editing: null })
  }

  function openEditQuestion(q: QuestionWithOptions) {
    setQForm({
      question_text: q.question_text,
      require_photo_if_no: q.yes_no_options?.require_photo_if_no ?? true,
      comment_mode: q.yes_no_options?.comment_mode ?? 'optional',
    })
    setQError('')
    setQuestionModal({ open: true, editing: q })
  }

  async function saveQuestion() {
    if (!qForm.question_text.trim()) { setQError('Question text is required.'); return }
    setSavingQuestion(true)
    setQError('')

    const sectionId = await ensureDefaultSection()
    if (!sectionId) { setSavingQuestion(false); return }

    const supabase = createClient()
    const allQs = sections.flatMap(s => s.form_questions)
    const nextIndex = questionModal.editing ? questionModal.editing.order_index : allQs.length

    const options: YesNoOptions = {
      require_photo_if_no: qForm.require_photo_if_no,
      comment_mode: qForm.comment_mode,
    }

    const payload = {
      template_id: templateId,
      section_id: sectionId,
      question_text: qForm.question_text.trim(),
      question_type: 'yes_no' as const,
      is_required: true,
      options,
      order_index: nextIndex,
      help_text: null,
    }

    if (questionModal.editing) {
      await supabase.from('form_questions').update(payload).eq('id', questionModal.editing.id)
    } else {
      await supabase.from('form_questions').insert(payload)
    }

    setQuestionModal({ open: false, editing: null })
    setSavingQuestion(false)
    await fetchData()
  }

  async function deleteQuestion(id: string) {
    const supabase = createClient()
    await supabase.from('form_questions').delete().eq('id', id)
    setDeleteConfirm(null)
    await fetchData()
  }

  async function moveQuestion(sectionId: string, index: number, dir: -1 | 1) {
    const section = sections.find(s => s.id === sectionId)
    if (!section) return
    const qs = section.form_questions
    const other = index + dir
    if (other < 0 || other >= qs.length) return
    const supabase = createClient()
    await Promise.all([
      supabase.from('form_questions').update({ order_index: other }).eq('id', qs[index].id),
      supabase.from('form_questions').update({ order_index: index }).eq('id', qs[other].id),
    ])
    await fetchData()
  }

  const allQuestions = sections.flatMap(s => s.form_questions)

  if (profileLoading || loading) return <LoadingPage />
  if (!template) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-4">Form template not found.</p>
      </div>
    )
  }

  // ─── PREVIEW MODE ──────────────────────────────────────────
  if (previewMode) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setPreviewMode(false)}>
            <X className="h-4 w-4" /> Close Preview
          </Button>
          <Badge variant="info">Preview Mode</Badge>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-gray-900">{template.name}</h1>
          {template.description && <p className="text-sm text-gray-500 mt-1">{template.description}</p>}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-blue-700 mb-1">How this form works</p>
          <ul className="text-xs text-blue-600 space-y-0.5 list-disc list-inside">
            <li>Answer each question with Yes or No</li>
            <li>A comments field appears under every question</li>
            <li>If you answer No, a photo upload is required</li>
          </ul>
        </div>

        {allQuestions.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">No questions yet.</p>
        ) : (
          <div className="space-y-4">
            {allQuestions.map((q, idx) => (
              <div key={q.id} className="border border-gray-200 rounded-xl p-5 bg-white space-y-4">
                {/* Question */}
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center mt-0.5">
                    {idx + 1}
                  </span>
                  <p className="text-sm font-medium text-gray-900">{q.question_text}</p>
                </div>

                {/* Yes / No buttons */}
                <div className="flex gap-3 ml-9">
                  <button className="flex items-center gap-2 px-5 py-2 rounded-lg border-2 border-green-200 bg-green-50 text-green-700 text-sm font-semibold hover:bg-green-100 transition-colors">
                    <CheckCircle2 className="h-4 w-4" /> Yes
                  </button>
                  <button className="flex items-center gap-2 px-5 py-2 rounded-lg border-2 border-red-200 bg-red-50 text-red-700 text-sm font-semibold hover:bg-red-100 transition-colors">
                    <XCircle className="h-4 w-4" /> No
                  </button>
                </div>

                {/* Comments */}
                {q.yes_no_options?.comment_mode !== 'none' && (
                  <div className="ml-9">
                    <label className="text-xs font-medium text-gray-500 flex items-center gap-1.5 mb-1">
                      <MessageSquare className="h-3.5 w-3.5" />
                      Comments
                      {q.yes_no_options?.comment_mode === 'required'
                        ? <span className="text-red-400">*</span>
                        : <span className="text-gray-400">(optional)</span>
                      }
                    </label>
                    <div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 h-16 text-xs text-gray-400">
                      Type comments here…
                    </div>
                  </div>
                )}

                {/* Photo if No */}
                {q.yes_no_options?.require_photo_if_no && (
                  <div className="ml-9 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
                    <Camera className="h-4 w-4 text-amber-600 flex-shrink-0" />
                    <p className="text-xs text-amber-700">
                      <strong>Photo required</strong> if answer is No
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <Button className="w-full" variant="primary">Submit Form</Button>
      </div>
    )
  }

  // ─── BUILDER MODE ──────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Back + Header */}
      <div className="flex items-start gap-3">
        <Link href="/admin/forms">
          <Button variant="ghost" size="sm" className="mt-0.5">
            <ChevronLeft className="h-4 w-4" /> Templates
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          {editingMeta ? (
            <div className="space-y-2">
              <input
                className="text-2xl font-bold text-gray-900 bg-transparent border-b-2 border-indigo-400 outline-none w-full"
                value={metaName}
                onChange={e => setMetaName(e.target.value)}
                autoFocus
              />
              <input
                className="text-sm text-gray-500 bg-transparent border-b border-gray-300 outline-none w-full"
                value={metaDesc}
                onChange={e => setMetaDesc(e.target.value)}
                placeholder="Add a description…"
              />
              <div className="flex gap-2 mt-1">
                <Button size="sm" loading={savingMeta} onClick={saveMeta}>
                  <Check className="h-3.5 w-3.5" /> Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditingMeta(false)
                    setMetaName(template.name)
                    setMetaDesc(template.description ?? '')
                  }}
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-gray-900">{template.name}</h1>
                {template.description && (
                  <p className="text-sm text-gray-500 mt-0.5">{template.description}</p>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  {allQuestions.length} question{allQuestions.length !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={() => setEditingMeta(true)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors mt-0.5"
              >
                <Edit2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-0.5 flex-shrink-0"
          onClick={() => setPreviewMode(true)}
        >
          <Eye className="h-4 w-4" /> Preview
        </Button>
      </div>

      {/* How-it-works banner */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-indigo-700 mb-1">Template Rules</p>
        <ul className="text-xs text-indigo-600 space-y-0.5 list-disc list-inside">
          <li>All questions are Yes / No</li>
          <li>A comments field is shown under every question (configurable per question)</li>
          <li>If the answer is <strong>No</strong>, a photo upload is required by default (configurable per question)</li>
        </ul>
      </div>

      {/* Questions list */}
      {allQuestions.length === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <p className="text-sm text-gray-500 mb-4">No questions yet. Add your first question below.</p>
          <Button onClick={openAddQuestion}>
            <Plus className="h-4 w-4" /> Add First Question
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map(section =>
            section.form_questions.map((q, qi) => (
              <Card key={q.id} className="group">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <GripVertical className="h-4 w-4 text-gray-300 flex-shrink-0 mt-1 cursor-grab" />

                    {/* Question number */}
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center mt-0.5">
                      {qi + 1}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-2">
                      <p className="text-sm font-medium text-gray-900">{q.question_text}</p>

                      {/* Badges */}
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="info" className="text-xs">Yes / No</Badge>

                        {q.yes_no_options?.require_photo_if_no ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                            <Camera className="h-3 w-3" /> Photo if No
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                            <Camera className="h-3 w-3" /> No photo
                          </span>
                        )}

                        {q.yes_no_options?.comment_mode !== 'none' && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                            <MessageSquare className="h-3 w-3" />
                            {q.yes_no_options?.comment_mode === 'required' ? 'Comment required' : 'Comment optional'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => moveQuestion(section.id, qi, -1)}
                        disabled={qi === 0}
                        className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-20 transition-colors"
                        title="Move up"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => moveQuestion(section.id, qi, 1)}
                        disabled={qi === section.form_questions.length - 1}
                        className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-20 transition-colors"
                        title="Move down"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => openEditQuestion(q)}
                        className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                        title="Edit"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm({ id: q.id, text: q.question_text })}
                        className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}

          {/* Add question button at bottom */}
          <button
            onClick={openAddQuestion}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/30 transition-colors text-sm font-medium"
          >
            <Plus className="h-4 w-4" /> Add Question
          </button>
        </div>
      )}

      {/* Question Modal */}
      <Modal
        isOpen={questionModal.open}
        onClose={() => setQuestionModal({ open: false, editing: null })}
        title={questionModal.editing ? 'Edit Question' : 'Add Question'}
        size="md"
      >
        <div className="space-y-5">
          {qError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{qError}</p>
          )}

          {/* Question text */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Question Text <span className="text-red-500">*</span>
            </label>
            <textarea
              value={qForm.question_text}
              onChange={e => setQForm(f => ({ ...f, question_text: e.target.value }))}
              placeholder="e.g. Is the price tag correctly positioned?"
              rows={3}
              autoFocus
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Answer type info */}
          <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex gap-2">
              <span className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-100 text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Yes
              </span>
              <span className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-100 text-red-700">
                <XCircle className="h-3.5 w-3.5" /> No
              </span>
            </div>
            <p className="text-xs text-gray-500">Answer type is always Yes / No</p>
          </div>

          {/* Photo if No */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Photo Upload
            </label>
            <div
              className={`flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-colors ${
                qForm.require_photo_if_no
                  ? 'border-amber-400 bg-amber-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
              onClick={() => setQForm(f => ({ ...f, require_photo_if_no: !f.require_photo_if_no }))}
            >
              <div className="flex items-center gap-3">
                <Camera className={`h-5 w-5 flex-shrink-0 ${qForm.require_photo_if_no ? 'text-amber-600' : 'text-gray-400'}`} />
                <div>
                  <p className={`text-sm font-semibold ${qForm.require_photo_if_no ? 'text-amber-800' : 'text-gray-600'}`}>
                    Require photo if answer is No
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    If toggled on, respondents must upload a photo when they answer No.
                  </p>
                </div>
              </div>
              <div className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${qForm.require_photo_if_no ? 'bg-amber-500' : 'bg-gray-200'}`}>
                <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${qForm.require_photo_if_no ? 'translate-x-5' : 'translate-x-0'}`} />
              </div>
            </div>
          </div>

          {/* Comments field */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Comments Field
            </label>
            <div className="space-y-2">
              {(['required', 'optional', 'none'] as const).map(mode => (
                <label
                  key={mode}
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                    qForm.comment_mode === mode
                      ? 'border-indigo-400 bg-indigo-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="comment_mode"
                    value={mode}
                    checked={qForm.comment_mode === mode}
                    onChange={() => setQForm(f => ({ ...f, comment_mode: mode }))}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {mode === 'required' ? 'Required' : mode === 'optional' ? 'Optional' : 'None'}
                    </p>
                    <p className="text-xs text-gray-500">
                      {mode === 'required' && 'Respondent must enter a comment before submitting.'}
                      {mode === 'optional' && 'Comment field is shown but not mandatory.'}
                      {mode === 'none' && 'No comment field shown for this question.'}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={() => setQuestionModal({ open: false, editing: null })}
            >
              Cancel
            </Button>
            <Button loading={savingQuestion} onClick={saveQuestion}>
              {questionModal.editing ? 'Save Changes' : 'Add Question'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Question"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Are you sure you want to delete{' '}
            <strong className="font-semibold">
              &ldquo;{deleteConfirm?.text.length && deleteConfirm.text.length > 60
                ? deleteConfirm.text.slice(0, 60) + '…'
                : deleteConfirm?.text}&rdquo;
            </strong>?
            This cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => deleteConfirm && deleteQuestion(deleteConfirm.id)}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
