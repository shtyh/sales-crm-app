import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useCreateCar } from '../lib/queries'
import { formatError } from '../lib/errors'
import { PROTON_MODELS, variantsFor } from '../data/proton-models'
import { CAR_STATUS_LABEL, type CarStatus } from '../lib/types'

const today = () => new Date().toISOString().slice(0, 10)
const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'

const STATUS_OPTIONS: CarStatus[] = [
  'in_stock',
  'reserved',
  'delivered',
  'returned',
]

// Banks SWL Motors has floor-stock facilities with. Add a new entry here
// when finance signs a new facility — keep the list tight to avoid free
// text typos that break the dashboard groupings.
const FLOOR_STOCK_BANKS = ['Public Bank'] as const
type Funding = 'cash' | 'floor_stock'

export function NewCarPage() {
  const navigate = useNavigate()
  const { canEditCarAttributes, loading } = useAuth()
  const createMut = useCreateCar()

  const [chassisNo, setChassisNo] = useState('')
  const [model, setModel] = useState<string>(PROTON_MODELS[0])
  const [variant, setVariant] = useState('')
  const [color, setColor] = useState('')
  const [arrivedAt, setArrivedAt] = useState(today())
  const [status, setStatus] = useState<CarStatus>('in_stock')
  const [funding, setFunding] = useState<Funding>('floor_stock')
  const [bank, setBank] = useState<string>(FLOOR_STOCK_BANKS[0])
  const [error, setError] = useState<string | null>(null)

  if (loading) {
    return (
      <AppShell>
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      </AppShell>
    )
  }
  if (!canEditCarAttributes) {
    return <Navigate to="/cars" replace />
  }

  function onModelChange(next: string) {
    setModel(next)
    if (!variantsFor(next).includes(variant)) setVariant('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      // Funding choice maps directly to two floor-stock columns:
      //   * cash        → bank = 'Cash', mark paid_off so the showroom can
      //                    deliver immediately (no settlement step).
      //   * floor_stock → record the bank, leave status at the default
      //                    'locked' until finance settles.
      const isCash = funding === 'cash'
      const created = await createMut.mutateAsync({
        chassis_no: chassisNo.trim(),
        model,
        variant: variant || null,
        color: color.trim() || null,
        arrived_at: arrivedAt,
        status,
        floor_stock_bank: isCash ? 'Cash' : bank,
        floor_stock_status: isCash ? 'paid_off' : 'locked',
      })
      navigate(`/cars/${created.id}`, { replace: true })
    } catch (e) {
      setError(formatError(e))
    }
  }

  const variants = variantsFor(model)

  return (
    <AppShell>
      <div className="mb-6">
        <Link to="/cars" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to inventory
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">New car</h1>
        <p className="mt-1 text-sm text-gray-500">
          Pick the funding source up front. Financed amount and due date are
          filled in later from the bank&rsquo;s letter.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-gray-700">
              Chassis / VIN<span className="ml-0.5 text-red-500">*</span>
            </span>
            <input
              type="text"
              required
              value={chassisNo}
              onChange={(e) => setChassisNo(e.target.value)}
              className={inputClass}
              placeholder="e.g. PMRBM12345N123456"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">
              Model<span className="ml-0.5 text-red-500">*</span>
            </span>
            <select
              required
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className={inputClass}
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
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
              className={inputClass}
            >
              <option value="">— Select variant —</option>
              {variants.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Color</span>
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className={inputClass}
              placeholder="Snow White"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">
              Arrived<span className="ml-0.5 text-red-500">*</span>
            </span>
            <input
              type="date"
              required
              value={arrivedAt}
              onChange={(e) => setArrivedAt(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">
              Status
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as CarStatus)}
              className={inputClass}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {CAR_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="block text-sm sm:col-span-2">
            <legend className="mb-1 block font-medium text-gray-700">
              Funding source<span className="ml-0.5 text-red-500">*</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 ${
                  funding === 'cash'
                    ? 'border-gray-900 bg-gray-900/5'
                    : 'border-gray-300 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="funding"
                  value="cash"
                  checked={funding === 'cash'}
                  onChange={() => setFunding('cash')}
                />
                <span>Cash</span>
                <span className="text-xs text-gray-500">
                  no bank · marked paid_off
                </span>
              </label>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 ${
                  funding === 'floor_stock'
                    ? 'border-gray-900 bg-gray-900/5'
                    : 'border-gray-300 bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="funding"
                  value="floor_stock"
                  checked={funding === 'floor_stock'}
                  onChange={() => setFunding('floor_stock')}
                />
                <span>Floor stock</span>
                <span className="text-xs text-gray-500">
                  bank-financed · default locked
                </span>
              </label>
            </div>
          </fieldset>

          {funding === 'floor_stock' && (
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-gray-700">
                Floor-stock bank<span className="ml-0.5 text-red-500">*</span>
              </span>
              <select
                value={bank}
                onChange={(e) => setBank(e.target.value)}
                required
                className={inputClass}
              >
                {FLOOR_STOCK_BANKS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-gray-500">
                Only Public Bank is set up today. Ask finance to add new
                facilities before they show up here.
              </span>
            </label>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <Link
            to="/cars"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={createMut.isPending}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-60"
          >
            {createMut.isPending ? 'Saving…' : 'Create car'}
          </button>
        </div>
      </form>
    </AppShell>
  )
}
