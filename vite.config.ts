import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/route-auto-input/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'ルート自動入力',
        short_name: 'ルート',
        description: '登録した患者の住所を、訪問順にGoogleマップの経路へ渡します。',
        lang: 'ja',
        start_url: '/route-auto-input/',
        scope: '/route-auto-input/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0b57d0',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
