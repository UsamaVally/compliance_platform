'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ChevronLeft,
  Save,
  Send,
  CheckSquare,
  AlertTriangle,
  BarChart2,
  Users,
  Store as StoreIcon,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { LoadingPage } from '@/components/ui/loading'
import { formatDate } from '@/lib/utils'

function getWeekBounds() {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((day + 6) % 7))
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  return {
    start: monday.toISOString().split('T')[0],
    end: friday.toISOString().split('T')[0],
  }
}

function getLastWeekBounds() {
  const wb = getWeekBounds()
  const startDate = new Date(wb.start)
  startDate.setDate(startDate.getDate() - 7)
  const endDate = new Date(wb.end)
  endDate.setDate(endDate.getDate() - 7)
  return {
    start: startDate.toISOString().split('T')[0],
    end: endDate.toISOString().split('T')[0],
  }
}

interface RMPerformanceRow {
  rmId: string
  rmName: string
  regionId: string
  regionName: string
  escalationId: string | null
  escalationStatus: string | null
  submittedAt: string | null
  onTime: boolean | null
  actionTaken: string
}

interface BranchMissedRow {
  storeId: string
  storeName: string
  regionName: string
  missedCount: number
  actionStatus: string
}

interface UnresolvedItem {
  id: string
  type: 'escalation' | 'action'
  title: string
  status: string
  rmName?: string
  storeName?: string
  included: boolean
}

interface RegionTrend {
  regionId: string
  regionName: string
  thisWeekRate: number
  lastWeekRate: number
  thisTotal: number
  thisSubmitted: number
}

export default function GMReportPage() {
  const { profile, loading: profileLoading } = useProfile()
  const wb = getWeekBounds()
  const lwb = getLastWeekBounds()

  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [draftId, setDraftId] = useState<string | null>(null)

  // Section 1 – Period
  const [periodStart, setPeriodStart] = useState(wb.start)
  const [periodEnd, setPeriodEnd] = useState(wb.end)

  // Section 2 – RM Performance
  const [rmRows, setRmRows] = useState<RMPerformanceRow[]>([])

  // Section 3 – Branch Summary
  const [branchMissed, setBranchMissed] = useState<BranchMissedRow[]>([])

  // Section 4 – Unresolved Issues
  const [unresolvedItems, setUnresolvedItems] = useState<UnresolvedItem[]>([])
  const [escalationNotes, setEscalationNotes] = useState('')

  // Section 5 – Compliance Trend
  const [regionTrends, setRegionTrends] = useState<RegionTrend[]>([])
  const [overallThisWeek, setOverallThisWeek] = useState(0)
  const [overallLastWeek, setOverallLastWeek] = useState(0)

  // Section 6 – Sign off
  const [summaryComments, setSummaryComments] = useState('')
  const [actionItemsForHS, setActionItemsForHS] = useState('')
  const [signOff, setSignOff] = useState(false)

  const [dataLoaded, setDataLoaded] = useState(false)

  const loadData = useCallback(async () => {
    if (!profile) return
    const supabase = createClient()

    // GM's regions
    const { data: regionsData } = await supabase
      .from('regions')
      .select('id, name')
      .eq('general_manager_id', profile.id)

    const regions = (regionsData ?? []) as { id: string; name: string }[]
    const regionIds = regions.map(r => r.id)
    if (regionIds.length === 0) { setDataLoaded(true); return }

    // RM assignments
    const { data: rmData } = await supabase
      .from('user_region_assignments')
      .select('user_id, region_id, profiles!user_region_assignments_user_id_fkey(id, full_name, role)')
      .in('region_id', regionIds)

    type RMAssignment = { user_id: string; region_id: string; profiles: { id: string; full_name: string; role: string } | null }
    const rmList = (rmData ?? []) as unknown as RMAssignment[]
    const regionToRM: Record<string, { id: string; name: string }> = {}
    const rmMap: Record<string, { id: string; name: string; regionId: string }> = {}
    for (const a of rmList) {
      if (a.profiles?.role === 'regional_manager') {
        regionToRM[a.region_id] = { id: a.user_id, name: a.profiles.full_name }
        rmMap[a.user_id] = { id: a.user_id, name: a.profiles.full_name, regionId: a.region_id }
      }
    }
    const rmUserIds = Object.keys(rmMap)

    // This week's RM escalations
    const { data: escsData } = await supabase
      .from('escalations')
      .select('id, submitted_by, status, submitted_at, period_start')
      .in('submitted_by', rmUserIds.length > 0 ? rmUserIds : ['_none_'])
      .eq('escalation_type', 'regional_report')
      .gte('period_start', periodStart)
      .lte('period_start', periodEnd)

    type EscRow = { id: string; submitted_by: string; status: string; submitted_at: string | null; period_start: string }
    const escs = (escsData ?? []) as EscRow[]
    const rmToEsc: Record<string, EscRow> = {}
    for (const e of escs) {
      if (!rmToEsc[e.submitted_by]) rmToEsc[e.submitted_by] = e
    }

    // Build RM rows
    const rows: RMPerformanceRow[] = regions.map(region => {
      const rm = regionToRM[region.id]
      if (!rm) return null
      const esc = rmToEsc[rm.id]
      const onTime = esc?.submitted_at
        ? new Date(esc.submitted_at) <= new Date(periodEnd + 'T23:59:59')
        : null
      return {
        rmId: rm.id,
        rmName: rm.name,
        regionId: region.id,
        regionName: region.name,
        escalationId: esc?.id ?? null,
        escalationStatus: esc?.status ?? null,
        submittedAt: esc?.submitted_at ?? null,
        onTime,
        actionTaken: '',
      }
    }).filter(Boolean) as RMPerformanceRow[]

    setRmRows(rows)

    // Stores
    const { data: storesData } = await supabase
      .from('stores')
      .select('id, name, region_id')
      .in('region_id', regionIds)
      .eq('is_active', true)

    type StoreRow = { id: string; name: string; region_id: string | null }
    const allStores = (storesData ?? []) as StoreRow[]
    const storeIds = allStores.map(s => s.id)

    // This week expected - missed
    const { data: expectedData } = await supabase
      .from('expected_submissions')
      .select('store_id, status, due_date')
      .in('store_id', storeIds.length > 0 ? storeIds : ['_none_'])
      .gte('due_date', periodStart)
      .lte('due_date', periodEnd)

    type ExpRow = { store_id: string; status: string; due_date: string }
    const expected = (expectedData ?? []) as ExpRow[]

    // Branch missed summary
    const storeMissed: Record<string, number> = {}
    const storeSubmitted: Record<string, number> = {}
    const storeTotal: Record<string, number> = {}
    for (const exp of expected) {
      storeTotal[exp.store_id] = (storeTotal[exp.store_id] ?? 0) + 1
      if (exp.status === 'missed') storeMissed[exp.store_id] = (storeMissed[exp.store_id] ?? 0) + 1
      if (exp.status === 'submitted_on_time' || exp.status === 'submitted_late')
        storeSubmitted[exp.store_id] = (storeSubmitted[exp.store_id] ?? 0) + 1
    }
    const missedStoreIds = Object.entries(storeMissed).filter(([, c]) => c > 0).map(([id]) => id)
    const branchRows: BranchMissedRow[] = missedStoreIds.map(sid => {
      const store = allStores.find(s => s.id === sid)
      const region = store?.region_id ? regions.find(r => r.id === store.region_id) : null
      return {
        storeId: sid,
        storeName: store?.name ?? sid,
        regionName: region?.name ?? '—',
        missedCount: storeMissed[sid] ?? 0,
        actionStatus: 'pending',
      }
    }).sort((a, b) => b.missedCount - a.missedCount)

    setBranchMissed(branchRows)

    // Unresolved escalations
    const { data: unresolvedEscs } = await supabase
      .from('escalations')
      .select('id, submitted_by, status, period_start, period_end')
      .in('submitted_by', rmUserIds.length > 0 ? rmUserIds : ['_none_'])
      .eq('escalation_type', 'regional_report')
      .in('status', ['submitted', 'under_review'])

    type UnresEsc = { id: string; submitted_by: string; status: string; period_start: string; period_end: string }
    const ue = (unresolvedEscs ?? []) as UnresEsc[]
    const unresolvedEscItems: UnresolvedItem[] = ue.map(e => ({
      id: e.id,
      type: 'escalation',
      title: `Regional report: ${formatDate(e.period_start)} – ${formatDate(e.period_end)}`,
      status: e.status,
      rmName: rmMap[e.submitted_by]?.name ?? 'Unknown',
      included: false,
    }))

    // Overdue actions
    const today = new Date().toISOString().split('T')[0]
    const { data: overdueActions } = await supabase
      .from('actions')
      .select('id, title, status, store_id')
      .in('store_id', storeIds.length > 0 ? storeIds : ['_none_'])
      .lt('due_date', today)
      .not('status', 'in', '("resolved","verified","closed")')
      .limit(20)

    type OARow = { id: string; title: string; status: string; store_id: string | null }
    const oa = (overdueActions ?? []) as OARow[]
    const unresolvedActionItems: UnresolvedItem[] = oa.map(a => ({
      id: a.id,
      type: 'action',
      title: a.title,
      status: a.status,
      storeName: allStores.find(s => s.id === a.store_id)?.name ?? '—',
      included: false,
    }))

    setUnresolvedItems([...unresolvedEscItems, ...unresolvedActionItems])

    // Compliance trends
    const { data: lastWeekExpected } = await supabase
      .from('expected_submissions')
      .select('store_id, status')
      .in('store_id', storeIds.length > 0 ? storeIds : ['_none_'])
      .gte('due_date', lwb.start)
      .lte('due_date', lwb.end)

    const lwe = (lastWeekExpected ?? []) as ExpRow[]
    const lweByStore: Record<string, { total: number; submitted: number }> = {}
    for (const e of lwe) {
      if (!lweByStore[e.store_id]) lweByStore[e.store_id] = { total: 0, submitted: 0 }
      lweByStore[e.store_id].total++
      if (e.status === 'submitted_on_time' || e.status === 'submitted_late') lweByStore[e.store_id].submitted++
    }

    // Trends per region
    let totalThis = 0, subThis = 0, totalLast = 0, subLast = 0
    const trends: RegionTrend[] = regions.map(region => {
      const regionStores = allStores.filter(s => s.region_id === region.id)
      let thisTotal = 0, thisSub = 0, lastTotal = 0, lastSub = 0
      for (const store of regionStores) {
        const tw = expected.filter(e => e.store_id === store.id)
        const lw = lwe.filter(e => e.store_id === store.id)
        thisTotal += tw.length
        thisSub += tw.filter(e => e.status === 'submitted_on_time' || e.status === 'submitted_late').length
        lastTotal += lw.length
        lastSub += lw.filter(e => e.status === 'submitted_on_time' || e.status === 'submitted_late').length
      }
      totalThis += thisTotal; subThis += thisSub
      totalLast += lastTotal; subLast += lastSub
      return {
        regionId: region.id,
        regionName: region.name,
        thisWeekRate: thisTotal > 0 ? Math.round((thisSub / thisTotal) * 100) : 0,
        lastWeekRate: lastTotal > 0 ? Math.round((lastSub / lastTotal) * 100) : 0,
        thisTotal,
        thisSubmitted: thisSub,
      }
    })
    setRegionTrends(trends)
    setOverallThisWeek(totalThis > 0 ? Math.round((subThis / totalThis) * 100) : 0)
    setOverallLastWeek(totalLast > 0 ? Math.round((subLast / totalLast) * 100) : 0)

    // Check for existing draft
    const { data: draftData } = await supabase
      .from('escalations')
      .select('id, content, review_notes')
      .eq('submitted_by', profile.id)
      .eq('escalation_type', 'gm_report')
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (draftData) {
      setDraftId(draftData.id)
      const c = draftData.content as Record<string, unknown>
      if (c?.summary_comments) setSummaryComments(c.summary_comments as string)
      if (c?.action_items_for_hs) setActionItemsForHS(c.action_items_for_hs as string)
      if (c?.escalation_notes) setEscalationNotes(c.escalation_notes as string)
    }

    setDataLoaded(true)
  }, [profile, periodStart, periodEnd, lwb.start, lwb.end])

  useEffect(() => {
    if (profile) loadData()
  }, [profile, loadData])

  function buildContent() {
    return {
      period_start: periodStart,
      period_end: periodEnd,
      rm_performance: rmRows.map(r => ({
        rm_id: r.rmId,
        rm_name: r.rmName,
        region_name: r.regionName,
        submitted: !!r.escalationStatus && r.escalationStatus !== 'draft',
        on_time: r.onTime,
        action_taken: r.actionTaken,
      })),
      branch_missed: branchMissed.map(b => ({
        store_name: b.storeName,
        region_name: b.regionName,
        missed_count: b.missedCount,
      })),
      unresolved_issues: unresolvedItems.filter(i => i.included).map(i => ({
        id: i.id,
        type: i.type,
        title: i.title,
        status: i.status,
      })),
      escalation_notes: escalationNotes,
      overall_compliance_this_week: overallThisWeek,
      overall_compliance_last_week: overallLastWeek,
      region_trends: regionTrends.map(rt => ({
        region_name: rt.regionName,
        this_week: rt.thisWeekRate,
        last_week: rt.lastWeekRate,
      })),
      summary_comments: summaryComments,
      action_items_for_hs: actionItemsForHS,
    }
  }

  async function handleSaveDraft() {
    if (!profile) return
    setSaving(true)
    setError('')
    const supabase = createClient()
    const content = buildContent()

    if (draftId) {
      const { error: e } = await supabase.from('escalations').update({ content, updated_at: new Date().toISOString() }).eq('id', draftId)
      if (e) { setError('Failed to save draft.'); setSaving(false); return }
    } else {
      const { data, error: e } = await supabase.from('escalations').insert({
        organisation_id: profile.organisation_id,
        escalation_type: 'gm_report',
        submitted_by: profile.id,
        period_start: periodStart,
        period_end: periodEnd,
        status: 'draft',
        content,
      }).select('id').single()
      if (e) { setError('Failed to save draft.'); setSaving(false); return }
      setDraftId(data?.id ?? null)
    }

    setSuccess('Draft saved successfully.')
    setSaving(false)
    setTimeout(() => setSuccess(''), 3000)
  }

  async function handleSubmit() {
    if (!profile) return
    if (!signOff) { setError('Please sign off on the report before submitting.'); return }
    setSubmitting(true)
    setError('')
    const supabase = createClient()
    const content = buildContent()

    if (draftId) {
      const { error: e } = await supabase.from('escalations').update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        content,
        updated_at: new Date().toISOString(),
      }).eq('id', draftId)
      if (e) { setError('Failed to submit report.'); setSubmitting(false); return }
    } else {
      const { error: e } = await supabase.from('escalations').insert({
        organisation_id: profile.organisation_id,
        escalation_type: 'gm_report',
        submitted_by: profile.id,
        period_start: periodStart,
        period_end: periodEnd,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        content,
      })
      if (e) { setError('Failed to submit report.'); setSubmitting(false); return }
    }

    await supabase.from('audit_logs').insert({
      organisation_id: profile.organisation_id,
      user_id: profile.id,
      action: 'gm_report_submitted',
      entity_type: 'escalation',
      entity_id: draftId ?? undefined,
      new_data: { status: 'submitted', period_start: periodStart, period_end: periodEnd },
    })

    setSubmitting(false)
    setSuccess('GM Report submitted successfully.')
  }

  if (profileLoading || !dataLoaded) return <LoadingPage />

  const trendDiff = overallThisWeek - overallLastWeek

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Back */}
      <Link href="/general-manager">
        <Button variant="ghost" size="sm">
          <ChevronLeft className="h-4 w-4" />
          Back to Dashboard
        </Button>
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">GM Summary Report</h1>
          <p className="text-sm text-gray-500 mt-1">Submit weekly summary to Higher Supervision</p>
        </div>
        {draftId && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
            Draft saved
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {/* Section 1: Report Period */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">1</span>
            Report Period
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Period Start (Monday)"
              type="date"
              value={periodStart}
              onChange={e => setPeriodStart(e.target.value)}
            />
            <Input
              label="Period End (Friday)"
              type="date"
              value={periodEnd}
              onChange={e => setPeriodEnd(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 2: RM Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">2</span>
            <Users className="h-4 w-4" />
            Regional Manager Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rmRows.length === 0 ? (
            <div className="px-6 py-6 text-sm text-gray-500">No RMs found in your regions.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">RM Name</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Region</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Submitted?</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">On Time?</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action Taken (if missed)</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {rmRows.map((row, i) => (
                      <tr key={row.rmId} className="hover:bg-gray-50">
                        <td className="px-6 py-3 text-sm font-medium text-gray-900">{row.rmName}</td>
                        <td className="px-6 py-3 text-sm text-gray-600">{row.regionName}</td>
                        <td className="px-6 py-3">
                          {row.escalationStatus && row.escalationStatus !== 'draft'
                            ? <span className="text-xs font-medium text-green-700 bg-green-100 px-2.5 py-0.5 rounded-full">Yes</span>
                            : <span className="text-xs font-medium text-red-700 bg-red-100 px-2.5 py-0.5 rounded-full">No</span>
                          }
                        </td>
                        <td className="px-6 py-3">
                          {row.onTime === null
                            ? <span className="text-gray-400 text-xs">—</span>
                            : row.onTime
                              ? <span className="text-xs font-medium text-green-700 bg-green-100 px-2.5 py-0.5 rounded-full">On Time</span>
                              : <span className="text-xs font-medium text-yellow-700 bg-yellow-100 px-2.5 py-0.5 rounded-full">Late</span>
                          }
                        </td>
                        <td className="px-6 py-3">
                          <input
                            type="text"
                            value={row.actionTaken}
                            onChange={e => {
                              const updated = [...rmRows]
                              updated[i] = { ...updated[i], actionTaken: e.target.value }
                              setRmRows(updated)
                            }}
                            placeholder={(!row.escalationStatus || row.escalationStatus === 'draft') ? 'What action did you take?' : '—'}
                            disabled={!(!row.escalationStatus || row.escalationStatus === 'draft')}
                            className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-gray-50"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Section 3: Branch Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">3</span>
            <StoreIcon className="h-4 w-4" />
            Branch-Level Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {branchMissed.length === 0 ? (
            <div className="px-6 py-6 text-sm text-green-700 font-medium">
              No missed submissions this period.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Store</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Region</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Missed Count</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {branchMissed.map((branch, i) => (
                      <tr key={branch.storeId} className={`hover:bg-gray-50 ${i < 5 ? 'bg-red-50/30' : ''}`}>
                        <td className="px-6 py-3 text-sm font-medium text-gray-900">
                          {branch.storeName}
                          {i < 5 && <span className="ml-2 text-xs text-red-600 font-medium">(Top non-compliant)</span>}
                        </td>
                        <td className="px-6 py-3 text-sm text-gray-600">{branch.regionName}</td>
                        <td className="px-6 py-3 text-sm text-red-700 font-semibold">{branch.missedCount}</td>
                        <td className="px-6 py-3">
                          <select
                            value={branch.actionStatus}
                            onChange={e => {
                              const updated = [...branchMissed]
                              updated[i] = { ...updated[i], actionStatus: e.target.value }
                              setBranchMissed(updated)
                            }}
                            className="block rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="pending">Pending</option>
                            <option value="actioned">Actioned</option>
                            <option value="escalated">Escalated</option>
                            <option value="monitoring">Monitoring</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Section 4: Unresolved Issues */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">4</span>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            Unresolved Issues for Higher Supervision
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {unresolvedItems.length === 0 ? (
            <p className="text-sm text-green-700 font-medium">No unresolved issues at this time.</p>
          ) : (
            <div className="space-y-2">
              {unresolvedItems.map((item, i) => (
                <label key={item.id} className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={item.included}
                    onChange={e => {
                      const updated = [...unresolvedItems]
                      updated[i] = { ...updated[i], included: e.target.checked }
                      setUnresolvedItems(updated)
                    }}
                    className="mt-0.5 h-4 w-4 text-indigo-600 border-gray-300 rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{item.title}</p>
                    <p className="text-xs text-gray-500">
                      {item.type === 'escalation' ? `RM: ${item.rmName}` : `Store: ${item.storeName}`}
                      {' · '}{item.status.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <StatusBadge status={item.status} />
                </label>
              ))}
            </div>
          )}
          <Textarea
            label="Escalation Notes"
            value={escalationNotes}
            onChange={e => setEscalationNotes(e.target.value)}
            placeholder="Provide context on unresolved issues being escalated to Higher Supervision..."
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Section 5: Compliance Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">5</span>
            <BarChart2 className="h-4 w-4 text-blue-500" />
            Compliance Trend
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Overall */}
          <div className="flex items-center gap-6 p-4 bg-gray-50 rounded-xl">
            <div className="text-center">
              <p className="text-xs text-gray-500">This Week</p>
              <p className={`text-3xl font-bold ${overallThisWeek >= 90 ? 'text-green-600' : overallThisWeek >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                {overallThisWeek}%
              </p>
            </div>
            <div className="flex items-center gap-2">
              {trendDiff >= 0
                ? <TrendingUp className="h-5 w-5 text-green-500" />
                : <TrendingDown className="h-5 w-5 text-red-500" />
              }
              <span className={`text-sm font-semibold ${trendDiff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {trendDiff >= 0 ? '+' : ''}{trendDiff}%
              </span>
              <span className="text-sm text-gray-500">vs last week</span>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Last Week</p>
              <p className="text-3xl font-bold text-gray-500">{overallLastWeek}%</p>
            </div>
          </div>

          {/* By region */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Region</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">This Week</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Week</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Change</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Submissions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {regionTrends.map(rt => {
                  const diff = rt.thisWeekRate - rt.lastWeekRate
                  return (
                    <tr key={rt.regionId} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{rt.regionName}</td>
                      <td className="px-6 py-3 text-sm font-semibold">
                        <span className={rt.thisWeekRate >= 90 ? 'text-green-600' : rt.thisWeekRate >= 70 ? 'text-yellow-600' : 'text-red-600'}>
                          {rt.thisWeekRate}%
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500">{rt.lastWeekRate}%</td>
                      <td className="px-6 py-3 text-sm">
                        <span className={`font-medium flex items-center gap-1 ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {diff >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                          {diff >= 0 ? '+' : ''}{diff}%
                        </span>
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500">{rt.thisSubmitted}/{rt.thisTotal}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Section 6: Sign Off */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">6</span>
            <CheckSquare className="h-4 w-4 text-green-600" />
            GM Sign-off
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            label="Summary Comments"
            value={summaryComments}
            onChange={e => setSummaryComments(e.target.value)}
            placeholder="Overall observations, achievements, and concerns this week..."
            rows={4}
          />
          <Textarea
            label="Action Items Requested from Higher Supervision"
            value={actionItemsForHS}
            onChange={e => setActionItemsForHS(e.target.value)}
            placeholder="What support or decisions do you need from Higher Supervision?"
            rows={3}
          />
          <label className="flex items-start gap-3 p-4 bg-indigo-50 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={signOff}
              onChange={e => setSignOff(e.target.checked)}
              className="mt-0.5 h-4 w-4 text-indigo-600 border-gray-300 rounded"
            />
            <div>
              <p className="text-sm font-semibold text-indigo-900">
                I, {profile?.full_name}, confirm that the information in this report is accurate and complete to the best of my knowledge.
              </p>
              <p className="text-xs text-indigo-600 mt-0.5">
                By checking this box you are electronically signing this report.
              </p>
            </div>
          </label>
        </CardContent>
      </Card>

      {/* Submit / Save Actions */}
      <div className="flex items-center justify-end gap-3 flex-wrap bg-white border border-gray-200 rounded-xl px-6 py-4">
        <Button variant="outline" loading={saving} onClick={handleSaveDraft}>
          <Save className="h-4 w-4" />
          Save Draft
        </Button>
        <Button variant="primary" loading={submitting} onClick={handleSubmit} disabled={!signOff}>
          <Send className="h-4 w-4" />
          Submit GM Report
        </Button>
      </div>
    </div>
  )
}
