import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

function App() {
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking')
  const [message, setMessage] = useState<string>('Connecting to Supabase…')

  useEffect(() => {
    // Harmless call that confirms the client + creds work,
    // even before any tables exist.
    supabase.auth.getSession().then(({ error }) => {
      if (error) {
        setStatus('error')
        setMessage(`Connection failed: ${error.message}`)
      } else {
        setStatus('ok')
        setMessage('Supabase connected ✅')
      }
    })
  }, [])

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <h1 style={{ margin: 0, fontSize: '2rem' }}>Sales CRM</h1>
      <p
        style={{
          margin: 0,
          padding: '0.75rem 1.25rem',
          borderRadius: '999px',
          background:
            status === 'ok'
              ? '#dcfce7'
              : status === 'error'
                ? '#fee2e2'
                : '#fef3c7',
          color:
            status === 'ok'
              ? '#166534'
              : status === 'error'
                ? '#991b1b'
                : '#92400e',
          fontWeight: 500,
        }}
      >
        {message}
      </p>
      <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>
        Project: {import.meta.env.VITE_SUPABASE_URL}
      </p>
    </main>
  )
}

export default App
