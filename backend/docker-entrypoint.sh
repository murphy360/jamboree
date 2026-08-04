#!/bin/sh
set -eu

DB_PATH="${TILE_HISTORY_DB_PATH:-/app/data/tile_history.db}"
MERGE_ON_STARTUP="${TILE_HISTORY_MERGE_ON_STARTUP:-true}"
MERGE_PATTERN="${TILE_HISTORY_MERGE_PATTERN:-*.bak}"
MERGE_ARCHIVE_DIR="${TILE_HISTORY_MERGE_ARCHIVE_DIR:-merged}"

if [ "${MERGE_ON_STARTUP}" = "true" ]; then
  echo "[entrypoint] Merging backup DB files before startup"
  python -m src.tools.merge_tile_history_backups \
    --db "${DB_PATH}" \
    --pattern "${MERGE_PATTERN}" \
    --archive-dir "${MERGE_ARCHIVE_DIR}"
fi

exec uvicorn src.main:app --host 0.0.0.0 --port 8000
