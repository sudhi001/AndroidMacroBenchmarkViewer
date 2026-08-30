import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative base so the built site works from a GitHub Pages project path,
  // from Render, and from a plain file:// open alike.
  base: './',
  build: { outDir: 'dist', sourcemap: true },
})
