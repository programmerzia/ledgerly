COMPOSE = docker compose -f docker/compose.yaml

.PHONY: up down test test-backend lint types

up:
	$(COMPOSE) up -d --wait

down:
	$(COMPOSE) down

test: test-backend
	cd frontend && npm test

test-backend:
	cd backend && composer test

lint:
	cd backend && vendor/bin/pint --test && vendor/bin/phpstan analyse --memory-limit=1G

types:
	@echo "make types: wired in plan step 0.4 (Scramble → openapi-typescript)"
