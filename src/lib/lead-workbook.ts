import ExcelJS from 'exceljs'
import { LEAD_STATUS_LABELS } from '../contracts/index.js'

/** The row shape the leads export query returns. */
export interface LeadExportRow {
  lead: {
    createdAt: Date | string
    name: string
    phone: string
    email: string | null
    interest: string | null
    amount: number | null
    tenorMonths: number | null
    estimatedInstallment: number | null
    purposes: string[] | null
    message: string | null
    source: string
    status: string
    contactedAt: Date | string | null
  }
  productName: string | null
  branchName: string | null
  assignedToName: string | null
}

const SOURCE_LABELS: Record<string, string> = {
  profiling: 'Profiling',
  contact_form: 'Formulir Kontak',
  suggestion: 'Saran',
  career: 'Karir',
  whatsapp: 'WhatsApp',
  manual: 'Manual',
}

/** Brand ink, minus the leading hash — ExcelJS wants ARGB. */
const INK = 'FF0F1B2D'
const PAPER = 'FFF4F6F8'
const LINE = 'FFE3E8EE'

const RUPIAH = '#,##0;[Red]-#,##0'
const DATETIME = 'dd/mm/yyyy hh:mm'

interface ColumnSpec {
  header: string
  width: number
  format?: string
  wrap?: boolean
  value: (r: LeadExportRow) => string | number | Date | null
}

const asDate = (v: Date | string | null) => (v ? new Date(v) : null)

const COLUMNS: ColumnSpec[] = [
  { header: 'Tanggal masuk', width: 18, format: DATETIME, value: (r) => asDate(r.lead.createdAt) },
  { header: 'Nama', width: 26, value: (r) => r.lead.name },
  // Kept as text: a phone number stored as a number loses its leading zero.
  { header: 'WhatsApp', width: 17, value: (r) => r.lead.phone },
  { header: 'Email', width: 26, value: (r) => r.lead.email },
  { header: 'Produk diminati', width: 26, value: (r) => r.productName ?? r.lead.interest },
  { header: 'Cabang', width: 20, value: (r) => r.branchName },
  { header: 'Sumber', width: 16, value: (r) => SOURCE_LABELS[r.lead.source] ?? r.lead.source },
  { header: 'Nominal (Rp)', width: 16, format: RUPIAH, value: (r) => r.lead.amount },
  { header: 'Tenor (bulan)', width: 13, format: '0', value: (r) => r.lead.tenorMonths },
  { header: 'Estimasi angsuran (Rp)', width: 20, format: RUPIAH, value: (r) => r.lead.estimatedInstallment },
  { header: 'Keperluan', width: 26, wrap: true, value: (r) => (r.lead.purposes ?? []).join(', ').replace(/_/g, ' ') },
  { header: 'Pesan', width: 46, wrap: true, value: (r) => r.lead.message },
  { header: 'Status', width: 14, value: (r) => LEAD_STATUS_LABELS[r.lead.status as keyof typeof LEAD_STATUS_LABELS] ?? r.lead.status },
  { header: 'Ditugaskan ke', width: 22, value: (r) => r.assignedToName },
  { header: 'Dihubungi pada', width: 18, format: DATETIME, value: (r) => asDate(r.lead.contactedAt) },
]

/**
 * The follow-up list as a real .xlsx.
 *
 * Everything here exists because a CSV loses it: the dark header staff can
 * freeze and filter against, rupiah figures Excel will sum, dates it will sort
 * by date rather than alphabetically, phone numbers that keep their leading
 * zero, and column widths that make the sheet readable without dragging.
 */
export async function buildLeadWorkbook(rows: LeadExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'KSP Sari Sedana Bali'
  wb.created = new Date()

  const ws = wb.addWorksheet('Calon Nasabah', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.header, width: c.width }))

  const head = ws.getRow(1)
  head.height = 26
  head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } }
  head.alignment = { vertical: 'middle', horizontal: 'left' }

  for (const row of rows) {
    ws.addRow(COLUMNS.map((c) => c.value(row) ?? null))
  }

  COLUMNS.forEach((c, i) => {
    const column = ws.getColumn(i + 1)
    if (c.format) column.numFmt = c.format
    column.alignment = { vertical: 'top', horizontal: c.format === RUPIAH || c.format === '0' ? 'right' : 'left', wrapText: c.wrap ?? false }
  })

  // Banded rows and a hairline grid, applied after the data so the header keeps its own fill.
  ws.eachRow({ includeEmpty: false }, (row, index) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: LINE } },
        bottom: { style: 'thin', color: { argb: LINE } },
        left: { style: 'thin', color: { argb: LINE } },
        right: { style: 'thin', color: { argb: LINE } },
      }
    })
    if (index > 1 && index % 2 === 1) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER } }
      })
    }
  })

  if (rows.length) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } }
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}
