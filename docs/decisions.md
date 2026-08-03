# Design decisions

Each entry says what I decided, why, and what I gave up. Roughly in build order: tooling, then structure, then the API, then operations.

## 1. Biome for formatting and linting

Set up before any code, so every file follows the same rules. One tool and one config file replace ESLint + Prettier, and also sort imports (`pnpm check` / `pnpm check:fix`). It is fast enough to run on save. `vcs.useIgnoreFile` reuses `.gitignore`, so generated files like `routeTree.gen.ts` are skipped.

*Tradeoff:* fewer rules than ESLint, and no type-aware linting — `tsc --noEmit` in `pnpm typecheck` covers that instead.

## 2. TypeScript + TanStack Start

The challenge allows any stack, so I picked the one I'm fastest in and spent the time on design and edge cases. The structure (handlers → service → domain → HTTP client) does not depend on the framework.

*Tradeoff:* not Redcare's Java stack. The design is the part that transfers, not the language.

## 3. Layered modules, each with its own `.dto.ts`

Calls go one way, and each layer only knows the one below it: route → handler → service → cache → client → mock-service. Each layer has one job. Handlers speak HTTP. The service orchestrates and owns the error policy. `matchInteractions()` is a pure function with no I/O. The client is the only module that knows the upstream exists. Errors cross layers as types (`ProductNotFoundError`, `UpstreamError`), not status codes, so nothing above the client looks at an HTTP response.

*Tradeoff:* more files, and a little jumping around to read one feature end to end. It pays off in testing (see 12) and keeps upstream changes inside one layer.

## 4. Zod schemas as the single source of truth

Query, response, and upstream bodies are all zod schemas, and every type is inferred from them instead of written twice. They are used differently on each side of the trust boundary:

- **Inbound** — every request is `safeParse`d, so bad input is rejected with per-field issues before any upstream call.
- **Upstream** — responses are parsed at the boundary, so a changed contract becomes a clear `UpstreamError` instead of an `undefined` deep in the matching code.
- **Outbound** — our own responses are typed but not re-validated at runtime. `InteractionsResponseBody` is inferred from the schema, so the compiler catches a bad reply at build time and we skip validating data we just built.

*Tradeoff:* the contract is written in prose, not published as a spec. Generating one from these schemas (e.g. `zod-openapi`) is the obvious next step if a consumer wants a typed client.

## 5. `GET /api/interactions?productIds=a,b` (comma-separated)

GET because the call only reads and can be repeated safely: responses are cacheable, and the URL can be shared or bookmarked. It also mirrors the real shop URL (`/wechselwirkungen/?productIds=…`).

*Tradeoff:* URL length limits basket size (capped at 100 ids). A `POST` variant would handle very large baskets.

## 6. Interaction-centric response, products referenced by id only

The response matches the widget's render loop: one `interactions[]` entry per warning card, with the display `texts` and `involvedProductIds`/`involvedIngredientIds` so a card can point at the products that clash.

Products come back as ids, without names or descriptions. An earlier version called `GET /product` for each id and included the name, on the idea that a BFF should save the widget a call. That does not apply here: the caller sent us the basket, so it already has the product data it renders — the ids came from a cart or product page that already loaded them. We would have paid one extra upstream read per product to return data the caller already had. Dropping it halves the upstream reads (2N + 1 → N + 1), removes a round of fan-out from the critical path, removes a failure point, and leaves the endpoint answering one question: *what interacts?*

Unknown ids are still caught: `GET /ingredients` returns its own 404 for an id the upstream does not know, which is the same fact the product read used to give us. Without `name`, a `products[]` array would only hold `{productId, status}` — already derivable from `meta.requestedProductIds` and `meta.unknownProductIds` — so it was dropped instead of kept as a duplicate.

*Tradeoff:* a consumer that has ids but no names (an email renderer, a support tool) needs its own product lookup — one extra read per id, behind the same cache, if that ever comes up. Either way, this shape serves this widget rather than being a generic interactions resource.

## 7. Partial success for unknown products, fail closed for upstream failures

The main healthcare call, and deliberately not symmetric:

- **Upstream 404 for a product id** is a *fact* (delisted, or a typo). The id goes into `meta.unknownProductIds` and warnings for the rest of the basket are still returned (HTTP 200). One dead id must not hide a real warfarin–ibuprofen warning.
- **Upstream 5xx or timeout** means we *don't know*. If ingredients are unavailable, an empty list would read as "no interactions", which is dangerous here. The API returns 502 with a `requestId` so the frontend can show "warnings temporarily unavailable".

*Tradeoff:* the frontend has to check `meta.unknownProductIds`. All-or-nothing would be simpler but unsafe.

## 8. Per-instance read-through cache (TanStack Query core) with short TTLs

Upstream data can change without a deploy, so the cache is TTL-based (30 s by default, env-tunable) rather than load-once. `@tanstack/query-core` (no React) gives exactly what is needed: `staleTime` as the TTL, dedup of concurrent fetches for the same key, and no caching of failures. `retry` is off so upstream errors fail closed straight away.

*Tradeoff:* with N instances, worst case is N cache misses per TTL window, and instances can disagree for up to one TTL. Fine here; see production notes for a shared cache.

## 9. Hand-rolled structured logger

A ~25-line JSON-lines logger keeps dependencies low and still gives parseable logs with request ids. In production this would be pino (redaction, levels from config, transports).

## 10. `x-request-id` to correlate requests across services

Every response carries an `x-request-id`. The handler reuses the incoming header if the caller (the widget, or the shop's edge) already set one, and generates a UUID otherwise. One id then links the widget's request, our log lines, and the error the user saw. It goes into the response header, every error body (`error.requestId`), and the request log line — so a support ticket quoting an id is enough to find that exact request, including which products were in the basket and whether the upstream failed.

An incoming id is only accepted if it matches `/^[\w.:-]{1,128}$/`. Anything longer, or containing newlines or control characters, is replaced with a fresh one, so a caller cannot forge or shape our logs and headers. `/api/health` echoes an id too but is not logged, keeping probe traffic out of the logs.

*Tradeoff:* this is correlation, not tracing. The id stops at this service — the client does not forward it upstream, and there are no spans, so a request cannot be followed *into* the mock service. Forwarding the header is a small change; doing it properly means W3C `traceparent` and OpenTelemetry (see production notes).

## 11. Configuration through environment variables, defaults tuned for development

Everything that differs between a laptop and a deployment — upstream base URL, request timeout, both cache TTLs, log level — is read from the environment (`src/config.ts`, plus `LOG_LEVEL` in the logger) and documented in `.env.example`. Every variable has a working default, so `pnpm dev` runs with no setup: `MOCK_SERVICE_URL` falls back to `http://localhost:8080`, where the mock service listens locally.

Deployments override only what they need. `docker-compose.yml` sets `MOCK_SERVICE_URL=http://mock-service:8080` because the compose hostname replaces `localhost`; timeouts and TTLs keep their defaults. The `Dockerfile` bakes in nothing beyond `NODE_ENV=production`, so the same image runs everywhere and changing a timeout never needs a rebuild.

Numbers are parsed and checked on read: a non-integer or non-positive value throws with the variable's name instead of quietly becoming `NaN`. Config is read once at the composition root (`getInteractionsHandler`) and the resolved values are logged there, so a misconfigured deployment shows up in the logs.

*Tradeoff:* because config is read lazily, a bad value appears on the first request instead of at startup. Reading it at boot would fail faster, but would make module import order matter in tests.

## 12. Tests at every seam, none needing a server

The layering in decision 3 exists so each layer can be tested against a fake of the one below it. The whole suite runs in-process on vitest:

- **Domain** — `matchInteractions()` is called with plain arrays. The matching rule, involvement mapping, and edge cases (empty ingredient lists, one product carrying both ingredients) are covered with no client at all.
- **Service** — driven with a fake `MockServiceClient`, the only practical way to assert the interesting behaviour: a 404 for one product giving partial success, an `UpstreamError` propagating, the cache deduplicating repeated reads.
- **Client** — `fetch` is stubbed, so the tests cover what this layer owns: exact URLs and query encoding, zod parsing, and 404 vs 5xx becoming `ProductNotFoundError` vs `UpstreamError`.
- **Handlers** — a fake `InteractionService` and a real `Request`, asserting status codes, error bodies, id parsing (repeated and comma-separated parameters, dedup, the 100-id cap), and the `x-request-id` echo.

*Tradeoff:* with fakes everywhere, nothing proves the real client and the real mock service agree — the upstream contract is only checked by zod at runtime. A contract test against the mock service's `openapi.yml` is the gap to close.

## 13. Monorepo layout, one command to run both services

The mock service moved to `services/mock-service/` and the new service sits next to it in `services/interaction-api/`, each with its own `Dockerfile` and toolchain (Maven, pnpm) rather than a shared build system. `docker-compose up` builds and runs both and wires them together, so a reviewer needs neither Java nor Node installed.

*Tradeoff:* the vendored mock service can drift from the original. It is treated as read-only and left unmodified for that reason.

## Assumptions

- **The widget already has the product name and description.** It rendered the basket before calling us, so the endpoint neither fetches nor returns them (see decision 6). Cards are matched back to products client-side by id.
- **Matching rule:** an interaction applies when *all* of its `requiredIngredientIds` are present across the requested products. So one product containing both ingredients also triggers the warning — the combination is present either way.
- Excipients shared across products (e.g. `ing-exc-010`) trigger nothing unless the catalog lists them. The catalog is the only authority on what interacts.
- The interaction catalog is small enough to fetch and scan whole, and product and ingredient ids are stable across upstream endpoints.
- A product with no ingredients (e.g. `99999999`) is valid and simply matches nothing.
- The API is an internal BFF behind the shop's edge, so auth, rate limiting, and CORS are handled there.
- Interaction `texts` are display-ready and already translated upstream.

## What I would do next in production

- **Resilience:** retries with backoff and jitter for upstream reads, a circuit breaker around the client, and stale-while-revalidate during short upstream blips.
- **Caching at scale:** a shared cache (e.g. Redis), or upstream ETag / `Cache-Control` support, once instance count or data size grows.
- **Observability:** metrics (request rate, latency, error rate, cache hit ratio, upstream latency), pino, and turning the correlation id of decision 10 into real tracing with W3C `traceparent` and OpenTelemetry.
- **Contracts:** consumer-driven contract tests against the upstream spec, and a published machine-readable contract for our own consumers.
- **API evolution:** a `POST` variant for large baskets, and severity levels on interactions if the data ever provides them.
