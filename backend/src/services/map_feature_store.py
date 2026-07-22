from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock

from src.services.models import MapFeature


class MapFeatureStore:
    """Stores non-polygon imported map features like points and lines."""

    def __init__(self, db_path: str) -> None:
        self._lock = Lock()
        db_file = Path(db_path)
        db_file.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(str(db_file), check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS map_features (
                    id TEXT PRIMARY KEY,
                    tile_uuid TEXT NOT NULL,
                    name TEXT NOT NULL,
                    folder_name TEXT,
                    geometry_type TEXT NOT NULL,
                    geometry_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    source_name TEXT,
                    source_url TEXT,
                    source_feature_id TEXT
                )
                """
            )
            self._connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_map_features_tile
                ON map_features (tile_uuid)
                """
            )
            self._connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_map_features_source
                ON map_features (source_type, source_url, source_feature_id)
                """
            )
            self._connection.commit()

    def list_features(self, tile_uuid: str) -> list[MapFeature]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT id, tile_uuid, name, folder_name, geometry_type, geometry_json,
                       created_at, updated_at, source_type, source_name, source_url, source_feature_id
                FROM map_features
                WHERE tile_uuid = ?
                ORDER BY folder_name ASC, name ASC
                """,
                (tile_uuid,),
            ).fetchall()
        return [self._row_to_feature(row) for row in rows]

    def replace_source_features(
        self,
        tile_uuid: str,
        source_type: str,
        source_url: str,
        features: list[MapFeature],
    ) -> int:
        now = datetime.now(UTC).isoformat()
        with self._lock:
            self._connection.execute(
                """
                DELETE FROM map_features
                WHERE tile_uuid = ? AND source_type = ? AND source_url = ?
                """,
                (tile_uuid, source_type, source_url),
            )

            for feature in features:
                self._connection.execute(
                    """
                    INSERT INTO map_features
                        (id, tile_uuid, name, folder_name, geometry_type, geometry_json,
                         created_at, updated_at, source_type, source_name, source_url, source_feature_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        feature.id or str(uuid.uuid4()),
                        tile_uuid,
                        feature.name,
                        feature.folder_name,
                        feature.geometry_type,
                        json.dumps(feature.geometry),
                        now,
                        now,
                        source_type,
                        feature.source_name,
                        source_url,
                        feature.source_feature_id,
                    ),
                )

            self._connection.commit()
        return len(features)

    def delete_non_manual_features(self, tile_uuid: str) -> int:
        with self._lock:
            cursor = self._connection.execute(
                """
                DELETE FROM map_features
                WHERE tile_uuid = ? AND COALESCE(source_type, 'manual') != 'manual'
                """,
                (tile_uuid,),
            )
            self._connection.commit()
        return cursor.rowcount

    def _row_to_feature(self, row: sqlite3.Row) -> MapFeature:
        return MapFeature(
            id=row["id"],
            tile_uuid=row["tile_uuid"],
            name=row["name"],
            folder_name=row["folder_name"],
            geometry_type=row["geometry_type"],
            geometry=json.loads(row["geometry_json"]),
            source_type=row["source_type"],
            source_name=row["source_name"],
            source_url=row["source_url"],
            source_feature_id=row["source_feature_id"],
        )
