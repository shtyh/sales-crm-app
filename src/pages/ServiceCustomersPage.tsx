import { useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useCreateServiceCustomer,
  useServiceCustomers,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import type { ServiceCustomerWithCounts } from '../lib/types'

// ─── Service customers ─────────────────────────────────────────────────────
//
// Workshop-side customer master. Auto-populated by the
// auto_import_to_service_on_delivery trigger when a sales booking ships,
// plus manual inserts via the "+ New service customer" form. The Sales
// customer master at /customers stays separate.

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'
const labelClass = 'text-[10px] font-medium uppercase tracking-wide text-gray-500'

export function ServiceCustomersPage() {
  const { canAccessService, role } = useAuth()
  if (canAccessService === false) return <Navigate to="/" replace />

  const canAdd = role !== 'sales_advisor'
  const { data: customers, error } = useServiceCustomers()
  const [q, setQ] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return customers ?? []
    return (customers ?? []).filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        (c.nric ?? '').toLowerCase().includes(needle) ||
        c.phone.toLowerCase().includes(needle) ||
        (c.email ?? '').toLowerCase().includes(needle),
    )
  }, [customers, q])

  return (
    <AppShell>
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Service Customers
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {customers ? (
                <>
                  <span className="font-medium text-gray-700">
                    {filtered.length}
                  </span>{' '}
                  of {customers.length} workshop customers
                </>
              ) : (
                'Loading…'
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {canAdd && (
              <button
                type="button"
                onClick={() => setAddOpen((v) => !v)}
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800"
              >
                {addOpen ? 'Cancel' : '+ New service customer'}
              </button>
            )}
            <Link
              to="/service/inquiry"
              className="text-xs text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
            >
              ← Back to Inquiry
            </Link>
          </div>
        </header>

        {addOpen && (
          <AddServiceCustomerForm
            onCreated={() => setAddOpen(false)}
            onCancel={() => setAddOpen(false)}
          />
        )}

        <input
          type="search"
          placeholder="Search name / NRIC / phone / email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
        />

        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {formatError(error)}
          </p>
        )}

        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-[11px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-2.5 text-left font-medium">Name</th>
                <th className="px-3 py-2.5 text-left font-medium">NRIC</th>
                <th className="px-3 py-2.5 text-left font-medium">Phone</th>
                <th className="px-3 py-2.5 text-right font-medium" title="Workshop vehicles">
                  Vehicles
                </th>
                <th
                  className="px-3 py-2.5 text-right font-medium"
                  title="Service orders raised"
                >
                  Jobs
                </th>
                <th className="px-3 py-2.5 text-left font-medium">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!customers && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-500">
                    Loading…
                  </td>
                </tr>
              )}
              {customers && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-500">
                    No service customers match.
                  </td>
                </tr>
              )}
              {filtered.flatMap((c) => {
                const isOpen = openId === c.id
                const row = (
                  <tr
                    key={c.id}
                    onClick={() => setOpenId(isOpen ? null : c.id)}
                    className={
                      'cursor-pointer transition hover:bg-gray-50/60 ' +
                      (isOpen ? 'bg-gray-50/80' : '')
                    }
                  >
                    <td className="px-3 py-2 text-gray-900">{c.name}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-700">
                      {c.nric ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{c.phone}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                      {c.vehicle_count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                      {c.job_count}
                    </td>
                    <td className="px-3 py-2">
                      {c.sales_customer_id ? (
                        <span className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          From sales
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                          Workshop
                        </span>
                      )}
                    </td>
                  </tr>
                )
                if (!isOpen) return [row]
                return [row, <Detail key={c.id + '-d'} customer={c} />]
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  )
}

function Detail({ customer: c }: { customer: ServiceCustomerWithCounts }) {
  const addr = [c.address, c.city, c.state, c.post_code].filter(Boolean).join(', ')
  return (
    <tr className="bg-gray-50/60">
      <td colSpan={6} className="px-3 py-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KV label="Email">{c.email ?? '—'}</KV>
          <KV label="Phone 2">{c.phone2 ?? '—'}</KV>
          <KV label="Address">{addr || '—'}</KV>
          <KV label="Birthday">{c.birthday ?? '—'}</KV>
          <KV label="Customer type">{c.customer_type}</KV>
          <KV label="Status">{c.status}</KV>
        </div>
      </td>
    </tr>
  )
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm text-gray-900">{children}</div>
    </div>
  )
}

// ─── New service customer form ─────────────────────────────────────────────

function AddServiceCustomerForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void
  onCancel: () => void
}) {
  const create = useCreateServiceCustomer()
  const [name, setName] = useState('')
  const [nric, setNric] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [postcode, setPostcode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setMsg(null)
    if (!name.trim()) return setErr('Name is required.')
    if (!phone.trim()) return setErr('Phone is required.')
    try {
      const created = await create.mutateAsync({
        name,
        nric: nric || null,
        phone,
        email: email || null,
        address: address || null,
        post_code: postcode || null,
      })
      setMsg(`Saved ${created.name}.`)
      setName('')
      setNric('')
      setPhone('')
      setEmail('')
      setAddress('')
      setPostcode('')
      setTimeout(onCreated, 600)
    } catch (e2) {
      const raw =
        e2 && typeof e2 === 'object'
          ? ((e2 as { code?: string; message?: string }).code ?? '') +
            ' ' +
            ((e2 as { message?: string }).message ?? '')
          : ''
      if (raw.includes('service_customers_nric_key') || raw.includes('23505')) {
        setErr(`NRIC "${nric}" already belongs to another service customer.`)
      } else {
        setErr(formatError(e2))
      }
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      <div>
        <h2 className="text-sm font-semibold text-gray-900">
          New service customer
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Name + Phone are required. NRIC is recommended for matching across
          sales / service.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div className="sm:col-span-3">
          <label className={labelClass}>Name *</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>
        <div className="sm:col-span-3">
          <label className={labelClass}>NRIC</label>
          <input
            value={nric}
            onChange={(e) => setNric(e.target.value)}
            className={inputClass + ' mt-1 font-mono'}
          />
        </div>
        <div className="sm:col-span-3">
          <label className={labelClass}>Phone *</label>
          <input
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>
        <div className="sm:col-span-3">
          <label className={labelClass}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>
        <div className="sm:col-span-4">
          <label className={labelClass}>Address</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Postcode</label>
          <input
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>
      </div>

      {err && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {err}
        </p>
      )}
      {msg && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {msg}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={create.isPending}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-50"
        >
          {create.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
