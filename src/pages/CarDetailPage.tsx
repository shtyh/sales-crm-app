import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { AuditLogPanel } from '../components/AuditLogPanel'
import { useAuth } from '../lib/auth'
import { useCar, useDeleteCar, useUpdateCar } from '../lib/queries'
import { formatError } from '../lib/errors'
import { PROTON_MODELS, variantsFor } from '../data/proton-models'
import {
  CAR_STATUS_LABEL,
  FLOOR_STOCK_LABEL,
  type CarStatus,
  type FloorStockStatus,
} from '../lib/types'

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'

function readonlyInputClass(editable: boolean) {
  return editable
    ? inputClass
    : 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 outline-none cursor-not-allowed'
}

const STATUS_OPTIONS: CarStatus[] = [
  'in_stock',
  'reserved',
  'delivered',
  'returned',
]
const FS_OPTIONS: FloorStockStatus[] = [
  'locked',
  'pending_settlement',
  'overdue',
  'paid_off',
]
// Inventory (floor-stock) financing is only ever Public Bank or paid cash —
// the 13-bank customer hire-purchase list doesn't apply here, so keep it tight.
const FLOOR_STOCK_BANKS = ['Public Bank', 'Cash'] as const

export function CarDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    role,
    isSuperAdmin,
    canEditCarAttributes,
    canEditCarFloorStock,
    canAccessSales,
  } = useAuth()
  const { data: car, error: carErr, isLoading } = useCar(id)
  const updateMut = useUpdateCar()
  const deleteMut = useDeleteCar()

  // Vehicle attributes (general_admin owned)
  const [chassisNo, setChassisNo] = useState('')
  const [model, setModel] = useState<string>(PROTON_MODELS[0])
  const [variant, setVariant] = useState('')
  const [color, setColor] = useState('')
  const [arrivedAt, setArrivedAt] = useState('')
  const [status, setStatus] = useState<CarStatus>('in_stock')

  // Floor-stock financing (finance_admin owned)
  const [floorStockBank, setFloorStockBank] = useState('')
  const [financedAmount, setFinancedAmount] = useState('')
  const [floorStockStatus, setFloorStockStatus] =
    useState<FloorStockStatus>('locked')
  const [floorStockDue, setFloorStockDue] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    if (!car) return
    setChassisNo(car.chassis_no)
    setModel(car.model)
    setVariant(car.variant ?? '')
    setColor(car.color ?? '')
    setArrivedAt(car.arrived_at)
    setStatus(car.status)
    setFloorStockBank(car.floor_stock_bank ?? '')
    setFinancedAmount(
      car.financed_amount != null ? String(car.financed_amount) : '',
    )
    setFloorStockStatus(car.floor_stock_status)
    setFloorStockDue(car.floor_stock_due ?? '')
  }, [car])

  if (role === 'sales_advisor' || canAccessSales === false) {
    return <Navigate to="/" replace />
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
  if (carErr || !car) {
    return (
      <AppShell>
        <div className="mb-4">
          <Link to="/cars" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to inventory
          </Link>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {carErr ? formatError(carErr) : 'Car not found.'}
        </div>
      </AppShell>
    )
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await updateMut.mutateAsync({
        id,
        patch: {
          // Each bucket is gated by role on the client AND by the DB
          // guard trigger — defence in depth.
          ...(canEditCarAttributes
            ? {
                chassis_no: chassisNo.trim(),
                model,
                variant: variant || null,
                color: color.trim() || null,
                arrived_at: arrivedAt,
                status,
              }
            : {}),
          ...(canEditCarFloorStock
            ? {
                floor_stock_bank: floorStockBank || null,
                financed_amount:
                  financedAmount.trim() === '' ? null : Number(financedAmount),
                floor_stock_status: floorStockStatus,
                floor_stock_due: floorStockDue || null,
              }
            : {}),
        },
      })
      setSavedAt(Date.now())
    } catch (e) {
      setError(formatError(e))
    }
  }

  /**
   * Hard delete — super_admin only. Two confirmations:
   *   1. Plain "are you sure" prompt
   *   2. Type the chassis number to confirm (defeats accidental clicks)
   * Bookings that linked to this car will simply lose `car_id` (FK is
   * on-delete-set-null), so they aren't blocked from existing.
   */
  async function handleDelete() {
    if (!car) return
    if (
      !window.confirm(
        `PERMANENTLY DELETE car ${car.chassis_no}?\n\n` +
          'This wipes the record from the database. There is no undo. ' +
          'Any bookings that pointed at this car will lose their car link.',
      )
    ) {
      return
    }
    const typed = window.prompt(
      `To confirm, type the chassis number exactly: ${car.chassis_no}`,
    )
    if (typed !== car.chassis_no) {
      setError('Chassis number did not match — delete aborted.')
      return
    }
    setError(null)
    try {
      await deleteMut.mutateAsync(id)
      navigate('/cars', { replace: true })
    } catch (e) {
      setError(formatError(e))
    }
  }

  const variants = variantsFor(model)
  const canSave = canEditCarAttributes || canEditCarFloorStock

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/cars"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to inventory
          </Link>
          <h1 className="mt-2 font-mono text-xl font-semibold text-gray-900">
            {car.chassis_no}
          </h1>
          <p className="text-sm text-gray-500">
            {car.model}
            {car.variant ? ` · ${car.variant}` : ''}
            {car.color ? ` · ${car.color}` : ''}
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSave}
        className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6"
      >
        {/* ---------- Vehicle attributes ---------- */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              🚗 Vehicle
            </h2>
            {!canEditCarAttributes && (
              <span className="text-xs text-gray-500">
                🔒 General Admin only
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-gray-700">
                Chassis / VIN
              </span>
              <input
                type="text"
                disabled={!canEditCarAttributes}
                value={chassisNo}
                onChange={(e) => setChassisNo(e.target.value)}
                className={readonlyInputClass(canEditCarAttributes)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">
                Model
              </span>
              <select
                disabled={!canEditCarAttributes}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={readonlyInputClass(canEditCarAttributes)}
              >
                {PROTON_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">
                Variant
              </span>
              <select
                disabled={!canEditCarAttributes}
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                className={readonlyInputClass(canEditCarAttributes)}
              >
                <option value="">— None —</option>
                {variants.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
                {variant && !variants.includes(variant) && (
                  <option value={variant}>{variant}</option>
                )}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">
                Color
              </span>
              <input
                type="text"
                disabled={!canEditCarAttributes}
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className={readonlyInputClass(canEditCarAttributes)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">
                Arrived
              </span>
              <input
                type="date"
                disabled={!canEditCarAttributes}
                value={arrivedAt}
                onChange={(e) => setArrivedAt(e.target.value)}
                className={readonlyInputClass(canEditCarAttributes)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">
                Status
              </span>
              <select
                disabled={!canEditCarAttributes}
                value={status}
                onChange={(e) => setStatus(e.target.value as CarStatus)}
                className={readonlyInputClass(canEditCarAttributes)}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {CAR_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* ---------- Floor stock financing ---------- */}
        <section className="rounded-xl border border-purple-200 bg-purple-50/40 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-purple-900">
              🏦 Floor stock financing
            </h2>
            {!canEditCarFloorStock && (
              <span className="text-xs text-gray-500">
                🔒 Finance Admin only
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">
                Bank
              </span>
              <select
                disabled={!canEditCarFloorStock}
                value={floorStockBank}
                onChange={(e) => {
                  const v = e.target.value
                  setFloorStockBank(v)
                  // Cash purchase = no financing, so it's already settled.
                  if (v === 'Cash') setFloorStockStatus('paid_off')
                }}
                className={readonlyInputClass(canEditCarFloorStock)}
              >
                <option value="">— Select bank —</option>
                {FLOOR_STOCK_BANKS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
                {floorStockBank &&
                  !FLOOR_STOCK_BANKS.includes(
                    floorStockBank as (typeof FLOOR_STOCK_BANKS)[number],
                  ) && <option value={floorStockBank}>{floorStockBank}</option>}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">
                Floor stock amount (MYR)
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                disabled={!canEditCarFloorStock}
                value={financedAmount}
                onChange={(e) => setFinancedAmount(e.target.value)}
                className={readonlyInputClass(canEditCarFloorStock)}
                inputMode="decimal"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">
                Floor stock status
              </span>
              <select
                disabled={!canEditCarFloorStock}
                value={floorStockStatus}
                onChange={(e) =>
                  setFloorStockStatus(e.target.value as FloorStockStatus)
                }
                className={readonlyInputClass(canEditCarFloorStock)}
              >
                {FS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {FLOOR_STOCK_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">
                Settlement due
              </span>
              <input
                type="date"
                disabled={!canEditCarFloorStock}
                value={floorStockDue}
                onChange={(e) => setFloorStockDue(e.target.value)}
                className={readonlyInputClass(canEditCarFloorStock)}
              />
            </label>
          </div>
          {floorStockStatus !== 'paid_off' && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              ⚠ While this car isn't paid off, any booking linked to it cannot
              be moved to <span className="font-semibold">delivered</span>.
            </div>
          )}
        </section>

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
            Saved ✓
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <Link
            to="/cars"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Back
          </Link>
          {isSuperAdmin && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteMut.isPending || updateMut.isPending}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
              title="Hard-delete this car (super_admin only)"
            >
              {deleteMut.isPending ? 'Deleting…' : '★ Delete'}
            </button>
          )}
          {canSave && (
            <button
              type="submit"
              disabled={updateMut.isPending}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-60"
            >
              {updateMut.isPending ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </div>
      </form>

      <AuditLogPanel tableName="cars" rowId={car.id} />
    </AppShell>
  )
}
