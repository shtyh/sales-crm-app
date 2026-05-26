import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useCreateServiceOrderItem,
  useCustomers,
  useDeleteServiceOrderItem,
  useServiceOrder,
  useServiceOrderItems,
  useUpdateServiceOrderItem,
  useVehicles,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import type { ServiceItemKind, ServiceOrderItem } from '../lib/types'

/**
 * Billing Screen — laid out 1:1 with the legacy WMS dialog. Adds line
 * items to a service order; the items table maps to service_order_items,
 * the totals roll up the line_totals.
 *
 * Columns we have today persist (kind / description / quantity /
 * unit_price / line_total). Categories, Bill No, Invoice Date, tax
 * codes, bonus points, trade-in, and the stock side panel are visible
 * to match the legacy screen but aren't backed by columns yet — tell
 * us which to wire first.
 */

// Legacy WMS quick-pick category buttons across the top. Each maps to
// the F-key hint shown along the bottom strip.
const CATEGORIES = [
  { code: 'Plt', label: 'Plate' },
  { code: 'Oil', label: 'Oil' },
  { code: 'Tyr', label: 'Tyre' },
  { code: 'Rim', label: 'Rim' },
  { code: 'Srv', label: 'Service' },
  { code: 'Nsk', label: 'Next Service' },
  { code: 'Wtk', label: 'Wheel Tracking' },
  { code: 'Pck', label: 'Pack' },
  { code: 'Grp', label: 'Grouping' },
  { code: 'Dcl', label: 'Decal' },
] as const

type CategoryCode = (typeof CATEGORIES)[number]['code']

// Each category bucket maps to one of our two kinds (part vs labour).
// Oil/Tyr/Rim/Pck/Plt/Dcl tend to be parts; Srv/Nsk/Wtk/Grp tend to be
// labour. Best-effort — the SA can flip kind manually if needed.
const CATEGORY_KIND: Record<CategoryCode, ServiceItemKind> = {
  Plt: 'part',
  Oil: 'part',
  Tyr: 'part',
  Rim: 'part',
  Srv: 'labour',
  Nsk: 'labour',
  Wtk: 'labour',
  Pck: 'part',
  Grp: 'labour',
  Dcl: 'part',
}

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

  const [category, setCategory] = useState<CategoryCode | ''>('')
  const [serviceCode, setServiceCode] = useState('')
  const [extraDesc, setExtraDesc] = useState('')
  const [remarks, setRemarks] = useState('')
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
    setCategory('')
    setServiceCode('')
    setExtraDesc('')
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
    setCategory('')
    setServiceCode('')
    // We pack the visible description from extra_desc + remarks back into
    // a single string since the DB only stores one description column.
    setExtraDesc(it.description)
    setRemarks('')
    setQuantity(String(it.quantity))
    setUnit('UNIT')
    setUnitPrice(String(it.unit_price))
    setDiscountMode('%')
    setDiscount('0')
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const description =
      [serviceCode, extraDesc, remarks].filter(Boolean).join(' · ').trim() ||
      (category ? CATEGORIES.find((c) => c.code === category)!.label : '')
    if (!description) {
      setError('Add a Service Code, Extra Desc, or Remarks line first.')
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
            kind: category ? CATEGORY_KIND[category] : 'labour',
            description,
            quantity: qtyN,
            unit_price: unitPriceN,
            line_total: nett,
          },
        })
      } else {
        await createItem.mutateAsync({
          service_order_id: id,
          kind: category ? CATEGORY_KIND[category] : 'labour',
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

  // Apply category quick-pick — also seeds the description prefix so
  // the SA doesn't have to retype "OIL" etc.
  function pickCategory(code: CategoryCode) {
    setCategory(code)
    if (!serviceCode) {
      setServiceCode(CATEGORIES.find((c) => c.code === code)!.label)
    }
  }

  // F2–F7 = category shortcuts on the legacy keyboard layout.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return
      if (e.target instanceof HTMLTextAreaElement) return
      const map: Record<string, CategoryCode> = {
        F2: 'Plt',
        F3: 'Oil',
        F4: 'Tyr',
        F5: 'Rim',
        F6: 'Srv',
        F7: 'Pck',
      }
      const code = map[e.key]
      if (code) {
        e.preventDefault()
        pickCategory(code)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceCode])

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

        {/* ============ CATEGORY QUICK-PICK STRIP ============ */}
        <div className="mt-4 border-t border-gray-200 pt-3">
          <div className={`${labelClass} mb-1`}>Service Category</div>
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button
                type="button"
                key={c.code}
                onClick={() => pickCategory(c.code)}
                title={c.label}
                className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                  category === c.code
                    ? 'bg-blue-600 text-white'
                    : 'border border-gray-300 bg-white text-gray-700 hover:bg-blue-50'
                }`}
              >
                {c.code}
              </button>
            ))}
          </div>
        </div>

        {/* ============ ENTRY FORM ============ */}
        <form
          onSubmit={handleSave}
          className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[1fr_18rem]"
        >
          <div className="space-y-2">
            <Field label="Service Code">
              <input
                type="text"
                value={serviceCode}
                onChange={(e) => setServiceCode(e.target.value)}
                className={inputClass}
                placeholder="e.g. OIL-5W30-1L"
              />
            </Field>
            <Field label="Extra Desc / Code">
              <input
                type="text"
                value={extraDesc}
                onChange={(e) => setExtraDesc(e.target.value)}
                className={inputClass}
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
                      No line items yet. Pick a category, fill the entry
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

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3 text-[10px] text-gray-500">
          <span className="font-mono">F2:PRT</span>
          <span className="font-mono">F3:OIL</span>
          <span className="font-mono">F4:TYR</span>
          <span className="font-mono">F5:RIM</span>
          <span className="font-mono">F6:SRV</span>
          <span className="font-mono">F7:PCK</span>
          <span className="ml-auto">
            Function keys pick a category (when not focused in a field).
          </span>
        </div>
      </div>
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
