import { lazy, Suspense, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'

// html5-qrcode is ~370 KB minified — split into its own chunk so it only
// hits the wire when the user actually clicks Scan.
const QrScannerModal = lazy(() =>
  import('../components/QrScannerModal').then((m) => ({
    default: m.QrScannerModal,
  })),
)
import { useAuth } from '../lib/auth'
import {
  useCreateStockReceipt,
  useLookupPartByCode,
  useStockReceipts,
  useSuppliers,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import type { Part } from '../lib/types'

// ─── Stock Received / Control ──────────────────────────────────────────────
//
// Port of the legacy WMS Stock Received screen. Two entry paths:
//   1. Manual — type/paste part code, qty, unit cost, hit Enter to add.
//   2. QR — same field, but a USB barcode scanner or phone-paste deposits
//      the code text into the focused input. No in-app camera library; the
//      OS handles QR decoding.
//
// On Save, the entire receipt commits atomically (header + items). A DB
// trigger bumps parts_inventory.stock_qty + qty_received per item.

const inputClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'

const labelClass = 'text-xs font-medium uppercase tracking-wider text-gray-500'

type Draft = {
  receipt_date: string
  supplier_id: string
  invoice_no: string
  invoice_date: string
  do_no: string
  po_no: string
  remarks: string
}

type LineDraft = {
  key: string
  part: Part
  qty: number
  unit_cost: number
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function StockReceivePage() {
  const { role, user, canAccessService, loading } = useAuth()
  if (canAccessService === false) return <Navigate to="/" replace />
  if (role === 'sales_advisor') return <Navigate to="/" replace />
  if (loading && role == null) {
    return (
      <AppShell>
        <p className="p-6 text-sm text-gray-500">Loading…</p>
      </AppShell>
    )
  }

  const { data: suppliers } = useSuppliers()
  const { data: recent, error: recentErr } = useStockReceipts(15)
  const lookupMut = useLookupPartByCode()
  const createMut = useCreateStockReceipt()

  const [draft, setDraft] = useState<Draft>({
    receipt_date: today(),
    supplier_id: '',
    invoice_no: '',
    invoice_date: '',
    do_no: '',
    po_no: '',
    remarks: '',
  })
  const [lines, setLines] = useState<LineDraft[]>([])
  const [partCode, setPartCode] = useState('')
  const [qtyInput, setQtyInput] = useState('1')
  const [costInput, setCostInput] = useState('')
  const [lineError, setLineError] = useState<string | null>(null)
  const [submitMsg, setSubmitMsg] = useState<string | null>(null)
  const [submitErr, setSubmitErr] = useState<string | null>(null)
  const codeInputRef = useRef<HTMLInputElement | null>(null)
  // Which field is the QR scanner targeting? `null` when closed.
  const [qrTarget, setQrTarget] = useState<'do_no' | 'part_code' | null>(null)

  const totals = useMemo(() => {
    let qty = 0
    let cost = 0
    for (const l of lines) {
      qty += l.qty
      cost += l.qty * l.unit_cost
    }
    return { qty, cost }
  }, [lines])

  function setF<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }

  async function addLine() {
    setLineError(null)
    const code = partCode.trim()
    const qty = Number(qtyInput)
    const cost = Number(costInput)
    if (!code) {
      setLineError('Enter a part code.')
      return
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setLineError('Quantity must be > 0.')
      return
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setLineError('Unit cost must be ≥ 0.')
      return
    }
    try {
      const part = await lookupMut.mutateAsync(code)
      if (!part) {
        setLineError(`No part found with code "${code}".`)
        return
      }
      setLines((prev) => [
        ...prev,
        { key: crypto.randomUUID(), part, qty, unit_cost: cost },
      ])
      setPartCode('')
      setQtyInput('1')
      setCostInput('')
      codeInputRef.current?.focus()
    } catch (err) {
      setLineError(formatError(err))
    }
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitErr(null)
    setSubmitMsg(null)
    if (lines.length === 0) {
      setSubmitErr('Add at least one line item before saving.')
      return
    }
    if (!user) return
    try {
      const created = await createMut.mutateAsync({
        input: {
          receipt_date: draft.receipt_date,
          supplier_id: draft.supplier_id || null,
          invoice_no: draft.invoice_no.trim() || null,
          invoice_date: draft.invoice_date || null,
          do_no: draft.do_no.trim() || null,
          po_no: draft.po_no.trim() || null,
          remarks: draft.remarks.trim() || null,
          items: lines.map((l) => ({
            part_id: l.part.id,
            qty: l.qty,
            unit_cost: l.unit_cost,
          })),
        },
        createdBy: user.id,
      })
      setSubmitMsg(
        `Receipt #${created.receipt_no} saved — ${lines.length} item${
          lines.length === 1 ? '' : 's'
        }, total qty ${totals.qty}, RM ${formatMYR(totals.cost)}.`,
      )
      setLines([])
      setDraft({
        receipt_date: today(),
        supplier_id: '',
        invoice_no: '',
        invoice_date: '',
        do_no: '',
        po_no: '',
        remarks: '',
      })
      codeInputRef.current?.focus()
    } catch (err) {
      setSubmitErr(formatError(err))
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Stock Received
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Record a delivery from a supplier. Stock is added to inventory on
              save.
            </p>
          </div>
          <Link
            to="/service/stock"
            className="text-xs text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
          >
            ← Back to Stock Menu
          </Link>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Header card */}
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">
              Receipt details
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Date">
                <input
                  type="date"
                  required
                  value={draft.receipt_date}
                  onChange={(e) => setF('receipt_date', e.target.value)}
                  className={inputClass + ' w-full'}
                />
              </Field>
              <Field label="Supplier" className="sm:col-span-2">
                <select
                  value={draft.supplier_id}
                  onChange={(e) => setF('supplier_id', e.target.value)}
                  className={inputClass + ' w-full'}
                >
                  <option value="">— Select supplier —</option>
                  {(suppliers ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Invoice No">
                <input
                  type="text"
                  value={draft.invoice_no}
                  onChange={(e) => setF('invoice_no', e.target.value)}
                  className={inputClass + ' w-full'}
                />
              </Field>
              <Field label="Invoice Date">
                <input
                  type="date"
                  value={draft.invoice_date}
                  onChange={(e) => setF('invoice_date', e.target.value)}
                  className={inputClass + ' w-full'}
                />
              </Field>
              <Field label="PO No">
                <input
                  type="text"
                  value={draft.po_no}
                  onChange={(e) => setF('po_no', e.target.value)}
                  className={inputClass + ' w-full'}
                />
              </Field>
              <Field label="DO No" className="sm:col-span-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={draft.do_no}
                    onChange={(e) => setF('do_no', e.target.value)}
                    placeholder="Type, paste, scan with USB reader, or use 📷 →"
                    className={
                      inputClass +
                      ' w-full font-mono tracking-wider placeholder:font-sans placeholder:tracking-normal'
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setQrTarget('do_no')}
                    className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                    title="Scan DO QR code with the camera"
                  >
                    📷 Scan
                  </button>
                </div>
              </Field>
              <Field label="Remarks" className="sm:col-span-3">
                <textarea
                  value={draft.remarks}
                  onChange={(e) => setF('remarks', e.target.value)}
                  rows={2}
                  className={inputClass + ' w-full'}
                />
              </Field>
            </div>
          </section>

          {/* Line items */}
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">
              Items received
            </h2>

            {/* Add-line row */}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-12 sm:col-span-6">
                  <label className={labelClass}>Part code</label>
                  <div className="mt-1 flex gap-2">
                    <input
                      ref={codeInputRef}
                      type="text"
                      value={partCode}
                      onChange={(e) => setPartCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void addLine()
                        }
                      }}
                      placeholder="Scan or type part_no, then press Enter"
                      className={inputClass + ' w-full font-mono'}
                    />
                    <button
                      type="button"
                      onClick={() => setQrTarget('part_code')}
                      className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                      title="Scan a barcode / QR for the part code"
                    >
                      📷
                    </button>
                  </div>
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <label className={labelClass}>Qty</label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={qtyInput}
                    onChange={(e) => setQtyInput(e.target.value)}
                    className={inputClass + ' mt-1 w-full text-right'}
                  />
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <label className={labelClass}>Unit cost</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={costInput}
                    onChange={(e) => setCostInput(e.target.value)}
                    placeholder="0.00"
                    className={inputClass + ' mt-1 w-full text-right'}
                  />
                </div>
                <div className="col-span-4 sm:col-span-2 flex items-end">
                  <button
                    type="button"
                    onClick={() => void addLine()}
                    disabled={lookupMut.isPending}
                    className="w-full rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-50"
                  >
                    {lookupMut.isPending ? '…' : 'Add'}
                  </button>
                </div>
              </div>
              {lineError && (
                <p className="mt-2 text-xs text-rose-700">{lineError}</p>
              )}
            </div>

            {/* Lines table */}
            <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Part</th>
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Unit cost
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Line total
                    </th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-6 text-center text-xs text-gray-500"
                      >
                        No items yet. Scan or type a part code above.
                      </td>
                    </tr>
                  )}
                  {lines.map((l) => (
                    <tr key={l.key} className="hover:bg-gray-50/60">
                      <td className="px-3 py-1.5 font-mono text-[12px] text-gray-900">
                        {l.part.part_no}
                      </td>
                      <td className="px-3 py-1.5 text-gray-900">
                        {l.part.name}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-900">
                        {l.qty}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                        {formatMYR(l.unit_cost)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-900">
                        {formatMYR(l.qty * l.unit_cost)}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(l.key)}
                          className="text-xs text-rose-600 underline-offset-2 hover:underline"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {lines.length > 0 && (
                    <tr className="border-t-2 border-gray-900 bg-gray-100">
                      <td
                        colSpan={2}
                        className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-900"
                      >
                        Totals
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-sm font-bold text-gray-900">
                        {totals.qty}
                      </td>
                      <td />
                      <td className="px-3 py-2 text-right tabular-nums text-sm font-bold text-gray-900">
                        {formatMYR(totals.cost)}
                      </td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Save bar */}
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-xs text-gray-500">
                {lines.length} item{lines.length === 1 ? '' : 's'} · Qty{' '}
                {totals.qty} · Total RM {formatMYR(totals.cost)}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLines([])
                    setSubmitMsg(null)
                    setSubmitErr(null)
                  }}
                  disabled={createMut.isPending}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  Clear
                </button>
                <button
                  type="submit"
                  disabled={createMut.isPending || lines.length === 0}
                  className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-50"
                >
                  {createMut.isPending ? 'Saving…' : '💾 Save receipt'}
                </button>
              </div>
            </div>

            {submitErr && (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {submitErr}
              </p>
            )}
            {submitMsg && (
              <p className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {submitMsg}
              </p>
            )}
          </section>
        </form>

        {/* Recent receipts */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">
            Recent receipts
          </h2>
          {recentErr && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formatError(recentErr)}
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">No</th>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Supplier</th>
                  <th className="px-3 py-2 text-left font-medium">DO No</th>
                  <th className="px-3 py-2 text-left font-medium">
                    Invoice No
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Items</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Total (RM)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {!recent && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-6 text-center text-xs text-gray-500"
                    >
                      Loading…
                    </td>
                  </tr>
                )}
                {recent && recent.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-6 text-center text-xs text-gray-500"
                    >
                      No receipts yet — save your first one above.
                    </td>
                  </tr>
                )}
                {recent?.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                      #{r.receipt_no}
                    </td>
                    <td className="px-3 py-1.5 text-gray-900">
                      {r.receipt_date}
                    </td>
                    <td className="px-3 py-1.5 text-gray-700">
                      {r.supplier_name ? (
                        <>
                          <span className="font-mono text-[11px] text-gray-500">
                            {r.supplier_code}
                          </span>{' '}
                          {r.supplier_name}
                        </>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-gray-700">
                      {r.do_no || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-gray-700">
                      {r.invoice_no || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                      {r.item_count}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                      {Number(r.total_qty).toString()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-900">
                      {formatMYR(Number(r.total_cost))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Suspense fallback={null}>
        <QrScannerModal
          open={qrTarget !== null}
          title={
            qrTarget === 'do_no'
              ? 'Scan delivery-order QR'
              : 'Scan part barcode / QR'
          }
          onScan={(text) => {
            if (qrTarget === 'do_no') {
              setF('do_no', text)
            } else if (qrTarget === 'part_code') {
              setPartCode(text)
              codeInputRef.current?.focus()
            }
          }}
          onClose={() => setQrTarget(null)}
        />
      </Suspense>
    </AppShell>
  )
}

// ─── Bits ──────────────────────────────────────────────────────────────────

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className={labelClass}>{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  )
}
