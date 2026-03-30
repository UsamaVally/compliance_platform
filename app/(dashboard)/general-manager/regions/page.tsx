'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  MapPin,
  Users,
  Store as StoreIcon,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  Calendar,
} from 'lucide-react'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { ComplianceBar } from '@/components/ui/compliance-bar'
import { StatusBadge } from '@/components/ui/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { LoadingPage, LoadingCard } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import { formatDate } from '@/lib/utils'

interface StoreSubmissionRow {
  storeId: string
  storeName: string
  storeCode: string
  total: number
  submitted: number
  missed: number
  rate: number
  latestStatus: string | null
  latestDueDate: string | null
}

interface RegionCard {
  regionId: string
  regionName: string
  rmName: string | null
  rmId: string | null
  storeCount: number
  complianceRate: number
  submittedCount: number
  missedCount: number
  stores: StoreSubmissionRow[]
}

function getWeekBounds(from: string, to: string) {
  return { start: from, end: to }
}

function getDefaultBounds() {
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

export default function GMRegionsPage() {
  const { profile, loading: profileLoading } = useProfile()
  const defaults = getDefaultBounds()

  const [fromDate, setFromDate] = useState(defaults.start)
  const [toDate, setToDate] = useState(defaults.end)
  const [regions, setRegions] = useState<RegionCard[]>([])
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const supabase = createClient()
    const { start, end } = getWeekBounds(fromDate, toDate)

    // 1. GM's regions
    const { data: regionsData } = await supabase
      .from('regions')
      .select('id, name')
      .eq('general_manager_id', profile.id)

    const regionList = (regionsData ?? []) as { id: string; name: string }[]
    const regionIds = regionList.map(r => r.id)

    if (regionIds.length === 0) {
      setRegions([])
      setLoading(false)
      return
    }

    // 2. RM assignments
    const { data: rmAssignments } = await supabase
      .from('user_region_assignments')
      .select('user_id, region_id, profiles!user_region_assignments_user_id_fkey(id, full_name, role)')
      .in('region_id', regionIds)

    type RMAssignment = {
      user_id: string
      region_id: string
      profiles: { id: string; full_name: string; role: string } | null
    }
    const rmList = (rmAssignments ?? []) as unknown as RMAssignment[]
    const regionToRM: Record<string, { id: string; name: string }> = {}
    for (const a of rmList) {
      if (a.profiles?.role === 'regional_manager') {
        regionToRM[a.region_id] = { id: a.user_id, name: a.profiles.full_name }
      }
    }

    // 3. Stores per region
    const { data: storesData } = await supabase
      .from('stores')
      .select('id, name, code, region_id')
      .in('region_id', regionIds)
      .eq('is_active', true)

    type StoreRow = { id: string; name: string; code: string; region_id: string | null }
    const allStores = (storesData ?? []) as StoreRow[]
    const storeIds = allStores.map(s => s.id)

    // 4. Expected submissions in date range
    const { data: expectedData } = await supabase
      .from('expected_submissions')
      .select('store_id, status, due_date')
      .in('store_id', storeIds.length > 0 ? storeIds : ['_none_'])
      .gte('due_date', start)
      .lte('due_date', end)
      .order('due_date', { ascending: false })

    type ExpRow = { store_id: string; status: string; due_date: string }
    const expectedList = (expectedData ?? []) as ExpRow[]

    // Aggregate per store
    const storeStats: Record<string, { total: number; submitted: number; missed: number; latestStatus: string | null; latestDueDate: string | null }> = {}
    for (const s of allStores) {
      storeStats[s.id] = { total: 0, submitted: 0, missed: 0, latestStatus: null, latestDueDate: null }
    }
    for (const exp of expectedList) {
      const stat = storeStats[exp.store_id]
      if (!stat) continue
      stat.total++
      if (exp.status === 'submitted_on_time' || exp.status === 'submitted_late') stat.submitted++
      if (exp.status === 'missed') stat.missed++
      if (!stat.latestDueDate || exp.due_date > stat.latestDueDate) {
        stat.latestDueDate = exp.due_date
        stat.latestStatus = exp.status
      }
    }

    // Build region cards
    const cards: RegionCard[] = regionList.map(region => {
      const rm = regionToRM[region.id]
      const regionStores = allStores.filter(s => s.region_id === region.id)
      let totalExp = 0
      let totalSub = 0
      let totalMissed = 0

      const storeSubs: StoreSubmissionRow[] = regionStores.map(store => {
        const stat = storeStats[store.id] ?? { total: 0, submitted: 0, missed: 0, latestStatus: null, latestDueDate: null }
        totalExp += stat.total
        totalSub += stat.submitted
        totalMissed += stat.missed
        return {
          storeId: store.id,
          storeName: store.name,
          storeCode: store.code,
          total: stat.total,
          submitted: stat.submitted,
          missed: stat.missed,
          rate: stat.total > 0 ? Math.round((stat.submitted / stat.total) * 100) : 0,
          latestStatus: stat.latestStatus,
          latestDueDate: stat.latestDueDate,
        }
      })

      return {
        regionId: region.id,
        regionName: region.name,
        rmName: rm?.name ?? null,
        rmId: rm?.id ?? null,
        storeCount: regionStores.length,
        complianceRate: totalExp > 0 ? Math.round((totalSub / totalExp) * 100) : 0,
        submittedCount: totalSub,
        missedCount: totalMissed,
        stores: storeSubs.sort((a, b) => a.rate - b.rate),
      }
    })

    setRegions(cards)
    setLoading(false)
  }, [profile, fromDate, toDate])

  useEffect(() => {
    if (profile) fetchData()
  }, [profile, fetchData])

  function toggleRegion(regionId: string) {
    setExpandedRegions(prev => {
      const next = new Set(prev)
      if (next.has(regionId)) next.delete(regionId)
      else next.add(regionId)
      return next
    })
  }

  if (profileLoading) return <LoadingPage />

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Regions Overview</h1>
          <p className="text-sm text-gray-500 mt-1">Drill down into store compliance across your regions</p>
        </div>
      </div>

      {/* Date Range Filter */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-500" />
              <span className="text-sm text-gray-600 font-medium">Date Range:</span>
            </div>
            <Input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="w-40"
            />
            <span className="text-gray-400 text-sm">to</span>
            <Input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="w-40"
            />
            <Button size="sm" variant="primary" onClick={fetchData}>Apply</Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <LoadingCard />
      ) : regions.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={MapPin}
              title="No regions assigned"
              description="No regions are currently assigned to you."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {regions.map(region => {
            const isExpanded = expandedRegions.has(region.regionId)
            return (
              <Card key={region.regionId} className="overflow-hidden">
                {/* Region Header */}
                <div
                  className="px-6 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => toggleRegion(region.regionId)}
                >
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                        <MapPin className="h-5 w-5 text-indigo-600" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-gray-900">{region.regionName}</h3>
                        <div className="flex items-center gap-4 mt-0.5 text-xs text-gray-500 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Users className="h-3.5 w-3.5" />
                            RM: {region.rmName ?? <em>Unassigned</em>}
                          </span>
                          <span className="flex items-center gap-1">
                            <StoreIcon className="h-3.5 w-3.5" />
                            {region.storeCount} stores
                          </span>
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle className="h-3.5 w-3.5" />
                            {region.submittedCount} submitted
                          </span>
                          <span className="flex items-center gap-1 text-red-600">
                            <XCircle className="h-3.5 w-3.5" />
                            {region.missedCount} missed
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 flex-shrink-0">
                      <div className="w-36 hidden sm:block">
                        <ComplianceBar rate={region.complianceRate} />
                      </div>
                      <div className="text-right">
                        <p className={`text-lg font-bold ${region.complianceRate >= 90 ? 'text-green-600' : region.complianceRate >= 70 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {region.complianceRate}%
                        </p>
                        <p className="text-xs text-gray-400">compliance</p>
                      </div>
                      {isExpanded
                        ? <ChevronDown className="h-5 w-5 text-gray-400 flex-shrink-0" />
                        : <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      }
                    </div>
                  </div>
                </div>

                {/* Store Drill-down */}
                {isExpanded && (
                  <div className="border-t border-gray-100">
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm text-gray-700">Store Submissions ({fromDate} – {toDate})</CardTitle>
                    </CardHeader>
                    {region.stores.length === 0 ? (
                      <div className="px-6 pb-6">
                        <EmptyState
                          icon={StoreIcon}
                          title="No stores in region"
                          description="This region has no active stores."
                        />
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-100">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Store</th>
                              <th className="px-6 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                              <th className="px-6 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted</th>
                              <th className="px-6 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Missed</th>
                              <th className="px-6 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Due</th>
                              <th className="px-6 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Latest Status</th>
                              <th className="px-6 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Compliance</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-100">
                            {region.stores.map(store => (
                              <tr key={store.storeId} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-3 text-sm font-medium text-gray-900">{store.storeName}</td>
                                <td className="px-6 py-3 text-sm text-gray-500">{store.storeCode}</td>
                                <td className="px-6 py-3 text-sm text-green-700 font-medium">{store.submitted}</td>
                                <td className="px-6 py-3 text-sm text-red-700 font-medium">{store.missed}</td>
                                <td className="px-6 py-3 text-sm text-gray-500">
                                  {store.latestDueDate ? formatDate(store.latestDueDate) : '—'}
                                </td>
                                <td className="px-6 py-3">
                                  {store.latestStatus ? <StatusBadge status={store.latestStatus} /> : <span className="text-gray-400 text-xs">—</span>}
                                </td>
                                <td className="px-6 py-3 min-w-[120px]">
                                  {store.total > 0 ? (
                                    <ComplianceBar rate={store.rate} height="h-1.5" />
                                  ) : (
                                    <span className="text-xs text-gray-400">No data</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
