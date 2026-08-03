import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

// Nitro options live in nitro.config.ts.
export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [nitro()],
});
