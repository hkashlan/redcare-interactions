# Product Interactions

Solution for the Redcare product interactions coding challenge ([challenge.md](challenge.md)).

Monorepo with two services:

| Service | Path | Description |
| --- | --- | --- |
| mock-service | [services/mock-service](services/mock-service) | Provided Java/Spring Boot mock service (external dependency), port 8080 |
| interaction-api | `services/interaction-api` | Interaction API for the frontend widget (TanStack Start, TypeScript), port 3000 |

> This README is a stub — build/run instructions, API design notes, decisions, and assumptions are added as the implementation progresses.

## Quick start (for now)

Run the mock service:

```bash
cd services/mock-service
./mvnw clean package
./mvnw spring-boot:run
```

Then: `curl 'http://localhost:8080/product?productId=04114918'`
