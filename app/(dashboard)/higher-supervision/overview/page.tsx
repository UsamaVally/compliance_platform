'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Users,
  MapPin,
  Store as StoreIcon,
  TrendingUp,
  TrendingDown,
  Minus,
  Download,
} from 'lucide-react'
import { useProfile } from '@/lib/hooks/useProfile'
import { createClient } from '@/lib/supabase/client'
import { ComplianceBar } from '@/components/ui/compliance-bar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LoadingPage, LoadingCard } from '@/components/ui/loading'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

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
  const s = new Date(wb.start); s.setDate(s.getDate() - 7)
  const e = new Date(wb.end); e.setDate(e.getDate() - 7)
  return { start: s.toISOString().split('T')[0], end: e.toISOString().split('T')[0] }
}

function getComplianceClass(rate: number) {
  if (rate >= 90) return 'text-green-600'
  if (rate >= 70) return 'text-yellow-600'
  return 'text-red-600'
}

function getComplianceDotClass(rate: number) {
  if (rate >= 90) return 'bg-green-500'
  if (rate >= 70) return 'bg-yellow-500'
  return 'bg-red-500'
}

interface StoreNode {
  storeId: string
  storeName: string
  storeCode: string
  thisWeekRate: number
  lastWeekRate: number
  submitted: number
  total: number
}

interface RegionNode {
  regionId: string
  regionName: string
  rmName: string | null
  thisWeekRate: number
  lastWeekRate: number
  submitted: number
  total: number
  stores: StoreNode[]
}

interface GMNode {
  gmId: string
  gmName: string
  thisWeekRate: number
  lastWeekRate: number
  submitted: number
  total: number
  regions: RegionNode[]
}

export default function HSOverviewPage() {
  const { profile, loading: profileLoading } = useProfile()
  const [tree, setTree] = useState<GMNode[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedGMs, setExpandedGMs] = useState<Set<string>>(new Set())
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set())

  const fetchData = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const supabase = createClient()
    const { start, end } = getWeekBounds()
    const lwb = getLastWeekBounds()

    // All GMs
    const { data: gmsData } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'general_manager')
      .eq('is_active', true)
    const gms = (gmsData ?? []) as { id: string; full_name: string }[]

    // All regions with GM
    const { data: regionsData } = await supabase
      .from('regions')
      .select('id, name, general_manager_id')
    const regions = (regionsData ?? []) as { id: string; name: string; general_manager_id: string | null }[]
    const regionIds = regions.map(r => r.id)

    // RM assignments per region
    const { data: rmData } = await supabase
      .from('user_region_assignments')
      .select('user_id, region_id, profiles!user_region_assignments_user_id_fkey(id, full_name, role)')
      .in('region_id', regionIds.length > 0 ? regionIds : ['_none_'])
    type RMA = { user_id: string; region_id: string; profiles: { id: string; full_name: string; role: string } | null }
    const rmList = (rmData ?? []) as unknown as RMA[]
    const regionToRM: Record<string, string> = {}
    for (const a of rmList) {
      if (a.profiles?.role === 'regional_manager') regionToRM[a.region_id] = a.profiles.full_name
    }

    // All stores
    const { data: storesData } = await supabase
      .from('stores')
      .select('id, name, code, region_id')
      .eq('is_active', true)
    const stores = (storesData ?? []) as { id: string; name: string; code: string; region_id: string | null }[]
    const storeIds = stores.map(s => s.id)

    // This week expected
    const { data: thisWeekData } = await supabase
      .from('expected_submissions')
      .select('store_id, status')
      .in('store_id', storeIds.length > 0 ? storeIds : ['_none_'])
      .gte('due_date', start)
      .lte('due_date', end)
    type ExpRow = { store_id: string; status: string }
    const thisWeek = (thisWeekData ?? []) as ExpRow[]

    // Last week expected
    const { data: lastWeekData } = await supabase
      .from('expected_submissions')
      .select('store_id, status')
      .in('store_id', storeIds.length > 0 ? storeIds : ['_none_'])
      .gte('due_date', lwb.start)
      .lte('due_date', lwb.end)
    const lastWeek = (lastWeekData ?? []) as ExpRow[]

    // Build store stat maps
    function buildStatMap(rows: ExpRow[]) {
      const m: Record<string, { total: number; submitted: number }> = {}
      for (const r of rows) {
        if (!m[r.store_id]) m[r.store_id] = { total: 0, submitted: 0 }
        m[r.store_id].total++
        if (r.status === 'submitted_on_time' || r.status === 'submitted_late') m[r.store_id].submitted++
      }
      return m
    }
    const thisStat = buildStatMap(thisWeek)
    const lastStat = buildStatMap(lastWeek)

    function getRate(stat: Record<string, { total: number; submitted: number }>, id: string) {
      const s = stat[id]
      return s && s.total > 0 ? Math.round((s.submitted / s.total) * 100) : 0
    }

    // Build tree
    const gmNodes: GMNode[] = gms.map(gm => {
      const gmRegions = regions.filter(r => r.general_manager_id === gm.id)

      const regionNodes: RegionNode[] = gmRegions.map(region => {
        const regionStores = stores.filter(s => s.region_id === region.id)

        const storeNodes: StoreNode[] = regionStores.map(store => {
          const tw = thisStat[store.id] ?? { total: 0, submitted: 0 }
          return {
            storeId: store.id,
            storeName: store.name,
            storeCode: store.code,
            thisWeekRate: getRate(thisStat, store.id),
            lastWeekRate: getRate(lastStat, store.id),
            submitted: tw.submitted,
            total: tw.total,
          }
        })

        let rTotal = 0, rSub = 0, rLastTotal = 0, rLastSub = 0
        for (const s of regionStores) {
          rTotal += (thisStat[s.id]?.total ?? 0)
          rSub += (thisStat[s.id]?.submitted ?? 0)
          rLastTotal += (lastStat[s.id]?.total ?? 0)
          rLastSub += (lastStat[s.id]?.submitted ?? 0)
        }

        return {
          regionId: region.id,
          regionName: region.name,
          rmName: regionToRM[region.id] ?? null,
          thisWeekRate: rTotal > 0 ? Math.round((rSub / rTotal) * 100) : 0,
          lastWeekRate: rLastTotal > 0 ? Math.round((rLastSub / rLastTotal) * 100) : 0,
          submitted: rSub,
          total: rTotal,
          stores: storeNodes,
        }
      })

      let gmTotal = 0, gmSub = 0, gmLastTotal = 0, gmLastSub = 0
      for (const r of regionNodes) {
        gmTotal += r.total; gmSub += r.submitted
        gmLastTotal += (r.lastWeekRate * r.total / 100) // approx
      }
      // More accurate: re-sum from stores
      const gmRegionIds = gmRegions.map(r => r.id)
      const gmStores = stores.filter(s => s.region_id && gmRegionIds.includes(s.region_id))
      let gTotal = 0, gSub = 0, gLastTotal = 0, gLastSub = 0
      for (const s of gmStores) {
        gTotal += (thisStat[s.id]?.total ?? 0)
        gSub += (thisStat[s.id]?.submitted ?? 0)
        gLastTotal += (lastStat[s.id]?.total ?? 0)
        gLastSub += (lastStat[s.id]?.submitted ?? 0)
      }

      return {
        gmId: gm.id,
        gmName: gm.full_name,
        thisWeekRate: gTotal > 0 ? Math.round((gSub / gTotal) * 100) : 0,
        lastWeekRate: gLastTotal > 0 ? Math.round((gLastSub / gLastTotal) * 100) : 0,
        submitted: gSub,
        total: gTotal,
        regions: regionNodes,
      }
    })

    setTree(gmNodes)
    setLoading(false)
  }, [profile])

  useEffect(() => {
    if (profile) fetchData()
  }, [profile, fetchData])

  function TrendIndicator({ thisWeek, lastWeek }: { thisWeek: number; lastWeek: number }) {
    const diff = thisWeek - lastWeek
    if (diff === 0) return <Minus className="h-4 w-4 text-gray-400" />
    if (diff > 0) return (
      <span className="flex items-center gap-0.5 text-green-600 text-xs font-medium">
        <TrendingUp className="h-3.5 w-3.5" />+{diff}%
      </span>
    )
    return (
      <span className="flex items-center gap-0.5 text-red-600 text-xs font-medium">
        <TrendingDown className="h-3.5 w-3.5" />{diff}%
      </span>
    )
  }

  function handleExport() {
    // Build CSV
    const rows: string[] = ['GM,Region,Store,Code,This Week %,Last Week %,Submitted,Total']
    for (const gm of tree) {
      for (const region of gm.regions) {
        if (region.stores.length === 0) {
          rows.push(`"${gm.gmName}","${region.regionName}",,,"${region.thisWeekRate}","${region.lastWeekRate}","${region.submitted}","${region.total}"`)
        }
        for (const store of region.stores) {
          rows.push(`"${gm.gmName}","${region.regionName}","${store.storeName}","${store.storeCode}","${store.thisWeekRate}","${store.lastWeekRate}","${store.submitted}","${store.total}"`)
        }
      }
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `compliance-overview-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (profileLoading) return <LoadingPage />

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Company-wide Compliance Overview</h1>
          <p className="text-sm text-gray-500 mt-1">Hierarchical drill-down: GM → Regions → Stores</p>
        </div>
        <Button variant="outline" onClick={handleExport}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-gray-600 bg-white border border-gray-200 rounded-xl px-4 py-2.5 flex-wrap">
        <span className="font-medium text-gray-700">Compliance:</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-500" /> ≥90% Good</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-yellow-500" /> 70-89% Warning</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> &lt;70% Critical</span>
      </div>

      {loading ? (
        <LoadingCard />
      ) : tree.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState icon={Users} title="No data available" description="No GMs or regions configured." />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tree.map(gm => {
            const gmExpanded = expandedGMs.has(gm.gmId)
            return (
              <div key={gm.gmId} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                {/* GM Row */}
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedGMs(prev => {
                    const next = new Set(prev)
                    if (next.has(gm.gmId)) next.delete(gm.gmId)
                    else next.add(gm.gmId)
                    return next
                  })}
                >
                  <div className="flex-shrink-0 flex items-center gap-2">
                    {gmExpanded ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                      <Users className="h-4 w-4 text-indigo-600" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold text-gray-900">{gm.gmName}</p>
                    <p className="text-xs text-gray-500">{gm.regions.length} regions · {gm.submitted}/{gm.total} submitted</p>
                  </div>
                  <div className="flex items-center gap-6">
                    <TrendIndicator thisWeek={gm.thisWeekRate} lastWeek={gm.lastWeekRate} />
                    <div className="w-32 hidden md:block">
                      <ComplianceBar rate={gm.thisWeekRate} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn('w-2.5 h-2.5 rounded-full', getComplianceDotClass(gm.thisWeekRate))} />
                      <span className={cn('text-lg font-bold', getComplianceClass(gm.thisWeekRate))}>
                        {gm.thisWeekRate}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Regions */}
                {gmExpanded && (
                  <div className="border-t border-gray-100">
                    {gm.regions.length === 0 ? (
                      <div className="px-12 py-4 text-sm text-gray-400">No regions assigned to this GM.</div>
                    ) : (
                      gm.regions.map(region => {
                        const regionExpanded = expandedRegions.has(region.regionId)
                        return (
                          <div key={region.regionId} className="border-b border-gray-100 last:border-b-0">
                            {/* Region Row */}
                            <div
                              className="flex items-center gap-4 pl-12 pr-5 py-3 cursor-pointer hover:bg-gray-50/50 transition-colors"
                              onClick={() => setExpandedRegions(prev => {
                                const next = new Set(prev)
                                if (next.has(region.regionId)) next.delete(region.regionId)
                                else next.add(region.regionId)
                                return next
                              })}
                            >
                              <div className="flex-shrink-0 flex items-center gap-2">
                                {regionExpanded ? <ChevronDown className="h-3.5 w-3.5 text-gray-400" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-400" />}
                                <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
                                  <MapPin className="h-3.5 w-3.5 text-blue-600" />
                                </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-gray-800">{region.regionName}</p>
                                <p className="text-xs text-gray-500">
                                  RM: {region.rmName ?? 'Unassigned'} · {region.stores.length} stores · {region.submitted}/{region.total}
                                </p>
                              </div>
                              <div className="flex items-center gap-6">
                                <TrendIndicator thisWeek={region.thisWeekRate} lastWeek={region.lastWeekRate} />
                                <div className="w-28 hidden md:block">
                                  <ComplianceBar rate={region.thisWeekRate} height="h-1.5" />
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={cn('w-2 h-2 rounded-full', getComplianceDotClass(region.thisWeekRate))} />
                                  <span className={cn('text-sm font-bold', getComplianceClass(region.thisWeekRate))}>
                                    {region.thisWeekRate}%
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Stores */}
                            {regionExpanded && (
                              <div className="border-t border-gray-100 bg-gray-50/30">
                                {region.stores.length === 0 ? (
                                  <div className="pl-24 pr-5 py-3 text-xs text-gray-400">No stores in this region.</div>
                                ) : (
                                  region.stores.map(store => (
                                    <div key={store.storeId} className="flex items-center gap-4 pl-24 pr-5 py-2.5 border-b border-gray-100 last:border-b-0 hover:bg-white/50 transition-colors">
                                      <div className="w-6 h-6 rounded bg-gray-100 flex items-center justify-center flex-shrink-0">
                                        <StoreIcon className="h-3 w-3 text-gray-500" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-gray-800">{store.storeName}</p>
                                        <p className="text-xs text-gray-400">{store.storeCode} · {store.submitted}/{store.total}</p>
                                      </div>
                                      <div className="flex items-center gap-4">
                                        <TrendIndicator thisWeek={store.thisWeekRate} lastWeek={store.lastWeekRate} />
                                        <div className="w-24 hidden md:block">
                                          <ComplianceBar rate={store.thisWeekRate} height="h-1" />
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                          <span className={cn('w-1.5 h-1.5 rounded-full', getComplianceDotClass(store.thisWeekRate))} />
                                          <span className={cn('text-xs font-bold', getComplianceClass(store.thisWeekRate))}>
                                            {store.thisWeekRate}%
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
