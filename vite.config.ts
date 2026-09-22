import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { APP_DESCRIPTION, APP_NAME } from './src/appInfo.ts';

/** index.html の %APP_NAME% を、ビルド時・開発サーバー起動時に APP_NAME へ置き換える。 */
const appNameInHtml: Plugin = {
  name: 'app-name-in-html',
  transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', APP_NAME),
};

export default defineConfig({
  base: '/route-auto-input/',
  plugins: [
    appNameInHtml,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: APP_DESCRIPTION,
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
    // Vitest は標準では CSS を処理せず、?raw で読んでも空文字になる。
    // 色のコントラスト検査(tests/styles.test.ts)で styles.css を読めるようにする。
    css: { include: [/styles.css/] },
  },
});
