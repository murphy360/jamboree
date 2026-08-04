# jamboree

Docker-first tracking platform for National Jamboree operations. The project starts with two core services:

- `backend`: FastAPI service that reads Tile tracker states from Home Assistant and streams live locations over WebSocket.
- `frontend`: React web app that renders live tracker positions on a map.

## Quick Start

1. Create a live env file from the example and set Home Assistant access:

```bash
Copy-Item backend/.env.example backend/.env
```

Optional (if `5173` is already used on your machine), create a root `.env` for Docker Compose:

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
- `TILE_HISTORY_API_DEFAULT_LIMIT` (`0` by default; default `limit` applied to `GET /tiles/{tile_uuid}/history` when query param is omitted)
- `TILE_DETAILS_API_DEFAULT_LIMIT` (`3000` by default; default `history_limit` applied to `GET /tiles/{tile_uuid}/details` when query param is omitted)
- `TILE_LEADERBOARD_HISTORY_POINTS_LIMIT` (`5000` by default; per-tile point cap used by leaderboard computation to keep responses fast)
- `TILE_LEADERBOARD_CACHE_TTL_SECONDS` (`20` by default; backend-maintained in-memory leaderboard cache lifetime)
- `TILE_DWELL_MERGE_RADIUS_METERS` (`50` by default; merges nearby dwell hotspots into one cluster)
- `MYMAPS_IMPORT_ENABLED` (`true` by default; enables Google My Maps KML sync)
- `MYMAPS_KML_URL` (KML feed URL used for imports)
- `MYMAPS_IMPORT_TILE_UUID` (`global` by default)
- `MYMAPS_IMPORT_INTERVAL_SECONDS` (`900` by default; sync interval in seconds)
- `MYMAPS_POLYGON_MERGE_RULES` (`BARR:Barrels,BOWS:Bows` by default; applied automatically after each My Maps sync)

Tile details endpoint supports runtime override for hotspot merge distance:
- `GET /tiles/{tile_uuid}/details?dwell_merge_meters=50`

History-heavy endpoints support runtime point limits:
- `GET /tiles/{tile_uuid}/history?limit=2000`
- `GET /tiles/{tile_uuid}/details?history_limit=2000`

Both responses now include:
- `total_points`: full number of stored points for the tile.
- `returned_points`: number of points returned in the current response.
- `history_truncated`: `true` when limits reduced the returned history.

Remove a tracker and all locally stored history/custom areas:
- `DELETE /tiles/{tile_uuid}`

Google My Maps import behavior:
- Runs automatically on backend startup.
- Re-runs periodically based on `MYMAPS_IMPORT_INTERVAL_SECONDS`.
- Replaces previously imported non-manual geometries while keeping manual areas intact.
- Automatically merges configured prefix groups into canonical polygons after each sync (default: `BARR* -> Barrels`, `BOWS* -> Bows`).

Proxy reliability note:
- Frontend nginx now resolves `backend` through Docker DNS at runtime to prevent stale upstream IP errors after backend container restarts.
- If you ever see transient `502 Bad Gateway` during deploy/restart windows, restart frontend once: `docker compose restart frontend`.

Import-related endpoints:
- `POST /imports/mymaps/sync` triggers an immediate KML sync.
- `GET /map-features?tile_uuid=global` returns imported non-polygon map features (points/lines).

If `HOME_ASSISTANT_TILE_ENTITIES` is empty, backend auto-discovers Tile trackers by scanning `device_tracker.*` entities that include `tile` in entity id or friendly name.

### Tile History Backup Merge Tool

If you rotated history databases to `.bak` files, merge them back into the primary DB with:

```bash
docker compose exec backend python -m src.tools.merge_tile_history_backups --db /app/data/tile_history.db
```

Optional flags:
- `--pattern "*.bak"` to control which backup files are merged.
- `--no-vacuum` to skip final `VACUUM`.

This merge restores both:
- `tile_history` rows
- `custom_areas` rows (named polygons)

Frontend detail-page history fetch size is controlled by:
- `VITE_TILE_DETAILS_HISTORY_LIMIT` (default `3000`)

### Tile History Time-Window Prune Tool

To keep only data within your target time window and delete everything else:

```bash
docker compose exec backend python -m src.tools.prune_tile_history_window --db /app/data/tile_history.db
```

Default keep window is exactly:
- Start: `2026-07-22T06:00:00-04:00`
- End: `2026-07-31T17:00:00-04:00`

Equivalent UTC window used for filtering:
- Start: `2026-07-22T10:00:00+00:00`
- End: `2026-07-31T21:00:00+00:00`

Optional flags:
- `--start <ISO8601>` to override start time.
- `--end <ISO8601>` to override end time.
- `--no-vacuum` to skip final `VACUUM`.

### Merge BARR Polygons Into Barrels

To combine all polygons whose names start with `BARR` into one `Barrels` polygon:

```bash
docker compose exec backend python -m src.tools.merge_barr_polygons --db /app/data/tile_history.db --tile-uuid global
```

Defaults:
- `--source-prefix BARR`
- `--target-name Barrels`

Optional flags:
- `--tile-uuid <value>` to limit the merge scope (recommended: `global`).

2. Start the stack:

```bash
docker compose up --build
```

3. Open the apps:

- Frontend: http://localhost:${FRONTEND_PORT} (default `5173`)
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
- Tile details page includes a Remove tracker action that clears local history and custom areas for that tracker.
- Leaderboard UI supports Daily and Overall rankings for distance and time-in-camp.
