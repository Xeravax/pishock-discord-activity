import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Client tests only. Server tests run with `node --test` (see `npm test`).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/client/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/client/test-setup.ts'],
    globals: false,
    css: false,
  },
});
