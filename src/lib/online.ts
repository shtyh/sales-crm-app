import { useEffect, useState } from 'react'

/**
 * Boolean — is the browser online right now? Uses navigator.onLine + the
 * window 'online' / 'offline' events so the UI dot flips the moment the
 * network comes back / drops.
 *
 * Caveat: navigator.onLine reports "the OS thinks we have a network
 * interface", not "we can reach our server". So the indicator may say
 * green while a captive portal / DNS issue silently breaks Supabase
 * calls. That's fine for this MVP — the form-draft + React-Query retry
 * cover the false-positive case (saves still queue locally and retry).
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  useEffect(() => {
    function on() {
      setOnline(true)
    }
    function off() {
      setOnline(false)
    }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
