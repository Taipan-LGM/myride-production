.PHONY: install run dev docker-up docker-down smoke test

install:
	@test -f .env || cp .env.example .env
	@command -v uv >/dev/null && uv venv .venv && uv pip install -r requirements.txt \
		|| (python3 -m venv .venv && .venv/bin/pip install -r requirements.txt)

run: install
	@./start_api.sh

dev: install
	@DEBUG=true .venv/bin/python run.py

docker-up:
	@test -f .env || cp .env.example .env
	docker compose up --build -d

docker-down:
	docker compose down

smoke:
	@chmod +x scripts/smoke_test.sh
	@./scripts/smoke_test.sh

test:
	@.venv/bin/pip install -q pytest pytest-asyncio >/dev/null 2>&1 || true
	@.venv/bin/python -m pytest tests/ai -q
