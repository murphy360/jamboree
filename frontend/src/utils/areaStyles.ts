import type { PathOptions } from "leaflet";

const HEALTH_CENTER_NAME_RE = /health\s*center/i;

const AREA_PALETTE: PathOptions[] = [
  { color: "#0f766e", fillColor: "#14b8a6", weight: 2, opacity: 0.9, fillOpacity: 0.14 },
  { color: "#1d4ed8", fillColor: "#60a5fa", weight: 2, opacity: 0.9, fillOpacity: 0.14 },
  { color: "#7c3aed", fillColor: "#a78bfa", weight: 2, opacity: 0.9, fillOpacity: 0.14 },
  { color: "#b45309", fillColor: "#f59e0b", weight: 2, opacity: 0.9, fillOpacity: 0.14 },
  { color: "#15803d", fillColor: "#4ade80", weight: 2, opacity: 0.9, fillOpacity: 0.14 },
  { color: "#be185d", fillColor: "#f472b6", weight: 2, opacity: 0.9, fillOpacity: 0.14 },
  { color: "#0e7490", fillColor: "#22d3ee", weight: 2, opacity: 0.9, fillOpacity: 0.14 },
  { color: "#334155", fillColor: "#94a3b8", weight: 2, opacity: 0.9, fillOpacity: 0.14 },
  { color: "#7c2d12", fillColor: "#fb923c", weight: 2, opacity: 0.9, fillOpacity: 0.14 },
  { color: "#4c1d95", fillColor: "#c4b5fd", weight: 2, opacity: 0.9, fillOpacity: 0.14 },
];

function hashName(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function getAreaPolygonStyle(name: string): PathOptions {
  if (HEALTH_CENTER_NAME_RE.test(name)) {
    return {
      color: "#b91c1c",
      fillColor: "#f87171",
      weight: 2,
      opacity: 0.95,
      fillOpacity: 0.18,
    };
  }

  const normalizedName = name.trim().toLowerCase();
  const paletteIndex = normalizedName ? hashName(normalizedName) % AREA_PALETTE.length : 0;
  return AREA_PALETTE[paletteIndex];
}