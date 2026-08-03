# Product Interactions

Small Java service that exposes three mock endpoints for a coding challenge.

For the candidate task and system context, see [challenge.md](challenge.md).

## Requirements

- Java 21
- Docker

The project includes the Maven Wrapper, so a local Maven installation is not required.

Optional:

- Make on UNIX-like systems if you prefer the Makefile shortcuts

## Run locally

Using the Maven Wrapper:

```bash
./mvnw clean package
./mvnw spring-boot:run
```

On Windows:

```powershell
.\mvnw.cmd clean package
.\mvnw.cmd spring-boot:run
```

Using Make:

```bash
make clean package
./mvnw spring-boot:run
```

## Run in Docker

Using the Maven Wrapper:

```bash
./mvnw -Pdocker-build validate
./mvnw -Pdocker-start validate
```

On Windows:

```powershell
.\mvnw.cmd -Pdocker-build validate
.\mvnw.cmd -Pdocker-start validate
```

Using Make:

```bash
make build
make start
```

The service listens on `http://localhost:8080`.

Useful Docker commands:

Using the Maven Wrapper:

```bash
./mvnw -Pdocker-stop validate
./mvnw -Pdocker-logs validate
```

On Windows:

```powershell
.\mvnw.cmd -Pdocker-stop validate
.\mvnw.cmd -Pdocker-logs validate
```

Using Make:

```bash
make stop
make logs
```

## API

The service exposes:

- `GET /product?productId={productId}` for product metadata.
- `GET /ingredients?productId={productId}` for product ingredient ids.
- `GET /interactions` for interaction data.

The OpenAPI contract is available in [openapi.yml](openapi.yml).
