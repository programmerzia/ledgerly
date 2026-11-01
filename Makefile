COMPOSE = docker compose -f docker/compose.yaml

.PHONY: up up-app down test test-backend lint types

up:
	$(COMPOSE) up -d --wait

# Full stack (php-fpm, nginx, minio, clamav) on top of the base services; build the SPA first (npm run build).
up-app:
	$(COMPOSE) --profile app up -d --build

down:
	$(COMPOSE) --profile app down

test: test-backend
	cd frontend && npm test

test-backend:
	cd backend && composer test

lint:
	cd backend && vendor/bin/pint --test && vendor/bin/phpstan analyse --memory-limit=1G
	cd frontend && npm run lint

# OpenAPI from code (Scramble) → TS types. openapi-typescript runs as a pinned, isolated tool with its
# own TypeScript 5: it has no TypeScript 7 release and must not change the app's compiler (Decision log).
OPENAPI_TS = npx --yes -p typescript@5.9 -p openapi-typescript@7.13.0 openapi-typescript

types:
	mkdir -p docs/api frontend/src/api
	cd backend && php artisan scramble:export --path=../docs/api/openapi.json --fail-on-unknown
	$(OPENAPI_TS) docs/api/openapi.json -o frontend/src/api/schema.d.ts
