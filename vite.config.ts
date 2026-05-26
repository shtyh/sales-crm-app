import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Service worker auto-replaces itself on next page load — no manual
      // "update available" prompt to deal with, matches how the rest of the
      // app deploys (Vercel pushes a new bundle, browser picks it up).
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-icon.svg'],
      manifest: {
        name: 'SWL Motors CRM',
        short_name: 'SWL CRM',
        description:
          'Sales + Service CRM for SWL Motors Proton 3S centre. Add to Home Screen for an app-like experience and resilience to flaky workshop wifi.',
        theme_color: '#111827',
        background_color: '#f9fafb',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        // Hashed assets under /assets/ are immutable (vercel.json sets
        // max-age=31536000) so we can hard-precache them. Runtime cache for
        // the API and navigation requests keeps the app reachable when the
        // network blinks.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        runtimeCaching: [
          {
            // App shell / SPA navigations — network first so updates land,
            // cache fallback so a flaky moment doesn't leave a blank tab.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-shell',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Supabase REST/postgrest reads — stale-while-revalidate so the
            // workshop dashboard renders instantly from cache and updates
            // in the background.
            urlPattern: /^https:\/\/[a-z0-9]+\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-rest',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 100, maxAgeSeconds: 24 * 60 * 60 },
              // Auth requests vary by Authorization header; safe to cache
              // the response per-URL because the data is row-level-secured
              // anyway.
            },
          },
        ],
      },
      devOptions: {
        // Don't run the SW in dev — would cache stale builds and make HMR
        // confusing. Only meaningful in production.
        enabled: false,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Split big third-party deps into their own chunks. The browser can
        // cache them independently of our app code, so a small page change
        // doesn't invalidate the (much larger) React/Supabase bundles.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@supabase')) return 'supabase'
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/react-router') ||
              id.includes('/scheduler/')
            ) {
              return 'react'
            }
          }
        },
      },
    },
  },
})
