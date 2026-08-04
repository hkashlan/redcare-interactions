import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so tests run without the Nitro plugin.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
