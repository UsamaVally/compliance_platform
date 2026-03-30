'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, FileText, ChevronRight, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/lib/hooks/useProfile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Modal } from '@/components/ui/modal'
import { Card, CardContent } from '@/components/ui/card'
import { LoadingPage } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import type { FormTemplate, Schedule } from '@/lib/types'

type TemplateWithCount = FormTemplate & { section_count: number; question_count: number }

export default function FormTemplatesPage() {
  const { profile, loading: profileLoading } = useProfile()
  const [templates, setTemplates] = useState<TemplateWithCount[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<FormTemplate | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', schedule_id: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchTemplates = useCallback(async () => {
    if (!profile) return
    const supabase = createClient()

    const [{ data: rawTemplates }, { data: rawSchedules }] = await Promise.all([
      supabase
        .from('form_templates')
        .select('*, form_sections(id, form_questions(id))')
        .eq('organisation_id', profile.organisation_id)
        .order('created_at', { ascending: false }),
      supabase
        .from('schedules')
        .select('*')
        .eq('organisation_id', profile.organisation_id)
        .order('name'),
    ])

    setSchedules(rawSchedules ?? [])
    setTemplates(
      (rawTemplates ?? []).map((t: any) => ({
        ...t,
        section_count: t.form_sections?.length ?? 0,
        question_count: t.form_sections?.reduce((acc: number, s: any) => acc + (s.form_questions?.length ?? 0), 0) ?? 0,
      }))
    )
    setLoading(false)
  }, [profile])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  async function handleCreate() {
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { data, error: err } = await supabase
      .from('form_templates')
      .insert({
        organisation_id: profile!.organisation_id,
        name: form.name.trim(),
        description: form.description.trim() || null,
        schedule_id: form.schedule_id || null,
        is_active: true,
        version: 1,
      })
      .select('id')
      .single()
    if (err) { setError(err.message); setSaving(false); return }
    setModalOpen(false)
    setForm({ name: '', description: '', schedule_id: '' })
    await fetchTemplates()
    setSaving(false)
    // Navigate to the builder
    window.location.href = `/admin/forms/${data.id}`
  }

  async function handleDelete() {
    if (!selectedTemplate) return
    setDeleting(true)
    const supabase = createClient()
    await supabase.from('form_templates').delete().eq('id', selectedTemplate.id)
    await fetchTemplates()
    setDeleteOpen(false)
    setDeleting(false)
  }

  async function toggleActive(t: FormTemplate) {
    const supabase = createClient()
    await supabase.from('form_templates').update({ is_active: !t.is_active }).eq('id', t.id)
    await fetchTemplates()
  }

  if (profileLoading || loading) return <LoadingPage />

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Form Templates</h1>
          <p className="text-sm text-gray-500 mt-1">
            {templates.length} template{templates.length !== 1 ? 's' : ''} — build the forms branch managers fill out
          </p>
        </div>
        <Button onClick={() => { setForm({ name: '', description: '', schedule_id: '' }); setError(''); setModalOpen(true) }}>
          <Plus className="h-4 w-4" /> New Template
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {templates.length === 0 ? (
            <div className="px-6 py-10">
              <EmptyState
                icon={FileText}
                title="No form templates yet"
                description="Create your first template to define the questions branch managers will answer."
              />
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {templates.map(t => (
                <div key={t.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                  <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <FileText className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900 truncate">{t.name}</p>
                      <Badge variant={t.is_active ? 'success' : 'default'}>
                        {t.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    {t.description && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{t.description}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {t.section_count} section{t.section_count !== 1 ? 's' : ''} · {t.question_count} question{t.question_count !== 1 ? 's' : ''} · v{t.version}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => { setSelectedTemplate(t); setDeleteOpen(true) }}
                      className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => toggleActive(t)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                      title={t.is_active ? 'Deactivate' : 'Activate'}
                    >
                      {t.is_active ? <ToggleRight className="h-5 w-5 text-indigo-500" /> : <ToggleLeft className="h-5 w-5" />}
                    </button>
                    <Link href={`/admin/forms/${t.id}`}>
                      <Button size="sm" variant="outline">
                        Edit <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="New Form Template" size="md">
        <div className="space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          <Input
            label="Template Name"
            required
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Store Compliance Check"
            autoFocus
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Brief description of what this form checks..."
              rows={2}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
          </div>
          <Select
            label="Link to Schedule"
            options={schedules.map(s => ({ value: s.id, label: s.name }))}
            placeholder="No schedule (standalone)"
            value={form.schedule_id}
            onChange={e => setForm(f => ({ ...f, schedule_id: e.target.value }))}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button loading={saving} onClick={handleCreate}>
              <Plus className="h-4 w-4" /> Create & Build
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Form Template" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Permanently delete <strong>{selectedTemplate?.name}</strong>? All sections and questions inside it will also be deleted. This cannot be undone.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={deleting} onClick={handleDelete}>Delete Template</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
