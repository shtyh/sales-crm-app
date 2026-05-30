import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  useApproveAllInOne,
  useConfirmLou,
  useDocumentVerifications,
  useRejectAllInOne,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import type { DocumentVerificationRow } from '../lib/types'

// Finance-Admin document-verification queue, rendered on /finance. Two kinds of
// item need a human decision:
//   • All-In-One rows still 'pending' → Approve / Reject.
//   • LOU rows still 'needs_review' → finance types the agreed loan amount and
//     confirms (match-within-RM1 is flagged for the record).
// Down-payment receipts are auto-summed by the DB trigger, so they never queue.

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'

function BookingCell({ row }: { row: DocumentVerificationRow }) {
  return (
    <div className="min-w-0">
      <Link
        to={`/bookings/${row.booking_id}`}
        className="font-medium text-gray-900 underline-offset-2 hover:underline"
      >
        {row.booking_code ?? row.booking_id.slice(0, 8)}
      </Link>
      <div className="truncate text-xs text-gray-500">
        {row.booking_customer_name ?? '—'}
        {row.booking_model ? ` · ${row.booking_model}` : ''}
      </div>
    </div>
  )
}

function AllInOneRow({ row }: { row: DocumentVerificationRow }) {
  const approve = useApproveAllInOne()
  const reject = useRejectAllInOne()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState(row.rejection_reason ?? '')
  const [err, setErr] = useState<string | null>(null)
  const busy = approve.isPending || reject.isPending

  return (
    <tr className="hover:bg-gray-50/60">
      <td className="px-3 py-2 align-top"><BookingCell row={row} /></td>
      <td className="px-3 py-2 align-top text-gray-700">All-In-One</td>
      <td className="px-3 py-2 align-top text-xs text-gray-600">
        <div>Comm: {row.extracted_commission != null ? formatMYR(row.extracted_commission) : '—'}</div>
        <div>Total OTR: {row.extracted_total_otr != null ? formatMYR(row.extracted_total_otr) : '—'}</div>
        <div className={row.extracted_sm_signature_detected === false ? 'text-rose-600' : 'text-gray-500'}>
          SM signature: {row.extracted_sm_signature_detected === false ? 'not detected' : row.extracted_sm_signature_detected ? 'detected' : '—'}
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        {err && <p className="mb-1 text-xs text-rose-600">{err}</p>}
        {!rejecting ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setErr(null)
                approve.mutate(row.id, { onError: (e) => setErr(formatError(e)) })
              }}
              className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {approve.isPending ? '…' : 'Approve'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejecting(true)}
              className="rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <input
              className={inputClass}
              placeholder="Reason for rejection (required)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={busy || reason.trim() === ''}
                onClick={() => {
                  setErr(null)
                  reject.mutate(
                    { id: row.id, reason },
                    {
                      onError: (e) => setErr(formatError(e)),
                      onSuccess: () => setRejecting(false),
                    },
                  )
                }}
                className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {reject.isPending ? '…' : 'Confirm reject'}
              </button>
              <button
                type="button"
                onClick={() => setRejecting(false)}
                className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </td>
    </tr>
  )
}

function LouRow({ row }: { row: DocumentVerificationRow }) {
  const { user } = useAuth()
  const confirm = useConfirmLou()
  const [amount, setAmount] = useState(
    row.extracted_loan_amount_lou != null ? String(row.extracted_loan_amount_lou) : '',
  )
  const [err, setErr] = useState<string | null>(null)
  const num = Number(amount)
  const valid = amount.trim() !== '' && Number.isFinite(num) && num > 0

  return (
    <tr className="hover:bg-gray-50/60">
      <td className="px-3 py-2 align-top"><BookingCell row={row} /></td>
      <td className="px-3 py-2 align-top text-gray-700">LOU</td>
      <td className="px-3 py-2 align-top text-xs text-gray-600">
        <div>Hirer: {row.extracted_hirer_name ?? '—'}</div>
        <div>Loan (form): {row.extracted_loan_amount_lou != null ? formatMYR(row.extracted_loan_amount_lou) : '—'}</div>
        <div>Handling fee: {row.extracted_handling_fee != null ? formatMYR(row.extracted_handling_fee) : '—'}</div>
      </td>
      <td className="px-3 py-2 align-top">
        {err && <p className="mb-1 text-xs text-rose-600">{err}</p>}
        <div className="flex items-center gap-1.5">
          <input
            inputMode="decimal"
            className={inputClass + ' w-32'}
            placeholder="Loan amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            type="button"
            disabled={!valid || confirm.isPending || !user}
            onClick={() => {
              if (!user) return
              setErr(null)
              confirm.mutate(
                {
                  id: row.id,
                  userId: user.id,
                  loanAmount: num,
                  extractedLoanAmount: row.extracted_loan_amount_lou,
                },
                { onError: (e) => setErr(formatError(e)) },
              )
            }}
            className="rounded-lg bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {confirm.isPending ? '…' : 'Confirm'}
          </button>
        </div>
        {row.extracted_loan_amount_lou != null && valid && Math.abs(num - row.extracted_loan_amount_lou) > 1 && (
          <p className="mt-1 text-xs text-amber-600">
            Differs from the form amount by {formatMYR(Math.abs(num - row.extracted_loan_amount_lou))}.
          </p>
        )}
      </td>
    </tr>
  )
}

export function FinanceDocVerifyQueue() {
  const { data: rows, error } = useDocumentVerifications()

  const queue = useMemo(() => {
    const all = rows ?? []
    const aio = all.filter(
      (r) => r.document_type === 'all_in_one' && r.verification_status === 'pending',
    )
    const lou = all.filter(
      (r) => r.document_type === 'lou' && r.verification_status === 'needs_review',
    )
    return { aio, lou, total: aio.length + lou.length }
  }, [rows])

  return (
    <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          📋 Document verification queue — {queue.total}
        </h2>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {formatError(error)}
        </p>
      )}

      {queue.total === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
          Nothing waiting. All-In-One forms and LOUs awaiting review show up here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Booking</th>
                <th className="px-3 py-2 text-left font-medium">Document</th>
                <th className="px-3 py-2 text-left font-medium">Extracted</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {queue.aio.map((r) => <AllInOneRow key={r.id} row={r} />)}
              {queue.lou.map((r) => <LouRow key={r.id} row={r} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
