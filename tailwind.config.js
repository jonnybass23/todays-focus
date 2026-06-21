/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/index.html', './public/app.js'],
  safelist: [
    // md:grid-cols-N is built dynamically in app.js (Math.min(cols.length, 4))
    'md:grid-cols-1',
    'md:grid-cols-2',
    'md:grid-cols-3',
    'md:grid-cols-4',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        bg:           'var(--bg)',
        panel:        'var(--panel)',
        card:         'var(--card)',
        edge:         'var(--edge)',
        'edge-strong':'var(--edge-strong)',
        ink:          'var(--ink)',
        'ink-soft':   'var(--ink-soft)',
        'ink-faint':  'var(--ink-faint)',
        'ink-strong': 'var(--ink-strong)',
        accent:       'var(--accent)',
        inputbg:      'var(--input)',
      },
    },
  },
  plugins: [],
};
