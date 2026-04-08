import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        tempo: {
          blue: '#0057FF',
          dark: '#0A0A0F',
          card: '#13131A',
          border: '#1E1E2E',
          muted: '#6B7280',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
}

export default config
