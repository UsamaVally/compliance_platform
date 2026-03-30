import { cn } from '@/lib/utils'
import { AlertCircle, CheckCircle, Info, XCircle, X } from 'lucide-react'

interface AlertProps {
  type: 'success' | 'error' | 'warning' | 'info'
  title?: string
  message: string
  onClose?: () => void
  className?: string
}

export function Alert({ type, title, message, onClose, className }: AlertProps) {
  const styles = {
    success: {
      bg: 'bg-green-50 border-green-200',
      text: 'text-green-800',
      icon: CheckCircle,
      iconClass: 'text-green-500',
    },
    error: {
      bg: 'bg-red-50 border-red-200',
      text: 'text-red-800',
      icon: XCircle,
      iconClass: 'text-red-500',
    },
    warning: {
      bg: 'bg-yellow-50 border-yellow-200',
      text: 'text-yellow-800',
      icon: AlertCircle,
      iconClass: 'text-yellow-500',
    },
    info: {
      bg: 'bg-blue-50 border-blue-200',
      text: 'text-blue-800',
      icon: Info,
      iconClass: 'text-blue-500',
    },
  }

  const { bg, text, icon: Icon, iconClass } = styles[type]

  return (
    <div className={cn('flex items-start gap-3 rounded-lg border p-4', bg, className)}>
      <Icon className={cn('h-5 w-5 flex-shrink-0 mt-0.5', iconClass)} />
      <div className="flex-1 min-w-0">
        {title && <p className={cn('text-sm font-semibold', text)}>{title}</p>}
        <p className={cn('text-sm', text)}>{message}</p>
      </div>
      {onClose && (
        <button onClick={onClose} className={cn('flex-shrink-0', text)}>
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
