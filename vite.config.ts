import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],

  worker: {
    format: 'es',
  },

  server: {
    host: true,          // bind to 0.0.0.0 so Streamlit's iframe can reach it
    port: 5173,
    strictPort: true,

    // Allow the page to be embedded in an iframe served from Streamlit (port 8501)
    headers: {
      'X-Frame-Options': 'ALLOWALL',
      'Content-Security-Policy': "frame-ancestors *",
      'Access-Control-Allow-Origin': '*',
    },

    hmr: {
      port: 5173,
      clientPort: 5173,
    },

    cors: true,
  },
});
