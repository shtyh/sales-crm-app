import { supabase } from './supabase'
import type { AppNotification } from './types'

// In-app notifications. RLS scopes every read to the caller's own rows
// (super_admin sees all); the unread count + mark-read go through SECURITY
// DEFINER RPCs so they're cheap and consistent.

export async function listNotifications(limit = 50): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data as AppNotification[]) ?? []
}

export async function getUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc('get_unread_notification_count')
  if (error) throw error
  return (data as number) ?? 0
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.rpc('mark_notification_read', { p_id: id })
  if (error) throw error
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase.rpc('mark_all_notifications_read')
  if (error) throw error
}
