/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Royal Forest / Emerald Brand Palette (matches brand logo background)
        forest: {
          50: '#edfbf5',
          100: '#d4f6e7',
          200: '#acecd3',
          300: '#74dcba',
          400: '#3cc39b',
          500: '#18a47e',
          600: '#0e8364',
          700: '#0d6851',
          800: '#0c5341',
          900: '#0b4437',
          950: '#05271f',
        },
        // Radiant Royal Gold / Champagne Luster Palette (neat, luminous, high-contrast)
        gold: {
          50: '#fefbf3',
          100: '#fdf4d8',
          200: '#fce7a4',
          300: '#f9d564',
          400: '#f0be2e',
          500: '#d49b14',
          600: '#b37e09',
          700: '#8f6106',
          800: '#704908',
          900: '#4d3106',
          950: '#2c1a01',
        },
        // Modern Clean Emerald Palette
        brand: {
          50: '#edfbf5',
          100: '#d4f6e7',
          200: '#acecd3',
          300: '#74dcba',
          400: '#3cc39b',
          500: '#18a47e',
          600: '#0e8364',
          700: '#0d6851',
          800: '#0c5341',
          900: '#0b4437',
          950: '#05271f',
        },
        // Warm Radiant Amber / Honey Accent
        amber: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
      },
      fontFamily: {
        sans: [
          '"Red Hat Display"',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'sans-serif',
        ],
        display: [
          '"Red Hat Display"',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'sans-serif',
        ],
        serif: [
          '"Red Hat Display"',
          'Georgia',
          'serif',
        ],
        mono: [
          '"Red Hat Display"',
          'ui-monospace',
          'monospace',
        ],
      },
      boxShadow: {
        'apple-subtle': '0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 1px rgba(0, 0, 0, 0.02)',
        'apple-card': '0 4px 20px -2px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.02)',
        'apple-card-hover': '0 12px 32px -4px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.03)',
        'apple-glass': '0 8px 32px 0 rgba(0, 0, 0, 0.08), inset 0 0 0 1px rgba(255, 255, 255, 0.3)',
        'apple-dark-glass': '0 12px 40px -4px rgba(0, 0, 0, 0.4), inset 0 1px 0 0 rgba(255, 255, 255, 0.12)',
        'apple-pill': '0 2px 8px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
      },
      borderRadius: {
        'apple-sm': '10px',
        'apple': '14px',
        'apple-md': '18px',
        'apple-lg': '22px',
        'apple-xl': '28px',
      },
    },
  },
  plugins: [],
};
