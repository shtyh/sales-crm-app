import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './lib/auth.tsx'

// Tuned for a CRM on workshop wifi:
//   * 30s staleness is fine (data doesn't change every second).
//   * 5 min in memory so back/forward nav is instant.
//   * Queries retry once — failures surface quickly without a long hang.
//   * Mutations retry up to 3 times, but ONLY for network-style failures
//     ("Failed to fetch" / TypeError) — never for server-side errors like
//     RLS rejections (those are deterministic, retrying just wastes time).
//     Exponential backoff so a brief outage gets multiple attempts but a
//     hard outage doesn't hammer.
function isNetworkError(err: unknown): boolean {
  if (err == null) return false
  if (err instanceof TypeError) return true // Failed to fetch
  const msg = (err as { message?: string }).message ?? String(err)
  return /network|fetch|failed to fetch|offline|disconnect/i.test(msg)
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
    },
    mutations: {
      retry: (failureCount, error) =>
        isNetworkError(error) && failureCount < 3,
      // 400ms, 800ms, 1600ms — 4 attempts in ~2.8s.
      retryDelay: (attempt) => Math.min(400 * 2 ** attempt, 3000),
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
)
