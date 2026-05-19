interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_TILE_AGE_ORANGE_MINUTES?: string;
  readonly VITE_TILE_AGE_RED_MINUTES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
