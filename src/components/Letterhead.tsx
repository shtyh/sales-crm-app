import { COMPANY } from '../lib/company'

/**
 * Shared letterhead block for all printable workshop / sales docs
 * (quotation, cash bill, invoice, …).
 *
 * Left column: Proton logo + company name + tagline + address +
 * registration / tel / SST / H/P / eMail.
 * Right column: document title (e.g. "Quotation", "Cash Bill") plus
 * a 2-col grid of meta fields the caller passes through `meta`.
 *
 * The Proton logo is served from `/proton-logo.png` (public dir).
 * If the file isn't there yet the `onError` handler hides the <img>
 * so the doc still prints cleanly with just the text letterhead.
 */
export function Letterhead({
  title,
  meta,
}: {
  /** Big right-side document title — "Quotation", "Cash Bill", … */
  title: string
  /** Right-side meta rows, [label, value] pairs. */
  meta: ReadonlyArray<readonly [string, React.ReactNode]>
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b-2 border-gray-900 pb-3">
      <div className="flex items-start gap-3">
        <img
          src="/proton-logo.png"
          alt="Proton"
          // The Proton logo PNG is the user's branded letterhead asset.
          // If it's missing in /public the onError keeps the layout
          // intact instead of leaving a broken-image icon on print.
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
          className="h-16 w-auto print:h-14"
        />
        <div>
          <div className="text-xl font-bold tracking-tight uppercase text-gray-900">
            {COMPANY.name}
          </div>
          <div className="mt-0.5 text-[11px] text-gray-700">
            {COMPANY.tagline}
          </div>
          <div className="mt-1 text-[11px] leading-snug text-gray-700">
            {COMPANY.address.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-4 text-[11px] text-gray-700">
            <div>Company Reg No: {COMPANY.regNo}</div>
            <div>Tel No: {COMPANY.tel}</div>
            <div>SST No: {COMPANY.sstNo}</div>
            <div>H/P No: {COMPANY.hp}</div>
            <div className="col-span-2">eMail: {COMPANY.email}</div>
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="text-2xl font-bold tracking-wide uppercase text-gray-900">
          {title}
        </div>
        {meta.length > 0 && (
          <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-[11px] text-gray-700">
            {meta.map(([label, value], i) => (
              <span key={i} className="contents">
                <span className="text-right">{label}</span>
                <span className="text-left">{value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
