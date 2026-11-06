/**
 * Dependency-free report export: a real .xlsx workbook and a simple .pdf table.
 * Kept small on purpose so the build needs no extra npm packages.
 */

export type Cell = string | number
export interface ExportTable {
  /** File name without extension */
  fileName: string
  title: string
  /** Shown under the title, e.g. the date range */
  subtitle?: string
  headers: string[]
  rows: Cell[][]
  /** Optional totals row appended at the end */
  totals?: Cell[]
  /** Which columns hold money (formatted with 2 decimals) */
  moneyCols?: number[]
}

const enc = new TextEncoder()

function save(bytes: Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ───────────────────────── ZIP (stored, no compression) ─────────────────────────

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
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  // Fixed DOS date/time (2024-01-01 00:00) – avoids clock-dependent output
  const dosTime = 0
  const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1

  for (const f of files) {
    const name = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(8, 0, true) // stored
    local.setUint16(10, dosTime, true)
    local.setUint16(12, dosDate, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, f.data.length, true)
    local.setUint32(22, f.data.length, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    parts.push(new Uint8Array(local.buffer), name, f.data)

    const cen = new DataView(new ArrayBuffer(46))
    cen.setUint32(0, 0x02014b50, true)
    cen.setUint16(4, 20, true)
    cen.setUint16(6, 20, true)
    cen.setUint16(8, 0x0800, true)
    cen.setUint16(10, 0, true)
    cen.setUint16(12, dosTime, true)
    cen.setUint16(14, dosDate, true)
    cen.setUint32(16, crc, true)
    cen.setUint32(20, f.data.length, true)
    cen.setUint32(24, f.data.length, true)
    cen.setUint16(28, name.length, true)
    cen.setUint32(42, offset, true)
    central.push(new Uint8Array(cen.buffer), name)

    offset += 30 + name.length + f.data.length
  }

  const cenSize = central.reduce((s, p) => s + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, cenSize, true)
  end.setUint32(16, offset, true)

  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0))
  let pos = 0
  for (const p of all) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}

// ───────────────────────────────── XLSX ─────────────────────────────────

const xmlEsc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // strip characters XML 1.0 forbids
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

const colName = (i: number) => String.fromCharCode(65 + i) // up to 26 columns is plenty here

export function buildXlsx(t: ExportTable): Uint8Array {
  const money = new Set(t.moneyCols ?? [])
  const cell = (v: Cell, c: number, r: number, style: number) => {
    const ref = `${colName(c)}${r}`
    if (typeof v === 'number' && Number.isFinite(v)) {
      const s = money.has(c) ? (style === 1 ? 4 : 3) : style
      return `<c r="${ref}" s="${s}"><v>${v}</v></c>`
    }
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`
  }

  const sheetRows: string[] = []
  let r = 1
  sheetRows.push(`<row r="${r}">${cell(t.title, 0, r, 1)}</row>`)
  r++
  if (t.subtitle) {
    sheetRows.push(`<row r="${r}">${cell(t.subtitle, 0, r, 0)}</row>`)
    r++
  }
  r++ // blank spacer row
  sheetRows.push(`<row r="${r}">${t.headers.map((h, c) => cell(h, c, r, 1)).join('')}</row>`)
  r++
  for (const row of t.rows) {
    sheetRows.push(`<row r="${r}">${row.map((v, c) => cell(v, c, r, 0)).join('')}</row>`)
    r++
  }
  if (t.totals) {
    sheetRows.push(`<row r="${r}">${t.totals.map((v, c) => cell(v, c, r, 1)).join('')}</row>`)
  }

  const widths = t.headers.map((h, c) => {
    const longest = Math.max(h.length, ...t.rows.map((row) => String(row[c] ?? '').length))
    return Math.min(60, Math.max(10, longest + 3))
  })
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${sheetRows.join('')}</sheetData></worksheet>`

  // 0 normal · 1 bold · 2 (unused) · 3 money · 4 bold money
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="5">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>` +
    `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`

  const sheetName = xmlEsc(t.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report')

  const files = [
    {
      name: '[Content_Types].xml',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    { name: 'xl/styles.xml', data: enc.encode(styles) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet) },
  ]
  return zipStore(files)
}

export function downloadXlsx(t: ExportTable) {
  save(buildXlsx(t), `${t.fileName}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}

// ───────────────────────────────── PDF ─────────────────────────────────

/** Standard PDF fonts only cover Latin-1; anything else becomes "?" so the file never breaks. */
const latin1 = (s: string) =>
  s
    .replace(/₹/g, 'Rs.')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')

const pdfEsc = (s: string) => latin1(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

export function buildPdf(t: ExportTable): Uint8Array {
  const W = 595
  const H = 842
  const M = 40
  const rowH = 20
  const money = new Set(t.moneyCols ?? [])
  const fmt = (v: Cell, c: number) =>
    typeof v === 'number'
      ? money.has(c)
        ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : String(v)
      : v

  // Column widths: first column narrow (rank), second wide (name), rest equal
  const usable = W - M * 2
  const n = t.headers.length
  const widths = t.headers.map((_, i) => {
    if (n <= 2) return usable / n
    if (i === 0) return 36
    if (i === 1) return usable - 36 - ((n - 2) * 100)
    return 100
  })
  const maxChars = (w: number) => Math.max(4, Math.floor((w - 10) / 5.2)) // ~Helvetica 10pt average

  const fit = (s: string, w: number) => {
    const x = latin1(s)
    const m = maxChars(w)
    return x.length > m ? x.slice(0, m - 1) + '.' : x
  }

  const body = [...t.rows, ...(t.totals ? [t.totals] : [])]
  const perFirst = Math.floor((H - M * 2 - 70 - rowH) / rowH)
  const perNext = Math.floor((H - M * 2 - rowH) / rowH)
  const pages: Cell[][][] = []
  let i = 0
  while (i < body.length || pages.length === 0) {
    const take = pages.length === 0 ? perFirst : perNext
    pages.push(body.slice(i, i + take))
    i += take
  }

  const contents: string[] = pages.map((pageRows, p) => {
    const o: string[] = []
    let y = H - M
    if (p === 0) {
      o.push(`BT /F2 16 Tf ${M} ${y - 12} Td (${pdfEsc(t.title)}) Tj ET`)
      if (t.subtitle) o.push(`BT /F1 10 Tf ${M} ${y - 30} Td (${pdfEsc(t.subtitle)}) Tj ET`)
      y -= 60
    }
    const drawRow = (cells: Cell[], bold: boolean, header: boolean) => {
      if (header) o.push(`0.93 0.94 0.97 rg ${M} ${y - rowH + 4} ${usable} ${rowH} re f 0 g`)
      let x = M
      cells.forEach((v, c) => {
        const text = fit(String(header ? v : fmt(v, c)), widths[c])
        const rightAlign = typeof v === 'number' || (header && c >= 2)
        const approx = text.length * 5.2
        const tx = rightAlign ? x + widths[c] - 6 - approx : x + 5
        o.push(`BT /${bold ? 'F2' : 'F1'} 10 Tf ${tx.toFixed(1)} ${y - 10} Td (${pdfEsc(text)}) Tj ET`)
        x += widths[c]
      })
      o.push(`0.85 g ${M} ${y - rowH + 4} ${usable} 0.5 re f 0 g`)
      y -= rowH
    }
    drawRow(t.headers, true, true)
    pageRows.forEach((row, idx) => {
      const isTotals = !!t.totals && p === pages.length - 1 && idx === pageRows.length - 1
      drawRow(row, isTotals, false)
    })
    o.push(`BT /F1 8 Tf ${M} ${M - 15} Td (Page ${p + 1} of ${pages.length}) Tj ET`)
    return o.join('\n')
  })

  // Assemble objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then page+content pairs
  const objs: string[] = []
  objs[1] = `<< /Type /Catalog /Pages 2 0 R >>`
  const kids = pages.map((_, p) => `${5 + p * 2} 0 R`).join(' ')
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`
  objs[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`
  objs[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`
  contents.forEach((c, p) => {
    objs[5 + p * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + p * 2} 0 R >>`
    objs[6 + p * 2] = `<< /Length ${c.length} >>\nstream\n${c}\nendstream`
  })

  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let k = 1; k < objs.length; k++) {
    offsets[k] = out.length
    out += `${k} 0 obj\n${objs[k]}\nendobj\n`
  }
  const xref = out.length
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`
  for (let k = 1; k < objs.length; k++) out += `${String(offsets[k]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`

  // Every char is < 256 after latin1(), so string length === byte length
  const bytes = new Uint8Array(out.length)
  for (let k = 0; k < out.length; k++) bytes[k] = out.charCodeAt(k) & 0xff
  return bytes
}

export function downloadPdf(t: ExportTable) {
  save(buildPdf(t), `${t.fileName}.pdf`, 'application/pdf')
}
