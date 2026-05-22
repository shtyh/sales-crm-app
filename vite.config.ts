import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
