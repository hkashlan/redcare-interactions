import { defineConfig } from 'nitro/config';

export default defineConfig({
  // `serverDir` points at src/, so Nitro scans src/routes/ for file-based routes.
  // Everything else under src/ is plain modules the route files import — Nitro
  // only scans routes/, middleware/ and plugins/.
  serverDir: 'src',

  // Without this, src/routes/api/interactions.get.test.ts is scanned as a route:
  // the build publishes `/api/interactions.get.test` and pulls vitest into the
  // production server bundle.
  ignore: ['**/*.test.ts'],

  /**
   * Defaults for every environment-dependent value, read back with
   * `useRuntimeConfig()`. Declaring them here means the defaults are visible in
   * one place instead of scattered across `process.env.X ?? fallback` reads.
   *
   * Nitro overrides each key from the environment, snake-cased and uppercased:
   * `NITRO_MOCK_SERVICE_URL` — and, because `envPrefix` is emptied, the plain
   * `MOCK_SERVICE_URL` that docker-compose.yml and .env.example already use.
   */
  runtimeConfig: {
    nitro: { envPrefix: '' },
    mockServiceUrl: 'http://localhost:8080',
    upstreamTimeoutMs: 2000,
    cacheTtlSeconds: 30,
    logLevel: 'info',
  },
  experimental: {
    openAPI: true,
  },

  openAPI: {
    // Disabling the Scalar UI unregisters `/_scalar`, which is also what takes
    // it out of the generated document. `swagger: false` does the same for
    // `/_swagger`, which is left on as the one browsable view of the API.
    ui: { scalar: false },
    production: 'runtime',
  },

  /**
   * Nitro's dev preset registers `/_nitro/tasks/**` for the tasks API. This
   * service has no tasks, and that route is what puts `/_nitro/` into the
   * generated OpenAPI document: the document is built from the registered
   * handlers, so dropping the handler drops the documented path with it.
   */
  modules: [
    (nitro) => {
      nitro.options.handlers = nitro.options.handlers.filter(
        (handler) => !handler.route.startsWith('/_nitro/'),
      );
    },
  ],
});
