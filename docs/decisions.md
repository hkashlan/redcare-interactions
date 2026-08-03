# Design decisions

ADR-lite: each entry states the decision, why, and the tradeoff accepted. They are ordered roughly as the project was built — tooling first, then structure, then the API contract and its behaviour, then the operational concerns.

## 1. Biome for formatting and linting

The first thing set up, before any application code, so that every file since has been written under the same rules. A single tool covers formatting, linting, and import sorting (`pnpm check` / `pnpm check:fix`), replacing the usual ESLint + Prettier pair with one dependency and one config file. It is fast enough to run on every save without a watch process, and `vcs.useIgnoreFile` keeps it aligned with `.gitignore` so generated files like `routeTree.gen.ts` stay out of both the formatter and the linter.

*Tradeoff:* Biome's rule set is narrower than ESLint's plugin ecosystem, and there is no type-aware linting — `tsc --noEmit` covers that separately in `pnpm typecheck`. For a service this size the simplicity is worth more than the extra rules.

## 2. TypeScript + TanStack Start

The challenge allows any technology; I chose the stack I'm most productive in so the available time went into design and edge cases rather than tooling. The architecture (thin handlers → orchestration service → pure domain module → typed HTTP client) is framework-agnostic.

*Tradeoff:* diverges from Redcare's Java-first stack; the design, not the language, is the transferable part.

## 3. Layered modules, each with its own `.dto.ts`

The call chain runs in one direction and every layer knows only the one below it: route file → handler → service → cache → client → mock-service. Each layer has a single job — handlers speak HTTP, the service orchestrates and owns the error policy, `matchInteractions()` is a pure function with no I/O, and the client is the only module that knows the upstream exists. Errors cross the boundary as types (`ProductNotFoundError`, `UpstreamError`), not status codes, so no layer above the client inspects an HTTP response.

Layers are wired by *interface*, not by import of a concrete implementation: `createInteractionService(client, options)` takes a `MockServiceClient`, `createInteractionsHandler(service)` takes an `InteractionService`, and the real chain is assembled once in a composition root (`getInteractionsHandler`). Swapping the mock service for the real product API is a change to one file.

Those interfaces and the data they carry live in a sibling `*.dto.ts` next to each module (`domain/match-interactions.dto.ts`, `server/interaction-service.dto.ts`), re-exported from the module itself with `export type * from './x.dto'`. So the contract of a layer can be read on one screen without its implementation, while consumers still import from the module (`./interaction-service`) and never need to know the split. The dto files hold types only — no runtime code, no imports back into their own layer — which keeps them free of import cycles.

*Tradeoff:* more files than one route handler with `fetch` calls inlined, and a small indirection cost when reading a feature end to end. It pays for itself in testability (see 13) and in confining upstream changes to a single layer.

## 4. Plain `(Request) => Response` handlers behind thin route files

Handlers are plain functions over the web-standard `Request`/`Response`, so integration tests construct `Request` objects directly — no server, no port, fast tests. Route files only wire handlers into TanStack Start, keeping the framework at the edge.

## 5. Zod schemas as the single source of truth

Query, response, and upstream bodies are all zod schemas, and every TypeScript type is inferred from them rather than declared twice. They earn their keep differently depending on which side of the trust boundary they sit:

- **Inbound** — the query schema `safeParse`s every request, so malformed input is rejected with per-field issues before any upstream call.
- **Upstream** — client responses are parsed at the trust boundary, so a contract drift becomes an explicit `UpstreamError` rather than an `undefined` deep in the matching logic.
- **Outbound** — our own responses are typed, not re-validated at runtime: `InteractionsResponseBody` is inferred from the schema, so the compiler rejects a malformed reply at build time and we skip the per-request cost of validating data we just constructed.

*Tradeoff:* the contract is documented in prose rather than published as a machine-readable spec. Deriving one from these same schemas (e.g. with `zod-openapi`) is a natural next step if a consumer wants to generate a typed client.

## 6. `GET /api/interactions?productIds=a,b` (comma-separated)

GET because the operation is read-only and idempotent: responses are cacheable by intermediaries, and the URL is deep-linkable/shareable — mirroring the real shop URL pattern (`/wechselwirkungen/?productIds=…`).

*Tradeoff:* URL length bounds the basket size (capped at 100 ids). A `POST` variant with a JSON body would be the extension for very large baskets.

## 7. Interaction-centric response with inlined product names

The response is shaped for the widget's render loop: one `interactions[]` entry per warning card, with display `texts` plus `involvedProductIds`/`involvedIngredientIds` so a card can name the clashing products. `products[]` inlines the display names so the widget makes exactly one call.

*Tradeoff:* the shape serves this widget rather than being a generic interactions resource; a second consumer with different needs might warrant a different projection.

## 8. Partial success for unknown products, fail closed for upstream failures

The central healthcare-domain judgment call, deliberately asymmetric:

- **Upstream 404 for a product id** is a *data fact* (delisted/typo). The id is reported with `status: "unknown"` and in `meta.unknownProductIds`, while warnings for the rest of the basket are still returned (HTTP 200). One dead id must not suppress a real warfarin–ibuprofen warning for the other products.
- **Upstream 5xx/timeout** is *ignorance*, not a fact. If ingredients are unknowable, returning an empty list would imply "no interactions" — dangerous in this domain. The API returns 502 with a `requestId` and lets the frontend show "warnings temporarily unavailable".

*Tradeoff:* partial success requires the frontend to check `meta.unknownProductIds`; the alternative (all-or-nothing) is simpler but unsafe.

## 9. Per-instance read-through cache (TanStack Query core) with short TTLs

Upstream data can change independently of deployments, so caching is TTL-based (30 s defaults, env-tunable) rather than load-once. `@tanstack/query-core` (no React) provides exactly the needed primitives: `staleTime` as TTL, dedup of concurrent fetches for the same key, and no caching of failures. `retry` is disabled so upstream errors fail closed immediately.

*Tradeoff:* with N instances, worst case is N cache misses per TTL window and instances can briefly disagree (bounded by the TTL). Acceptable here; see production notes for the distributed option.

## 10. Hand-rolled structured logger

A ~25-line JSON-lines logger keeps the challenge dependency-light while still producing machine-parseable logs with request ids. In production this would be pino (redaction, levels from config, transports).

## 11. `x-request-id` as the correlation id between services

Every response carries an `x-request-id`. The handler honours the incoming header when the caller (the widget, or the shop's edge in front of it) already set one and generates a UUID otherwise, so one id ties the widget's request, this service's log lines, and the error the user was shown together. The id goes into the response header, into every error body (`error.requestId`), and into the request log line — so a support ticket quoting an id is enough to find the exact request, including *which* products were in the basket and whether the upstream failed.

An incoming id is honoured only if it matches `/^[\w.:-]{1,128}$/`; anything longer, or carrying newlines or control characters, is replaced by a fresh id. A caller must not be able to shape or forge our log lines and response headers with an id it chose. `/api/health` echoes an id too, but is deliberately not logged, so probe traffic stays out of the logs.

*Tradeoff:* this is correlation, not distributed tracing. The id currently stops at this service — the mock-service client does not forward it upstream, and there are no spans or parent/child relationships, so a request cannot be followed *into* the mock service. Forwarding the header on outgoing fetches is a small change; doing it properly means adopting W3C `traceparent` and OpenTelemetry (see production notes), at which point the id becomes part of a real trace rather than a per-service convention.

## 12. Configuration through environment variables, defaults tuned for development

Everything that differs between a laptop and a deployed environment — the upstream base URL, the request timeout, both cache TTLs, and the log level — is read from the environment (`src/config.ts`, plus `LOG_LEVEL` in the logger) and documented in `.env.example`. Each variable has a working default, so `pnpm dev` runs with no setup at all: `MOCK_SERVICE_URL` falls back to `http://localhost:8080`, which is where the mock service listens locally.

Deployments override only what they need. `docker-compose.yml` sets `MOCK_SERVICE_URL=http://mock-service:8080` because the compose-network hostname replaces `localhost`; the timeouts and TTLs keep their defaults unless a given environment wants to tune them. Nothing is baked into the `Dockerfile` beyond `NODE_ENV=production`, so the same image runs unchanged in every environment and a timeout change never requires a rebuild.

Numeric values are parsed and validated on read: a non-integer or non-positive value throws with the variable's name rather than silently degrading to `NaN`. Config is read once at the composition root (`getInteractionsHandler`) and the resolved values are logged as it initializes, so a misconfigured deployment is visible in the logs — on the first `/api/interactions` request rather than at process start, which is the flip side of building the chain lazily.

*Tradeoff:* because config is read lazily rather than at import time, an invalid value surfaces on the first request instead of at process start. Validating eagerly at boot would fail faster, at the cost of making the module import-order sensitive in tests.

## 13. Tests at every seam, none of them needing a server

The layering of decision 3 exists so each layer can be tested against a fake of the one below it, and the whole suite runs in-process on vitest:

- **Domain** — `matchInteractions()` is called with plain arrays; the matching rule, involvement mapping, and edge cases (empty ingredient lists, single product carrying both ingredients) are covered without any client at all.
- **Service** — driven with a fake `MockServiceClient`, which is the only practical way to assert the interesting behaviour: a 404 for one product yielding partial success, an `UpstreamError` propagating, caching deduplicating repeated reads.
- **Client** — `fetch` is stubbed, so the assertions are about what this layer owns: the exact URLs and query encoding, zod parsing of the bodies, and 404 vs 5xx becoming `ProductNotFoundError` vs `UpstreamError`.
- **Handlers** — given a fake `InteractionService` and a real `Request` object, asserting status codes, error bodies, id parsing (repeated and comma-separated parameters, dedup, the 100-id cap), and the `x-request-id` echo.

*Tradeoff:* stubs and fakes mean nothing in the suite proves the real client and the real mock-service agree — the upstream contract is pinned only by zod parsing at runtime. A contract test against the mock service's `openapi.yml` is the gap to close (see production notes).

## 14. Monorepo layout, one command to run both services

The mock service was moved into `services/mock-service/` and the new service sits beside it in `services/interaction-api/`, each with its own `Dockerfile` and its own toolchain (Maven, pnpm) rather than a shared build system. `docker-compose up` builds and runs both, wiring them over the compose network, so a reviewer needs neither Java nor Node installed locally to see the thing work.

*Tradeoff:* keeping the vendored mock service in the repo means it can drift from the upstream original; it is treated as read-only and unmodified for exactly that reason.

## Assumptions

- **Matching rule:** an interaction applies iff *all* of its `requiredIngredientIds` appear in the union of ingredients across the requested products. Consequently a single product containing both ingredients of a pair also triggers the warning (defensible: the combination is present).
- Excipients shared across products (e.g. `ing-exc-010`) trigger nothing unless the catalog lists them — the catalog is the sole authority on what interacts.
- The interaction catalog is small enough to fetch and scan whole; product and ingredient ids are stable across the upstream endpoints.
- A product with an empty ingredient list (e.g. `99999999`) is valid and simply matches nothing.
- The API is an internal BFF behind the shop's edge: authentication, rate limiting, and CORS are handled there and are out of scope here.
- Interaction `texts` are display-ready and already localized upstream.

## What I would do next in production

- **Resilience:** retries with backoff + jitter for idempotent upstream reads, a circuit breaker around the mock-service client, stale-while-revalidate serving during brief upstream blips.
- **Caching at scale:** a shared cache tier (e.g. Redis) or upstream ETag/`Cache-Control` support once instance count or data size grows.
- **Observability:** metrics (request rate/latency/error rate, cache hit ratio, upstream latency), pino, and turning the `x-request-id` correlation of decision 11 into real distributed tracing — propagating W3C `traceparent` on the outgoing fetches under OpenTelemetry.
- **Contracts:** consumer-driven contract tests against the upstream spec, and a published machine-readable contract for this API's own consumers.
- **API evolution:** a `POST` variant for large baskets; severity levels on interactions if the data source ever provides them.
