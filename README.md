# Product Interactions

Solution for the Redcare product interactions coding challenge ([challenge.md](challenge.md)): a small backend-for-frontend that accepts a list of product ids and returns everything a shop widget needs to render interaction warnings, using the provided Java mock service as its external data source.

## Repository layout

| Path | Description |
| --- | --- |
| [services/mock-service](services/mock-service) | Provided Java/Spring Boot mock service (treated as an external dependency), port 8080 |
| [services/interaction-api](services/interaction-api) | **The solution**: interaction API for the frontend widget (TypeScript, TanStack Start, API-only), port 3000 |
| [docs/architecture.md](docs/architecture.md) | Component and request-flow diagrams |
| [docs/decisions.md](docs/decisions.md) | Design decisions, tradeoffs, assumptions, production notes |

## Prerequisites

- **Docker** (with Compose) — enough to run everything.
- For local development only: **Java 21** (mock service) and **Node.js 22+** with **pnpm** (interaction-api; `corepack enable` provides pnpm).

## Quickstart

```bash
docker compose up --build
```

This builds and starts both services: `mock-service` on <http://localhost:8080> and `interaction-api` on <http://localhost:3000>. When both are up:

```bash
curl 'http://localhost:3000/api/interactions?productIds=04114918,10019621'
```

returns (abridged):

```json
{
  "interactions": [
    {
      "interactionId": "int-ibu-asa",
      "texts": [
        "Ibuprofen and acetylsalicylic acid are both NSAID-related pain medicines and may increase gastrointestinal irritation.",
        "Combining NSAIDs can increase the risk of serious side effects such as stomach ulcers."
      ],
      "involvedProductIds": ["04114918", "10019621"],
      "involvedIngredientIds": ["ing-ibu-001", "ing-asa-002"]
    }
  ],
  "meta": {
    "requestedProductIds": ["04114918", "10019621"],
    "unknownProductIds": []
  }
}
```

More calls to try:

```bash
curl 'http://localhost:3000/api/interactions?productIds=06313728,04114918'  # warfarin + ibuprofen pair warning
curl 'http://localhost:3000/api/interactions?productIds=99999999'           # product with no ingredients → no warnings
curl 'http://localhost:3000/api/interactions?productIds=04114918,00000000'  # unknown id → partial success (200)
curl 'http://localhost:3000/api/interactions'                               # missing parameter → 400
curl 'http://localhost:3000/api/health'                                     # liveness probe
```

To see the fail-closed behaviour: `docker compose stop mock-service`, then repeat the first curl — the API answers `502` with code `UPSTREAM_UNAVAILABLE` instead of pretending there are no interactions.

## Local development (without Compose)

Terminal 1 — mock service:

```bash
cd services/mock-service
./mvnw spring-boot:run          # serves on :8080
```

Terminal 2 — interaction API:

```bash
cd services/interaction-api
pnpm install
pnpm dev                        # serves on :3000, talks to localhost:8080
```

Tests and checks (from `services/interaction-api`): `pnpm test`, `pnpm check` (Biome), `pnpm typecheck`.

## API design in short

One endpoint serves the widget: `GET /api/interactions?productIds=a,b,c`.

- **Interaction-centric response** — one entry per applicable interaction, so the widget renders one warning card per entry without joining data client-side. Each entry carries the display `texts`, plus `involvedProductIds`/`involvedIngredientIds` so a card can say *which* products clash.
- **Products by id only** — the caller supplied the basket, so it already has whatever names it renders. Fetching product metadata here would double the upstream reads per request to return data nobody asked for; this endpoint answers one question — *what interacts?*
- **Matching rule** — an interaction applies iff *all* of its required ingredient ids are present in the union of ingredients across the requested products.
- **Error semantics (the key healthcare-domain judgment call):**
  - Unknown product id (upstream 404) → **partial success** (200): the id is listed in `meta.unknownProductIds`, but warnings for the rest of the basket are still returned. One delisted product must not suppress everyone else's warnings.
  - Upstream failure or timeout → **fail closed** (502): if ingredients are unknowable, the API must not imply "no interactions".
  - Invalid input → 400 with per-field issues.
- **Diagnosability** — structured JSON logs, an `x-request-id` honoured or generated and echoed on every response, `GET /api/health`.

Full API reference: [services/interaction-api/README.md](services/interaction-api/README.md). Rationale and tradeoffs: [docs/decisions.md](docs/decisions.md).

## Notes for reviewers

- The service is written in TypeScript — the challenge allows any technology, and I chose the stack I'm most fluent in. The design itself is language-agnostic: thin handlers → service → pure domain module → typed client.
- Upstream reads go through a per-instance read-through fetch cache with short TTLs (TTL, concurrent-fetch dedup, no caching of failures — no dependency). Safe with multiple instances; a distributed cache is a production step, not a requirement here.
- The core matching logic is a pure function with no I/O, unit-tested in isolation; client, service, and handlers each have their own test seams (all developed test-first).
- Assumptions and "what I'd do next in production" are listed in [docs/decisions.md](docs/decisions.md).
