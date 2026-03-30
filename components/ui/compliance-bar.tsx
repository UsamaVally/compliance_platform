import { cn, getComplianceBg } from '@/lib/utils'

interface ComplianceBarProps {
  rate: number
  label?: string
  showLabel?: boolean
  height?: string
}

export function ComplianceBar({ rate, label, showLabel = true, height = 'h-2' }: ComplianceBarProps) {
  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between items-center mb-1">
          {label && <span className="text-xs text-gray-600">{label}</span>}
          <span
            className={cn(
              'text-xs font-semibold ml-auto',
              rate >= 90 ? 'text-green-600' : rate >= 70 ? 'text-yellow-600' : 'text-red-600'
            )}
          >
            {rate.toFixed(0)}%
          </span>
        </div>
      )}
      <div className={cn('w-full bg-gray-200 rounded-full', height)}>
        <div
          className={cn('rounded-full transition-all duration-500', height, getComplianceBg(rate))}
          style={{ width: `${Math.min(rate, 100)}%` }}
        />
      </div>
    </div>
  )
}
