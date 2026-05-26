import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useMyAttendance } from '../lib/queries'
import { formatError } from '../lib/errors'
import { LATE_AFTER_HOUR } from '../lib/geo'
import type { Attendance } from '../lib/types'

/**
 * Employee's own attendance — calendar view of the month plus a
 * day-by-day list below with check-in/out times and distances. Late
 * arrivals (check-in hour ≥ LATE_AFTER_HOUR in Asia/KL) are flagged.
 */
export function MyAttendancePage() {
  const { profile } = useAuth()
  const { data: rows, error } = useMyAttendance(profile?.id)
  const [cursor, setCursor] = useState(() => firstOfMonth(new Date()))

  const monthRows = useMemo(() => {
    if (!rows) return []
    const { from, to } = monthRange(cursor)
    return rows.filter((r) => r.work_date >= from && r.work_date <= to)
  }, [rows, cursor])

  // Index by YYYY-MM-DD for fast day-cell lookup.
  const byDay = useMemo(() => {
    const m = new Map<string, Attendance>()
    for (const r of monthRows) m.set(r.work_date, r)
    return m
  }, [monthRows])

  const totals = useMemo(() => {
    let present = 0
    let onTime = 0
    let late = 0
    for (const r of monthRows) {
      present += 1
      if (isLate(r)) late += 1
      else onTime += 1
    }
    return { present, onTime, late }
  }, [monthRows])

  return (
    <AppShell>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            My attendance
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {profile?.full_name || profile?.email}
          </p>
        </div>
        <Link
          to="/clock-in"
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800"
        >
          Clock in / out
        </Link>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {formatError(error)}
        </div>
      )}

      {/* ---------- Month picker ---------- */}
      <div className="mb-3 flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-3 py-2">
        <button
          type="button"
          onClick={() => setCursor((c) => addMonths(c, -1))}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
        >
          ← Prev
        </button>
        <div className="text-sm font-semibold text-gray-900">
          {cursor.toLocaleDateString('en-MY', {
            month: 'long',
            year: 'numeric',
            timeZone: 'Asia/Kuala_Lumpur',
          })}
        </div>
        <button
          type="button"
          onClick={() => setCursor((c) => addMonths(c, 1))}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
        >
          Next →
        </button>
      </div>

      {/* ---------- Summary ---------- */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Card label="Present days" value={totals.present} />
        <Card label="On time" value={totals.onTime} tone="green" />
        <Card label="Late" value={totals.late} tone="amber" />
      </div>

      {/* ---------- Calendar grid ---------- */}
      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-3">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {buildCalendar(cursor).map((cell, i) => {
            if (!cell) return <div key={i} />
            const iso = cell.iso
            const row = byDay.get(iso)
            const cellLate = row && isLate(row)
            return (
              <div
                key={i}
                title={
                  row
                    ? `In ${fmtTime(row.check_in_at)}${row.check_out_at ? ` · Out ${fmtTime(row.check_out_at)}` : ''}`
                    : 'No record'
                }
                className={`flex h-12 flex-col items-center justify-center rounded text-xs ${
                  row
                    ? cellLate
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-green-100 text-green-900'
                    : 'bg-gray-50 text-gray-400'
                }`}
              >
                <span className="font-semibold">{cell.day}</span>
                {row && (
                  <span className="text-[10px] tabular-nums">
                    {fmtTime(row.check_in_at)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ---------- Detail list ---------- */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Date</th>
              <th className="px-3 py-2 text-left font-medium">Check in</th>
              <th className="px-3 py-2 text-left font-medium">Check out</th>
              <th className="px-3 py-2 text-right font-medium">
                Distance (m)
              </th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {monthRows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-gray-500"
                >
                  No records this month.
                </td>
              </tr>
            )}
            {monthRows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                  {r.work_date}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {fmtTime(r.check_in_at)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {r.check_out_at ? (
                    fmtTime(r.check_out_at)
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                  {Math.round(Number(r.check_in_distance_m))}
                </td>
                <td className="px-3 py-2">
                  {isLate(r) ? (
                    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Late
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      On time
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  )
}

// ---------- helpers ----------

function isLate(r: Attendance): boolean {
  const hour = Number(
    new Date(r.check_in_at)
      .toLocaleTimeString('en-MY', {
        hour: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kuala_Lumpur',
      })
      .slice(0, 2),
  )
  return hour >= LATE_AFTER_HOUR
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kuala_Lumpur',
  })
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

/** Returns `{ from, to }` as YYYY-MM-DD bounds (inclusive) for the
 *  month containing `cursor`. Local-time based (matches work_date). */
function monthRange(cursor: Date): { from: string; to: string } {
  const y = cursor.getFullYear()
  const m = cursor.getMonth()
  const last = new Date(y, m + 1, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    from: `${y}-${pad(m + 1)}-01`,
    to: `${y}-${pad(m + 1)}-${pad(last)}`,
  }
}

/** Layout cells for a Mon-Sun calendar, with leading blanks for the
 *  weekday offset of day 1. */
function buildCalendar(cursor: Date): Array<{ day: number; iso: string } | null> {
  const y = cursor.getFullYear()
  const m = cursor.getMonth()
  const first = new Date(y, m, 1)
  const last = new Date(y, m + 1, 0).getDate()
  // JS getDay: 0=Sun..6=Sat. We want Mon=0..Sun=6.
  const startOffset = (first.getDay() + 6) % 7
  const cells: Array<{ day: number; iso: string } | null> = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  const pad = (n: number) => String(n).padStart(2, '0')
  for (let d = 1; d <= last; d++) {
    cells.push({ day: d, iso: `${y}-${pad(m + 1)}-${pad(d)}` })
  }
  return cells
}

function Card({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'green' | 'amber'
}) {
  const cls =
    tone === 'green'
      ? 'text-green-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : 'text-gray-900'
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3">
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${cls}`}>
        {value}
      </div>
    </div>
  )
}
