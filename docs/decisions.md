# Design decisions

What I decided, why, and what I gave up. Roughly in build order: tooling, then structure, then the API, then operations.

## 1. Biome for formatting and linting

Set up before any code, so every file follows the same rules. One tool and one config file replace ESLint + Prettier, and it also sorts imports (`pnpm check` / `pnpm check:fix`). It is fast enough to run on save. `vcs.useIgnoreFile` reuses `.gitignore`, so build output is skipped.

*Tradeoff:* fewer rules than ESLint, and no type-aware linting — `pnpm typecheck` (`tsc --noEmit`) covers that instead.

## 2. Keep it simple: modules by subject, not layers

One endpoint, five source files. Each file is named after the thing it owns, not after its place in a stack:

| File | Owns |
| --- | --- |
| `src/routes/api/interactions.get.ts` | the endpoint — query schema, error policy, response shape |
| `src/client/mock-service.ts` | the upstream — contract, timeout, cached reads, `UpstreamError` |
| `src/domain/match-interactions.ts` | the business rule — pure, no I/O |
| `src/util/http.ts` | request ids and JSON responses |
| `src/util/logger.ts` | consola with a JSON reporter |

The route file reads top to bottom as one request: parse the query, read the catalog and the basket, match, answer. Anything that is not about this endpoint — how a request id is validated, how a JSON body is framed, how the upstream is read — sits behind a named import. So the handler is 60 lines of policy instead of 150 lines of policy mixed with plumbing.

There are no interfaces, no factories and no injection. A module that exports two functions has no seam to configure or to mock; the route just imports it by name. A file is separate because it owns a different subject: the client is its own file because it is the only code that knows the upstream exists.

Five files does not mean less proof. The tests check that the code does what it should, not how it is wired: the matching rule is called directly as a pure function, and the client and the endpoint run against a real `node:http` server that speaks the upstream contract — real sockets, real status codes, real timeouts, real JSON. Nothing is mocked, so nothing has to exist only to be mocked. The suite was checked by breaking the code on purpose (dropping the 100-id cap, the request-id guard, the timeout, the `404 → unknown product` rule, the fail-closed 502); all eleven breaks were caught.

*Tradeoff:* `util/` is the kind of folder that collects unrelated code later. It has to stay two named, single-purpose modules.

## 3. TypeScript on Nitro

The challenge allows any stack, so I picked the one I am fastest in and spent the time on design and edge cases. Nitro rather than a full-stack framework because this service renders nothing: file-based routes, a build that outputs a plain `node .output/server/index.mjs`, and a caching primitive (see 9) — no React, no router, no client bundle for an API that only returns JSON.

It also stays small and portable: **three runtime dependencies** — `nitro`, `zod`, `consola` — and the same code builds for a Node container or for **serverless** (Vercel, Cloudflare, AWS Lambda) by changing the build preset, not the code.

*Tradeoff:* not Redcare's Java stack. The design is the part that transfers, not the language.

## 4. Mermaid diagrams in the docs

`docs/architecture.md` has three diagrams, each answering a different question:

- **System overview** (flowchart) — which module calls which, so the file layout above is visible before reading any code.
- **Interaction matching** (flowchart) — the domain rule with real mock data (warfarin + ibuprofen), including the cases that do *not* match.
- **Request flow** (sequence diagram) — one request end to end, with the parallel reads and all three outcomes (400, partial success, 502) in one picture.

Mermaid instead of exported images because the diagrams live next to the text, render on GitHub and in most IDEs, and change in a normal diff. A wrong arrow is fixed in a pull request, not in a drawing tool.

*Tradeoff:* they are written by hand, so they can go stale. Nothing in CI checks that they still match the code.

## 5. Zod schemas as the single source of truth

Query, response and upstream bodies are zod schemas, and every type is inferred from them instead of written twice. They are used differently on each side of the trust boundary:

- **Inbound** — every request is `safeParse`d, so bad input is rejected with per-field issues before any upstream call.
- **Upstream** — responses are parsed at the boundary, so a changed contract becomes a clear `UpstreamError` instead of an `undefined` deep in the matching code.
- **Outbound** — our own responses are not re-validated at runtime. They are built from `matchInteractions()`'s return type, so the compiler already catches a malformed reply at build time.

## 6. `GET /api/interactions?productIds=a,b` (comma-separated)

GET because the call only reads and can be repeated safely: responses are cacheable, and the URL can be shared or bookmarked. It also mirrors the real shop URL (`/wechselwirkungen/?productIds=…`).

*Tradeoff:* URL length limits basket size (capped at 100 ids). A `POST` variant would handle very large baskets.

## 7. Interaction-centric response, products referenced by id only

The response matches the widget's render loop: one `interactions[]` entry per warning card, with the display `texts` and `involvedProductIds` / `involvedIngredientIds` so a card can point at the products that clash.

Products come back as ids, without names or descriptions. The caller sent us the basket, so it already has the product data it renders — the ids came from a cart or a product page that loaded them. Fetching names would cost one extra upstream read per product to return data the caller already has. Leaving them out halves the upstream reads (2N + 1 → N + 1), removes a round of fan-out from the critical path, removes a failure point, and keeps the endpoint answering one question: *what interacts?*

Unknown ids are still caught: `GET /ingredients` returns its own 404 for an id the upstream does not know. Without `name`, a `products[]` array would only hold `{productId, status}`, which is already derivable from `meta.requestedProductIds` and `meta.unknownProductIds`.

*Tradeoff:* a caller that has ids but no names (an email renderer, a support tool) has to look them up itself — one extra read per id, behind the same cache. This shape serves the widget, not every possible caller.

## 8. Partial success for unknown products, fail closed for upstream failures

The main healthcare call, and deliberately not symmetric:

- **Upstream 404 for a product id** is a *fact* (delisted, or a typo). The id goes into `meta.unknownProductIds` and warnings for the rest of the basket are still returned (HTTP 200). One dead id must not hide a real warfarin–ibuprofen warning.
- **Upstream 5xx or timeout** means we *do not know*. An empty list would read as "no interactions", which is dangerous here. The API returns 502 with a `requestId` so the frontend can show "warnings temporarily unavailable".

In code this is the difference between `read()` returning `null` and throwing `UpstreamError` — a 404 is the only upstream status that becomes data.

*Tradeoff:* the frontend has to check `meta.unknownProductIds`. All-or-nothing would be simpler but unsafe.

## 9. Caching delegated to `nitro/cache`

Upstream data can change without a deploy, so caching is TTL-based (30 s) rather than load-once. Both reads are wrapped in `defineCachedFunction`, keyed on `catalog` and on the product id. Nitro already gives the three rules that matter: serve a fresh entry, share one in-flight call between callers asking for the same key, and drop the entry on rejection so a failure is never cached.

Two options are load-bearing:

- **`swr: false`.** With Nitro's default, an expired entry plus a failing upstream *resolves with the stale value* and turns the error into a log line — and with `staleMaxAge` unset, there is no bound on how stale. That silently inverts decision 8: the endpoint would answer 200 with old data exactly when it cannot verify anything. Off, the request waits for a fresh value or fails closed.
- **404 caches as `null`.** An unknown product is a stable fact, so it is worth caching; only real failures must not be.

*Tradeoff:* storage is Nitro's `cache` mount point, in memory per instance by default — with N instances the worst case is N misses per TTL window, and instances can disagree for up to one TTL. Fine here, and moving to shared Redis is a `nitro.config.ts` change, not a code change. Retry, backoff and a circuit breaker are still missing (see production notes).

## 10. consola with a JSON reporter

Logging is [consola](https://github.com/unjs/consola), the unjs logger Nitro already ships, so it adds nothing to the bundle and brings levels, `LOG_LEVEL` filtering and the call sites for free.

It gets one reporter, which prints `{level, time, message, ...fields}` as a single line. Consola's default formatting is built for humans at a terminal and wraps an object across several lines — a log collector reads each of those as a separate record, which loses the request id from every line but the first. Six lines of reporter buy back one record per event.

*Tradeoff:* in production this would be pino, or whatever the platform already collects, with redaction and transports. What matters here is that the log shape is a choice, not a default.

## 11. `x-request-id` to correlate requests across services

Every response carries an `x-request-id`. The handler reuses the incoming header if the caller (the widget, or the shop's edge) already set one, and generates a UUID otherwise. One id then links the widget's request, our log lines and the error the user saw. It goes into the response header, every error body (`error.requestId`) and the request log line — so a support ticket quoting an id is enough to find that exact request, including which products were in the basket and whether the upstream failed.

An incoming id is accepted only if it matches `/^[\w.:-]{1,128}$/`. Anything longer, or containing newlines or control characters, is replaced with a fresh one, so a caller cannot forge or shape our logs and headers.

*Tradeoff:* this is correlation, not tracing. The id stops at this service — it is not forwarded upstream and there are no spans, so a request cannot be followed *into* the mock service. Doing it properly means W3C `traceparent` and OpenTelemetry (see production notes).

## 12. Configuration through Nitro's `runtimeConfig`

Everything that differs between a laptop and a deployment — upstream base URL, request timeout, cache TTL, log level — is declared with its default in `nitro.config.ts` under `runtimeConfig`, and read with `useRuntimeConfig()` by whichever module needs it. Nitro overlays each key from the environment, so the defaults and the list of what is configurable live in one place instead of being spread across `process.env.X ?? fallback` reads.

Every value has a working default, so `pnpm dev` runs with no setup: `MOCK_SERVICE_URL` falls back to `http://localhost:8080`, where the mock service listens locally. Deployments override only what they need — `docker-compose.yml` sets just `MOCK_SERVICE_URL`, because the compose hostname replaces `localhost`. The `Dockerfile` bakes in nothing beyond `NODE_ENV=production`, so the same image runs everywhere and changing a timeout never needs a rebuild.

`runtimeConfig.nitro.envPrefix` is emptied so the plain names (`MOCK_SERVICE_URL`, `LOG_LEVEL`) work alongside Nitro's `NITRO_`-prefixed form. Without it, only `NITRO_MOCK_SERVICE_URL` would be read and the compose variable would be silently ignored — a failure that looks like a working deployment pointed at the wrong host.

*Tradeoff:* environment overrides arrive as strings whatever the declared default's type is, so the two numeric values are coerced where they are used. `UPSTREAM_TIMEOUT_MS=abc` becomes `NaN` and every upstream read fails, instead of being rejected at startup. Validating the resolved config once with a zod schema would close that.

## 13. Monorepo layout, one command to run both services

The mock service moved to `services/mock-service/` and the new service sits next to it in `services/interaction-api/`, each with its own `Dockerfile` and toolchain (Maven, pnpm) rather than a shared build system. `docker compose up` builds and runs both and wires them together, so a reviewer needs neither Java nor Node installed.

*Tradeoff:* the vendored mock service can drift from the original. It is treated as read-only and left unmodified for that reason.

## 14. A published OpenAPI document, declared next to the route

A consumer should be able to generate a client instead of copying a README. Nitro already builds an OpenAPI 3.1 document and serves Swagger UI behind `experimental.openAPI`, so this costs one config flag and one metadata block — no extra dependency, no separate spec file to keep in sync.

The operation is declared in the route file it describes, so the endpoint and its docs change in the same diff. The `productIds` parameter comes from the same `productIdSchema` the handler validates with, so the per-id rules are written once.

It is served in production too (`openAPI.production: 'runtime'`), since decision 8 assumes an internal BFF behind the shop's edge. For a public deployment, remove one line.

*Tradeoff:* Nitro's `defineRouteMeta()` macro does not work on `nitro@3.0.260610-beta` — the metadata is silently dropped. The route attaches it to the exported handler instead, and documents how to revert once a stable release fixes the macro. Also, only the query parameter comes from a schema; the four response bodies are described in prose, so the document explains the endpoint but will not generate response types (see decision 5).

## Assumptions

- **The widget already has the product name and description.** It rendered the basket before calling us, so the endpoint neither fetches nor returns them (see decision 7). Cards are matched back to products client-side by id.
- **Matching rule:** an interaction applies when *all* of its `requiredIngredientIds` are present across the requested products. So one product containing both ingredients also triggers the warning — the combination is present either way.
- Excipients shared across products (e.g. `ing-exc-010`) trigger nothing unless the catalog lists them. The catalog is the only authority on what interacts.
- The interaction catalog is small enough to fetch and scan whole, and product and ingredient ids are stable across upstream endpoints.
- A product with no ingredients (e.g. `99999999`) is valid and simply matches nothing.
- The API is an internal BFF behind the shop's edge, so auth, rate limiting and CORS are handled there.
- Interaction `texts` are display-ready and already translated upstream.

## What I would do next in production

- **Health endpoint:** a `GET /health` the container and load balancer can call to see if the service is up.
- **Error tracking:** send exceptions to a collector like Sentry or PostHog, so failures are seen without reading logs.
- **Releases:** semantic-release, so versions and changelogs come from the commits instead of by hand.
- **Resilience:** retry failed upstream reads with backoff, add a circuit breaker, and allow a *bounded* stale window (`swr: true` with an explicit `staleMaxAge`) so a short blip is absorbed without the unbounded staleness decision 9 rules out.
- **Caching at scale:** point Nitro's `cache` mount at a shared store (e.g. Redis) in `nitro.config.ts`, or use upstream ETag / `Cache-Control`, once instance count or data size grows.
- **Observability:** metrics (request rate, latency, error rate, cache hit ratio, upstream latency), and tracing with OpenTelemetry — pass the W3C `traceparent` header on to the mock service, so one request can be followed across both services instead of only correlated by id here (see decision 11).
- **Tests:** a contract test generated from the upstream `openapi.yml`, so the test server cannot drift from the real one; and a smoke test in CI that runs `docker compose up` and repeats the root README's curls against the actual Java service.
- **Response schemas in the spec:** give the response bodies zod schemas so the published document (decision 14) generates response types, not just request ones — and assert in CI that `/_openapi.json` still describes the operation, which would have caught the Nitro regression that decision documents.
- **API evolution:** a `POST` variant for large baskets, and severity levels on interactions if the data ever provides them.
