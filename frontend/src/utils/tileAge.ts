import type { TileLocation } from "../hooks/useTileLocations";

const DEFAULT_ORANGE_AFTER_MINUTES = 60;
const DEFAULT_RED_AFTER_MINUTES = 360;

export type AgeBandConfig = {
  orangeAfterMinutes: number;
  redAfterMinutes: number;
};

export type TileListEntry = {
  tile: TileLocation;
  ageMs: number;
  ageLabel: string;
  color: string;
};

function parseAgeThreshold(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.floor(parsed));
}

export function getAgeBandConfig(): AgeBandConfig {
  const orangeAfterMinutes = parseAgeThreshold(
    import.meta.env.VITE_TILE_AGE_ORANGE_MINUTES,
    DEFAULT_ORANGE_AFTER_MINUTES,
  );
  const redAfterMinutes = Math.max(
    orangeAfterMinutes + 1,
    parseAgeThreshold(import.meta.env.VITE_TILE_AGE_RED_MINUTES, DEFAULT_RED_AFTER_MINUTES),
  );

  return { orangeAfterMinutes, redAfterMinutes };
}

export function getTileTimestamp(tile: TileLocation): string | null | undefined {
  return tile.tile_service_observed_at ?? tile.observed_at ?? tile.polled_at;
}

function getTileAgeMs(value: string | null | undefined, referenceTimeMs: number): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, referenceTimeMs - timestamp);
}

function getTileColor(ageMs: number, config: AgeBandConfig): string {
  if (!Number.isFinite(ageMs)) {
    return "#dc2626";
  }

  const ageMinutes = Math.floor(ageMs / 60_000);
  if (ageMinutes >= config.redAfterMinutes) {
    return "#dc2626";
  }

  if (ageMinutes >= config.orangeAfterMinutes) {
    return "#f97316";
  }

  return "#2563eb";
}

export function formatAge(value: string | null | undefined, referenceTimeMs: number): string {
  if (!value) {
    return "Unknown";
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "Unknown";
  }

  const elapsedMs = referenceTimeMs - timestamp;
  if (elapsedMs <= -60_000) {
    return formatFutureAge(elapsedMs);
  }

  if (Math.abs(elapsedMs) < 60_000) {
    return "Just now";
  }

  return formatPastAge(elapsedMs);
}

function formatFutureAge(elapsedMs: number): string {
  const futureMinutes = Math.floor(Math.abs(elapsedMs) / 60_000);
  if (futureMinutes < 60) {
    return `In ${futureMinutes} min`;
  }

  const futureHours = Math.floor(futureMinutes / 60);
  const remMinutes = futureMinutes % 60;
  return remMinutes > 0 ? `In ${futureHours} hr ${remMinutes} min` : `In ${futureHours} hr`;
}

function formatPastAge(elapsedMs: number): string {
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes} min ago`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours < 24) {
    return minutes > 0 ? `${hours} hr ${minutes} min ago` : `${hours} hr ago`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days} d ${remainingHours} hr ago` : `${days} d ago`;
}

function formatCompactAge(value: string | null | undefined, referenceTimeMs: number): string {
  if (!value) {
    return "Unknown";
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "Unknown";
  }

  const ageMs = referenceTimeMs - timestamp;
  if (ageMs < 60_000) {
    return "Now";
  }

  const totalMinutes = Math.floor(ageMs / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    return `${totalHours}hr`;
  }

  const totalDays = Math.floor(totalHours / 24);
  return `${totalDays}d`;
}

export function buildSortedTileEntries(
  locations: TileLocation[],
  currentTimeMs: number,
  ageBandConfig: AgeBandConfig,
): TileListEntry[] {
  return [...locations]
    .map((tile) => {
      const timestamp = getTileTimestamp(tile);
      const ageMs = getTileAgeMs(timestamp, currentTimeMs);
      return {
        tile,
        ageMs,
        ageLabel: formatCompactAge(timestamp, currentTimeMs),
        color: getTileColor(ageMs, ageBandConfig),
      };
    })
    .sort((a, b) => {
      if (a.ageMs !== b.ageMs) {
        return b.ageMs - a.ageMs;
      }

      return a.tile.label.localeCompare(b.tile.label);
    });
}

export function buildTileColorMap(entries: TileListEntry[]): Record<string, string> {
  return entries.reduce<Record<string, string>>((acc, entry) => {
    acc[entry.tile.tile_uuid] = entry.color;
    return acc;
  }, {});
}
