'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Users, Building2, CalendarClock, BarChart3, ClipboardList,
  MapPin, Settings, ShieldCheck, ArrowRight, Globe, Shield,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useProfile } from '@/lib/hooks/useProfile'
import { StatCard } from '@/components/ui/stat-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoadingPage } from '@/components/ui/loading'
import { formatDateTime } from '@/lib/utils'
import type { AuditLog } from '@/lib/types'

interface AdminStats {
  totalGeneralAreas: number
  totalRegions: number
  totalBranches: number
  totalUsers: number
  totalSupervisors: number
  activeTemplates: number
  activeSchedules: number
  weeklyCompliancePct: number
}

type AuditLogWithUser = AuditLog & {
  profiles: { full_name: string } | null
}

const quickLinks = [
  { href: '/admin/general-areas', label: 'General Areas', icon: Globe, color: 'bg-violet-50 text-violet-600' },
  { href: '/admin/regions', label: 'Regions', icon: MapPin, color: 'bg-purple-50 text-purple-600' },
  { href: '/admin/stores', label: 'Branches', icon: Building2, color: 'bg-green-50 text-green-600' },
  { href: '/admin/users', label: 'Users', icon: Users, color: 'bg-blue-50 text-blue-600' },
  { href: '/admin/supervisors', label: 'Supervisors', icon: Shield, color: 'bg-indigo-50 text-indigo-600' },
  { href: '/admin/forms', label: 'Form Templates', icon: ClipboardList, color: 'bg-teal-50 text-teal-600' },
  { href: '/admin/schedules', label: 'Schedules', icon: CalendarClock, color: 'bg-orange-50 text-orange-600' },
  { href: '/admin/organisation', label: 'Organisation', icon: Settings, color: 'bg-gray-50 text-gray-600' },
  { href: '/admin/audit', label: 'Audit Trail', icon: ShieldCheck, color: 'bg-red-50 text-red-600' },
]

export default function AdminDashboard() {
  const { profile, loading: profileLoading } = useProfile()
  const [stats, setStats] = useState<AdminStats>({
    totalGeneralAreas: 0,
    totalRegions: 0,
    totalBranches: 0,
    totalUsers: 0,
    totalSupervisors: 0,
    activeTemplates: 0,
    activeSchedules: 0,
    weeklyCompliancePct: 0,
  })
  const [auditLogs, setAuditLogs] = useState<AuditLogWithUser[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return

    async function fetchData() {
      const supabase = createClient()
      const orgId = profile.organisation_id

      const [
        { count: areasCount },
        { count: regionsCount },
        { count: branchCount },
        { count: usersCount },
        { count: supervisorsCount },
        { count: templatesCount },
        { count: schedulesCount },
        { data: logsData },
      ] = await Promise.all([
        supabase
          .from('general_areas')
          .select('id', { count: 'exact', head: true })
          .eq('organisation_id', orgId)
          .eq('status', 'active'),
        supabase
          .from('regions')
          .select('id', { count: 'exact', head: true })
          .eq('organisation_id', orgId)
          .eq('status', 'active'),
        supabase
          .from('stores')
          .select('id', { count: 'exact', head: true })
          .eq('organisation_id', orgId)
          .eq('is_active', true),
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('organisation_id', orgId)
          .eq('is_active', true),
        supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('organisation_id', orgId)
          .eq('role', 'higher_supervision')
          .eq('is_active', true),
        supabase
          .from('form_templates')
          .select('id', { count: 'exact', head: true })
          .eq('organisation_id', orgId)
          .eq('is_active', true),
        supabase
          .from('schedules')
          .select('id', { count: 'exact', head: true })
          .eq('organisation_id', orgId)
          .eq('is_active', true),
        supabase
          .from('audit_logs')
          .select('*, profiles(full_name)')
          .eq('organisation_id', orgId)
          .order('created_at', { ascending: false })
          .limit(15),
      ])

      // Compliance this week
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const today = new Date().toISOString().split('T')[0]

      const { count: totalExpected } = await supabase
        .from('expected_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('organisation_id', orgId)
        .gte('due_date', weekAgo)
        .lte('due_date', today)

      const { count: totalSubmitted } = await supabase
        .from('expected_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('organisation_id', orgId)
        .gte('due_date', weekAgo)
        .lte('due_date', today)
        .in('status', ['submitted_on_time', 'submitted_late', 'approved', 'under_review', 'closed'])

      const compliancePct =
        totalExpected && totalExpected > 0
          ? Math.round(((totalSubmitted ?? 0) / totalExpected) * 100)
          : 0

      setStats({
        totalGeneralAreas: areasCount ?? 0,
        totalRegions: regionsCount ?? 0,
        totalBranches: branchCount ?? 0,
        totalUsers: usersCount ?? 0,
        totalSupervisors: supervisorsCount ?? 0,
        activeTemplates: templatesCount ?? 0,
        activeSchedules: schedulesCount ?? 0,
        weeklyCompliancePct: compliancePct,
      })
      setAuditLogs((logsData ?? []) as AuditLogWithUser[])
      setLoading(false)
    }

    fetchData()
  }, [profile])

  if (profileLoading || loading) return <LoadingPage />

  const complianceColor =
    stats.weeklyCompliancePct >= 90 ? 'text-green-600' :
    stats.weeklyCompliancePct >= 70 ? 'text-yellow-600' : 'text-red-600'
  const complianceBg =
    stats.weeklyCompliancePct >= 90 ? 'bg-green-50' :
    stats.weeklyCompliancePct >= 70 ? 'bg-yellow-50' : 'bg-red-50'

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Platform overview and management controls</p>
      </div>

      {/* Stats Row 1 — Structure */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Company Structure</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            title="General Areas"
            value={stats.totalGeneralAreas}
            subtitle="Active areas"
            icon={Globe}
            iconColor="text-violet-600"
            iconBg="bg-violet-50"
          />
          <StatCard
            title="Regions"
            value={stats.totalRegions}
            subtitle="Active regions"
            icon={MapPin}
            iconColor="text-purple-600"
            iconBg="bg-purple-50"
          />
          <StatCard
            title="Branches"
            value={stats.totalBranches}
            subtitle="Active branches"
            icon={Building2}
            iconColor="text-green-600"
            iconBg="bg-green-50"
          />
          <StatCard
            title="Total Users"
            value={stats.totalUsers}
            subtitle={`incl. ${stats.totalSupervisors} supervisor${stats.totalSupervisors !== 1 ? 's' : ''}`}
            icon={Users}
            iconColor="text-blue-600"
            iconBg="bg-blue-50"
          />
        </div>
      </div>

      {/* Stats Row 2 — Operations */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Operations</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard
            title="Active Templates"
            value={stats.activeTemplates}
            subtitle="Form templates"
            icon={ClipboardList}
            iconColor="text-teal-600"
            iconBg="bg-teal-50"
          />
          <StatCard
            title="Active Schedules"
            value={stats.activeSchedules}
            subtitle="Running schedules"
            icon={CalendarClock}
            iconColor="text-orange-600"
            iconBg="bg-orange-50"
          />
          <StatCard
            title="This Week Compliance"
            value={`${stats.weeklyCompliancePct}%`}
            subtitle="Submission rate (7 days)"
            icon={BarChart3}
            iconColor={complianceColor}
            iconBg={complianceBg}
          />
        </div>
      </div>

      {/* Quick Links */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {quickLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors group"
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${link.color}`}>
                  <link.icon className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-gray-700 group-hover:text-indigo-700 transition-colors">
                  {link.label}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-gray-400 group-hover:text-indigo-500 ml-auto transition-colors" />
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent Audit Logs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent Activity</CardTitle>
            <Link
              href="/admin/audit"
              className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
            >
              View all
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {auditLogs.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-gray-500">No activity yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {['Date / Time', 'User', 'Action', 'Entity'].map(h => (
                      <th
                        key={h}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {auditLogs.map(log => (
                    <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {formatDateTime(log.created_at)}
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-700 whitespace-nowrap">
                        {log.profiles?.full_name ?? log.user_id?.slice(0, 8) ?? '—'}
                      </td>
                      <td className="px-6 py-3">
                        <Badge variant="info">
                          {log.action.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-6 py-3 text-sm text-gray-500">
                        {log.entity_type ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
