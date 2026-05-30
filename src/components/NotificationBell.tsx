import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from '../lib/queries'
import type { AppNotification, NotificationType } from '../lib/types'

export const NOTIFICATION_ICON: Record<NotificationType, string> = {
  no_sm_signature: '⚠️',
  all_in_one_pending: '📋',
  all_in_one_approved: '✅',
  all_in_one_rejected: '❌',
  down_payment_complete: '💰',
  lou_pending: '📄',
  lou_verified: '✅',
  booking_complete: '🎉',
  commission_unlocked: '💸',
}

export function notifTimeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/**
 * Top-bar notification bell — unread badge + dropdown of the latest 10.
 * Visible to every role; each user only ever sees their own notifications
 * (RLS). Unread count is polled (60s) via useUnreadCount; the list is only
 * fetched while the dropdown is open.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()
  const { data: unread = 0 } = useUnreadCount()
  const { data: notifs } = useNotifications(10, open)
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  function onItemClick(n: AppNotification) {
    if (!n.is_read) markRead.mutate(n.id)
    setOpen(false)
    if (n.booking_id) navigate(`/bookings/${n.booking_id}`)
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-lg text-gray-600 transition hover:bg-gray-100"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <span className="text-sm font-semibold text-gray-900">
              Notifications
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                className="text-xs text-gray-500 hover:text-gray-900"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {(!notifs || notifs.length === 0) && (
              <div className="px-4 py-6 text-center text-xs text-gray-500">
                No notifications yet.
              </div>
            )}
            {notifs?.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onItemClick(n)}
                className={`flex w-full items-start gap-2 border-b border-gray-50 px-4 py-2.5 text-left transition hover:bg-gray-50 ${
                  n.is_read ? '' : 'bg-rose-50/40'
                }`}
              >
                <span className="text-base leading-none">
                  {NOTIFICATION_ICON[n.type] ?? '🔔'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-gray-800">{n.message}</span>
                  <span className="mt-0.5 block text-[10px] text-gray-400">
                    {notifTimeAgo(n.created_at)}
                  </span>
                </span>
                {!n.is_read && (
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
                )}
              </button>
            ))}
          </div>

          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-gray-100 px-4 py-2 text-center text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            View all
          </Link>
        </div>
      )}
    </div>
  )
}
