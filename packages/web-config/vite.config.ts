import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: process.env.MONO_CONFIG_UI_API_URL
    ? {
        proxy: {
          "/api": {
            target: process.env.MONO_CONFIG_UI_API_URL,
            changeOrigin: true,
          },
        },
      }
    : undefined,
})
