import { COMPANY } from '../lib/company'

/**
 * Shared letterhead block for all printable workshop / sales docs.
 *
 * Layout:
 *   [logo] [company name]                              [doc title]
 *          [tagline]                                   [meta grid]
 *          [address — joined into one line]
 *          [reg · sst]
 *          [tel · h/p · email]
 *
 * Compact by design — every field is one line so a long doc title
 * ("Material Requisition Form") doesn't force the right column to
 * wrap into a tall awkward block.
 *
 * The Proton logo is served from `/proton-logo.png` (public dir);
 * the `onError` handler hides the <img> so the doc still prints
 * cleanly if the asset is missing.
 */
export function Letterhead({
  title,
  meta,
}: {
  /** Right-side document title — "Quotation", "Cash Bill", … */
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
          onError={(e) => {
            ;(e.currentTarget as HTMLImageElement).style.display = 'none'
          }}
          className="h-12 w-auto shrink-0 print:h-11"
        />
        <div className="leading-snug">
          <div className="text-lg font-bold tracking-tight uppercase text-gray-900">
            {COMPANY.name}
          </div>
          <div className="text-[10px] text-gray-500">{COMPANY.tagline}</div>
          <div className="mt-1 text-[10px] text-gray-700">
            {COMPANY.address.join(', ').replace(/,$/, '')}
          </div>
          <div className="text-[10px] text-gray-700">
            Reg: {COMPANY.regNo}
            <Sep />
            SST: {COMPANY.sstNo}
          </div>
          <div className="text-[10px] text-gray-700">
            Tel: {COMPANY.tel}
            <Sep />
            H/P: {COMPANY.hp}
            <Sep />
            {COMPANY.email}
          </div>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="whitespace-nowrap text-xl font-bold uppercase tracking-tight text-gray-900">
          {title}
        </div>
        {meta.length > 0 && (
          <div className="mt-1.5 grid grid-cols-[auto_auto] justify-end gap-x-2 gap-y-0.5 text-[10.5px] text-gray-700">
            {meta.map(([label, value], i) => (
              <span key={i} className="contents">
                <span className="text-right text-gray-500">{label}</span>
                <span className="text-left">{value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Sep() {
  return <span className="mx-1.5 text-gray-300">·</span>
}
