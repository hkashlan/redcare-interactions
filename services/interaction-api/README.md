# interaction-api

API-only TanStack Start service that powers a frontend interaction-warning widget. It accepts a list of product ids, resolves product names and ingredients from the mock service, matches the interaction catalog against the basket, and returns render-ready warning data.

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

All configuration is via environment variables (see [.env.example](.env.example)):

| Variable | Default | Description |
| --- | --- | --- |
| `MOCK_SERVICE_URL` | `http://localhost:8080` | Base URL of the mock service |
| `UPSTREAM_TIMEOUT_MS` | `2000` | Timeout per upstream request |
| `CATALOG_TTL_MS` | `30000` | In-memory cache TTL for the interaction catalog |
| `PRODUCT_TTL_MS` | `30000` | In-memory cache TTL for product metadata and ingredients |
| `LOG_LEVEL` | `info` | Minimum severity to emit: `debug`, `info`, `warn` or `error` (case-insensitive; `debug` adds a line per upstream read). An unrecognised value falls back to `info` |

## API

The contract is defined by the zod schemas in `src/server/schemas.ts`: the query schema validates every incoming request, and the response schemas are the source of the TypeScript types the handlers build their replies from.

### `GET /api/interactions?productIds=<id>,<id>,…`

Returns the interaction warnings applicable to the given basket. `productIds` is a comma-separated list, deduplicated server-side, with up to 100 distinct ids. The parameter may also be repeated — the two forms below are equivalent, and may be mixed:

```bash
curl 'http://localhost:3000/api/interactions?productIds=06313728,04114918'
curl 'http://localhost:3000/api/interactions?productIds=06313728&productIds=04114918'
```

```json
{
  "products": [
    { "productId": "06313728", "status": "resolved", "name": "Warfarin 5" },
    { "productId": "04114918", "status": "resolved", "name": "Ibuprofen 400" }
  ],
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

- `products` — one entry per *distinct* requested id, in first-seen order (a repeated id is collapsed, so this can be shorter than the client's basket). `status: "resolved"` entries carry the display `name`; ids the upstream does not know come back as `status: "unknown"`.
- `interactions` — one entry per applicable interaction. An interaction applies iff all of its required ingredient ids appear in the union of ingredients across the basket. `texts` are display-ready; `involvedProductIds` names the products that contributed the ingredients.
- `meta.unknownProductIds` — ids that could not be resolved (partial success, still HTTP 200).

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

### `GET /api/health`

Liveness probe. Returns `200` with `{ "status": "ok" }`.

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
| `interaction-api: dev server` | `pnpm dev` with the debugger attached and `LOG_LEVEL=debug`. Handlers, service, client and domain all run in the vite process, so breakpoints in `src/**` hit on every request |
| `interaction-api: built server` | Runs `pnpm build` first, then `.output/server/index.mjs` — for anything that only reproduces in a production build |
| `interaction-api: all tests` | Whole vitest suite, single-threaded, no test timeout |
| `interaction-api: current test file` | Same, for the `*.test.ts` open in the editor |
| `interaction-api: attach to node (9229)` | Attaches to an already-running `node --inspect` (mapped to `/app` for the container) |

The dev-server configuration needs the mock service on `localhost:8080`; the `mock-service: up` / `mock-service: down` tasks (`docker compose up -d mock-service`) start and stop it.

Code map:

- `src/domain/match-interactions.ts` — pure matching rule, no I/O
- `src/clients/mock-service.ts` — typed fetch client (zod-parsed, timeouts, typed errors)
- `src/server/interaction-service.ts` — orchestration: parallel fetches, cache, error policy
- `src/server/handlers/` — plain `(Request) => Response` handlers (testable without a server)
- `src/routes/api/` — TanStack Start route files that only wire handlers in
- `src/server/schemas.ts` — zod schemas; the response schema doubles as the public contract
