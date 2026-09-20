import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.RMS_API_URL || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: API },
      '/uploads': { target: API },
      '/socket.io': { target: API, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
