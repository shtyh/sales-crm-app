import { useMemo, useState, type ChangeEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useBankStatements,
  useReconciliations,
  useRunReconcile,
  useUploadStatement,
} from '../lib/queries'
import { getStatementSignedUrl } from '../lib/reconciliation'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import type {
  BankStatement,
  BookingReconciliationRow,
  ReconciliationDiff,
  ReconciliationStatus,
} from '../lib/types'

// ─── Helpers ────────────────────────────────────────────────────────────────

const inputClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'

const STATUS_LABEL: Record<ReconciliationStatus, string> = {
  complete: '✓ Complete',
  discrepancy: '✗ Discrepancy',
  missing: '⚠ Missing',
}

const STATUS_STYLE: Record<ReconciliationStatus, string> = {
  complete: 'bg-green-100 text-green-800',
  discrepancy: 'bg-rose-100 text-rose-800',
  missing: 'bg-amber-100 text-amber-800',
}

const DOC_LABEL: Record<string, string> = {
  all_in_one: 'All-In-One',
  lou: 'LOU',
  bank_in: 'Bank-in',
  statement: 'Statement',
}

function formatDiffValue(v: number | string | null): string {
  if (v == null) return '—'
  if (typeof v === 'number') return formatMYR(v)
  return v
}

// ─── Page ──────────────────────────────────────────────────────────────────

export function ReconciliationPage() {
  const { user, role, isFinanceAdmin, isSuperAdmin } = useAuth()

  // FA, super_admin, and sales_manager get the queue. Everyone else bounces.
  const allowed = isSuperAdmin || isFinanceAdmin || role === 'sales_manager'
  if (role && !allowed) {
    return <Navigate to="/" replace />
  }

  const { data: rows, error } = useReconciliations()
  const rematch = useRunReconcile()

  // Bank statement upload (super_admin only). It lives here because the
  // statement's credit lines are what populate this queue. The hooks run
  // for every allowed viewer; the section itself only renders for super_admin.
  const { data: statements } = useBankStatements(isSuperAdmin)
  const uploadStatement = useUploadStatement()
  const [statementMsg, setStatementMsg] = useState<string | null>(null)
  const [statementErr, setStatementErr] = useState<string | null>(null)

  function handleStatementChange(e: ChangeEvent<HTMLInputElement>) {
    setStatementMsg(null)
    setStatementErr(null)
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user) return
    uploadStatement.mutate(
      { userId: user.id, file },
      {
        onSuccess: (res) =>
          setStatementMsg(
            `Uploaded — extracted ${res.lines_inserted} credit line${
              res.lines_inserted === 1 ? '' : 's'
            } from the statement.`,
          ),
        onError: (err) => setStatementErr(formatError(err)),
      },
    )
  }

  // Open the stored PDF in a new tab via a short-lived signed URL.
  async function openStatement(s: BankStatement) {
    try {
      const url = await getStatementSignedUrl(s.file_path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setStatementErr(formatError(err))
    }
  }

  const [filterStatus, setFilterStatus] = useState<'' | ReconciliationStatus>('')
  const [filterText, setFilterText] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!rows) return []
    const needle = filterText.trim().toLowerCase()
    return rows.filter((r) => {
      if (filterStatus && r.status !== filterStatus) return false
      if (!needle) return true
      return (
        r.customer_name.toLowerCase().includes(needle) ||
        r.vehicle_model.toLowerCase().includes(needle) ||
        r.booking_code.toLowerCase().includes(needle)
      )
    })
  }, [rows, filterStatus, filterText])

  // Quick top-line counts.
  const counts = useMemo(() => {
    const c = { complete: 0, discrepancy: 0, missing: 0 }
    rows?.forEach((r) => {
      c[r.status] = (c[r.status] ?? 0) + 1
    })
    return c
  }, [rows])

  function handleRematch(bookingId: string) {
    rematch.mutate(bookingId)
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Reconciliation queue
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Cross-checks the bank statement, LOU, bank-in receipt, and
              All-In-One Preparation form for every booking. Updates
              automatically as new documents land.
            </p>
          </div>
        </header>

        {/* Counts strip */}
        <div className="grid grid-cols-3 gap-3">
          <CountCard label="Complete" value={counts.complete} tone="green" />
          <CountCard
            label="Discrepancy"
            value={counts.discrepancy}
            tone="rose"
          />
          <CountCard label="Missing docs" value={counts.missing} tone="amber" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            placeholder="Search customer, model, booking code…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className={inputClass + ' min-w-[18rem] flex-1'}
          />
          <select
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(e.target.value as '' | ReconciliationStatus)
            }
            className={inputClass}
          >
            <option value="">All statuses</option>
            <option value="complete">Complete</option>
            <option value="discrepancy">Discrepancy</option>
            <option value="missing">Missing</option>
          </select>
        </div>

        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {formatError(error)}
          </p>
        )}

        {/* Queue table */}
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Booking</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Model</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Missing / diffs</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-sm text-gray-500"
                  >
                    No reconciliations yet. Uploads from any of the three flows
                    will populate this list.
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const isOpen = openId === r.id
                return (
                  <Row
                    key={r.id}
                    row={r}
                    open={isOpen}
                    onToggle={() => setOpenId(isOpen ? null : r.id)}
                    onRematch={() => handleRematch(r.booking_id)}
                    rematching={
                      rematch.isPending && rematch.variables === r.booking_id
                    }
                  />
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Bank statement upload — super_admin only, at the bottom. This is
            the input that feeds the queue above; click a file to view it. */}
        {isSuperAdmin && (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">
              Bank statements
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800">
                {uploadStatement.isPending
                  ? 'Uploading…'
                  : 'Upload statement PDF'}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={handleStatementChange}
                  disabled={uploadStatement.isPending}
                  className="hidden"
                />
              </label>
              <span className="text-xs text-gray-500">
                PDF · max 20 MB · AI extracts each credit line for matching
              </span>
            </div>
            {uploadStatement.isPending && (
              <p className="mt-3 text-sm text-gray-600">
                Reading statement — usually 10-30 seconds…
              </p>
            )}
            {statementErr && (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {statementErr}
              </p>
            )}
            {statementMsg && (
              <p className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {statementMsg}
              </p>
            )}
            {statements && statements.length > 0 && (
              <ul className="mt-4 divide-y divide-gray-100 text-sm text-gray-700">
                {statements.slice(0, 8).map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => openStatement(s)}
                      title="Open the uploaded PDF in a new tab"
                      className="truncate text-left font-medium text-gray-900 underline-offset-2 hover:text-gray-600 hover:underline"
                    >
                      📄{' '}
                      {s.original_name ||
                        s.file_path.split('/').pop() ||
                        'statement.pdf'}
                    </button>
                    <span className="shrink-0 text-xs text-gray-500">
                      {new Date(s.uploaded_at).toLocaleDateString('en-MY', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                      {s.period_start && s.period_end
                        ? ` · ${s.period_start} → ${s.period_end}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </AppShell>
  )
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

function CountCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'green' | 'rose' | 'amber'
}) {
  const toneCls =
    tone === 'green'
      ? 'border-green-200 bg-green-50 text-green-900'
      : tone === 'rose'
        ? 'border-rose-200 bg-rose-50 text-rose-900'
        : 'border-amber-200 bg-amber-50 text-amber-900'
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${toneCls}`}>
      <div className="text-xs font-medium opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  )
}

function Row({
  row,
  open,
  onToggle,
  onRematch,
  rematching,
}: {
  row: BookingReconciliationRow
  open: boolean
  onToggle: () => void
  onRematch: () => void
  rematching: boolean
}) {
  const missing = row.details?.missing ?? []
  const diffs = row.details?.diffs ?? []

  return (
    <>
      <tr
        className={
          'cursor-pointer hover:bg-gray-50/60 ' +
          (open ? 'bg-gray-50/60' : '')
        }
        onClick={onToggle}
      >
        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-700">
          <Link
            to={`/bookings/${row.booking_id}`}
            className="hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.booking_code}
          </Link>
        </td>
        <td className="px-3 py-2 text-gray-900">{row.customer_name}</td>
        <td className="px-3 py-2 text-gray-700">{row.vehicle_model}</td>
        <td className="px-3 py-2">
          <span
            className={
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ' +
              STATUS_STYLE[row.status]
            }
          >
            {STATUS_LABEL[row.status]}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-gray-600">
          {row.status === 'complete' && '—'}
          {missing.length > 0 && (
            <>Missing: {missing.map((m) => DOC_LABEL[m] ?? m).join(', ')}</>
          )}
          {missing.length > 0 && diffs.length > 0 && <br />}
          {diffs.length > 0 && (
            <>
              {diffs.length} diff{diffs.length === 1 ? '' : 's'} on{' '}
              {Array.from(new Set(diffs.map((d) => d.field))).join(', ')}
            </>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRematch()
            }}
            disabled={rematching}
            className="text-xs text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline disabled:opacity-50"
          >
            {rematching ? '…' : 'Re-run'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50/40">
          <td colSpan={6} className="px-3 py-3">
            <DetailPanel row={row} diffs={diffs} missing={missing} />
          </td>
        </tr>
      )}
    </>
  )
}

function DetailPanel({
  row,
  diffs,
  missing,
}: {
  row: BookingReconciliationRow
  diffs: ReconciliationDiff[]
  missing: string[]
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KV label="Booking fee" value={formatMYR(row.booking_fee)} />
        <KV
          label="Loan amount"
          value={row.loan_amount != null ? formatMYR(row.loan_amount) : '—'}
        />
        <KV
          label="Commission"
          value={
            row.commission_amount != null
              ? formatMYR(row.commission_amount)
              : '—'
          }
        />
        <KV label="OTR" value={formatMYR(row.otr_price)} />
      </div>

      {missing.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Missing documents
          </div>
          <ul className="mt-1 flex flex-wrap gap-2 text-xs">
            {missing.map((m) => (
              <li
                key={m}
                className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800"
              >
                {DOC_LABEL[m] ?? m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {diffs.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Discrepancies
          </div>
          <table className="mt-1 min-w-full text-xs">
            <thead className="text-gray-500">
              <tr>
                <th className="py-1 pr-3 text-left font-medium">Source</th>
                <th className="py-1 pr-3 text-left font-medium">Field</th>
                <th className="py-1 pr-3 text-right font-medium">
                  Expected
                </th>
                <th className="py-1 pr-3 text-right font-medium">Got</th>
              </tr>
            </thead>
            <tbody className="text-gray-700">
              {diffs.map((d, i) => (
                <tr key={i} className="border-t border-gray-200">
                  <td className="py-1 pr-3">{DOC_LABEL[d.doc] ?? d.doc}</td>
                  <td className="py-1 pr-3">{d.field}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {formatDiffValue(d.expected)}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums text-rose-700">
                    {formatDiffValue(d.got)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Last reconciled{' '}
        {new Date(row.updated_at).toLocaleString('en-MY', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
      </p>
    </div>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-medium text-gray-900">{value}</div>
    </div>
  )
}
