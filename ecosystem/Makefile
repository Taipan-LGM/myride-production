.PHONY: help dev api redis up down up-prod down-prod test smoke admin urls flutter-rider flutter-driver

help:
	@echo "My Ride SA ecosystem"
	@echo "  make dev          - Redis (docker) + API"
	@echo "  make api          - FastAPI only"
	@echo "  make test         - AI + unit tests"
	@echo "  make smoke        - HTTP smoke (API must be up)"
	@echo "  make up / down    - docker compose (dev)"
	@echo "  make up-prod      - docker compose.prod.yml (needs backend/.env.prod)"
	@echo "  make admin        - print dashboard URL"
	@echo "  make urls         - all local URLs"
	@echo "  make flutter-rider / flutter-driver"

dev: redis
	@$(MAKE) -C backend run

api:
	@$(MAKE) -C backend run

redis:
	@cd backend && docker compose up -d redis 2>/dev/null || true

up:
	@command -v docker >/dev/null || { echo "Docker not installed. Use: make api"; exit 1; }
	@cd backend && docker compose up --build -d

down:
	@command -v docker >/dev/null || { echo "Docker not installed."; exit 1; }
	@cd backend && docker compose down

up-prod:
	@command -v docker >/dev/null || { echo "Docker not installed."; exit 1; }
	@test -f backend/.env.prod || { echo "Create backend/.env.prod from .env.prod.example"; exit 1; }
	@cd backend && docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build

down-prod:
	@command -v docker >/dev/null || { echo "Docker not installed."; exit 1; }
	@cd backend && docker compose -f docker-compose.prod.yml --env-file .env.prod down

test:
	@$(MAKE) -C backend test

smoke:
	@$(MAKE) -C backend smoke

admin:
	@echo "http://127.0.0.1:8000/admin"

urls:
	@echo "Admin dashboard:  http://127.0.0.1:8000/admin"
	@echo "API docs:         http://127.0.0.1:8000/docs"
	@echo "Health:           http://127.0.0.1:8000/health"
	@echo "Metrics JSON:     http://127.0.0.1:8000/admin/metrics"
	@echo "Rider (Flutter):  http://127.0.0.1:8766  (make flutter-rider)"
	@echo "Driver (Flutter): http://127.0.0.1:8767  (make flutter-driver)"

flutter-rider:
	@./run-rider.sh

flutter-driver:
	@./run-driver.sh
