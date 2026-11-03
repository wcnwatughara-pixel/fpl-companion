import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/fpl-companion/',
  plugins: [react()],
})
    react(),
    tailwindcss()
  ],
  server: {
    // Proxy all /api requests to the FPL API.
    // This avoids CORS errors: the browser talks to localhost,
    // and Vite forwards the request to fantasy.premierleague.com.
    proxy: {
      '/api': {
        target: 'https://fantasy.premierleague.com',
        changeOrigin: true,
        // If the FPL API is slow, give it up to 30 seconds
        timeout: 30000
      }
    }
  }
})
