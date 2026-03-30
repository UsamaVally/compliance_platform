'use client'

import { useEffect, useState } from 'react'
import { Settings, Save, AlertTriangle, Bell, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/lib/hooks/useProfile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingPage } from '@/components/ui/loading'
import type { Organisation } from '@/lib/types'

interface OrgSettings {
  missed_submission_escalation_hours: number
  unresolved_action_escalation_days: number
  repeat_offender_threshold: number
  repeat_offender_window_days: number
  email_notifications_enabled: boolean
  notify_on_missed_submission: boolean
  notify_on_late_submission: boolean
  notify_on_action_assigned: boolean
  notify_on_action_overdue: boolean
}

const DEFAULT_SETTINGS: OrgSettings = {
  missed_submission_escalation_hours: 24,
  unresolved_action_escalation_days: 3,
  repeat_offender_threshold: 3,
  repeat_offender_window_days: 30,
  email_notifications_enabled: true,
  notify_on_missed_submission: true,
  notify_on_late_submission: true,
  notify_on_action_assigned: true,
  notify_on_action_overdue: true,
}

export default function OrganisationPage() {
  const { profile: adminProfile, loading: profileLoading } = useProfile()
  const [org, setOrg] = useState<Organisation | null>(null)
  const [loading, setLoading] = useState(true)

  const [orgName, setOrgName] = useState('')
  const [orgSlug, setOrgSlug] = useState('')
  const [settings, setSettings] = useState<OrgSettings>(DEFAULT_SETTINGS)

  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [error, setError] = useState('')

  const [resetOpen, setResetOpen] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    if (!adminProfile) return
    const supabase = createClient()
    supabase
      .from('organisations')
      .select('*')
      .eq('id', adminProfile.organisation_id)
      .single()
      .then(({ data }) => {
        if (data) {
          setOrg(data)
          setOrgName(data.name)
          setOrgSlug(data.slug)
          const merged = { ...DEFAULT_SETTINGS, ...(data.settings as Partial<OrgSettings>) }
          setSettings(merged)
        }
        setLoading(false)
      })
  }, [adminProfile])

  async function handleSave() {
    if (!org) return
    setSaving(true)
    setError('')
    setSavedMsg('')
    const supabase = createClient()
    const { error: err } = await supabase
      .from('organisations')
      .update({ name: orgName, slug: orgSlug, settings: settings as any })
      .eq('id', org.id)

    if (err) {
      setError(err.message)
    } else {
      setSavedMsg('Organisation settings saved successfully.')
      // Audit log
      await supabase.from('audit_logs').insert({
        organisation_id: org.id,
        user_id: adminProfile?.id,
        action: 'organisation_updated',
        entity_type: 'organisations',
        entity_id: org.id,
        new_data: { name: orgName, slug: orgSlug },
      })
    }
    setSaving(false)
  }

  async function handleReset() {
    if (resetConfirmText !== 'RESET') return
    setResetting(true)
    const supabase = createClient()
    const orgId = org!.id

    // Delete all submissions, expected_submissions, audit_logs for this org
    await Promise.all([
      supabase.from('audit_logs').delete().eq('organisation_id', orgId),
      supabase.from('submission_answers').delete().in(
        'submission_id',
        (await supabase.from('submissions').select('id').eq('organisation_id', orgId)).data?.map(s => s.id) ?? []
      ),
      supabase.from('submissions').delete().eq('organisation_id', orgId),
      supabase.from('expected_submissions').delete().eq('organisation_id', orgId),
      supabase.from('notifications').delete().eq('organisation_id', orgId),
      supabase.from('actions').delete().eq('organisation_id', orgId),
    ])

    await supabase.from('audit_logs').insert({
      organisation_id: orgId,
      user_id: adminProfile?.id,
      action: 'organisation_data_reset',
      entity_type: 'organisations',
      entity_id: orgId,
      new_data: { reset_at: new Date().toISOString() },
    })

    setResetting(false)
    setResetOpen(false)
    setResetConfirmText('')
  }

  function setSettingNum(key: keyof OrgSettings, val: string) {
    const n = parseInt(val)
    if (!isNaN(n)) setSettings(s => ({ ...s, [key]: n }))
  }

  if (profileLoading || loading) return <LoadingPage />

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Organisation Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure your organisation's compliance platform settings.</p>
      </div>

      {savedMsg && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700">
          {savedMsg}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-gray-500" />
            <CardTitle>Organisation Details</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Organisation Name"
            value={orgName}
            onChange={e => setOrgName(e.target.value)}
          />
          <Input
            label="Slug"
            value={orgSlug}
            onChange={e => setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            helperText="Used in URLs. Lowercase, hyphens only."
          />
        </CardContent>
      </Card>

      {/* Escalation Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle>Compliance Thresholds</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Missed Submission Escalation (hours)"
              type="number"
              min={1}
              value={settings.missed_submission_escalation_hours}
              onChange={e => setSettingNum('missed_submission_escalation_hours', e.target.value)}
              helperText="Hours before a missed submission triggers escalation."
            />
            <Input
              label="Unresolved Action Escalation (days)"
              type="number"
              min={1}
              value={settings.unresolved_action_escalation_days}
              onChange={e => setSettingNum('unresolved_action_escalation_days', e.target.value)}
              helperText="Days before an open action is escalated."
            />
            <Input
              label="Repeat Offender Threshold"
              type="number"
              min={1}
              value={settings.repeat_offender_threshold}
              onChange={e => setSettingNum('repeat_offender_threshold', e.target.value)}
              helperText="Number of missed submissions to flag as repeat offender."
            />
            <Input
              label="Repeat Offender Window (days)"
              type="number"
              min={1}
              value={settings.repeat_offender_window_days}
              onChange={e => setSettingNum('repeat_offender_window_days', e.target.value)}
              helperText="Rolling window for repeat offender calculation."
            />
          </div>
        </CardContent>
      </Card>

      {/* Email Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-gray-500" />
            <CardTitle>Email Notification Settings</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {([
            ['email_notifications_enabled', 'Enable email notifications globally'],
            ['notify_on_missed_submission', 'Notify on missed submission'],
            ['notify_on_late_submission', 'Notify on late submission'],
            ['notify_on_action_assigned', 'Notify when action is assigned'],
            ['notify_on_action_overdue', 'Notify when action is overdue'],
          ] as [keyof OrgSettings, string][]).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <span className="text-sm text-gray-700">{label}</span>
              <button
                type="button"
                onClick={() => setSettings(s => ({ ...s, [key]: !s[key] }))}
                className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${
                  settings[key] ? 'bg-indigo-600' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    settings[key] ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button loading={saving} onClick={handleSave}>
          <Save className="h-4 w-4" /> Save Settings
        </Button>
      </div>

      {/* Danger Zone */}
      <Card className="border-red-200">
        <CardHeader className="border-b border-red-100 bg-red-50 rounded-t-xl">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <CardTitle className="text-red-700">Danger Zone</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900">Reset All Data</p>
              <p className="text-sm text-gray-500 mt-0.5">
                Permanently delete all submissions, expected submissions, audit logs, notifications and actions
                for this organisation. This action cannot be undone.
              </p>
            </div>
            <Button variant="danger" onClick={() => setResetOpen(true)}>
              <Trash2 className="h-4 w-4" /> Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reset Confirmation Modal */}
      <Modal isOpen={resetOpen} onClose={() => { setResetOpen(false); setResetConfirmText('') }} title="Confirm Data Reset" size="sm">
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm text-red-700 font-medium">This will permanently delete all operational data.</p>
            <p className="text-xs text-red-600 mt-1">User profiles, stores, regions and schedules will NOT be deleted.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Type <span className="font-mono font-bold">RESET</span> to confirm
            </label>
            <input
              type="text"
              value={resetConfirmText}
              onChange={e => setResetConfirmText(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="RESET"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setResetOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={resetting}
              disabled={resetConfirmText !== 'RESET'}
              onClick={handleReset}
            >
              Permanently Reset
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
