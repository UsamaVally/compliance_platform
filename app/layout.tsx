import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ComplianceHub - Operations Compliance Platform',
  description: 'Enterprise compliance management, escalation tracking, and operational oversight platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
