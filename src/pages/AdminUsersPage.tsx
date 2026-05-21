import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { listProfiles, updateProfile } from '../lib/profiles'
import { formatError } from '../lib/errors'
import type { Profile } from '../lib/types'

export function AdminUsersPage() {
  const { profile: currentProfile, isAdmin, loading } = useAuth()

  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(
    null,
  )

  async function refresh() {
    try {
      const rows = await listProfiles()
      setProfiles(rows)
    } catch (e) {
      setError(formatError(e))
    }
  }

  useEffect(() => {
    if (isAdmin) refresh()
  }, [isAdmin])

  // Permission guard — wait until auth has loaded, then redirect non-admins.
  if (loading) {
    return (
      <AppShell>
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      </AppShell>
    )
  }
  if (!isAdmin) {
    return <Navigate to="/" replace />
  }

  async function handleToggleAdmin(p: Profile) {
    if (p.id === currentProfile?.id && p.is_admin) {
      if (
        !window.confirm(
          'Demote yourself? You will lose admin access immediately.',
        )
      ) {
        return
      }
    }
    setBusyId(p.id)
    setError(null)
    try {
      await updateProfile(p.id, { is_admin: !p.is_admin })
      await refresh()
    } catch (e) {
      setError(formatError(e))
    } finally {
      setBusyId(null)
    }
  }

  async function handleSaveName(p: Profile, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed) {
      setEditing(null)
      return
    }
    if (trimmed === (p.full_name ?? '')) {
      setEditing(null)
      return
    }
    setBusyId(p.id)
    setError(null)
    try {
      await updateProfile(p.id, { full_name: trimmed })
      await refresh()
    } catch (e) {
      setError(formatError(e))
    } finally {
      setBusyId(null)
      setEditing(null)
    }
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-gray-900">
            Admin · Users
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage display names and admin rights.
          </p>
        </div>
        <div className="text-xs text-gray-500">
          {profiles?.length ?? 0} user{profiles?.length === 1 ? '' : 's'}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {profiles === null && !error && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      )}

      {profiles && profiles.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white sm:block">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">
                    Display name
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {profiles.map((p) => {
                  const isSelf = p.id === currentProfile?.id
                  const editingThis = editing?.id === p.id
                  return (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        {editingThis ? (
                          <input
                            autoFocus
                            type="text"
                            value={editing.value}
                            onChange={(e) =>
                              setEditing({ id: p.id, value: e.target.value })
                            }
                            onBlur={() => handleSaveName(p, editing.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter')
                                handleSaveName(p, editing.value)
                              else if (e.key === 'Escape') setEditing(null)
                            }}
                            className="w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900/10"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setEditing({ id: p.id, value: p.full_name ?? '' })
                            }
                            className="text-left text-gray-900 hover:underline"
                            title="Click to edit"
                          >
                            {p.full_name || (
                              <span className="italic text-gray-400">
                                (no name)
                              </span>
                            )}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{p.email}</td>
                      <td className="px-4 py-3">
                        {p.is_admin ? (
                          <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                            ☆ Admin
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">Staff</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleAdmin(p)}
                          disabled={busyId === p.id}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                        >
                          {busyId === p.id
                            ? '…'
                            : p.is_admin
                              ? isSelf
                                ? 'Demote (me)'
                                : 'Demote'
                              : 'Make admin'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-3 sm:hidden">
            {profiles.map((p) => {
              const isSelf = p.id === currentProfile?.id
              const editingThis = editing?.id === p.id
              return (
                <li
                  key={p.id}
                  className="rounded-2xl border border-gray-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    {editingThis ? (
                      <input
                        autoFocus
                        type="text"
                        value={editing.value}
                        onChange={(e) =>
                          setEditing({ id: p.id, value: e.target.value })
                        }
                        onBlur={() => handleSaveName(p, editing.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveName(p, editing.value)
                          else if (e.key === 'Escape') setEditing(null)
                        }}
                        className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900/10"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({ id: p.id, value: p.full_name ?? '' })
                        }
                        className="text-left font-medium text-gray-900 hover:underline"
                      >
                        {p.full_name || (
                          <span className="italic text-gray-400">
                            (no name)
                          </span>
                        )}
                      </button>
                    )}
                    {p.is_admin && (
                      <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                        ☆ Admin
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{p.email}</div>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleToggleAdmin(p)}
                      disabled={busyId === p.id}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                    >
                      {busyId === p.id
                        ? '…'
                        : p.is_admin
                          ? isSelf
                            ? 'Demote (me)'
                            : 'Demote'
                          : 'Make admin'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <p className="mt-6 text-xs text-gray-400">
        To invite a new user: Supabase Dashboard → Authentication → Users →
        Add user → Send invitation.
      </p>
    </AppShell>
  )
}
