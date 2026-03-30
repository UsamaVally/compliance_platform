'use client'

import { useState, useEffect } from 'react'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { createClient } from '@/lib/supabase/client'
import type { ProfileWithOrg } from '@/lib/types'

interface DashboardShellProps {
  profile: ProfileWithOrg
  children: React.ReactNode
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function DashboardShell({ profile, children }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  // Default sidebar open on desktop via CSS, but track state for mobile toggle
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    setSidebarOpen(mq.matches)

    const handler = (e: MediaQueryListEvent) => {
      setSidebarOpen(e.matches)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    async function fetchUnread() {
      const supabase = createClient()
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profile.id)
        .eq('is_read', false)
      setUnreadCount(count ?? 0)
    }
    fetchUnread()
  }, [profile.id])

  const handleMenuToggle = () => {
    setSidebarOpen(prev => !prev)
  }

  const handleCloseSidebar = () => {
    setSidebarOpen(false)
  }

  // Page title derived from role
  const roleTitle: Record<string, string> = {
    branch_manager: 'Branch Manager',
    regional_manager: 'Regional Manager',
    general_manager: 'General Manager',
    higher_supervision: 'Higher Supervision',
    admin: 'Admin',
  }
  const title = roleTitle[profile.role] ?? 'Dashboard'

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        profile={profile}
        isOpen={sidebarOpen}
        onClose={handleCloseSidebar}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header
          onMenuToggle={handleMenuToggle}
          title={title}
          unreadCount={unreadCount}
          userInitials={getInitials(profile.full_name)}
          userName={profile.full_name}
        />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
