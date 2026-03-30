'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell,
  CheckCheck,
  AlertTriangle,
  FileText,
  Clock,
  XCircle,
  Zap,
  ArrowUpCircle,
  Info,
  Loader2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { timeAgo } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Notification {
  id: string
  type: string
  title: string
  message: string
  related_entity_type: string | null
  related_entity_id: string | null
  is_read: boolean
  created_at: string
}

type TabKey = 'all' | 'unread' | 'forms_due' | 'missed' | 'actions' | 'escalations'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'forms_due', label: 'Forms Due' },
  { key: 'missed', label: 'Missed' },
  { key: 'actions', label: 'Actions' },
  { key: 'escalations', label: 'Escalations' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTypeIcon(type: string) {
  if (type.includes('missed')) return <XCircle className="h-5 w-5 text-red-500" />
  if (type.includes('due') || type.includes('form')) return <Clock className="h-5 w-5 text-blue-500" />
  if (type.includes('action')) return <Zap className="h-5 w-5 text-yellow-500" />
  if (type.includes('escalat')) return <ArrowUpCircle className="h-5 w-5 text-purple-500" />
  if (type.includes('alert') || type.includes('warn')) return <AlertTriangle className="h-5 w-5 text-orange-500" />
  if (type.includes('report')) return <FileText className="h-5 w-5 text-indigo-500" />
  return <Info className="h-5 w-5 text-gray-400" />
}

function matchesTab(n: Notification, tab: TabKey): boolean {
  if (tab === 'all') return true
  if (tab === 'unread') return !n.is_read
  if (tab === 'forms_due') return n.type.includes('due') || n.type.includes('form')
  if (tab === 'missed') return n.type.includes('missed')
  if (tab === 'actions') return n.type.includes('action')
  if (tab === 'escalations') return n.type.includes('escalat')
  return true
}

function getEntityPath(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null
  const map: Record<string, string> = {
    submission: `/branch-manager/submissions/${entityId}`,
    action: `/admin/actions/${entityId}`,
    escalation: `/regional-manager/escalations/${entityId}`,
    review: `/higher-supervision/overview`,
  }
  return map[entityType] ?? null
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const router = useRouter()
  const supabase = createClient()

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [markingAll, setMarkingAll] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('all')

  const fetchNotifications = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    setNotifications((data ?? []) as Notification[])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('notifications-page')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        () => { fetchNotifications() }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [supabase, fetchNotifications])

  const markAsRead = async (n: Notification) => {
    if (!n.is_read) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', n.id)
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
    }
    const path = getEntityPath(n.related_entity_type, n.related_entity_id)
    if (path) router.push(path)
  }

  const markAllAsRead = async () => {
    setMarkingAll(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false)
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    }
    setMarkingAll(false)
  }

  const filtered = notifications.filter(n => matchesTab(n, activeTab))
  const unreadCount = notifications.filter(n => !n.is_read).length

  const tabCount = (tab: TabKey) => {
    const count = notifications.filter(n => matchesTab(n, tab) && !n.is_read).length
    return count > 0 ? count : null
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Bell className="h-6 w-6 text-indigo-600" />
            Notifications
            {unreadCount > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700">
                {unreadCount} unread
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-500 mt-1">Stay up to date with submissions, actions, and escalations.</p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={markAllAsRead}
            loading={markingAll}
          >
            <CheckCheck className="h-4 w-4" />
            Mark All as Read
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-1 overflow-x-auto scrollbar-hide">
          {TABS.map(tab => {
            const count = tabCount(tab.key)
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`whitespace-nowrap flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
                {count != null && (
                  <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded-full text-xs font-bold ${
                    isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Bell className="h-12 w-12 text-gray-200 mb-4" />
          <p className="text-base font-medium text-gray-500">No notifications</p>
          <p className="text-sm text-gray-400 mt-1">
            {activeTab === 'unread'
              ? "You're all caught up!"
              : `No ${activeTab.replace('_', ' ')} notifications yet.`}
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-gray-100">
              {filtered.map((n) => (
                <li
                  key={n.id}
                  onClick={() => markAsRead(n)}
                  className={`flex items-start gap-4 px-5 py-4 cursor-pointer transition-colors hover:bg-gray-50 ${
                    !n.is_read ? 'bg-indigo-50/40' : ''
                  }`}
                >
                  {/* Icon */}
                  <div className="flex-shrink-0 mt-0.5 w-9 h-9 rounded-full bg-white border border-gray-100 shadow-sm flex items-center justify-center">
                    {getTypeIcon(n.type)}
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-semibold truncate ${n.is_read ? 'text-gray-700' : 'text-gray-900'}`}>
                        {n.title}
                      </p>
                      <span className="flex-shrink-0 text-xs text-gray-400 whitespace-nowrap">
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                    <p className={`text-sm mt-0.5 line-clamp-2 ${n.is_read ? 'text-gray-400' : 'text-gray-600'}`}>
                      {n.message}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 capitalize">
                        {n.type.replace(/_/g, ' ')}
                      </span>
                      {!n.is_read && (
                        <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" />
                      )}
                      {n.related_entity_type && (
                        <span className="text-xs text-indigo-600 hover:underline">
                          View {n.related_entity_type}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
