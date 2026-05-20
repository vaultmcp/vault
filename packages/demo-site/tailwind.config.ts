import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#050505',
        panel: '#0c0c0c',
        line: '#1a1a1a',
        ink: '#e8e8e8',
        dim: '#7a7a7a',
        accent: '#00ff66',
        warn: '#ffb547',
        bad: '#ff4757',
      },
      fontFamily: {
        mono: ['var(--font-mono)', '"JetBrains Mono"', '"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        widish: '0.04em',
      },
    },
  },
  plugins: [],
};

export default config;
