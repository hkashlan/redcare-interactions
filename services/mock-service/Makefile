.PHONY: help package build build-buildkit start stop logs clean

IMAGE_NAME=product-interactions
CONTAINER_NAME=product-interactions
PORT=8080

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

package: ## Build the jar with Maven
	./mvnw clean package

build: ## Build the Docker image with BuildKit
	docker build -t $(IMAGE_NAME) .

build-legacy: ## Build the Docker image without buildkit
	DOCKER_BUILDKIT=0 docker build -t $(IMAGE_NAME) .

start: ## Start the container on localhost:8080
	docker run --rm -d --name $(CONTAINER_NAME) -p $(PORT):8080 $(IMAGE_NAME)

stop: ## Stop the running container
	docker stop $(CONTAINER_NAME)

logs: ## Tail container logs
	docker logs -f $(CONTAINER_NAME)

clean: ## Remove Maven target folder
	./mvnw clean
