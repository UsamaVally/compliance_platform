'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  ClipboardList,
  ClipboardCheck,
  Bell,
  Users,
  MapPin,
  Calendar,
  Settings,
  LogOut,
  Shield,
  BarChart3,
  AlertTriangle,
  FileText,
  Star,
  Building2,
  History,
} from 'lucide-react'
import { cn, getRoleLabel } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

interface Profile {
  role: string
  full_name: string
  email: string
}

interface SidebarProps {
  profile: Profile
  isOpen?: boolean
  onClose?: () => void
}

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
}

function getNavItems(role: string): NavItem[] {
  switch (role) {
    case 'branch_manager':
      return [
        { label: 'Dashboard', href: '/branch-manager', icon: LayoutDashboard },
        { label: 'My Forms', href: '/branch-manager/forms', icon: ClipboardList },
        { label: 'Submission History', href: '/branch-manager/submissions', icon: History },
        { label: 'Notifications', href: '/notifications', icon: Bell },
      ]
    case 'regional_manager':
      return [
        { label: 'Dashboard', href: '/regional-manager', icon: LayoutDashboard },
        { label: 'Notifications', href: '/notifications', icon: Bell },
      ]
    case 'general_manager':
      return [
        { label: 'Dashboard', href: '/general-manager', icon: LayoutDashboard },
        { label: 'Notifications', href: '/notifications', icon: Bell },
      ]
    case 'higher_supervision':
      return [
        { label: 'Dashboard', href: '/higher-supervision', icon: LayoutDashboard },
        { label: 'Overview', href: '/higher-supervision/overview', icon: BarChart3 },
        { label: 'GM Reports', href: '/higher-supervision/gm-reports', icon: FileText },
        { label: 'Analytics', href: '/higher-supervision/analytics', icon: Star },
        { label: 'Actions', href: '/higher-supervision/actions', icon: AlertTriangle },
        { label: 'Notifications', href: '/notifications', icon: Bell },
      ]
    case 'admin':
      return [
        { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
        { label: 'General Areas', href: '/admin/general-areas', icon: Shield },
        { label: 'Regions', href: '/admin/regions', icon: MapPin },
        { label: 'Branches', href: '/admin/stores', icon: Building2 },
        { label: 'Users', href: '/admin/users', icon: Users },
        { label: 'Supervisors', href: '/admin/supervisors', icon: Star },
        { label: 'Form Templates', href: '/admin/forms', icon: FileText },
        { label: 'Schedules', href: '/admin/schedules', icon: Calendar },
        { label: 'Organisation', href: '/admin/organisation', icon: Settings },
        { label: 'Audit Log', href: '/admin/audit', icon: History },
        { label: 'Notifications', href: '/notifications', icon: Bell },
      ]
    default:
      return [
        { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
        { label: 'Notifications', href: '/notifications', icon: Bell },
      ]
  }
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function Sidebar({ profile, isOpen = true, onClose }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const navItems = getNavItems(profile.role)

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 lg:hidden"
          aria-hidden="true"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex flex-col w-64 bg-white border-r border-gray-200 transition-transform duration-200 ease-in-out',
          'lg:static lg:translate-x-0 lg:z-auto',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <div className="flex-shrink-0 w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <span className="text-base font-bold text-gray-900 tracking-tight">ComplianceHub</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {navItems.map(item => {
            const Icon = item.icon
            const rootPaths = ['/admin', '/branch-manager', '/regional-manager', '/general-manager', '/higher-supervision', '/dashboard']
            const isActive =
              pathname === item.href ||
              (!rootPaths.includes(item.href) && pathname.startsWith(item.href + '/')) ||
              (rootPaths.includes(item.href) && (pathname === item.href || pathname.startsWith(item.href + '/') && !navItems.some(n => n.href !== item.href && pathname.startsWith(n.href + '/'))))

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4 flex-shrink-0 transition-colors',
                    isActive ? 'text-indigo-600' : 'text-gray-400 group-hover:text-gray-600'
                  )}
                />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-gray-100 px-3 py-3">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
            {/* Avatar */}
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center">
              <span className="text-xs font-semibold text-indigo-700">
                {getInitials(profile.full_name)}
              </span>
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{profile.full_name}</p>
              <p className="text-xs text-gray-500 truncate">{getRoleLabel(profile.role)}</p>
            </div>
            {/* Logout */}
            <button
              onClick={handleLogout}
              title="Sign out"
              className="flex-shrink-0 p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
