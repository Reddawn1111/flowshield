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
    strictPort: true,    // fail fast if port is taken instead of silently picking another

    // Allow the page to be embedded in an iframe served from Streamlit (port 8501)
    headers: {
      'X-Frame-Options': 'ALLOWALL',
      'Content-Security-Policy': "frame-ancestors *",
      'Access-Control-Allow-Origin': '*',
    },

    // Keep Vite's HMR WebSocket pointing at the React port, not the Streamlit port,
    // so hot-reload works even when the page is loaded inside an iframe.
    hmr: {
      port: 5173,
      clientPort: 5173,
    },

    cors: true,
  },
});
