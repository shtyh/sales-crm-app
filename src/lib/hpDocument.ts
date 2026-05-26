import JSZip from 'jszip'
import { saveAs } from 'file-saver'

/**
 * HP-disbursement letter generator.
 *
 * The .docx template lives at `/templates/hp-disbursement.docx` and contains
 * four placeholder tokens — {{date}}, {{customerName}}, {{loanAmount}}, and
 * {{handlingFee}} — that we substitute inside word/document.xml. The .docx
 * format is just a zip of XML, so this is plain string replacement; no
 * heavyweight templating engine needed.
 *
 * Handling fee is hardcoded RM 600 per business policy.
 */

const TEMPLATE_URL = '/templates/hp-disbursement.docx'
export const HANDLING_FEE_RM = 600

export interface HpDocumentFields {
  customerName: string
  /** Loan amount in MYR (numeric). Formatted as "RM 95,000.00" in output. */
  loanAmount: number
  /** Optional override; defaults to today's date in DD/MM/YYYY. */
  date?: Date
}

function formatMyr(amount: number): string {
  return `RM ${amount.toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

/**
 * XML-escape user-supplied values so they can't break document.xml. Names
 * with `&` or `<` (rare but possible in business names) would otherwise
 * produce a corrupt docx.
 */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Generate the HP disbursement letter for a booking and trigger a download.
 * Filename includes the customer name + date so the admin can save many.
 */
export async function generateHpLetter(
  fields: HpDocumentFields,
): Promise<void> {
  const res = await fetch(TEMPLATE_URL)
  if (!res.ok) {
    throw new Error(
      `Failed to load HP template (HTTP ${res.status}). Is /templates/hp-disbursement.docx deployed?`,
    )
  }
  const buf = await res.arrayBuffer()

  const zip = await JSZip.loadAsync(buf)
  const docFile = zip.file('word/document.xml')
  if (!docFile) {
    throw new Error('HP template is missing word/document.xml — corrupt file?')
  }
  let xml = await docFile.async('string')

  const date = fields.date ?? new Date()
  const replacements: Record<string, string> = {
    '{{date}}': xmlEscape(formatDate(date)),
    '{{customerName}}': xmlEscape(fields.customerName),
    '{{loanAmount}}': xmlEscape(formatMyr(fields.loanAmount)),
    '{{handlingFee}}': xmlEscape(formatMyr(HANDLING_FEE_RM)),
  }
  for (const [token, value] of Object.entries(replacements)) {
    // `replaceAll` instead of regex so the {{ / }} braces don't need escaping.
    xml = xml.split(token).join(value)
  }

  zip.file('word/document.xml', xml)

  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })

  // Filename: customer-friendly slug + ISO date. Avoids overwriting on disk
  // when printing for multiple customers in a row.
  const slug = fields.customerName
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  saveAs(blob, `HP-${slug || 'customer'}-${stamp}.docx`)
}
