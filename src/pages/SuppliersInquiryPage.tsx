import { useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useCreateSupplier, useSuppliers } from '../lib/queries'
import { formatError } from '../lib/errors'
import type { Supplier } from '../lib/types'

// ─── Supplier directory ────────────────────────────────────────────────────
//
// Read-only listing of the suppliers table imported from AUTFDV01.csv.
// Picked from the Inquiry Hub. Search filters client-side because we only
// hold ~25 rows; if it grows past a few hundred, swap in server-side.

export function SuppliersInquiryPage() {
  const { canAccessService, role } = useAuth()
  if (canAccessService === false) return <Navigate to="/" replace />

  const canAdd = role !== 'sales_advisor' // matches the suppliers_write RLS policy
  const { data: suppliers, error } = useSuppliers()
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return suppliers ?? []
    return (suppliers ?? []).filter(
      (s) =>
        s.code.toLowerCase().includes(needle) ||
        s.name.toLowerCase().includes(needle) ||
        (s.person ?? '').toLowerCase().includes(needle) ||
        (s.phone ?? '').toLowerCase().includes(needle),
    )
  }, [suppliers, q])

  return (
    <AppShell>
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Vendor / Supplier
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {suppliers ? (
                <>
                  <span className="font-medium text-gray-700">
                    {filtered.length}
                  </span>{' '}
                  of {suppliers.length} suppliers
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
                {addOpen ? 'Cancel' : '+ New supplier'}
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
          <AddSupplierForm
            onCreated={() => setAddOpen(false)}
            onCancel={() => setAddOpen(false)}
          />
        )}

        <input
          type="search"
          placeholder="Search code / name / contact…"
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
                <th className="px-3 py-2.5 text-left font-medium">Code</th>
                <th className="px-3 py-2.5 text-left font-medium">Name</th>
                <th className="px-3 py-2.5 text-left font-medium">Contact</th>
                <th className="px-3 py-2.5 text-left font-medium">Phone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!suppliers && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-xs text-gray-500"
                  >
                    Loading…
                  </td>
                </tr>
              )}
              {suppliers && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-xs text-gray-500"
                  >
                    No suppliers match.
                  </td>
                </tr>
              )}
              {filtered.flatMap((s) => {
                const isOpen = openId === s.id
                const row = (
                  <tr
                    key={s.id}
                    onClick={() => setOpenId(isOpen ? null : s.id)}
                    className={
                      'cursor-pointer transition hover:bg-gray-50/60 ' +
                      (isOpen ? 'bg-gray-50/80' : '')
                    }
                  >
                    <td className="px-3 py-2 font-mono text-[12px] text-gray-700">
                      {s.code}
                    </td>
                    <td className="px-3 py-2 text-gray-900">{s.name}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {s.person ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {s.phone ?? <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                )
                if (!isOpen) return [row]
                return [row, <DetailRow key={s.id + '-detail'} supplier={s} />]
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  )
}

function DetailRow({ supplier: s }: { supplier: Supplier }) {
  const addr = [s.address_line1, s.address_line2, s.address_line3]
    .filter(Boolean)
    .join(', ')
  return (
    <tr className="bg-gray-50/60">
      <td colSpan={4} className="px-3 py-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KV label="Address">
            <span className="text-sm text-gray-800">
              {addr || <span className="text-gray-400">—</span>}
              {s.postcode ? ` ${s.postcode}` : ''}
            </span>
          </KV>
          <KV label="Email">{s.email ?? '—'}</KV>
          <KV label="Phone 2">{s.phone2 ?? '—'}</KV>
          <KV label="Fax">{s.fax ?? '—'}</KV>
          <KV label="SST No">{s.sst_no ?? '—'}</KV>
          <KV label="TIN No">{s.tin_no ?? '—'}</KV>
          <KV label="MSIC Code">{s.msic_code ?? '—'}</KV>
          <KV label="Activity">{s.biz_activity ?? '—'}</KV>
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

// ─── New supplier form ─────────────────────────────────────────────────────

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'

const labelClass = 'text-[10px] font-medium uppercase tracking-wide text-gray-500'

type SupplierDraft = {
  code: string
  name: string
  person: string
  phone: string
  phone2: string
  fax: string
  email: string
  address_line1: string
  address_line2: string
  address_line3: string
  postcode: string
  sst_no: string
  tin_no: string
  biz_activity: string
  msic_code: string
}

const BLANK_DRAFT: SupplierDraft = {
  code: '',
  name: '',
  person: '',
  phone: '',
  phone2: '',
  fax: '',
  email: '',
  address_line1: '',
  address_line2: '',
  address_line3: '',
  postcode: '',
  sst_no: '',
  tin_no: '',
  biz_activity: '',
  msic_code: '',
}

function AddSupplierForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void
  onCancel: () => void
}) {
  const create = useCreateSupplier()
  const [d, setD] = useState<SupplierDraft>(BLANK_DRAFT)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  function set<K extends keyof SupplierDraft>(k: K, v: string) {
    setD((prev) => ({ ...prev, [k]: v }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setMsg(null)
    const code = d.code.trim()
    const name = d.name.trim()
    if (!code) return setErr('Supplier code is required.')
    if (!name) return setErr('Supplier name is required.')
    try {
      const created = await create.mutateAsync(d)
      setMsg(`Saved supplier ${created.code} · ${created.name}.`)
      setD(BLANK_DRAFT)
      setTimeout(onCreated, 600)
    } catch (e2) {
      const raw =
        e2 && typeof e2 === 'object'
          ? ((e2 as { code?: string; message?: string }).code ?? '') +
            ' ' +
            ((e2 as { message?: string }).message ?? '')
          : ''
      if (raw.includes('suppliers_code_key') || raw.includes('23505')) {
        setErr(
          `Supplier code "${code}" already exists. Pick a different code.`,
        )
      } else {
        setErr(formatError(e2))
      }
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      <div>
        <h2 className="text-sm font-semibold text-gray-900">New supplier</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Code + Name are required. Everything else is optional and can be
          edited later.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass}>Code *</label>
          <input
            required
            value={d.code}
            onChange={(e) => set('code', e.target.value)}
            placeholder="e.g. 4000/Z01"
            className={inputClass + ' mt-1 font-mono'}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Name *</label>
          <input
            required
            value={d.name}
            onChange={(e) => set('name', e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>

        <div>
          <label className={labelClass}>Contact person</label>
          <input
            value={d.person}
            onChange={(e) => set('person', e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>
        <div>
          <label className={labelClass}>Phone</label>
          <input
            value={d.phone}
            onChange={(e) => set('phone', e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>
        <div>
          <label className={labelClass}>Phone 2</label>
          <input
            value={d.phone2}
            onChange={(e) => set('phone2', e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>

        <div>
          <label className={labelClass}>Fax</label>
          <input
            value={d.fax}
            onChange={(e) => set('fax', e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Email</label>
          <input
            type="email"
            value={d.email}
            onChange={(e) => set('email', e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>

        <div className="sm:col-span-3">
          <label className={labelClass}>Address line 1</label>
          <input
            value={d.address_line1}
            onChange={(e) => set('address_line1', e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Address line 2</label>
          <input
            value={d.address_line2}
            onChange={(e) => set('address_line2', e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>
        <div>
          <label className={labelClass}>Postcode</label>
          <input
            value={d.postcode}
            onChange={(e) => set('postcode', e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>
        <div className="sm:col-span-3">
          <label className={labelClass}>Address line 3</label>
          <input
            value={d.address_line3}
            onChange={(e) => set('address_line3', e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>

        <div>
          <label className={labelClass}>SST No</label>
          <input
            value={d.sst_no}
            onChange={(e) => set('sst_no', e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>
        <div>
          <label className={labelClass}>TIN No</label>
          <input
            value={d.tin_no}
            onChange={(e) => set('tin_no', e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>
        <div>
          <label className={labelClass}>MSIC Code</label>
          <input
            value={d.msic_code}
            onChange={(e) => set('msic_code', e.target.value)}
            className={inputClass + ' mt-1'}
          />
        </div>
        <div className="sm:col-span-3">
          <label className={labelClass}>Business activity</label>
          <input
            value={d.biz_activity}
            onChange={(e) => set('biz_activity', e.target.value)}
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
          {create.isPending ? 'Saving…' : 'Save supplier'}
        </button>
      </div>
    </form>
  )
}
