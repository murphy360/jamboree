# jamboree

Docker-first tracking platform for National Jamboree operations. The project starts with two core services:

- `backend`: FastAPI service that reads Tile tracker states from Home Assistant and streams live locations over WebSocket.
- `frontend`: React web app that renders live tracker positions on a map.

## Quick Start

1. Create a live env file from the example and set Home Assistant access:

```bash
Copy-Item backend/.env.example backend/.env
```

Optional (if `8000` is already used on your machine), create root compose overrides:

```bash
Copy-Item .env.example .env
```

Set these values in `backend/.env`:
- `HOME_ASSISTANT_URL` (for your setup: `http://192.168.68.82:8123`)
- `HOME_ASSISTANT_TOKEN` (Long-Lived Access Token)
- `HOME_ASSISTANT_TILE_ENTITIES` (optional comma-separated filter, e.g. `device_tracker.tile_keys,device_tracker.tile_daypack`)
- `HOME_ASSISTANT_EXCLUDE_ENTITIES` (optional comma-separated entity IDs to ignore, e.g. `device_tracker.corey_s_s25_ultra`)
- `HOME_ASSISTANT_REQUIRE_HASH` (`true` by default; only includes trackers with `#` in name/identifier fields)
- `TILE_HISTORY_DB_PATH` (`/app/data/tile_history.db` by default; persisted to `backend/data` via Docker volume)
- `TILE_HISTORY_MAX_POINTS_PER_TILE` (`0` by default for unlimited retention; set a positive value to cap stored points per tile)
- `TILE_DWELL_MERGE_RADIUS_METERS` (`50` by default; merges nearby dwell hotspots into one cluster)

Tile details endpoint supports runtime override for hotspot merge distance:
- `GET /tiles/{tile_uuid}/details?dwell_merge_meters=50`

If `HOME_ASSISTANT_TILE_ENTITIES` is empty, backend auto-discovers Tile trackers by scanning `device_tracker.*` entities that include `tile` in entity id or friendly name.

2. Start the stack:

```bash
docker compose up --build
```

3. Open the apps:

- Frontend: http://localhost:5173
- Backend health: http://localhost:8086/health

## Leaderboard

The app includes Daily and Overall leaderboard views for two metrics:

- Most distance traveled.
- Most time spent in custom areas with `camp` in the area name.
- Most time spent in custom areas named for patch trading (for example, `Patch Trading`).

API endpoint:

- `GET /leaderboard` for overall rankings.
- `GET /leaderboard?date=YYYY-MM-DD` for a daily leaderboard.

Examples:

```bash
curl http://localhost:8086/leaderboard
curl "http://localhost:8086/leaderboard?date=2026-05-21"
```

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
- Home Assistant tracker client and polling worker scaffolded.
- WebSocket endpoint (`/ws/locations`) implemented.
- React map UI with live WebSocket updates implemented.
- ArcGIS layers integrated into the frontend map.
- Tile details page includes history, dwell clusters, and custom area management.
- Leaderboard UI supports Daily and Overall rankings for distance and time-in-camp.
