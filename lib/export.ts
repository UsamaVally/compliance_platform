export function exportToCSV(data: Record<string, any>[], filename: string) {
  if (!data.length) return
  const headers = Object.keys(data[0])
  const rows = data.map(row =>
    headers.map(h => {
      const val = row[h]
      if (val === null || val === undefined) return ''
      if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`
      const str = String(val)
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str
    }).join(',')
  )
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function exportToPDF(title: string, htmlContent: string) {
  const printWindow = window.open('', '_blank')
  if (!printWindow) return
  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; font-size: 12px; color: #111; }
    h1 { font-size: 20px; color: #1e1b4b; margin-bottom: 16px; }
    h2 { font-size: 15px; color: #1e1b4b; margin: 20px 0 8px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: #f0f0f0; font-weight: 600; text-align: left; padding: 6px 8px; border: 1px solid #ddd; }
    td { padding: 6px 8px; border: 1px solid #ddd; vertical-align: top; }
    .badge-green { background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 9999px; font-size: 11px; }
    .badge-red { background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 9999px; font-size: 11px; }
    .badge-yellow { background: #fef9c3; color: #854d0e; padding: 2px 8px; border-radius: 9999px; font-size: 11px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p style="color:#666;margin-bottom:16px;">Generated: ${new Date().toLocaleString()}</p>
  ${htmlContent}
</body>
</html>`)
  printWindow.document.close()
  setTimeout(() => printWindow.print(), 500)
}

export function tableToHTML(headers: string[], rows: string[][]): string {
  return `<table>
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`
}
