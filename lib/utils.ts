import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, isAfter, isBefore } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date, fmt = 'dd MMM yyyy') {
  return format(new Date(date), fmt)
}

export function formatDateTime(date: string | Date) {
  return format(new Date(date), 'dd MMM yyyy HH:mm')
}

export function timeAgo(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

export function isOverdue(dueDate: string, dueTime?: string): boolean {
  const due = new Date(`${dueDate}T${dueTime || '23:59:59'}`)
  return isBefore(due, new Date())
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    not_due: 'text-gray-500 bg-gray-100',
    due: 'text-blue-700 bg-blue-100',
    submitted_on_time: 'text-green-700 bg-green-100',
    submitted_late: 'text-yellow-700 bg-yellow-100',
    missed: 'text-red-700 bg-red-100',
    under_review: 'text-purple-700 bg-purple-100',
    approved: 'text-green-700 bg-green-100',
    rejected: 'text-red-700 bg-red-100',
    escalated: 'text-orange-700 bg-orange-100',
    closed: 'text-gray-700 bg-gray-100',
    open: 'text-red-700 bg-red-100',
    in_progress: 'text-blue-700 bg-blue-100',
    awaiting_evidence: 'text-yellow-700 bg-yellow-100',
    resolved: 'text-green-700 bg-green-100',
    verified: 'text-emerald-700 bg-emerald-100',
  }
  return colors[status] || 'text-gray-700 bg-gray-100'
}

export function getStatusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

export function getComplianceColor(rate: number): string {
  if (rate >= 90) return 'text-green-600'
  if (rate >= 70) return 'text-yellow-600'
  return 'text-red-600'
}

export function getComplianceBg(rate: number): string {
  if (rate >= 90) return 'bg-green-500'
  if (rate >= 70) return 'bg-yellow-500'
  return 'bg-red-500'
}

export function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    higher_supervision: 'Supervisor',
    general_manager: 'General Manager',
    regional_manager: 'Regional Manager',
    branch_manager: 'Branch Manager',
    admin: 'Administrator',
  }
  return labels[role] || role
}

export function getRoleDashboardPath(role: string): string {
  const paths: Record<string, string> = {
    higher_supervision: '/higher-supervision',
    general_manager: '/general-manager',
    regional_manager: '/regional-manager',
    branch_manager: '/branch-manager',
    admin: '/admin',
  }
  return paths[role] || '/dashboard'
}
