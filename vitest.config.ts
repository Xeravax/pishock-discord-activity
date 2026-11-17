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
    coverage: {
      provider: 'v8',
      include: ['src/client/**/*.{ts,tsx}'],
      exclude: ['src/client/**/*.test.{ts,tsx}', 'src/client/vendor/**', 'src/client/test-setup.ts'],
      // json-summary feeds the CI job summary; text-summary prints in the log.
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage/client',
    },
  },
});
