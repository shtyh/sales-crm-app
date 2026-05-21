import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { formatError } from '../lib/errors'

export function AccountPage() {
  const { user } = useAuth()

  const [fullName, setFullName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Pre-fill once the auth user is available.
  useEffect(() => {
    const existing =
      (user?.user_metadata?.full_name as string | undefined) ?? ''
    setFullName(existing)
  }, [user])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: fullName.trim() },
      })
      if (error) throw error
      setSavedAt(Date.now())
    } catch (e) {
      setError(formatError(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell>
      <div className="mb-6">
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Account</h1>
        <p className="mt-1 text-sm text-gray-500">
          Your display name shows up on the dashboard and your bookings.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="max-w-md space-y-4 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6"
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">
            Display name
          </span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
            placeholder="e.g. Ahmad Rahman"
            required
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Email</span>
          <input
            type="email"
            value={user?.email ?? ''}
            disabled
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
          />
          <span className="mt-1 block text-xs text-gray-400">
            Email is fixed — contact admin if you need to change it.
          </span>
        </label>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {savedAt && !error && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            Saved ✓
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <Link
            to="/"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </AppShell>
  )
}
