/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        flood: {
          cyan: '#00E5FF',
          amber: '#FFB300',
          red: '#FF1744',
          dark: '#0a0d14',
          panel: '#111724',
          border: '#1e293b'
        }
      },
      boxShadow: {
        'glow-cyan': '0 0 20px rgba(0, 229, 255, 0.4)',
        'glow-red': '0 0 20px rgba(255, 23, 68, 0.5)',
        'pedestal': '0 30px 60px -12px rgba(0, 0, 0, 0.9), 0 18px 36px -18px rgba(0, 0, 0, 0.95)'
      }
    },
  },
  plugins: [],
}
