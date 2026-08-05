from __future__ import annotations

import sqlite3

from src.tools.reset_polygon_data import reset_polygon_data


def test_reset_polygon_data_clears_polygon_tables_but_preserves_history(tmp_path) -> None:
    db_path = tmp_path / "tile_history.db"

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE tile_history (
                tile_uuid TEXT NOT NULL,
                label TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                observed_at TEXT NOT NULL,
                observed_at_second TEXT NOT NULL,
                PRIMARY KEY (tile_uuid, observed_at_second)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE custom_areas (
                area_id TEXT PRIMARY KEY,
                tile_uuid TEXT NOT NULL,
                name TEXT NOT NULL,
                polygon_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                source_type TEXT NOT NULL DEFAULT 'manual',
                source_name TEXT,
                source_url TEXT,
                source_feature_id TEXT
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE map_features (
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
        connection.execute(
            """
            CREATE TABLE custom_area_merge_events (
                event_id TEXT PRIMARY KEY,
                tile_uuid TEXT NOT NULL,
                merge_into_area_id TEXT NOT NULL,
                target_before_json TEXT NOT NULL,
                source_areas_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                undone_at TEXT
            )
            """
        )
        connection.execute(
            "INSERT INTO tile_history VALUES (?, ?, ?, ?, ?, ?)",
            ("tile-1", "Tracker", 38.0, -81.0, "2026-08-01T00:00:00+00:00", "2026-08-01T00:00:00+00:00"),
        )
        connection.execute(
            "INSERT INTO custom_areas VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("area-1", "global", "Area", "[]", "2026-08-01T00:00:00+00:00", "2026-08-01T00:00:00+00:00", "manual", None, None, None),
        )
        connection.execute(
            "INSERT INTO map_features VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ("feature-1", "global", "Feature", None, "Polygon", "{}", "2026-08-01T00:00:00+00:00", "2026-08-01T00:00:00+00:00", "manual", None, None, None),
        )
        connection.execute(
            "INSERT INTO custom_area_merge_events VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("event-1", "global", "area-1", "{}", "[]", "2026-08-01T00:00:00+00:00", None),
        )
        connection.commit()

    stats = reset_polygon_data(db_path, run_vacuum=False)

    assert stats.custom_area_rows_deleted == 1
    assert stats.map_feature_rows_deleted == 1
    assert stats.merge_event_rows_deleted == 1

    with sqlite3.connect(db_path) as connection:
        history_count = connection.execute("SELECT COUNT(*) FROM tile_history").fetchone()[0]
        custom_area_count = connection.execute("SELECT COUNT(*) FROM custom_areas").fetchone()[0]
        map_feature_count = connection.execute("SELECT COUNT(*) FROM map_features").fetchone()[0]
        merge_event_count = connection.execute("SELECT COUNT(*) FROM custom_area_merge_events").fetchone()[0]

    assert history_count == 1
    assert custom_area_count == 0
    assert map_feature_count == 0
    assert merge_event_count == 0