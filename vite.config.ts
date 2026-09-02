import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/route-auto-input/',
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
