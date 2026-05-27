import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
// useEffect is kept for the PartsSearchModal's focus/escape handling.
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useCreateServiceOrderItem,
  useCustomers,
  useDeleteServiceOrderItem,
  useParts,
  useServiceOrder,
  useServiceOrderItems,
  useUpdateServiceOrderItem,
  useVehicles,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import type { Part, ServiceOrderItem } from '../lib/types'

/**
 * Billing Screen — adds line items to a service order; rows persist via
 * service_order_items, the totals roll up the line_totals.
 *
 * Entry is keyed on Part Code: the SA either types it directly or opens
 * the 🔍 picker, which searches parts_inventory by part_no / name /
 * brand. Picking a part autofills the description + unit price.
 *
 * Bill No, Invoice Date, tax codes, bonus points, trade-in, and the
 * stock side panel are still visible to match the legacy screen but
 * aren't backed by columns yet.
 */

const inputClass =
  'w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900/20'
const readOnlyClass =
  'w-full rounded border border-gray-300 bg-gray-50 px-2 py-1 text-sm text-gray-700'
const labelClass = 'text-[11px] font-medium text-gray-700'

export function BillingPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { role, isAdmin } = useAuth()

  // Same gate as the rest of the workshop side.
  if (role && !isAdmin) return <Navigate to="/" replace />

  const { data: order, error: orderErr, isLoading } = useServiceOrder(id)
  const { data: items, error: itemsErr } = useServiceOrderItems(id)
  const { data: customers } = useCustomers(true)
  const { data: vehicles } = useVehicles(true)
  const createItem = useCreateServiceOrderItem()
  const updateItem = useUpdateServiceOrderItem()
  const deleteItem = useDeleteServiceOrderItem()

  const [partCode, setPartCode] = useState('')
  const [partName, setPartName] = useState('')
  const [remarks, setRemarks] = useState('')
  const [partsOpen, setPartsOpen] = useState(false)
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState('UNIT')
  const [unitPrice, setUnitPrice] = useState('0')
  const [discountMode, setDiscountMode] = useState<'%' | '$'>('%')
  const [discount, setDiscount] = useState('0')
  // Editing existing line vs adding new. selectedId = null when entering
  // a fresh line; otherwise we're in "Modify" mode for that row.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Derived bits for the header strip.
  const customer = useMemo(
    () =>
      order?.customer_id
        ? customers?.find((c) => c.id === order.customer_id)
        : undefined,
    [order, customers],
  )
  const vehicle = useMemo(
    () =>
      order?.vehicle_id
        ? vehicles?.find((v) => v.id === order.vehicle_id)
        : undefined,
    [order, vehicles],
  )

  // Numeric forms of the entry fields — used to drive the live amount
  // strip on the right side of the form.
  const qtyN = Number(quantity) || 0
  const unitPriceN = Number(unitPrice) || 0
  const gross = qtyN * unitPriceN
  const discountN = Number(discount) || 0
  const discountAmount =
    discountMode === '%' ? (gross * discountN) / 100 : discountN
  const nett = Math.max(0, gross - discountAmount)

  // Totals across all saved line items.
  const totals = useMemo(() => {
    let g = 0
    for (const it of items ?? []) g += Number(it.line_total) || 0
    return { gross: g, invoice: g, sales: g }
  }, [items])

  function clearEntry() {
    setSelectedId(null)
    setPartCode('')
    setPartName('')
    setRemarks('')
    setQuantity('1')
    setUnit('UNIT')
    setUnitPrice('0')
    setDiscountMode('%')
    setDiscount('0')
    setError(null)
  }

  function loadIntoEntry(it: ServiceOrderItem) {
    setSelectedId(it.id)
    // The DB stores one description string; split it back into a name
    // (best-effort) — anything before the first " · " is treated as the
    // part name, the rest as remarks.
    const [first, ...rest] = it.description.split(' · ')
    setPartCode('')
    setPartName(first ?? '')
    setRemarks(rest.join(' · '))
    setQuantity(String(it.quantity))
    setUnit('UNIT')
    setUnitPrice(String(it.unit_price))
    setDiscountMode('%')
    setDiscount('0')
  }

  // When the SA picks a part from the search modal, autofill code + name
  // + unit price. The free-text "Remarks" field is left untouched.
  function applyPart(part: Part) {
    setPartCode(part.part_no)
    setPartName(part.name)
    setUnit(part.unit || 'UNIT')
    setUnitPrice(String(part.unit_price ?? 0))
    setPartsOpen(false)
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setError(null)
    // Description is what the line shows in the table: part code first
    // (so SAs can scan by code), then the part name and any remarks.
    const description =
      [partCode, partName, remarks]
        .filter((s) => s.trim().length > 0)
        .join(' · ')
        .trim()
    if (!description) {
      setError('Enter a Part Code (or pick one from search) before saving.')
      return
    }
    if (qtyN <= 0) {
      setError('Quantity must be greater than 0.')
      return
    }
    try {
      if (selectedId) {
        await updateItem.mutateAsync({
          id: selectedId,
          patch: {
            kind: 'part',
            description,
            quantity: qtyN,
            unit_price: unitPriceN,
            line_total: nett,
          },
        })
      } else {
        await createItem.mutateAsync({
          service_order_id: id,
          kind: 'part',
          description,
          quantity: qtyN,
          unit_price: unitPriceN,
          line_total: nett,
        })
      }
      clearEntry()
    } catch (err) {
      setError(formatError(err))
    }
  }

  async function handleDelete() {
    if (!selectedId) return
    if (!window.confirm('Delete this line item?')) return
    try {
      await deleteItem.mutateAsync({ id: selectedId, orderId: id })
      clearEntry()
    } catch (err) {
      setError(formatError(err))
    }
  }


  if (isLoading) {
    return (
      <AppShell>
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      </AppShell>
    )
  }
  if (!order || orderErr) {
    return (
      <AppShell>
        <div className="mb-4">
          <Link
            to="/service/ops"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to Job Sheet
          </Link>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {orderErr ? formatError(orderErr) : 'Order not found.'}
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Link
          to="/service/ops"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back to Job Sheet
        </Link>
        <div className="text-xs text-gray-500">
          Today:{' '}
          <span className="text-gray-900">
            {new Date().toLocaleDateString('en-MY')}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-300 bg-white p-4 shadow-sm sm:p-5">
        <h1 className="border-b border-gray-200 pb-2 text-base font-semibold text-gray-900">
          Billing Screen
        </h1>

        {/* ============ TOP HEADER STRIP ============ */}
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <HeaderRow label="Account">
            <input
              type="text"
              readOnly
              value={
                customer?.name
                  ? customer.name.toUpperCase()
                  : 'CASH - WALK IN'
              }
              className={readOnlyClass}
            />
          </HeaderRow>
          <HeaderRow label="Vehicle / Chassis No">
            <input
              type="text"
              readOnly
              value={vehicle?.chassis_no ?? vehicle?.registration_no ?? ''}
              className={`${readOnlyClass} font-mono`}
            />
          </HeaderRow>

          <HeaderRow label="Job No">
            <input
              type="text"
              readOnly
              value={order.order_no ?? '—'}
              className={`${readOnlyClass} font-mono`}
            />
          </HeaderRow>
          <HeaderRow label="Mechanic">
            <input
              type="text"
              readOnly
              value={order.technician?.name ?? '—'}
              className={readOnlyClass}
            />
          </HeaderRow>

          <HeaderRow label="Bill No">
            <input
              type="text"
              readOnly
              placeholder="— not assigned yet —"
              className={`${readOnlyClass} italic`}
            />
          </HeaderRow>
          <HeaderRow label="Mileage">
            <input
              type="text"
              readOnly
              value={order.mileage_in != null ? String(order.mileage_in) : '—'}
              className={`${readOnlyClass} text-right tabular-nums`}
            />
          </HeaderRow>

          <HeaderRow label="Department">
            <input
              type="text"
              readOnly
              value="WORKSHOP"
              className={readOnlyClass}
            />
          </HeaderRow>
          <HeaderRow label="Invoice Date">
            <input
              type="text"
              readOnly
              placeholder="— set when invoice issued —"
              className={`${readOnlyClass} italic`}
            />
          </HeaderRow>

          <div />
          <HeaderRow label="Job Sheet Date">
            <input
              type="text"
              readOnly
              value={
                order.opened_at
                  ? new Date(order.opened_at).toLocaleDateString('en-MY')
                  : '—'
              }
              className={readOnlyClass}
            />
          </HeaderRow>
        </div>

        {/* ============ ENTRY FORM ============ */}
        <form
          onSubmit={handleSave}
          className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-gray-200 pt-3 sm:grid-cols-[1fr_18rem]"
        >
          <div className="space-y-2">
            <Field label="Part Code">
              <div className="flex w-full items-center gap-1.5">
                <input
                  type="text"
                  value={partCode}
                  onChange={(e) => setPartCode(e.target.value.toUpperCase())}
                  className={`${inputClass} font-mono`}
                  placeholder="Type or click 🔍 to search inventory"
                />
                <button
                  type="button"
                  onClick={() => setPartsOpen(true)}
                  title="Search parts inventory"
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-sm hover:bg-gray-50"
                >
                  🔍
                </button>
              </div>
            </Field>
            <Field label="Part Name">
              <input
                type="text"
                value={partName}
                onChange={(e) => setPartName(e.target.value)}
                className={inputClass}
                placeholder="Auto-fills when a part is picked"
              />
            </Field>
            <Field label="Remarks">
              <input
                type="text"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className={inputClass}
              />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Quantity">
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className={`${inputClass} text-right tabular-nums`}
                />
              </Field>
              <Field label="Unit">
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className={inputClass}
                >
                  <option>UNIT</option>
                  <option>L</option>
                  <option>KG</option>
                  <option>SET</option>
                  <option>HR</option>
                </select>
              </Field>
              <Field label="Unit Price">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  className={`${inputClass} text-right tabular-nums`}
                />
              </Field>
            </div>
            <Field label="Discount">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="discMode"
                      checked={discountMode === '%'}
                      onChange={() => setDiscountMode('%')}
                    />
                    %
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      name="discMode"
                      checked={discountMode === '$'}
                      onChange={() => setDiscountMode('$')}
                    />
                    $
                  </label>
                </div>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className={`${inputClass} flex-1 text-right tabular-nums`}
                />
              </div>
            </Field>

            {/* Amount strip — live as the SA types */}
            <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
              <Calc label="Gross Amount" value={gross} />
              <Calc label="Tax Code (Sales %)" placeholder readOnlyText="—" />
              <Calc label="Nett Amount" value={nett} highlight />
              <Calc label="Tax Amount (Sales)" placeholder readOnlyText="—" />
              <Calc label="Bonus Point" placeholder readOnlyText="0.00" />
              <Calc
                label="Tax Code (Purchase %)"
                placeholder
                readOnlyText="—"
              />
              <Calc label="T.C.P" placeholder readOnlyText="0.00" />
              <Calc
                label="Tax Amount (Purchase)"
                placeholder
                readOnlyText="—"
              />
              <Calc label="T.V.C" placeholder readOnlyText="0.00" />
              <Calc label="T.P.A" placeholder readOnlyText="0.00" />
              <Calc label="Bonus %" placeholder readOnlyText="0.00" />
            </div>
          </div>

          {/* ============ RIGHT PANEL: stock + latest selling ============ */}
          <aside className="rounded-lg border border-gray-200 bg-amber-50/50 p-3 text-sm">
            <div className="mb-2 rounded bg-amber-200 px-2 py-1 text-center text-xs font-semibold uppercase tracking-wider text-amber-900">
              Latest Selling Price
            </div>
            <StockRow label="Minimum Order" value="0.000000" />
            <StockRow label="Stock On Hand" value="0.000000" />
            <StockRow label="WIP Stock" value="0.000000" />
            <div className="mt-2 rounded bg-gray-200 px-2 py-1 text-center text-xs font-semibold uppercase tracking-wider text-gray-700">
              Available Stock
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" disabled />
              Trade In
              <span className="ml-1 text-[10px] text-gray-400">
                (coming soon)
              </span>
            </label>
            <p className="mt-2 text-[10px] text-gray-500">
              Stock / pricing isn&rsquo;t wired to parts_inventory yet.
            </p>
          </aside>

          {error && (
            <div
              role="alert"
              className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {/* ============ ACTION BAR ============ */}
          <div className="sm:col-span-2 mt-3 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3">
            <Btn type="button" onClick={clearEntry}>
              New
            </Btn>
            <Btn type="submit" primary disabled={createItem.isPending || updateItem.isPending}>
              {selectedId
                ? updateItem.isPending
                  ? 'Saving…'
                  : 'Save (Modify)'
                : createItem.isPending
                  ? 'Saving…'
                  : 'Save'}
            </Btn>
            <Btn
              type="button"
              onClick={handleDelete}
              disabled={!selectedId || deleteItem.isPending}
              danger
            >
              Delete
            </Btn>
            <Btn type="button" onClick={clearEntry}>
              Clear
            </Btn>
            <Btn type="button" disabled>
              Memo
            </Btn>
            <Btn type="button" disabled>
              Greeting
            </Btn>
            <div className="ml-auto" />
            <Btn type="button" onClick={() => navigate('/service/ops')}>
              Close
            </Btn>
          </div>
        </form>

        {/* ============ BILLING ITEM LISTING ============ */}
        <div className="mt-5">
          <div className="rounded-t-lg border border-gray-200 bg-yellow-100/70 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-yellow-900">
            Billing Item Listing
          </div>
          <div className="overflow-x-auto rounded-b-lg border-x border-b border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50 uppercase tracking-wider text-gray-500">
                <tr>
                  <Th>Category</Th>
                  <Th>Name</Th>
                  <Th alignRight>Quantity</Th>
                  <Th alignRight>Unit Price</Th>
                  <Th alignRight>Discount %</Th>
                  <Th alignRight>Amount</Th>
                  <Th>Tax Code (S)</Th>
                  <Th alignRight>Tax % (S)</Th>
                  <Th alignRight>Tax Amount (S)</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {!items && !itemsErr && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-6 text-center text-gray-500"
                    >
                      Loading…
                    </td>
                  </tr>
                )}
                {items && items.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-6 text-center text-gray-500"
                    >
                      No line items yet. Search for a part, fill the entry
                      form above, and click Save.
                    </td>
                  </tr>
                )}
                {(items ?? []).map((it) => (
                  <tr
                    key={it.id}
                    onClick={() => loadIntoEntry(it)}
                    className={`cursor-pointer ${
                      selectedId === it.id
                        ? 'bg-blue-50'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 uppercase">
                      {it.kind}
                    </td>
                    <td className="px-3 py-1.5">{it.description}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                      {Number(it.quantity).toFixed(2)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                      {formatMYR(Number(it.unit_price))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-400">
                      —
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-semibold">
                      {formatMYR(Number(it.line_total))}
                    </td>
                    <td className="px-3 py-1.5 text-gray-400">—</td>
                    <td className="px-3 py-1.5 text-right text-gray-400">
                      —
                    </td>
                    <td className="px-3 py-1.5 text-right text-gray-400">
                      —
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ============ TOTALS ============ */}
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="space-y-1 text-xs">
            <Total label="Total Gross Amount" value={totals.gross} />
            <Total label="Tax Amount (+)" placeholder readOnlyText="0.00" />
            <Total label="Discount (−)" placeholder readOnlyText="0.00" />
          </div>
          <div className="space-y-1 text-xs">
            <Total label="Total Invoice Amount" value={totals.invoice} highlight />
            <Total label="Trade In Amount (+)" placeholder readOnlyText="0.00" />
            <Total label="Total Sales Amount" value={totals.sales} highlight />
          </div>
        </div>

      </div>

      {partsOpen && (
        <PartsSearchModal
          onPick={applyPart}
          onClose={() => setPartsOpen(false)}
        />
      )}
    </AppShell>
  )
}

// ---------- presentational helpers ----------

function HeaderRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="grid grid-cols-[8.5rem_1fr] items-center gap-2">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="grid grid-cols-[7rem_1fr] items-center gap-2">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  )
}

function Calc({
  label,
  value,
  placeholder,
  readOnlyText,
  highlight,
}: {
  label: string
  value?: number
  placeholder?: boolean
  readOnlyText?: string
  highlight?: boolean
}) {
  const shown =
    value != null
      ? formatMYR(value)
      : placeholder
        ? readOnlyText ?? '—'
        : '—'
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-1">
      <span className={`${labelClass} text-[10px]`}>{label}</span>
      <input
        type="text"
        readOnly
        value={shown}
        className={`w-full rounded border border-gray-300 bg-white px-2 py-0.5 text-right text-xs tabular-nums ${
          highlight ? 'font-semibold text-gray-900' : 'text-gray-700'
        }`}
      />
    </div>
  )
}

function StockRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1 grid grid-cols-[7rem_1fr] items-center gap-2 text-xs">
      <span className="text-gray-700">{label}</span>
      <span className="rounded border border-gray-300 bg-white px-2 py-0.5 text-right tabular-nums text-gray-500">
        {value}
      </span>
    </div>
  )
}

function Total({
  label,
  value,
  placeholder,
  readOnlyText,
  highlight,
}: {
  label: string
  value?: number
  placeholder?: boolean
  readOnlyText?: string
  highlight?: boolean
}) {
  const shown =
    value != null
      ? formatMYR(value)
      : placeholder
        ? readOnlyText ?? '—'
        : '—'
  return (
    <div className="grid grid-cols-[10rem_1fr] items-center gap-2">
      <span className="text-gray-700">{label}</span>
      <span
        className={`rounded border border-gray-300 px-2 py-0.5 text-right tabular-nums ${
          highlight
            ? 'bg-green-50 font-semibold text-green-800'
            : 'bg-white text-gray-700'
        }`}
      >
        {shown}
      </span>
    </div>
  )
}

function Th({
  children,
  alignRight,
}: {
  children: React.ReactNode
  alignRight?: boolean
}) {
  return (
    <th
      className={`px-3 py-2 font-medium ${alignRight ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  )
}

function Btn({
  type = 'button',
  onClick,
  disabled,
  primary,
  danger,
  children,
}: {
  type?: 'button' | 'submit'
  onClick?: () => void
  disabled?: boolean
  primary?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  const tone = primary
    ? 'bg-gray-900 text-white hover:bg-gray-800'
    : danger
      ? 'border border-red-300 bg-white text-red-700 hover:bg-red-50'
      : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
    >
      {children}
    </button>
  )
}

/**
 * Parts inventory picker. Loads the active parts roster, filters
 * client-side as the SA types (part_no, name, brand), and resolves to a
 * Part on row-click. Cheap because parts_inventory is short — if it
 * ever grows past a few thousand we can move the search server-side.
 */
function PartsSearchModal({
  onPick,
  onClose,
}: {
  onPick: (p: Part) => void
  onClose: () => void
}) {
  const { data: parts, error } = useParts()
  const [q, setQ] = useState('')
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const active = (parts ?? []).filter((p) => p.is_active)
    if (!needle) return active
    return active.filter(
      (p) =>
        p.part_no.toLowerCase().includes(needle) ||
        p.name.toLowerCase().includes(needle) ||
        (p.brand ?? '').toLowerCase().includes(needle),
    )
  }, [parts, q])

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Search parts"
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/40 px-4 py-10"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
    >
      <div className="max-h-full w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-300 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-widest text-gray-500">
              Inventory search
            </div>
            <h2 className="mt-0.5 text-base font-semibold text-gray-900">
              Pick a part
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        <div className="border-b border-gray-200 px-4 py-3">
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by part no, name, or brand…"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
          />
        </div>

        {error && (
          <div className="px-4 py-2 text-sm text-red-700">
            {formatError(error)}
          </div>
        )}

        <div className="max-h-[60vh] overflow-y-auto">
          {!parts && !error && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              Loading parts…
            </div>
          )}
          {parts && filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              {parts.length === 0
                ? 'No parts in inventory yet. Add part numbers first.'
                : `No parts match "${q}".`}
            </div>
          )}
          <table className="min-w-full divide-y divide-gray-100 text-xs">
            <thead className="sticky top-0 bg-gray-50 uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Part No</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Brand</th>
                <th className="px-3 py-2 text-right font-medium">Stock</th>
                <th className="px-3 py-2 text-right font-medium">
                  Unit price
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => onPick(p)}
                  className="cursor-pointer hover:bg-blue-50"
                >
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-900">
                    {p.part_no}
                  </td>
                  <td className="px-3 py-2 text-gray-900">{p.name}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {p.brand ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                    {Number(p.stock_qty).toLocaleString()} {p.unit}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">
                    {formatMYR(Number(p.unit_price ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
