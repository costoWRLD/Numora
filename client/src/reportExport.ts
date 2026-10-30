export type ReportExportModel = {
  from: string
  to: string
  currency: string
  totals: { expenses: string; income: string; net: string }
  comparison: { previousPeriod: string; change: string }
  categories: Array<{ name: string; amount: string; share: string }>
  trends: Array<{ period: string; income: string; expenses: string }>
  records: Array<{ date: string; type: string; name: string; category: string; amount: string; currency: string; notes?: string }>
}

type ReportLine = { text: string; size?: number; bold?: boolean; gapAfter?: number }

function reportLines(report: ReportExportModel): ReportLine[] {
  return [
    { text: 'NUMORA SPENDING REPORT', size: 20, bold: true, gapAfter: 5 },
    { text: `Reporting period: ${report.from} to ${report.to}`, size: 10, gapAfter: 16 },
    { text: `Currency: ${report.currency}`, size: 10, gapAfter: 12 },
    { text: 'SUMMARY', size: 13, bold: true, gapAfter: 7 },
    { text: `Total spending: ${report.currency} ${report.totals.expenses}` },
    { text: `Recorded income: ${report.currency} ${report.totals.income}` },
    { text: `Net cash flow (income minus spending): ${report.currency} ${report.totals.net}`, gapAfter: 14 },
    { text: 'PERIOD COMPARISON', size: 13, bold: true, gapAfter: 7 },
    { text: `Previous period spending: ${report.currency} ${report.comparison.previousPeriod}` },
    { text: `Change in spending: ${report.comparison.change}`, gapAfter: 14 },
    { text: 'SPENDING BY CATEGORY', size: 13, bold: true, gapAfter: 7 },
    ...(report.categories.length ? report.categories.map((entry) => ({ text: `${entry.name}: ${report.currency} ${entry.amount} (${entry.share})` })) : [{ text: 'No category spending recorded for this period.' }]),
    { text: 'SPENDING OVER TIME', size: 13, bold: true, gapAfter: 7 },
    ...(report.trends.length ? report.trends.map((entry) => ({ text: `${entry.period}  |  Income ${report.currency} ${entry.income}  |  Spending ${report.currency} ${entry.expenses}` })) : [{ text: 'No dated income or spending recorded for this period.' }]),
    { text: 'FINANCIAL RECORDS', size: 13, bold: true, gapAfter: 7 },
    ...(report.records.length ? report.records.map((entry) => `${entry.date}  |  ${entry.type}  |  ${entry.name}  |  ${entry.category}  |  ${entry.currency} ${entry.amount}${entry.notes ? `  |  ${entry.notes}` : ''}`).map((text) => ({ text })) : [{ text: 'No individual records match this period and currency.' }]),
    { text: 'Prepared locally by Numora. Net cash flow is recorded income minus recorded spending; it is not a profit calculation.', size: 9, gapAfter: 2 },
  ]
}

function safeFileName(value: string) {
  return value.replace(/[^\w.-]+/g, '-')
}

function download(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ascii(value: string) {
  return value.normalize('NFKD')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e]/g, '')
}

function pdfEscape(value: string) {
  return ascii(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
}

function wrap(text: string, width: number) {
  const words = ascii(text).split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

export function downloadReportPdf(report: ReportExportModel) {
  const expanded = reportLines(report).flatMap((line) => wrap(line.text, line.size && line.size > 14 ? 48 : 92).map((text) => ({ ...line, text })))
  const pages: string[][] = []
  let page: string[] = []
  let y = 756
  for (const line of expanded) {
    const size = line.size || 10
    const step = size + (line.gapAfter || 4)
    if (y - step < 48) {
      pages.push(page)
      page = []
      y = 756
    }
    page.push(`/${line.bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 48 ${y} Tm (${pdfEscape(line.text)}) Tj`)
    y -= step
  }
  if (page.length) pages.push(page)
  const encoder = new TextEncoder()
  const objects: string[] = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, index) => `${5 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  pages.forEach((lines, index) => {
    const pageId = 5 + index * 2
    const contentId = pageId + 1
    const stream = `BT\n${lines.map((line) => `${line}\n`).join('')}ET`
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`
    objects[contentId] = `<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream`
  })
  let output = '%PDF-1.4\n'
  const offsets = [0]
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = encoder.encode(output).length
    output += `${index} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = encoder.encode(output).length
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let index = 1; index < objects.length; index += 1) output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  download(output, 'application/pdf', `numora-report-${safeFileName(report.from)}-to-${safeFileName(report.to)}.pdf`)
}

function xmlEscape(value: unknown) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function paragraph(text: string, style = '') {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`
}

function wordTable(rows: string[][]) {
  const columnCount = Math.max(1, rows[0]?.length || 1)
  const columnWidth = Math.floor(10440 / columnCount)
  return `<w:tbl><w:tblPr><w:tblW w:w="10440" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="D8E0D8"/>`).join('')}</w:tblBorders></w:tblPr><w:tblGrid>${rows[0].map(() => `<w:gridCol w:w="${columnWidth}"/>`).join('')}</w:tblGrid>${rows.map((row, rowIndex) => `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="${columnWidth}" w:type="dxa"/>${rowIndex === 0 ? '<w:shd w:fill="EAF0EA"/>' : ''}</w:tcPr><w:p><w:r>${rowIndex === 0 ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEscape(cell)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function zipStored(files: Array<{ name: string; content: string }>) {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let localOffset = 0
  const write16 = (view: DataView, offset: number, value: number) => view.setUint16(offset, value, true)
  const write32 = (view: DataView, offset: number, value: number) => view.setUint32(offset, value >>> 0, true)
  for (const file of files) {
    const name = encoder.encode(file.name)
    const data = encoder.encode(file.content)
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length + data.length)
    const localView = new DataView(local.buffer)
    write32(localView, 0, 0x04034b50); write16(localView, 4, 20); write16(localView, 6, 0x0800); write16(localView, 8, 0)
    write32(localView, 14, crc); write32(localView, 18, data.length); write32(localView, 22, data.length); write16(localView, 26, name.length); write16(localView, 28, 0)
    local.set(name, 30); local.set(data, 30 + name.length)
    localParts.push(local)
    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    write32(centralView, 0, 0x02014b50); write16(centralView, 4, 20); write16(centralView, 6, 20); write16(centralView, 8, 0x0800); write16(centralView, 10, 0)
    write32(centralView, 16, crc); write32(centralView, 20, data.length); write32(centralView, 24, data.length); write16(centralView, 28, name.length)
    write16(centralView, 30, 0); write16(centralView, 32, 0); write16(centralView, 34, 0); write32(centralView, 38, 0); write32(centralView, 42, localOffset)
    central.set(name, 46); centralParts.push(central)
    localOffset += local.length
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  write32(endView, 0, 0x06054b50); write16(endView, 8, files.length); write16(endView, 10, files.length); write32(endView, 12, centralSize); write32(endView, 16, localOffset)
  const chunks = [...localParts, ...centralParts, end].map((part) => Uint8Array.from(part).buffer as ArrayBuffer)
  return new Blob(chunks, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

export function downloadReportDocx(report: ReportExportModel) {
  const records = [['Date', 'Type', 'Name', 'Category', 'Amount'], ...report.records.map((entry) => [entry.date, entry.type, entry.name, entry.category, `${entry.currency} ${entry.amount}`])]
  const categories = [['Category', 'Spending', 'Share'], ...report.categories.map((entry) => [entry.name, `${report.currency} ${entry.amount}`, entry.share])]
  const trends = [['Period', 'Income', 'Spending'], ...report.trends.map((entry) => [entry.period, `${report.currency} ${entry.income}`, `${report.currency} ${entry.expenses}`])]
  const summary = wordTable([
    ['Measure', 'Amount'],
    ['Total spending', `${report.currency} ${report.totals.expenses}`],
    ['Recorded income', `${report.currency} ${report.totals.income}`],
    ['Net cash flow', `${report.currency} ${report.totals.net}`],
    ['Previous period spending', `${report.currency} ${report.comparison.previousPeriod}`],
    ['Change in spending', report.comparison.change],
  ])
  const body = [
    paragraph('Numora Spending Report', 'Title'),
    paragraph(`Reporting period: ${report.from} to ${report.to}`),
    paragraph(`Currency: ${report.currency}`),
    paragraph('Summary', 'Heading1'), summary,
    paragraph('Spending by category', 'Heading1'), wordTable(categories),
    paragraph('Spending over time', 'Heading1'), wordTable(trends),
    paragraph('Financial records', 'Heading1'), wordTable(records),
    paragraph('Net cash flow is recorded income minus recorded spending. It is not a profit calculation.'),
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/></w:sectPr>',
  ].join('')
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  const files = [
    { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', content: documentXml },
    { name: 'word/_rels/document.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'word/styles.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="203F34"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="203F34"/></w:rPr></w:style></w:styles>' },
  ]
  const blob = zipStored(files)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `numora-report-${safeFileName(report.from)}-to-${safeFileName(report.to)}.docx`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
