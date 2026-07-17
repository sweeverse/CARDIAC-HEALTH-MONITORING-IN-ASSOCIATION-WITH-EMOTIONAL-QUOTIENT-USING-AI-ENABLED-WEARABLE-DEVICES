/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--color-ink) / <alpha-value>)',
        paper: '#EEEEEE',
        surface: '#FFFFFF',
        line: '#D0CECE',
        brand: {
          red: '#CF0A0A',
          orange: '#DC5F00',
        },
        teal: {
          50: '#EAF3F1',
          100: '#CFE3DF',
          300: '#7FB3AA',
          500: '#2F7B73',
          600: '#1A5C55',
          700: '#0E4F4A',
          900: '#0A332F',
        },
        coral: {
          400: '#F2855F',
          500: '#DC5F00',
          600: '#C8401E',
        },
        success: '#2F8F5B',
        warning: '#DC5F00',
        danger: '#CF0A0A',
        // Dark mode specific — a near-black with a faint cool undertone
        // instead of flat pure black, with more contrast step between
        // background/surface/card so panels read as layered, not flat.
        dark: {
          bg: '#08090A',
          surface: '#121415',
          card: '#1B1D1F',
          border: '#2C2F32',
          text: '#F1F1EF',
          muted: '#B4B7B9',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Inter"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,36,33,0.04), 0 4px 16px rgba(15,36,33,0.06)',
        pop: '0 8px 30px rgba(15,36,33,0.12)',
        'dark-card': '0 1px 2px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      backgroundImage: {
        'grid-fade': 'linear-gradient(180deg, rgba(207,10,10,0.06) 0%, rgba(220,95,0,0.02) 50%, rgba(207,10,10,0) 100%)',
        'hero-pattern': "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23CF0A0A' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
      },
      keyframes: {
        pulseLine: {
          '0%': { strokeDashoffset: '1000' },
          '100%': { strokeDashoffset: '0' },
        },
        floatSlow: {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        heartbeat: {
          '0%, 100%': { transform: 'scale(1)' },
          '14%': { transform: 'scale(1.15)' },
          '28%': { transform: 'scale(1)' },
          '42%': { transform: 'scale(1.1)' },
          '70%': { transform: 'scale(1)' },
        },
        toastIn: {
          '0%': { opacity: '0', transform: 'translateX(24px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
        },
        toastOut: {
          '0%': { opacity: '1', transform: 'translateX(0) scale(1)', maxHeight: '120px' },
          '85%': { opacity: '0', transform: 'translateX(16px) scale(0.97)', maxHeight: '120px' },
          '100%': { opacity: '0', transform: 'translateX(16px) scale(0.97)', maxHeight: '0px', marginTop: '0px' },
        },
        indeterminate: {
          '0%': { transform: 'translateX(-100%)' },
          '50%': { transform: 'translateX(60%)' },
          '100%': { transform: 'translateX(220%)' },
        },
      },
      animation: {
        pulseLine: 'pulseLine 2.6s linear infinite',
        floatSlow: 'floatSlow 6s ease-in-out infinite',
        heartbeat: 'heartbeat 1.5s ease-in-out infinite',
        toastIn: 'toastIn 0.25s cubic-bezier(0.16,1,0.3,1) both',
        toastOut: 'toastOut 0.32s cubic-bezier(0.4,0,1,1) forwards',
        indeterminate: 'indeterminate 1.1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
