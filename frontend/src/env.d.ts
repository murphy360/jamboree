interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_TILE_AGE_ORANGE_MINUTES?: string;
  readonly VITE_TILE_AGE_RED_MINUTES?: string;
  readonly VITE_TILE_HISTORY_LIMIT?: string;
  readonly VITE_TILE_DETAILS_HISTORY_LIMIT?: string;
  readonly VITE_TILE_HISTORY_INITIAL_BATCH?: string;
  readonly VITE_TILE_DETAILS_INITIAL_BATCH?: string;
  readonly VITE_TILE_HISTORY_DEDUPE_TOLERANCE_METERS?: string;
  readonly VITE_TILE_DETAILS_DEDUPE_TOLERANCE_METERS?: string;
  readonly VITE_DWELL_MERGE_RADIUS_METERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "leaflet-draw/dist/leaflet.draw.css";
