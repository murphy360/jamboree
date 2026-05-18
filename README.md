# jamboree

Docker-first tracking platform for National Jamboree operations. The project starts with two core services:

- `backend`: FastAPI service that integrates with Tile APIs and streams live locations over WebSocket.
- `frontend`: React web app that renders live tracker positions on a map.

## Quick Start

1. Create a live env file from the example and set Tile credentials:

```bash
Copy-Item backend/.env.example backend/.env
```

Optional (if `8000` is already used on your machine), create root compose overrides:

```bash
Copy-Item .env.example .env
```

Set these values in `backend/.env`:
- `TILE_EMAIL`
- `TILE_PASSWORD`

2. Start the stack:

```bash
docker compose up --build
```

3. Open the apps:

- Frontend: http://localhost:5173
- Backend health: http://localhost:18000/health (or your `BACKEND_HOST_PORT` value)

## Linting Rules

Linting is tuned for LLM-driven development and explicitly prevents large, god-class/god-file code.

- Backend (`ruff` + `pylint`): complexity and module-length limits.
- Frontend (`eslint`): complexity, file-length, and function-length limits.

Run linters:

```bash
# backend (inside container)
docker compose exec backend python -m pip install -r requirements-dev.txt
docker compose exec backend ruff check src
docker compose exec backend pylint src

# frontend (inside container)
docker compose exec frontend npm run lint
```

## Current Status

- FastAPI health endpoint implemented.
- Tile client adapter and polling worker scaffolded.
- WebSocket endpoint (`/ws/locations`) implemented.
- React map UI scaffolded with live WebSocket updates.

ArcGIS base map overlay integration is the next major implementation step.
