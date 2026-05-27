import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useCheckIn,
  useCheckOut,
  useLunchIn,
  useLunchOut,
  useMyToday,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import {
  LATE_AFTER_HOUR,
  OFFICE,
  getCurrentPosition,
  haversineM,
  isMobileDevice,
  malaysiaToday,
} from '../lib/geo'

type FixState =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'ready'; lat: number; lng: number; distance: number; accuracy: number }
  | { kind: 'denied'; message: string }

/**
 * Clock-in / clock-out page. Single screen, mobile-friendly: big primary
 * button is whichever action makes sense right now (check in if today
 * has no row yet, check out if checked in but not out, nothing once
 * checked out). GPS is requested on mount and refreshed via a Recheck
 * button so the SA can move closer to the office and try again.
 */
export function ClockInPage() {
  const { profile, role } = useAuth()
  const today = malaysiaToday()
  const todayQ = useMyToday(profile?.id, today)
  const checkInMut = useCheckIn()
  const checkOutMut = useCheckOut()
  const lunchOutMut = useLunchOut()
  const lunchInMut = useLunchIn()

  // Snapshot once on mount — if the result changed mid-session (e.g.
  // DevTools toggled mobile emulation) we don't care, and we definitely
  // don't want this re-evaluating after a Hot Reload.
  const [isMobile] = useState(() => isMobileDevice())

  const [fix, setFix] = useState<FixState>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Request GPS as soon as we have a profile to act for. Skip when the
  // caller is on desktop — we won't show the buttons anyway, and asking
  // for location on a non-phone is wasted noise.
  const requestFix = useCallback(async () => {
    if (!isMobile) return
    setFix({ kind: 'requesting' })
    setError(null)
    try {
      const pos = await getCurrentPosition()
      const distance = haversineM(
        pos.coords.latitude,
        pos.coords.longitude,
        OFFICE.lat,
        OFFICE.lng,
      )
      setFix({
        kind: 'ready',
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        distance,
      })
    } catch (e: unknown) {
      const message =
        e instanceof GeolocationPositionError
          ? e.code === e.PERMISSION_DENIED
            ? 'Permission denied. Enable location access in your browser settings and reload.'
            : 'Could not get your location — try again outdoors.'
          : (e as Error).message
      setFix({ kind: 'denied', message })
    }
  }, [isMobile])

  useEffect(() => {
    if (!profile?.id) return
    void requestFix()
  }, [profile?.id, requestFix])

  if (!profile) {
    return (
      <AppShell>
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      </AppShell>
    )
  }

  // Workshop / sales advisors / admins all clock in here. Nobody is gated
  // out — but we still bounce people without a profile (shouldn't happen).
  if (!role) return <Navigate to="/" replace />

  // Phone-only — desktop browsers can't punch in. Combined with the GPS
  // geofence this raises the bar against "clock in from the office PC".
  if (!isMobile) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md">
          <h1 className="text-xl font-semibold text-gray-900">Clock In</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Hi {profile.full_name || profile.email}
          </p>

          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <div className="text-2xl">📱</div>
            <div className="mt-2 text-base font-semibold">
              Open this on your phone.
            </div>
            <p className="mt-1 text-amber-800">
              Clock-in only works from a mobile device — we need a real GPS
              fix from the showroom to record your attendance. Scan the QR
              code or type the URL on your phone&rsquo;s browser:
            </p>
            <div className="mt-3 rounded-lg border border-amber-200 bg-white p-2 font-mono text-xs text-gray-800">
              {typeof window !== 'undefined'
                ? `${window.location.origin}/clock-in`
                : '/clock-in'}
            </div>
          </div>

          <div className="mt-6 flex justify-between text-xs text-gray-600">
            <Link to="/attendance" className="hover:underline">
              My attendance →
            </Link>
            <Link to="/" className="hover:underline">
              Back to home
            </Link>
          </div>
        </div>
      </AppShell>
    )
  }

  const todayRow = todayQ.data
  const isCheckedIn = !!todayRow && !todayRow.check_out_at
  const isDoneForDay = !!todayRow && !!todayRow.check_out_at
  // Lunch state derived from the same row. Only meaningful while
  // checked in and before the final check-out.
  const isOnLunch =
    !!todayRow && !!todayRow.lunch_out_at && !todayRow.lunch_in_at
  const canLunchOut =
    !!todayRow && !todayRow.lunch_out_at && !todayRow.check_out_at
  const canLunchIn = isOnLunch

  const ready = fix.kind === 'ready'
  const inside = ready && fix.distance <= OFFICE.radiusM

  async function handleCheckIn() {
    if (fix.kind !== 'ready' || !inside || !profile) return
    setError(null)
    try {
      await checkInMut.mutateAsync({
        profile_id: profile.id,
        work_date: today,
        check_in_lat: round6(fix.lat),
        check_in_lng: round6(fix.lng),
        check_in_distance_m: round2(fix.distance),
      })
      setSavedAt(Date.now())
    } catch (e) {
      setError(formatError(e))
    }
  }

  async function handleCheckOut() {
    if (fix.kind !== 'ready' || !todayRow) return
    // Check-out doesn't enforce the geofence — sometimes staff leave
    // the building before tapping. The distance is still recorded so a
    // manager can spot anomalies later.
    setError(null)
    try {
      await checkOutMut.mutateAsync({
        id: todayRow.id,
        patch: {
          check_out_at: new Date().toISOString(),
          check_out_lat: round6(fix.lat),
          check_out_lng: round6(fix.lng),
          check_out_distance_m: round2(fix.distance),
        },
      })
      setSavedAt(Date.now())
    } catch (e) {
      setError(formatError(e))
    }
  }

  async function handleLunchOut() {
    if (fix.kind !== 'ready' || !todayRow) return
    setError(null)
    try {
      await lunchOutMut.mutateAsync({
        id: todayRow.id,
        patch: {
          lunch_out_at: new Date().toISOString(),
          lunch_out_lat: round6(fix.lat),
          lunch_out_lng: round6(fix.lng),
          lunch_out_distance_m: round2(fix.distance),
        },
      })
      setSavedAt(Date.now())
    } catch (e) {
      setError(formatError(e))
    }
  }

  async function handleLunchIn() {
    if (fix.kind !== 'ready' || !todayRow) return
    setError(null)
    try {
      await lunchInMut.mutateAsync({
        id: todayRow.id,
        patch: {
          lunch_in_at: new Date().toISOString(),
          lunch_in_lat: round6(fix.lat),
          lunch_in_lng: round6(fix.lng),
          lunch_in_distance_m: round2(fix.distance),
        },
      })
      setSavedAt(Date.now())
    } catch (e) {
      setError(formatError(e))
    }
  }

  const isLate =
    todayRow &&
    Number(
      new Date(todayRow.check_in_at)
        .toLocaleTimeString('en-MY', {
          hour: '2-digit',
          hour12: false,
          timeZone: 'Asia/Kuala_Lumpur',
        })
        .slice(0, 2),
    ) >= LATE_AFTER_HOUR

  return (
    <AppShell>
      <div className="mx-auto max-w-md">
        <div className="mb-3">
          <h1 className="text-xl font-semibold text-gray-900">Clock In</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Hi {profile.full_name || profile.email} ·{' '}
            <span className="text-gray-700">
              {new Date().toLocaleDateString('en-MY', {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          </p>
        </div>

        {/* ---------- Today's status card ---------- */}
        {todayRow && (
          <div
            className={`mb-4 rounded-2xl border p-4 text-sm ${
              isDoneForDay
                ? 'border-green-200 bg-green-50 text-green-900'
                : 'border-blue-200 bg-blue-50 text-blue-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                {isDoneForDay
                  ? '✓ Day complete'
                  : isOnLunch
                    ? '🍱 On lunch'
                    : '◐ Checked in'}
              </span>
              {isLate && !isDoneForDay && (
                <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
                  Late
                </span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <StatusSlot
                label="Check in"
                iso={todayRow.check_in_at}
                distance={Number(todayRow.check_in_distance_m)}
              />
              <StatusSlot
                label="Lunch out"
                iso={todayRow.lunch_out_at}
                distance={
                  todayRow.lunch_out_distance_m != null
                    ? Number(todayRow.lunch_out_distance_m)
                    : null
                }
              />
              <StatusSlot
                label="Lunch in"
                iso={todayRow.lunch_in_at}
                distance={
                  todayRow.lunch_in_distance_m != null
                    ? Number(todayRow.lunch_in_distance_m)
                    : null
                }
              />
              <StatusSlot
                label="Check out"
                iso={todayRow.check_out_at}
                distance={
                  todayRow.check_out_distance_m != null
                    ? Number(todayRow.check_out_distance_m)
                    : null
                }
              />
            </div>
          </div>
        )}

        {/* ---------- Location + geofence card ---------- */}
        <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm">
          <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
            📍 {OFFICE.name}
          </div>
          {fix.kind === 'requesting' && (
            <div className="mt-2 text-gray-600">
              Getting your location…
            </div>
          )}
          {fix.kind === 'denied' && (
            <div className="mt-2 text-red-700">{fix.message}</div>
          )}
          {fix.kind === 'ready' && (
            <>
              <div className="mt-2 flex items-end justify-between">
                <div>
                  <div className="text-2xl font-semibold tabular-nums text-gray-900">
                    {round0(fix.distance)} m
                  </div>
                  <div className="text-xs text-gray-500">
                    from office (allowed within {OFFICE.radiusM} m)
                  </div>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    inside
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {inside ? 'Inside geofence' : 'Outside geofence'}
                </span>
              </div>
              <div className="mt-2 text-[10px] text-gray-500">
                Your location: {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}{' '}
                (accuracy ±{round0(fix.accuracy)} m)
              </div>
            </>
          )}
          <button
            type="button"
            onClick={requestFix}
            disabled={fix.kind === 'requesting'}
            className="mt-3 w-full rounded-md border border-gray-300 bg-white py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {fix.kind === 'requesting' ? 'Locating…' : 'Recheck location'}
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {savedAt && (
          <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            ✓ Saved at{' '}
            {new Date(savedAt).toLocaleTimeString('en-MY', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
          </div>
        )}

        {/* ---------- Action buttons (state machine) ---------- */}
        {!isCheckedIn && !isDoneForDay && (
          <button
            type="button"
            onClick={handleCheckIn}
            disabled={!ready || !inside || checkInMut.isPending}
            className="w-full rounded-2xl bg-green-600 px-6 py-6 text-2xl font-semibold text-white shadow-lg transition hover:bg-green-700 disabled:opacity-50"
          >
            {checkInMut.isPending ? 'Saving…' : '✓ Check In'}
          </button>
        )}

        {isCheckedIn && canLunchOut && (
          <button
            type="button"
            onClick={handleLunchOut}
            disabled={!ready || lunchOutMut.isPending}
            className="w-full rounded-2xl bg-amber-500 px-6 py-5 text-xl font-semibold text-white shadow-lg transition hover:bg-amber-600 disabled:opacity-50"
          >
            {lunchOutMut.isPending ? 'Saving…' : '🍱 Out for lunch'}
          </button>
        )}

        {isCheckedIn && canLunchIn && (
          <button
            type="button"
            onClick={handleLunchIn}
            disabled={!ready || lunchInMut.isPending}
            className="w-full rounded-2xl bg-emerald-600 px-6 py-5 text-xl font-semibold text-white shadow-lg transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {lunchInMut.isPending ? 'Saving…' : '↩ Back from lunch'}
          </button>
        )}

        {isCheckedIn && !isOnLunch && (
          <button
            type="button"
            onClick={handleCheckOut}
            disabled={!ready || checkOutMut.isPending}
            className="mt-3 w-full rounded-2xl bg-rose-600 px-6 py-5 text-xl font-semibold text-white shadow-md transition hover:bg-rose-700 disabled:opacity-50"
          >
            {checkOutMut.isPending ? 'Saving…' : '⏻ Check Out (end day)'}
          </button>
        )}

        {isDoneForDay && (
          <div className="rounded-2xl border-2 border-dashed border-green-300 bg-green-50/50 px-6 py-6 text-center text-base font-medium text-green-800">
            All done for today. See you tomorrow!
          </div>
        )}

        {!isCheckedIn && !isDoneForDay && !inside && ready && (
          <p className="mt-3 text-center text-xs text-rose-700">
            You&rsquo;re too far from the office to check in. Move within{' '}
            {OFFICE.radiusM} m and tap Recheck.
          </p>
        )}

        <div className="mt-6 flex justify-between text-xs text-gray-600">
          <Link to="/attendance" className="hover:underline">
            My attendance →
          </Link>
          <Link to="/" className="hover:underline">
            Back to home
          </Link>
        </div>
      </div>
    </AppShell>
  )
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function round0(n: number): number {
  return Math.round(n)
}

function StatusSlot({
  label,
  iso,
  distance,
}: {
  label: string
  iso: string | null
  distance: number | null
}) {
  const time = iso
    ? new Date(iso).toLocaleTimeString('en-MY', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Kuala_Lumpur',
      })
    : null
  return (
    <div>
      <div className="text-gray-600">{label}</div>
      <div
        className={`text-base font-semibold tabular-nums ${
          time ? '' : 'text-gray-400'
        }`}
      >
        {time ?? '—'}
      </div>
      {distance != null && (
        <div className="text-[10px] text-gray-500">
          {Math.round(distance)} m from office
        </div>
      )}
    </div>
  )
}
