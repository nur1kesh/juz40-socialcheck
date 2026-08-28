import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      opacity: {
        6: '0.06',
        8: '0.08',
        12: '0.12',
        15: '0.15',
      },
      colors: {
        // Warm ivory base — keeps the deep teal from reading as cold/flat.
        paper: {
          DEFAULT: '#FBF6F0',
          soft: '#FDFAF6',
          card: '#FFFFFF',
        },
        ink: {
          DEFAULT: '#0C2226',
          soft: '#3E5559',
          // Darkened from the original #7E9295 (3.04:1 against `paper`,
          // below WCAG AA's 4.5:1 for small text — this token is used
          // for labels/captions/timestamps throughout, mostly at small
          // sizes) to ~5.3:1 while staying in the same muted teal-gray family.
          faint: '#5B696B',
        },
        // Primary brand scale built directly off the requested teal swatch
        // (~#0B6E85) — no burgundy anywhere in the palette anymore.
        forest: {
          50: '#E5F3F6',
          100: '#BFE3EA',
          200: '#84C7D3',
          300: '#46A6B7',
          400: '#1D869B',
          500: '#0B6E85',
          600: '#08596C',
          700: '#074657',
          800: '#053440',
          900: '#03242C',
          950: '#02171D',
        },
        // Warm amber accent — pairs with teal without reintroducing a
        // burgundy/wine hue.
        gold: {
          100: '#FDF0D5',
          200: '#FADFA8',
          300: '#F5C766',
          400: '#E8AC2E',
          500: '#C48F12',
          600: '#96690A',
        },
        // Vivid coral-red for errors/warnings — stays distinct from both
        // teal and amber so it still reads as "alert".
        clay: {
          400: '#FF6B5B',
          500: '#E14435',
        },
        // Lighter sparkle accent — a sunlit seafoam, kept in the same
        // family as the primary teal instead of an unrelated hue.
        lime: {
          300: '#A8E6D8',
          400: '#6FCDBA',
          500: '#3FB09B',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(3,36,44,0.08), 0 8px 24px -12px rgba(3,36,44,0.18)',
        lifted: '0 4px 8px rgba(3,36,44,0.1), 0 24px 48px -16px rgba(3,36,44,0.34)',
        glow: '0 0 0 1px rgba(11,110,133,0.1), 0 12px 32px -8px rgba(11,110,133,0.5)',
        'glow-gold': '0 12px 28px -8px rgba(196,143,18,0.5)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.8) translateY(10px)' },
          '60%': { opacity: '1', transform: 'scale(1.03) translateY(0)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        blob: {
          '0%, 100%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(4%, -6%) scale(1.08)' },
          '66%': { transform: 'translate(-3%, 4%) scale(0.95)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'gradient-x': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        drift: {
          '0%, 100%': { transform: 'translate(0, 0)' },
          '25%': { transform: 'translate(14px, -22px)' },
          '50%': { transform: 'translate(-10px, -36px)' },
          '75%': { transform: 'translate(-20px, -12px)' },
        },
        'step-in-forward': {
          '0%': { opacity: '0', transform: 'translateX(28px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
        },
        'step-in-back': {
          '0%': { opacity: '0', transform: 'translateX(-28px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.6s cubic-bezier(0.16,1,0.3,1) both',
        'scale-in': 'scale-in 0.4s cubic-bezier(0.16,1,0.3,1) both',
        'pop-in': 'pop-in 0.55s cubic-bezier(0.34,1.56,0.64,1) both',
        shimmer: 'shimmer 2.5s linear infinite',
        blob: 'blob 16s ease-in-out infinite',
        float: 'float 5s ease-in-out infinite',
        'gradient-x': 'gradient-x 6s ease infinite',
        'spin-slow': 'spin 16s linear infinite',
        drift: 'drift 10s ease-in-out infinite',
        'step-in-forward': 'step-in-forward 0.42s cubic-bezier(0.16,1,0.3,1) both',
        'step-in-back': 'step-in-back 0.42s cubic-bezier(0.16,1,0.3,1) both',
      },
    },
  },
  plugins: [],
};

export default config;
