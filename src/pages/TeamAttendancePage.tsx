import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useAllAttendance, useProfiles } from '../lib/queries'
import { formatError } from '../lib/errors'
import { LATE_AFTER_HOUR, malaysiaToday } from '../lib/geo'
import type { Attendance, Profile } from '../lib/types'

type TabKey = 'today' | 'month'

/**
 * Manager view of attendance. Two tabs:
 *   Today — every employee with status (Not yet / Checked in / Late /
 *           Done), useful first thing in the morning.
 *   Month — table of employees × days, dots for present, amber for late,
 *           plus a per-employee late-count summary.
 *
 * Visible to is_admin (anyone non-sales-advisor) — same gate as the
 * RLS that lets them see everyone's rows.
 */
export function TeamAttendancePage() {
  const { isAdmin, loading, role } = useAuth()
  const { data: profiles } = useProfiles()
  const { data: rows, error } = useAllAttendance(isAdmin)
  const [tab, setTab] = useState<TabKey>('today')
  const [cursor, setCursor] = useState(() => firstOfMonth(new Date()))

  // CSV export is gated to roles that actually need it for payroll.
  const canExport = role === 'super_admin' || role === 'service_manager'

  if (loading) {
    return (
      <AppShell>
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      </AppShell>
    )
  }
  if (!isAdmin) return <Navigate to="/" replace />

  const today = malaysiaToday()
  const todayByProfile = useMemoIndex(rows, today)

  const monthRows = useMemo(() => {
    if (!rows) return []
    const { from, to } = monthRange(cursor)
    return rows.filter((r) => r.work_date >= from && r.work_date <= to)
  }, [rows, cursor])

  const profileById = useMemo(() => {
    const m = new Map<string, Profile>()
    for (const p of profiles ?? []) m.set(p.id, p)
    return m
  }, [profiles])

  function handleExport() {
    // Export the current tab's scope: Today tab → just today's rows;
    // Month tab → every row in the selected month.
    const scope =
      tab === 'today'
        ? (rows ?? []).filter((r) => r.work_date === today)
        : monthRows
    const csv = toAttendanceCsv(scope, profileById)
    const fileScope =
      tab === 'today'
        ? today
        : `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}`
    downloadCsv(`attendance-${fileScope}.csv`, csv)
  }

  return (
    <AppShell>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Team attendance
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Who&rsquo;s in today and how the month is going.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <TabBtn active={tab === 'today'} onClick={() => setTab('today')}>
            Today
          </TabBtn>
          <TabBtn active={tab === 'month'} onClick={() => setTab('month')}>
            Month
          </TabBtn>
          {canExport && (
            <button
              type="button"
              onClick={handleExport}
              disabled={!rows}
              title="Download the current tab as a CSV (opens in Excel)"
              className="ml-2 rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              ⬇ Export CSV
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {formatError(error)}
        </div>
      )}

      {tab === 'today' && (
        <TodaySection profiles={profiles ?? []} byProfile={todayByProfile} />
      )}

      {tab === 'month' && (
        <MonthSection
          profiles={profiles ?? []}
          rows={monthRows}
          cursor={cursor}
          onPrev={() => setCursor((c) => addMonths(c, -1))}
          onNext={() => setCursor((c) => addMonths(c, 1))}
        />
      )}
    </AppShell>
  )
}

// ---------- today tab ----------

function TodaySection({
  profiles,
  byProfile,
}: {
  profiles: Profile[]
  byProfile: Map<string, Attendance>
}) {
  // Ignore the deprecated 'accountant' role (UI filtered everywhere).
  // Sales advisors don't clock in (their dropdown hides the entry), so
  // they don't belong in the team list either. Accountant is deprecated.
  const employees = profiles.filter(
    (p) => p.role !== 'accountant' && p.role !== 'sales_advisor',
  )

  const lateCount = employees.filter((p) => {
    const r = byProfile.get(p.id)
    return r && isLate(r)
  }).length
  const inCount = employees.filter((p) => {
    const r = byProfile.get(p.id)
    return r && !r.check_out_at
  }).length
  const doneCount = employees.filter(
    (p) => byProfile.get(p.id)?.check_out_at,
  ).length
  const notYetCount = employees.filter((p) => !byProfile.get(p.id)).length

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="Checked in" value={inCount} tone="blue" />
        <Card label="Done" value={doneCount} tone="green" />
        <Card label="Late" value={lateCount} tone="amber" />
        <Card label="Not yet" value={notYetCount} tone="rose" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Employee</th>
              <th className="px-3 py-2 text-left font-medium">Role</th>
              <th className="px-3 py-2 text-left font-medium">Check in</th>
              <th className="px-3 py-2 text-left font-medium">Lunch out</th>
              <th className="px-3 py-2 text-left font-medium">Lunch in</th>
              <th className="px-3 py-2 text-left font-medium">Check out</th>
              <th className="px-3 py-2 text-right font-medium">
                Distance (m)
              </th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {employees.map((p) => {
              const r = byProfile.get(p.id)
              const status: StatusKind = !r
                ? 'not_yet'
                : r.check_out_at
                  ? 'done'
                  : r.lunch_out_at && !r.lunch_in_at
                    ? 'lunch'
                    : isLate(r)
                      ? 'late'
                      : 'in'
              return (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {p.full_name || p.email}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {roleLabel(p.role)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {r ? fmtTime(r.check_in_at) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {r?.lunch_out_at ? fmtTime(r.lunch_out_at) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {r?.lunch_in_at ? fmtTime(r.lunch_in_at) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                    {r?.check_out_at ? fmtTime(r.check_out_at) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                    {r ? Math.round(Number(r.check_in_distance_m)) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill kind={status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ---------- month tab ----------

function MonthSection({
  profiles,
  rows,
  cursor,
  onPrev,
  onNext,
}: {
  profiles: Profile[]
  rows: Attendance[]
  cursor: Date
  onPrev: () => void
  onNext: () => void
}) {
  // Sales advisors don't clock in (their dropdown hides the entry), so
  // they don't belong in the team list either. Accountant is deprecated.
  const employees = profiles.filter(
    (p) => p.role !== 'accountant' && p.role !== 'sales_advisor',
  )
  const days = useMemo(() => buildMonthDays(cursor), [cursor])

  // index: profile_id → work_date → attendance row
  const indexed = useMemo(() => {
    const m = new Map<string, Map<string, Attendance>>()
    for (const r of rows) {
      let inner = m.get(r.profile_id)
      if (!inner) {
        inner = new Map()
        m.set(r.profile_id, inner)
      }
      inner.set(r.work_date, r)
    }
    return m
  }, [rows])

  return (
    <>
      <div className="mb-3 flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-3 py-2">
        <button
          type="button"
          onClick={onPrev}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
        >
          ← Prev
        </button>
        <div className="text-sm font-semibold text-gray-900">
          {cursor.toLocaleDateString('en-MY', {
            month: 'long',
            year: 'numeric',
          })}
        </div>
        <button
          type="button"
          onClick={onNext}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
        >
          Next →
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 uppercase tracking-wider text-gray-500">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-medium">
                Employee
              </th>
              {days.map((d) => (
                <th
                  key={d.iso}
                  className="px-1.5 py-2 text-center font-medium tabular-nums"
                >
                  {d.day}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium">Present</th>
              <th className="px-3 py-2 text-right font-medium">Late</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {employees.map((p) => {
              const inner = indexed.get(p.id)
              let present = 0
              let late = 0
              return (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-900">
                    {p.full_name || p.email}
                    <div className="text-[10px] text-gray-500">
                      {roleLabel(p.role)}
                    </div>
                  </td>
                  {days.map((d) => {
                    const r = inner?.get(d.iso)
                    if (r) {
                      present += 1
                      if (isLate(r)) late += 1
                    }
                    return (
                      <td
                        key={d.iso}
                        title={
                          r
                            ? `In ${fmtTime(r.check_in_at)}${r.check_out_at ? ` · Out ${fmtTime(r.check_out_at)}` : ''}`
                            : '—'
                        }
                        className="px-1.5 py-2 text-center"
                      >
                        {r ? (
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-full ${
                              isLate(r) ? 'bg-amber-500' : 'bg-green-500'
                            }`}
                          />
                        ) : (
                          <span className="text-gray-300">·</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {present}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${
                      late > 0 ? 'font-semibold text-amber-700' : ''
                    }`}
                  >
                    {late}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-gray-500">
        Green dot = on-time check-in · Amber dot = late (after{' '}
        {LATE_AFTER_HOUR}:00) · Dot missing = no record.
      </p>
    </>
  )
}

// ---------- helpers ----------

function useMemoIndex(rows: Attendance[] | undefined, day: string) {
  return useMemo(() => {
    const m = new Map<string, Attendance>()
    for (const r of rows ?? []) {
      if (r.work_date === day) m.set(r.profile_id, r)
    }
    return m
  }, [rows, day])
}

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

function buildMonthDays(cursor: Date): Array<{ day: number; iso: string }> {
  const y = cursor.getFullYear()
  const m = cursor.getMonth()
  const last = new Date(y, m + 1, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  const out: Array<{ day: number; iso: string }> = []
  for (let d = 1; d <= last; d++) {
    out.push({ day: d, iso: `${y}-${pad(m + 1)}-${pad(d)}` })
  }
  return out
}

function roleLabel(role: string | null): string {
  if (!role) return '—'
  if (role === 'sales_advisor' || role === 'service_advisor') return 'SA'
  if (role === 'mechanic') return 'Technician'
  return role.replace(/_/g, ' ')
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? 'bg-gray-900 text-white'
          : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  )
}

function Card({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'blue' | 'green' | 'amber' | 'rose'
}) {
  const cls = {
    blue: 'text-blue-700',
    green: 'text-green-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
  }[tone]
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3">
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${cls}`}>
        {value}
      </div>
    </div>
  )
}

type StatusKind = 'not_yet' | 'in' | 'late' | 'lunch' | 'done'

function StatusPill({ kind }: { kind: StatusKind }) {
  const cls = {
    not_yet: 'bg-gray-100 text-gray-600',
    in: 'bg-blue-100 text-blue-800',
    late: 'bg-amber-100 text-amber-800',
    lunch: 'bg-yellow-100 text-yellow-800',
    done: 'bg-green-100 text-green-800',
  }[kind]
  const label = {
    not_yet: 'Not yet',
    in: 'Checked in',
    late: 'Late',
    lunch: '🍱 On lunch',
    done: 'Done',
  }[kind]
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  )
}

// ---------- CSV export ----------

/** Two-digit padded number — used to build month/day strings. */
function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** RFC 4180-ish CSV escape: wrap in quotes when needed, double internal quotes. */
function csvCell(v: unknown): string {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function csvTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kuala_Lumpur',
  })
}

function workedMinutes(r: Attendance): number | '' {
  if (!r.check_out_at) return ''
  const span =
    new Date(r.check_out_at).getTime() - new Date(r.check_in_at).getTime()
  let lunch = 0
  if (r.lunch_out_at && r.lunch_in_at) {
    lunch =
      new Date(r.lunch_in_at).getTime() - new Date(r.lunch_out_at).getTime()
  }
  return Math.max(0, Math.round((span - lunch) / 60_000))
}

function toAttendanceCsv(
  rows: Attendance[],
  profileById: Map<string, Profile>,
): string {
  const header = [
    'work_date',
    'employee',
    'role',
    'check_in',
    'lunch_out',
    'lunch_in',
    'check_out',
    'check_in_distance_m',
    'late',
    'worked_minutes',
  ]
  const lines = [header.join(',')]
  for (const r of rows) {
    const p = profileById.get(r.profile_id)
    lines.push(
      [
        r.work_date,
        csvCell(p?.full_name || p?.email || r.profile_id),
        csvCell(p?.role ?? ''),
        csvTime(r.check_in_at),
        csvTime(r.lunch_out_at),
        csvTime(r.lunch_in_at),
        csvTime(r.check_out_at),
        Math.round(Number(r.check_in_distance_m)),
        isLate(r) ? 'Y' : 'N',
        workedMinutes(r),
      ].join(','),
    )
  }
  return lines.join('\n')
}

function downloadCsv(filename: string, csv: string): void {
  // BOM so Excel opens UTF-8 correctly on Windows.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
