# AGENTS

## Mission
Build and maintain a Docker-first tracking system that overlays Tile location data onto the National Jamboree map.

## Architecture Guardrails
- Keep runtime services in containers; do not require host-level tooling beyond Docker and Docker Compose.
- Keep a clear separation: frontend in `frontend/`, backend in `backend/`.
- Treat Tile API integration as unstable and unofficial. Isolate it in adapter code under `backend/src/services/tile_client.py`.
- Add resilience around Tile API calls: retries, token refresh, and graceful fallback behavior.

## Linting Rules For LLM Output
- Prefer small modules and focused files.
- Backend limits:
  - max module lines: 400 (`backend/.pylintrc`)
  - max function complexity: 10 (`backend/pyproject.toml`)
  - max statements per function: 45
- Frontend limits:
  - max file lines: 300 (`frontend/eslint.config.js`)
  - max function lines: 70
  - max cyclomatic complexity: 8
- If a generated file exceeds these thresholds, split by concern before committing.

## Development Workflow
- Start stack: `docker compose up --build`
- Backend URL: `http://localhost:8000`
- Frontend URL: `http://localhost:5173`
- WebSocket endpoint: `ws://localhost:8000/ws/locations`

## Verification Checklist
- `docker compose build` succeeds for both services.
- Health check returns `200` at `/health`.
- Frontend can connect to WebSocket and render incoming location markers.
- Lint passes in both backend and frontend.

## Where To Extend Next
- ArcGIS basemap integration in frontend map component.
- Persistent geospatial storage and history playback.
- Auth and role-based views for staff versus general observers.
