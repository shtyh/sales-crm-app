import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useCreateServiceOrderItem,
  useDeleteServiceOrderItem,
  useServiceOrder,
  useServiceOrderItems,
  useUpdateServiceOrder,
  useUpdateServiceOrderItem,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import { useFormDraft } from '../lib/formDraft'
import { useOnlineStatus } from '../lib/online'
import {
  QUOTE_STATUS_LABEL,
  SERVICE_ORDER_STATUS_LABEL,
  type QuoteStatus,
  type ServiceItemKind,
  type ServiceOrderItem,
  type ServiceOrderStatus,
} from '../lib/types'

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10 user-invalid:border-red-500 user-invalid:focus:border-red-500 user-invalid:focus:ring-red-500/20'

// Malaysian SST proxy. Most workshops still quote 6% on labour/parts;
// expose it as a single client-side constant so it's easy to override or
// move into a settings table later.
const TAX_RATE = 0.06

const STATUS_OPTIONS: ServiceOrderStatus[] = [
  'open',
  'in_progress',
  'awaiting_parts',
  'completed',
  'collected',
  'cancelled',
]

function formatMyr(n: number) {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    maximumFractionDigits: 2,
  }).format(n)
}

export function ServiceOrderDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { role, isAdmin } = useAuth()

  // Workshop only — SAs (sales side) bounced.
  if (role && !isAdmin) return <Navigate to="/" replace />

  const { data: order, error: orderErr, isLoading } = useServiceOrder(id)
  const { data: items, error: itemsErr } = useServiceOrderItems(id)

  const updateOrder = useUpdateServiceOrder()
  const createItem = useCreateServiceOrderItem()
  const updateItem = useUpdateServiceOrderItem()
  const deleteItem = useDeleteServiceOrderItem()

  // Header form state (mirrors order rows once loaded).
  const [status, setStatus] = useState<ServiceOrderStatus>('open')
  const [complaint, setComplaint] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [notes, setNotes] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const online = useOnlineStatus()

  useEffect(() => {
    if (!order) return
    setStatus(order.status)
    setComplaint(order.complaint ?? '')
    setDiagnosis(order.diagnosis ?? '')
    setNotes(order.notes ?? '')
  }, [order])

  // Totals derived live from the items list — single source of truth so the
  // header form never drifts from the lines below.
  const totals = useMemo(() => {
    const subtotal = (items ?? []).reduce(
      (sum, i) => sum + Number(i.line_total),
      0,
    )
    const tax = +(subtotal * TAX_RATE).toFixed(2)
    const total = +(subtotal + tax).toFixed(2)
    return { subtotal, tax, total }
  }, [items])

  // Persist totals on the order whenever the items list changes. Avoids
  // staleness in the dashboard cards which read these columns.
  useEffect(() => {
    if (!order) return
    const dirty =
      Number(order.subtotal) !== totals.subtotal ||
      Number(order.tax_amount) !== totals.tax ||
      Number(order.total_amount) !== totals.total
    if (!dirty) return
    updateOrder.mutate({
      id,
      patch: {
        subtotal: totals.subtotal,
        tax_amount: totals.tax,
        total_amount: totals.total,
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.subtotal, totals.tax, totals.total, order?.id])

  async function handleSaveHeader(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      // The DB-level guard auto-stamps completed_at / collected_at when
      // status flips to those values via the trigger, but for now we set
      // them client-side too so the dashboard cards refresh promptly.
      const patch: Partial<{
        status: ServiceOrderStatus
        complaint: string | null
        diagnosis: string | null
        notes: string | null
      }> = {
        status,
        complaint: complaint || null,
        diagnosis: diagnosis || null,
        notes: notes || null,
      }
      await updateOrder.mutateAsync({ id, patch })
      setSavedAt(Date.now())
    } catch (e) {
      setError(formatError(e))
    }
  }

  async function flipQuoteStatus(next: QuoteStatus) {
    setError(null)
    try {
      await updateOrder.mutateAsync({
        id,
        patch: { quote_status: next },
      })
    } catch (e) {
      setError(formatError(e))
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
  if (orderErr || !order) {
    return (
      <AppShell>
        <div className="mb-4">
          <Link to="/" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back
          </Link>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {orderErr ? formatError(orderErr) : 'Job order not found.'}
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back
          </Link>
          <h1 className="mt-2 font-mono text-xl font-semibold text-gray-900">
            {order.order_no ?? '— draft —'}
          </h1>
          <p className="text-sm text-gray-500">
            {order.vehicle?.registration_no ?? '—'} · {order.vehicle?.model}
            {order.vehicle?.variant ? ` ${order.vehicle.variant}` : ''}
          </p>
          {order.customer && (
            <p className="mt-1 text-sm text-gray-600">
              👤 {order.customer.name}
              {order.customer.phone ? ` · ${order.customer.phone}` : ''}
            </p>
          )}
        </div>
        <QuoteActions
          status={order.quote_status}
          onSend={() => flipQuoteStatus('sent')}
          onApprove={() => flipQuoteStatus('approved')}
          onReject={() => flipQuoteStatus('rejected')}
        />
      </div>

      <form
        onSubmit={handleSaveHeader}
        className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6"
      >
        {/* ---------- Status + diagnosis ---------- */}
        <Section title="🛠 Status & diagnosis">
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ServiceOrderStatus)}
              className={inputClass}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {SERVICE_ORDER_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mileage in">
            <input
              type="text"
              readOnly
              value={
                order.mileage_in != null
                  ? `${order.mileage_in.toLocaleString()} km`
                  : '—'
              }
              className={`${inputClass} bg-gray-50`}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Customer's complaint">
              <textarea
                rows={2}
                value={complaint}
                onChange={(e) => setComplaint(e.target.value)}
                className={`${inputClass} min-h-16`}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Mechanic's diagnosis">
              <textarea
                rows={2}
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                className={`${inputClass} min-h-16`}
                placeholder="What was found / what was done…"
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Internal notes">
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={`${inputClass} min-h-16`}
              />
            </Field>
          </div>
        </Section>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}
        {savedAt && !error && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            ✓ Saved.
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
          <button
            type="submit"
            disabled={updateOrder.isPending}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-60"
          >
            {updateOrder.isPending ? 'Saving…' : 'Save header'}
          </button>
        </div>
      </form>

      {/* ---------- Line items ---------- */}
      {!online && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          🛜 Offline — header edits and new line items are saved locally and
          will retry once the connection's back.
        </div>
      )}

      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            💼 Parts & labour
          </h2>
          <span className="text-xs text-gray-500">
            {items?.length ?? 0} line{items?.length === 1 ? '' : 's'}
          </span>
        </div>

        {itemsErr && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {formatError(itemsErr)}
          </div>
        )}

        {!items && !itemsErr && (
          <p className="text-sm text-gray-500">Loading…</p>
        )}

        {items && items.length > 0 && (
          <ItemsTable
            items={items}
            onUpdate={(id, patch) => updateItem.mutateAsync({ id, patch })}
            onDelete={(item) =>
              deleteItem.mutateAsync({ id: item.id, orderId: item.service_order_id })
            }
          />
        )}

        <AddLineItem
          orderId={order.id}
          onAdd={(kind, description, quantity, unit_price) =>
            createItem.mutateAsync({
              service_order_id: order.id,
              kind,
              description,
              quantity,
              unit_price,
              line_total: +(quantity * unit_price).toFixed(2),
              part_id: null,
            })
          }
        />

        {/* Totals — derived from items, syncs back to the order row via the
            effect above so the dashboard cards stay accurate. */}
        <div className="mt-4 grid grid-cols-3 gap-3 border-t border-gray-100 pt-4 text-sm">
          <Total label="Subtotal" value={totals.subtotal} />
          <Total
            label={`Tax (${(TAX_RATE * 100).toFixed(0)}%)`}
            value={totals.tax}
          />
          <Total label="Total" value={totals.total} bold />
        </div>
      </section>
    </AppShell>
  )
}

// ---------- Sub-components ------------------------------------------------

function QuoteActions({
  status,
  onSend,
  onApprove,
  onReject,
}: {
  status: QuoteStatus
  onSend: () => void
  onApprove: () => void
  onReject: () => void
}) {
  const pill = {
    none: 'bg-gray-100 text-gray-700',
    sent: 'bg-orange-100 text-orange-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-rose-100 text-rose-700',
  }[status]
  return (
    <div className="flex flex-col items-end gap-2">
      <span
        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${pill}`}
      >
        Quote · {QUOTE_STATUS_LABEL[status]}
      </span>
      <div className="flex gap-2">
        {status === 'none' && (
          <button
            type="button"
            onClick={onSend}
            className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-sm font-medium text-orange-800 hover:bg-orange-100"
          >
            Send quote
          </button>
        )}
        {status === 'sent' && (
          <>
            <button
              type="button"
              onClick={onApprove}
              className="rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-100"
            >
              Mark approved
            </button>
            <button
              type="button"
              onClick={onReject}
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-800 hover:bg-rose-100"
            >
              Mark rejected
            </button>
          </>
        )}
        {(status === 'approved' || status === 'rejected') && (
          <button
            type="button"
            onClick={onSend}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            title="Re-send a revised quote"
          >
            Re-send quote
          </button>
        )}
      </div>
    </div>
  )
}

function ItemsTable({
  items,
  onUpdate,
  onDelete,
}: {
  items: ServiceOrderItem[]
  onUpdate: (
    id: string,
    patch: Partial<{
      description: string
      quantity: number
      unit_price: number
      line_total: number
    }>,
  ) => Promise<unknown>
  onDelete: (item: ServiceOrderItem) => Promise<unknown>
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-100">
      <table className="min-w-full divide-y divide-gray-100 text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Kind</th>
            <th className="px-3 py-2 text-left font-medium">Description</th>
            <th className="px-3 py-2 text-right font-medium">Qty</th>
            <th className="px-3 py-2 text-right font-medium">Unit price</th>
            <th className="px-3 py-2 text-right font-medium">Line total</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((it) => (
            <ItemRow
              key={it.id}
              item={it}
              onUpdate={onUpdate}
              onDelete={() => onDelete(it)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ItemRow({
  item,
  onUpdate,
  onDelete,
}: {
  item: ServiceOrderItem
  onUpdate: (
    id: string,
    patch: Partial<{
      description: string
      quantity: number
      unit_price: number
      line_total: number
    }>,
  ) => Promise<unknown>
  onDelete: () => Promise<unknown>
}) {
  const [description, setDescription] = useState(item.description)
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [unitPrice, setUnitPrice] = useState(String(item.unit_price))

  useEffect(() => {
    setDescription(item.description)
    setQuantity(String(item.quantity))
    setUnitPrice(String(item.unit_price))
  }, [item.id, item.description, item.quantity, item.unit_price])

  function commit() {
    const q = Number(quantity) || 0
    const p = Number(unitPrice) || 0
    const lt = +(q * p).toFixed(2)
    const dirty =
      description !== item.description ||
      q !== Number(item.quantity) ||
      p !== Number(item.unit_price)
    if (!dirty) return
    onUpdate(item.id, {
      description,
      quantity: q,
      unit_price: p,
      line_total: lt,
    })
  }

  return (
    <tr>
      <td className="px-3 py-2">
        <span
          className={
            item.kind === 'part'
              ? 'inline-flex rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800'
              : 'inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800'
          }
        >
          {item.kind === 'part' ? 'Part' : 'Labour'}
        </span>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commit}
          className="w-full rounded border border-transparent px-2 py-1 text-sm hover:border-gray-200 focus:border-gray-900 focus:outline-none"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          step="0.01"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          onBlur={commit}
          className="w-20 rounded border border-transparent px-2 py-1 text-right text-sm tabular-nums hover:border-gray-200 focus:border-gray-900 focus:outline-none"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min={0}
          step="0.01"
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          onBlur={commit}
          className="w-28 rounded border border-transparent px-2 py-1 text-right text-sm tabular-nums hover:border-gray-200 focus:border-gray-900 focus:outline-none"
        />
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-gray-900">
        {formatMyr(Number(item.line_total))}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-rose-700 hover:underline"
          title="Remove line"
        >
          Remove
        </button>
      </td>
    </tr>
  )
}

function AddLineItem({
  orderId,
  onAdd,
}: {
  orderId: string
  onAdd: (
    kind: ServiceItemKind,
    description: string,
    quantity: number,
    unit_price: number,
  ) => Promise<unknown>
}) {
  const [kind, setKind] = useState<ServiceItemKind>('part')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitPrice, setUnitPrice] = useState('')
  const [busy, setBusy] = useState(false)

  // Per-order draft so the half-typed line survives a tab crash. Cleared
  // immediately on a successful add (the form reset already wipes the
  // in-memory state — we mirror that to localStorage here).
  const draftKey = `so-line-draft:${orderId}`
  const clearDraft = useFormDraft(
    draftKey,
    { kind, description, quantity, unitPrice },
    (d) => {
      setKind(d.kind ?? 'part')
      setDescription(d.description ?? '')
      setQuantity(d.quantity ?? '1')
      setUnitPrice(d.unitPrice ?? '')
    },
  )

  async function handleAdd() {
    if (!description.trim()) return
    const q = Number(quantity) || 0
    const p = Number(unitPrice) || 0
    if (q <= 0) return
    setBusy(true)
    try {
      await onAdd(kind, description, q, p)
      setDescription('')
      setQuantity('1')
      setUnitPrice('')
      clearDraft()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-sm">
      <label className="flex flex-col text-xs">
        <span className="mb-1 font-medium text-gray-600">Kind</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ServiceItemKind)}
          className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="part">Part</option>
          <option value="labour">Labour</option>
        </select>
      </label>
      <label className="flex flex-1 min-w-[12rem] flex-col text-xs">
        <span className="mb-1 font-medium text-gray-600">Description</span>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
          placeholder={
            kind === 'part'
              ? 'e.g. Brake pad set — front'
              : 'e.g. Oil change service'
          }
        />
      </label>
      <label className="flex w-20 flex-col text-xs">
        <span className="mb-1 font-medium text-gray-600">Qty</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums"
        />
      </label>
      <label className="flex w-28 flex-col text-xs">
        <span className="mb-1 font-medium text-gray-600">Unit price</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={unitPrice}
          onChange={(e) => setUnitPrice(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums"
        />
      </label>
      <button
        type="button"
        onClick={handleAdd}
        disabled={busy || !description.trim()}
        className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60"
      >
        {busy ? 'Adding…' : 'Add line'}
      </button>
    </div>
  )
}

function Total({
  label,
  value,
  bold,
}: {
  label: string
  value: number
  bold?: boolean
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div
        className={`mt-1 tabular-nums ${bold ? 'text-base font-semibold text-gray-900' : 'text-gray-700'}`}
      >
        {formatMyr(value)}
      </div>
    </div>
  )
}

// ----- small layout helpers -----------------------------------------------

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">{title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
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
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      {children}
    </label>
  )
}
