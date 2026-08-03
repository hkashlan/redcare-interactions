# interaction-api

API-only Nitro service that powers a frontend interaction-warning widget. It accepts a list of product ids, resolves their ingredients from the mock service, matches the interaction catalog against the basket, and returns render-ready warning data.

It is deliberately small: one endpoint, and five source files with one job each.

```
src/routes/api/interactions.get.ts   the endpoint: query schema, error policy, response shape
src/client/mock-service.ts           the upstream: contract, failure modes, cached reads
src/domain/match-interactions.ts     the matching rule — pure, no I/O, no framework
src/util/http.ts                     request ids and JSON responses
src/util/logger.ts                   consola with a JSON reporter

src/routes/api/interactions.get.test.ts
src/client/mock-service.test.ts
src/domain/match-interactions.test.ts
src/test/upstream-server.ts          a real HTTP server speaking the mock service's contract
```

## Requirements

- Node.js 22+
- pnpm (`corepack enable`)
- A running mock service (default `http://localhost:8080`) — see [services/mock-service](../mock-service)

## Run

```bash
pnpm install
pnpm dev            # dev server on http://localhost:3000
```

Production build:

```bash
pnpm build
pnpm start          # runs node .output/server/index.mjs
```

Docker (usually via the root `docker-compose.yml`):

```bash
docker build -t interaction-api .
docker run --rm -p 3000:3000 -e MOCK_SERVICE_URL=http://host.docker.internal:8080 interaction-api
```

## Configuration

Defaults live in [`nitro.config.ts`](nitro.config.ts) under `runtimeConfig` and are read with `useRuntimeConfig()`. Each is overridden from the environment (see [.env.example](.env.example)):

| Variable | Default | Description |
| --- | --- | --- |
| `MOCK_SERVICE_URL` | `http://localhost:8080` | Base URL of the mock service |
| `UPSTREAM_TIMEOUT_MS` | `2000` | Timeout per upstream request |
| `CACHE_TTL_SECONDS` | `30` | How long an upstream read is cached (catalog and ingredient lists) |
| `LOG_LEVEL` | `info` | Minimum severity to emit: `debug`, `info`, `warn` or `error` (case-insensitive; `debug` adds a line per upstream read). An unrecognised value falls back to `info` |

Nitro's own `NITRO_`-prefixed form works too (`NITRO_MOCK_SERVICE_URL`); the plain names above are enabled by emptying `runtimeConfig.nitro.envPrefix`. Environment values arrive as strings, so the two numeric ones are coerced where they are read.

## API

Both contracts are zod schemas: the incoming query in the route file, the upstream responses in `src/client/mock-service.ts`. The query schema validates every request; the upstream schemas make contract drift in the mock service an explicit `502` instead of a silent wrong answer.

### `GET /api/interactions?productIds=<id>,<id>,…`

Returns the interaction warnings applicable to the given basket. `productIds` is a comma-separated list, deduplicated server-side, with up to 100 distinct ids. The parameter may also be repeated — the two forms below are equivalent, and may be mixed:

```bash
curl 'http://localhost:3000/api/interactions?productIds=06313728,04114918'
curl 'http://localhost:3000/api/interactions?productIds=06313728&productIds=04114918'
```

```json
{
  "interactions": [
    {
      "interactionId": "int-warfarin-ibu",
      "texts": [
        "Warfarin and ibuprofen may increase bleeding risk when used together.",
        "A frontend widget should show this as a pair interaction only when both ingredients are present."
      ],
      "involvedProductIds": ["06313728", "04114918"],
      "involvedIngredientIds": ["ing-war-005", "ing-ibu-001"]
    }
  ],
  "meta": {
    "requestedProductIds": ["06313728", "04114918"],
    "unknownProductIds": []
  }
}
```

(Ibuprofen's single-ingredient warnings are also included; the pair entry is shown here for brevity.)

Response semantics:

- `interactions` — one entry per applicable interaction. An interaction applies iff all of its required ingredient ids appear in the union of ingredients across the basket. `texts` are display-ready; `involvedProductIds` names the products that contributed the ingredients.
- `meta.requestedProductIds` — the basket as this service evaluated it: one entry per *distinct* requested id, in first-seen order (a repeated id is collapsed, so this can be shorter than the client's basket).
- `meta.unknownProductIds` — the subset the upstream does not know (partial success, still HTTP 200).

Products appear as ids only. The caller supplied the basket, so it already holds whatever product names it renders; fetching them here would double the upstream reads per request to return data the caller did not ask for. If a consumer ever does need names in this response, `GET /product` is one added read per id behind the same cache.

Error responses share one body shape:

```json
{ "error": { "code": "…", "message": "…", "requestId": "…", "issues": [ { "path": "…", "message": "…" } ] } }
```

| Status | Code | When |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | `productIds` missing, empty, >100 ids, or malformed (`issues` lists details) |
| 502 | `UPSTREAM_UNAVAILABLE` | Mock service errored or timed out — the API fails closed rather than implying "no interactions" |
| 500 | `INTERNAL_ERROR` | Unexpected failure |

Every response echoes the incoming `x-request-id` header (or a generated UUID) both as a response header and in error bodies, and the same id appears in the structured logs.

## Logging

[consola](https://github.com/unjs/consola) with a single reporter that emits one JSON line per event, so logs stay machine-parseable (consola's default formatting wraps objects over several lines, which a collector reads as several records):

```json
{"level":"info","time":"2026-08-03T21:39:51.181Z","message":"interactions request served","requestId":"ce5c595c-…","productCount":2,"interactionCount":4,"unknownCount":0,"durationMs":25}
```

One line per request — served, rejected (`warn`), failed upstream or unexpected (`error`) — plus one per upstream read at `LOG_LEVEL=debug`, which are effectively cache-miss lines.

## Caching

Both upstream reads go through [`defineCachedFunction`](https://nitro.build/guide/cache) from `nitro/cache`, keyed on `catalog` and on the product id, with a 30s TTL. That gives read-through caching, one shared in-flight call when concurrent requests want the same key, and eviction on failure so the next request retries — none of which needs code here.

`swr: false` is load-bearing: under Nitro's default an expired entry plus a failing upstream *resolves with the stale value* and demotes the error to a log line, which would silently invert the fail-closed policy above.

Storage is Nitro's `cache` mount point — in-memory per instance by default, so moving to a shared Redis cache is a `nitro.config.ts` change rather than a code change.

## Development

```bash
pnpm test           # vitest, single run
pnpm test:watch     # vitest in watch mode
pnpm check          # biome lint + format check
pnpm check:fix      # auto-fix
pnpm typecheck      # tsc --noEmit
```

### Debugging (VS Code)

`.vscode/launch.json` at the repo root ships five configurations (F5 → pick one):

| Configuration | What it does |
| --- | --- |
| `interaction-api: dev server` | `pnpm dev` with the debugger attached and `LOG_LEVEL=debug`. The route and the domain rule both run in the vite process, so breakpoints in `src/**` hit on every request |
| `interaction-api: built server` | Runs `pnpm build` first, then `.output/server/index.mjs` — for anything that only reproduces in a production build |
| `interaction-api: all tests` | Whole vitest suite, single-threaded, no test timeout |
| `interaction-api: current test file` | Same, for the `*.test.ts` open in the editor |
| `interaction-api: attach to node (9229)` | Attaches to an already-running `node --inspect` (mapped to `/app` for the container) |

The dev-server configuration needs the mock service on `localhost:8080`; the `mock-service: up` / `mock-service: down` tasks (`docker compose up -d mock-service`) start and stop it.

### Tests

42 tests in three files, with no mocks, stubs, spies or injected doubles anywhere:

| File | What it covers |
| --- | --- |
| `src/domain/match-interactions.test.ts` | the matching rule as a pure function |
| `src/client/mock-service.test.ts` | parsing, `404` vs. failure, contract drift, timeout, caching, no caching of failures |
| `src/routes/api/interactions.get.test.ts` | the endpoint: 200 with `meta`, partial success, every 400 issue path, fail-closed 502, request-id handling |

The two I/O suites run against `src/test/upstream-server.ts` — a real `node:http` server that answers `/interactions` and `/ingredients` like the Java service does. Nothing is injected and `fetch` is untouched, so a real socket, real status codes, real latency and real JSON parsing are all in the path; a test changes the upstream's *behaviour* (`catalog`, `ingredients`, `status`, `delayMs`) rather than swapping an implementation.

The route is driven through `handler.fetch(request)` — the same entry point Nitro uses — with the real `nitro/cache` (emptied between cases) and the real `nitro.config.ts` defaults, repointed at the test server. Because the endpoint's test sits next to the route it tests, `nitro.config.ts` sets `ignore: ['**/*.test.ts']`; without it Nitro scans that file as a route and publishes `/api/interactions.get.test`.

Rationale and the mutation checks used to verify the suite catches regressions: [decision 2](../../docs/decisions.md). End-to-end against the actual mock service: the curls in the [root README](../../README.md).
