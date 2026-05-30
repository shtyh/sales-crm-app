import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { NOTIFICATION_ICON, notifTimeAgo } from '../components/NotificationBell'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import type { NotificationType } from '../lib/types'

type ReadFilter = 'all' | 'unread' | 'read'

const TYPE_LABEL: Record<NotificationType, string> = {
  no_sm_signature: 'No SM signature',
  all_in_one_pending: 'All-In-One pending',
  all_in_one_approved: 'All-In-One approved',
  all_in_one_rejected: 'All-In-One rejected',
  down_payment_complete: 'Down payment complete',
  lou_pending: 'LOU pending',
  lou_verified: 'LOU verified',
  booking_complete: 'Booking complete',
  commission_unlocked: 'Commission unlocked',
}

const selectClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'

export function NotificationsPage() {
  const { data: notifs, error, isLoading } = useNotifications(200)
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const [readFilter, setReadFilter] = useState<ReadFilter>('all')
  const [typeFilter, setTypeFilter] = useState<'' | NotificationType>('')

  const filtered = useMemo(() => {
    let list = notifs ?? []
    if (readFilter === 'unread') list = list.filter((n) => !n.is_read)
    if (readFilter === 'read') list = list.filter((n) => n.is_read)
    if (typeFilter) list = list.filter((n) => n.type === typeFilter)
    return list
  }, [notifs, readFilter, typeFilter])

  const unreadCount = (notifs ?? []).filter((n) => !n.is_read).length

  return (
    <AppShell>
      <div className="space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Notifications
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">{unreadCount} unread</p>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAll.mutate()}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Mark all read
            </button>
          )}
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={readFilter}
            onChange={(e) => setReadFilter(e.target.value as ReadFilter)}
            className={selectClass}
          >
            <option value="all">All</option>
            <option value="unread">Unread</option>
            <option value="read">Read</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as '' | NotificationType)
            }
            className={selectClass}
          >
            <option value="">All types</option>
            {(Object.keys(TYPE_LABEL) as NotificationType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {formatError(error)}
          </p>
        )}

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          {isLoading && (
            <div className="p-6 text-center text-sm text-gray-500">Loading…</div>
          )}
          {notifs && filtered.length === 0 && !isLoading && (
            <div className="p-6 text-center text-sm text-gray-500">
              No notifications.
            </div>
          )}
          <ul className="divide-y divide-gray-100">
            {filtered.map((n) => {
              const body = (
                <div
                  className={`flex items-start gap-3 px-4 py-3 transition hover:bg-gray-50 ${
                    n.is_read ? '' : 'bg-rose-50/40'
                  }`}
                >
                  <span className="text-lg leading-none">
                    {NOTIFICATION_ICON[n.type] ?? '🔔'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-800">{n.message}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
                      <span>{notifTimeAgo(n.created_at)}</span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500">
                        {TYPE_LABEL[n.type] ?? n.type}
                      </span>
                    </div>
                  </div>
                  {!n.is_read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                  )}
                </div>
              )
              return (
                <li
                  key={n.id}
                  onClick={() => {
                    if (!n.is_read) markRead.mutate(n.id)
                  }}
                >
                  {n.booking_id ? (
                    <Link to={`/bookings/${n.booking_id}`} className="block">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </AppShell>
  )
}
