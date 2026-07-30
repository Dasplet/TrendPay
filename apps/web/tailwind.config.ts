import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // TrendPay design system
        brand: {
          bg:      '#252547',
          sidebar: '#1a0840',
          accent:  '#852EC7',
          muted:   '#AE93AA',
          success: '#6CC998',
          danger:  '#C0392B',
          card:    '#1e1a45',
          border:  'rgba(133,46,199,0.2)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(160deg, #1a0840 0%, #321168 60%, #252547 100%)',
        'card-gradient':  'linear-gradient(135deg, rgba(133,46,199,0.25) 0%, rgba(50,17,104,0.5) 100%)',
      },
    },
  },
  plugins: [],
};

export default config;
