import { useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { TableActivityLog } from '../components/AuditLogPanel'
import { useAuth } from '../lib/auth'
import {
  useCommissionSchedules,
  useCreateSchedule,
  useDeleteSchedule,
  useUpdateSchedule,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import { PROTON_MODELS, variantsFor } from '../data/proton-models'
import type { AuditLogEntry, CommissionSchedule } from '../lib/types'

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'

export function CommissionSchedulesPage() {
  const { isSuperAdmin, loading } = useAuth()
  const { data: schedules, error: listErr } = useCommissionSchedules(isSuperAdmin)
  const createMut = useCreateSchedule()
  const updateMut = useUpdateSchedule()
  const deleteMut = useDeleteSchedule()
  const [error, setError] = useState<string | null>(null)

  // Form state for the "add new" row at the top of the table.
  const [newModel, setNewModel] = useState<string>(PROTON_MODELS[0])
  const [newVariant, setNewVariant] = useState<string>('')
  const [newAmount, setNewAmount] = useState<string>('')
  const [newHq, setNewHq] = useState<string>('0')
  const [newDealer, setNewDealer] = useState<string>('0')
  const [newNotes, setNewNotes] = useState<string>('')

  // Per-row inline edits.
  const [edits, setEdits] = useState<
    Record<
      string,
      {
        base_commission: string
        hq_discount: string
        dealer_support: string
        notes: string
      }
    >
  >({})

  // model · variant label per row id, so the change log can name which row
  // each entry touched. Must run before the early returns (rules of hooks).
  const scheduleLabelById = useMemo(() => {
    const m = new Map<string, string>()
    schedules?.forEach((s) =>
      m.set(s.id, `${s.model}${s.variant ? ` · ${s.variant}` : ''}`),
    )
    return m
  }, [schedules])

  if (loading) {
    return (
      <AppShell>
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      </AppShell>
    )
  }
  if (!isSuperAdmin) return <Navigate to="/" replace />

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const amt = Number(newAmount)
    const hq = Number(newHq)
    const dealer = Number(newDealer)
    if (!Number.isFinite(amt) || amt < 0) {
      setError('Base commission must be a non-negative number.')
      return
    }
    if (!Number.isFinite(hq) || hq < 0) {
      setError('HQ discount must be a non-negative number.')
      return
    }
    if (!Number.isFinite(dealer) || dealer < 0) {
      setError('Dealer support must be a non-negative number.')
      return
    }
    try {
      await createMut.mutateAsync({
        model: newModel,
        variant: newVariant.trim() || null,
        base_commission: amt,
        hq_discount: hq,
        dealer_support: dealer,
        notes: newNotes.trim() || null,
      })
      setNewVariant('')
      setNewAmount('')
      setNewHq('0')
      setNewDealer('0')
      setNewNotes('')
    } catch (e) {
      setError(formatError(e))
    }
  }

  async function handleSaveRow(s: CommissionSchedule) {
    const edit = edits[s.id]
    if (!edit) return
    const amt = Number(edit.base_commission)
    const hq = Number(edit.hq_discount)
    const dealer = Number(edit.dealer_support)
    if (!Number.isFinite(amt) || amt < 0) {
      setError(`Base commission for ${s.model} must be a non-negative number.`)
      return
    }
    if (!Number.isFinite(hq) || hq < 0) {
      setError(`HQ discount for ${s.model} must be a non-negative number.`)
      return
    }
    if (!Number.isFinite(dealer) || dealer < 0) {
      setError(`Dealer support for ${s.model} must be a non-negative number.`)
      return
    }
    setError(null)
    try {
      await updateMut.mutateAsync({
        id: s.id,
        patch: {
          base_commission: amt,
          hq_discount: hq,
          dealer_support: dealer,
          notes: edit.notes || null,
        },
      })
      setEdits((m) => {
        const { [s.id]: _, ...rest } = m
        return rest
      })
    } catch (e) {
      setError(formatError(e))
    }
  }

  async function handleDelete(s: CommissionSchedule) {
    if (
      !window.confirm(
        `Delete commission row for ${s.model}${s.variant ? ` · ${s.variant}` : ''}?\n\n` +
          'New bookings for this model/variant will get base_commission = NULL ' +
          '(no commission auto-calculated) until a row is added again. ' +
          'Existing bookings keep the value they were snapshotted with.',
      )
    ) {
      return
    }
    setError(null)
    try {
      await deleteMut.mutateAsync(s.id)
    } catch (e) {
      setError(formatError(e))
    }
  }

  const showError = error ?? (listErr ? formatError(listErr) : null)
  const variantsForNew = variantsFor(newModel)

  // Resolve a model · variant label for a change-log entry. Live rows come
  // from the map above; deleted rows fall back to the entry's own snapshot
  // (INSERT/DELETE store the full row; an UPDATE that didn't touch
  // model/variant won't have them, so it lands on '—').
  const labelForEntry = (e: AuditLogEntry): string => {
    const known = scheduleLabelById.get(e.row_id)
    if (known) return known
    const model = (e.changed?.model ?? e.old_values?.model) as
      | string
      | undefined
    const variant = (e.changed?.variant ?? e.old_values?.variant) as
      | string
      | undefined
    return model ? `${model}${variant ? ` · ${variant}` : ''}` : '—'
  }

  return (
    <AppShell>
      <div className="mb-6">
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">
          Commission schedule
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Base commission per car (model + variant). New bookings snapshot
          this value at creation; future changes do <em>not</em> retroactively
          update existing bookings. Discount given by the SA is subtracted
          1-for-1 from the snapshot to produce the final commission.
        </p>
      </div>

      {showError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {showError}
        </div>
      )}

      {/* ---------- Add new ---------- */}
      <form
        onSubmit={handleCreate}
        className="mb-6 rounded-2xl border border-gray-200 bg-white p-5"
      >
        <h2 className="mb-3 text-sm font-semibold text-gray-900">+ Add row</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-7">
          <label className="block text-sm sm:col-span-1">
            <span className="mb-1 block font-medium text-gray-700">Model</span>
            <select
              value={newModel}
              onChange={(e) => {
                setNewModel(e.target.value)
                setNewVariant('')
              }}
              className={inputClass}
            >
              {PROTON_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm sm:col-span-1">
            <span className="mb-1 block font-medium text-gray-700">
              Variant
            </span>
            <select
              value={newVariant}
              onChange={(e) => setNewVariant(e.target.value)}
              className={inputClass}
            >
              <option value="">— Any (catch-all) —</option>
              {variantsForNew.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm sm:col-span-1">
            <span className="mb-1 block font-medium text-gray-700">
              Base commission (MYR)
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              required
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              className={inputClass}
              inputMode="decimal"
              placeholder="2100"
            />
          </label>
          <label className="block text-sm sm:col-span-1">
            <span className="mb-1 block font-medium text-gray-700">
              HQ discount (MYR)
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={newHq}
              onChange={(e) => setNewHq(e.target.value)}
              className={inputClass}
              inputMode="decimal"
              placeholder="5000"
            />
          </label>
          <label className="block text-sm sm:col-span-1">
            <span className="mb-1 block font-medium text-gray-700">
              Dealer support (MYR)
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={newDealer}
              onChange={(e) => setNewDealer(e.target.value)}
              className={inputClass}
              inputMode="decimal"
              placeholder="2000"
            />
          </label>
          <label className="block text-sm sm:col-span-1">
            <span className="mb-1 block font-medium text-gray-700">Notes</span>
            <input
              type="text"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              className={inputClass}
              placeholder="optional"
            />
          </label>
          <div className="flex items-end sm:col-span-1">
            <button
              type="submit"
              disabled={createMut.isPending}
              className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-60"
            >
              {createMut.isPending ? 'Adding…' : 'Add row'}
            </button>
          </div>
        </div>
      </form>

      {/* ---------- Existing rows ---------- */}
      <div className="rounded-2xl border border-gray-200 bg-white">
        {!schedules ? (
          <div className="p-6 text-center text-sm text-gray-500">Loading…</div>
        ) : schedules.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">
            No commission rows yet. Add the first one above.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Model</th>
                <th className="px-4 py-3 text-left font-medium">Variant</th>
                <th className="px-4 py-3 text-right font-medium">
                  Base commission
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  HQ discount
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  Dealer support
                </th>
                <th className="px-4 py-3 text-left font-medium">Notes</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {schedules.map((s) => {
                const editing = edits[s.id]
                const startEdit = () =>
                  setEdits((m) => ({
                    ...m,
                    [s.id]: {
                      base_commission: String(s.base_commission),
                      hq_discount: String(s.hq_discount ?? 0),
                      dealer_support: String(s.dealer_support ?? 0),
                      notes: s.notes ?? '',
                    },
                  }))
                const cancelEdit = () =>
                  setEdits((m) => {
                    const { [s.id]: _, ...rest } = m
                    return rest
                  })
                const busy =
                  (updateMut.isPending &&
                    updateMut.variables?.id === s.id) ||
                  (deleteMut.isPending && deleteMut.variables === s.id)
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {s.model}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {s.variant || (
                        <span className="italic text-gray-400">
                          (any variant)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {editing ? (
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={editing.base_commission}
                          onChange={(e) =>
                            setEdits((m) => ({
                              ...m,
                              [s.id]: {
                                ...editing,
                                base_commission: e.target.value,
                              },
                            }))
                          }
                          className="w-32 rounded border border-gray-300 px-2 py-1 text-right text-sm"
                          inputMode="decimal"
                        />
                      ) : (
                        formatMYR(Number(s.base_commission))
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {editing ? (
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={editing.hq_discount}
                          onChange={(e) =>
                            setEdits((m) => ({
                              ...m,
                              [s.id]: {
                                ...editing,
                                hq_discount: e.target.value,
                              },
                            }))
                          }
                          className="w-32 rounded border border-gray-300 px-2 py-1 text-right text-sm"
                          inputMode="decimal"
                        />
                      ) : (
                        formatMYR(Number(s.hq_discount ?? 0))
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {editing ? (
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={editing.dealer_support}
                          onChange={(e) =>
                            setEdits((m) => ({
                              ...m,
                              [s.id]: {
                                ...editing,
                                dealer_support: e.target.value,
                              },
                            }))
                          }
                          className="w-32 rounded border border-gray-300 px-2 py-1 text-right text-sm"
                          inputMode="decimal"
                        />
                      ) : (
                        formatMYR(Number(s.dealer_support ?? 0))
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {editing ? (
                        <input
                          type="text"
                          value={editing.notes}
                          onChange={(e) =>
                            setEdits((m) => ({
                              ...m,
                              [s.id]: { ...editing, notes: e.target.value },
                            }))
                          }
                          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      ) : (
                        s.notes || (
                          <span className="italic text-gray-400">—</span>
                        )
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleSaveRow(s)}
                              disabled={busy}
                              className="rounded-lg bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={busy}
                              className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={startEdit}
                              disabled={busy}
                              className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(s)}
                              disabled={busy}
                              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1 text-xs text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Who changed what, when — INSERT / UPDATE / DELETE on this table.
          Super-admin only (audit_log RLS); the panel self-hides otherwise. */}
      <TableActivityLog
        tableName="commission_schedules"
        title="🕓 Change log"
        labelOf={labelForEntry}
      />
    </AppShell>
  )
}
