import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Same var the app reads (src/lib/config.ts), so the dev proxy and the
  // browser always agree on the backend origin.
  const apiUrl = loadEnv(mode, process.cwd(), '').VITE_API_URL || 'http://localhost:8001'

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': {
          target: apiUrl,
          changeOrigin: true,
        },
        '/auth': {
          target: apiUrl,
          changeOrigin: true,
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            charts: ['recharts'],
            graph: ['react-force-graph-2d'],
            // three is only reachable through the hero orb's lazy chunk, so this
            // stays a dynamic chunk — split out purely so it caches on its own
            // and does not swamp the size report for the R3F glue.
            three: ['three'],
          },
        },
      },
    },
  }
})
