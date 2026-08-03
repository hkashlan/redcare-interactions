function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid value for ${name}: "${raw}" (expected a positive integer)`);
  }
  return value;
}

export function getConfig() {
  return {
    mockServiceUrl: process.env.MOCK_SERVICE_URL ?? 'http://localhost:8080',
    upstreamTimeoutMs: intFromEnv('UPSTREAM_TIMEOUT_MS', 2000),
    catalogTtlMs: intFromEnv('CATALOG_TTL_MS', 30000),
    productTtlMs: intFromEnv('PRODUCT_TTL_MS', 30000),
  };
}

export type Config = ReturnType<typeof getConfig>;
