import { defineConfig } from 'nitro';

// `serverDir` points at src/, so Nitro scans src/routes/ for file-based routes.
// Everything else under src/ (clients, domain, server) is plain modules the
// route files import — Nitro only scans routes/, middleware/ and plugins/.
export default defineConfig({
  serverDir: 'src',
});
