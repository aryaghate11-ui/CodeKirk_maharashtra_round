/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#080b10',
          'bg-deep': '#040609',
          panel: '#0e141d',
          'panel-elevated': '#141d2a',
          'panel-secondary': '#111722',
          border: '#1f2b3b',
          'border-bright': '#2f4055',
          text: '#f1f5f9',
          muted: '#8b9bb0',
          subtle: '#52627a',
        },
        quorum: {
          green: '#10b981',
          'green-light': '#34d399',
          'green-glow': '#60e6ae',
          'green-bg': '#07241c',
          'green-border': '#155e4b',
          red: '#ef4444',
          'red-light': '#f87171',
          'red-bg': '#2b1216',
          'red-border': '#682329',
          amber: '#f59e0b',
          'amber-light': '#fbbf24',
          'amber-bg': '#291e0a',
          'amber-border': '#654817',
          blue: '#3b82f6',
          'blue-light': '#60a5fa',
          'blue-bg': '#0d1f38',
          'blue-border': '#1d3e6d',
          purple: '#8b5cf6',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SFMono-Regular"', 'Consolas', '"Liberation Mono"', 'Menlo', 'monospace'],
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out forwards',
        'slide-up': 'slideUp 0.3s ease-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      boxShadow: {
        'panel': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        'glow-green': '0 0 25px rgba(16, 185, 129, 0.15)',
        'glow-red': '0 0 25px rgba(239, 68, 68, 0.15)',
        'glow-amber': '0 0 25px rgba(245, 158, 11, 0.15)',
      },
    },
  },
  plugins: [],
};
