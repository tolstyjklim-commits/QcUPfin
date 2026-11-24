import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative asset paths work both on GitHub Pages project sites and local preview.
// В dev бэкенд проксируется на тот же адрес: так игра работает и через https-туннель внутри Telegram.
const api = { target: 'http://localhost:4000', changeOrigin: true }
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { allowedHosts: true, proxy: { '/api': api, '/gifts-assets': api, '/health': api } },
})
