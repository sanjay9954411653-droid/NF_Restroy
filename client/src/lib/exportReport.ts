/**
 * Report export — no external libraries.
 *  - exportExcel(): builds a genuine .xlsx file (zip of XML) that opens in Excel / Google Sheets / LibreOffice.
 *  - exportPdf():   opens a clean print page; choose "Save as PDF" in the print dialog.
 */

export type Cell = string | number

export interface ReportTable {
  /** Heading above the table (also the Excel sheet name) */
  name: string
  /** Small line under the heading, e.g. the period */
  note?: string
  headers: string[]
  rows: Cell[][]
  /** Optional bold totals row */
  totals?: Cell[]
  /** Column indexes that hold money (shown as 1,234.50 in Excel, ₹ in the PDF) */
  money?: number[]
}

// ── helpers ──────────────────────────────────────────────────────────────────

const enc = new TextEncoder()

const stripBad = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
const xmlEsc = (s: string) =>
  stripBad(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const colName = (i: number): string => {
  let n = i + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function downloadBlob(data: BlobPart, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// ── minimal ZIP writer (stored, no compression) ───────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const now = new Date()
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()

  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff]
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]

  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const size = f.data.length

    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0),
    ])
    chunks.push(local, name, f.data)

    central.push(
      new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(dosTime), ...u16(dosDate),
        ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ]),
      name,
    )
    offset += local.length + name.length + size
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ])

  const all = [...chunks, ...central, end]
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0))
  let p = 0
  for (const c of all) {
    out.set(c, p)
    p += c.length
  }
  return out
}

// ── XLSX ─────────────────────────────────────────────────────────────────────

// cell styles (index into cellXfs below)
const S_DEFAULT = 0
const S_HEADER = 1
const S_MONEY = 2
const S_BOLD = 3
const S_BOLD_MONEY = 4

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE0E7FF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

interface XCell { v: Cell; s: number }

function sheetXml(t: ReportTable): string {
  const money = new Set(t.money || [])
  const grid: XCell[][] = []

  grid.push([{ v: t.name, s: S_BOLD }])
  if (t.note) grid.push([{ v: t.note, s: S_DEFAULT }])
  grid.push([])
  grid.push(t.headers.map((h) => ({ v: h, s: S_HEADER })))
  for (const r of t.rows) {
    grid.push(r.map((v, i) => ({ v, s: typeof v === 'number' && money.has(i) ? S_MONEY : S_DEFAULT })))
  }
  if (t.totals) {
    grid.push(t.totals.map((v, i) => ({ v, s: typeof v === 'number' && money.has(i) ? S_BOLD_MONEY : S_BOLD })))
  }

  // column widths from the longest value (title/note rows excluded)
  const widths = t.headers.map((h) => h.length)
  for (const r of [...t.rows, ...(t.totals ? [t.totals] : [])]) {
    r.forEach((v, i) => {
      const len = typeof v === 'number' ? v.toFixed(2).length : String(v).length
      if (len > (widths[i] ?? 0)) widths[i] = len
    })
  }
  const cols = widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(Math.max(w + 3, 10), 50)}" customWidth="1"/>`)
    .join('')

  const rowsXml = grid
    .map((row, ri) => {
      if (row.length === 0) return `<row r="${ri + 1}"/>`
      const cells = row
        .map((c, ci) => {
          const ref = `${colName(ci)}${ri + 1}`
          if (typeof c.v === 'number' && Number.isFinite(c.v)) {
            return `<c r="${ref}" s="${c.s}"><v>${c.v}</v></c>`
          }
          const text = xmlEsc(String(c.v))
          return `<c r="${ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`
        })
        .join('')
      return `<row r="${ri + 1}">${cells}</row>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${rowsXml}</sheetData></worksheet>`
}

export function buildXlsx(tables: ReportTable[]): Uint8Array {
  // Excel sheet names: max 31 chars, no []:*?/\ and must be unique
  const used = new Set<string>()
  const names = tables.map((t, i) => {
    let n = stripBad(t.name).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`
    let k = 2
    const base = n
    while (used.has(n.toLowerCase())) n = `${base.slice(0, 28)} ${k++}`
    used.add(n.toLowerCase())
    return n
  })

  const files: { name: string; data: Uint8Array }[] = []
  const add = (name: string, xml: string) => files.push({ name, data: enc.encode(xml) })

  add(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${tables
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  )
  add(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  add(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
      .map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
  )
  add(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}<Relationship Id="rId${tables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  )
  add('xl/styles.xml', STYLES_XML)
  tables.forEach((t, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(t)))

  return zipStore(files)
}

export function exportExcel(filename: string, tables: ReportTable[]) {
  downloadBlob(
    buildXlsx(tables),
    filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
}

// ── PDF (print page) ─────────────────────────────────────────────────────────

const rupees = (n: number) =>
  '₹' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

/** Returns false when the browser blocked the new window. */
export function exportPdf(title: string, subtitle: string, tables: ReportTable[]): boolean {
  const w = window.open('', '_blank')
  if (!w) return false

  const cell = (v: Cell, i: number, money: Set<number>, tag: 'td' | 'th') => {
    const isNum = typeof v === 'number'
    const text = isNum ? (money.has(i) ? rupees(v) : String(v)) : xmlEsc(String(v))
    return `<${tag}${isNum ? ' class="num"' : ''}>${text}</${tag}>`
  }

  const body = tables
    .map((t) => {
      const money = new Set(t.money || [])
      // columns that hold numbers: right-align their headings too
      const numCols = new Set(t.headers.map((_, i) => i).filter((i) => t.rows.some((r) => typeof r[i] === 'number')))
      const th = (h: string, i: number) => `<th${numCols.has(i) ? ' class="num"' : ''}>${xmlEsc(h)}</th>`
      return `<section>
        <h2>${xmlEsc(t.name)}</h2>
        ${t.note ? `<p class="note">${xmlEsc(t.note)}</p>` : ''}
        <table>
          <thead><tr>${t.headers.map(th).join('')}</tr></thead>
          <tbody>${t.rows.map((r) => `<tr>${r.map((v, i) => cell(v, i, money, 'td')).join('')}</tr>`).join('')}</tbody>
          ${t.totals ? `<tfoot><tr>${t.totals.map((v, i) => cell(v, i, money, 'td')).join('')}</tr></tfoot>` : ''}
        </table>
      </section>`
    })
    .join('')

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${xmlEsc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #111827; margin: 0; padding: 16px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #6b7280; font-size: 12px; margin: 0 0 18px; }
  h2 { font-size: 15px; margin: 22px 0 2px; }
  .note { color: #6b7280; font-size: 12px; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #e0e7ff; text-align: left; padding: 7px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
  tfoot td { font-weight: 700; border-top: 2px solid #111827; border-bottom: none; }
  .num { text-align: right; white-space: nowrap; }
  th.num { text-align: right; }
  section { break-inside: avoid; }
  .bar { position: sticky; top: 0; background: #4f46e5; color: #fff; padding: 10px 14px; margin: -16px -16px 16px; display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
  .bar button { background: #fff; color: #4f46e5; border: 0; border-radius: 8px; padding: 8px 14px; font-weight: 600; font-size: 13px; }
  @media print { .bar { display: none; } body { padding: 0; } }
</style></head><body>
  <div class="bar"><span>Choose "Save as PDF" as the printer</span><button onclick="window.print()">Print / Save as PDF</button></div>
  <h1>${xmlEsc(title)}</h1>
  <p class="sub">${xmlEsc(subtitle)} · Generated ${xmlEsc(new Date().toLocaleString('en-IN'))}</p>
  ${body}
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print() }, 400) })</script>
</body></html>`)
  w.document.close()
  return true
}
