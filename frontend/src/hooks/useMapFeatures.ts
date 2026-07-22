import { useEffect, useMemo, useState } from "react";

export type ImportedMapPoint = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  folderName: string | null;
};

type RawMapFeature = {
  id?: string;
  name?: string;
  folder_name?: string | null;
  geometry_type?: string;
  geometry?: {
    coordinates?: number[];
  };
};

function isHumanReadableName(name: string): boolean {
  const normalized = name.trim();
  if (!normalized) {
    return false;
  }

  const lower = normalized.toLowerCase();
  if (lower.startsWith("feature")) {
    return false;
  }

  const hasLetter = /[a-z]/i.test(normalized);
  const digitsOnly = /^\d+$/.test(normalized);
  return hasLetter && !digitsOnly;
}

export function useMapFeatures(baseUrl: string, tileUuid = "global") {
  const [points, setPoints] = useState<ImportedMapPoint[]>([]);

  const normalizedBaseUrl = useMemo(
    () => baseUrl.trim().replace(/\/$/, ""),
    [baseUrl],
  );

  useEffect(() => {
    if (!normalizedBaseUrl) {
      setPoints([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(
          `${normalizedBaseUrl}/map-features?tile_uuid=${encodeURIComponent(tileUuid)}`,
        );
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as RawMapFeature[];
        if (!Array.isArray(payload)) {
          return;
        }

        const parsed = payload
          .filter((item) => item.geometry_type === "Point")
          .map((item) => {
            const coords = item.geometry?.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) {
              return null;
            }

            const longitude = Number(coords[0]);
            const latitude = Number(coords[1]);
            if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
              return null;
            }

            return {
              id: item.id ?? `${item.name ?? "unknown"}-${latitude}-${longitude}`,
              name: item.name ?? "Unnamed Point",
              latitude,
              longitude,
              folderName: item.folder_name ?? null,
            } satisfies ImportedMapPoint;
          })
          .filter((item): item is ImportedMapPoint => item !== null)
          .filter((item) => isHumanReadableName(item.name));

        if (!cancelled) {
          setPoints(parsed);
        }
      } catch {
        if (!cancelled) {
          setPoints([]);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [normalizedBaseUrl, tileUuid]);

  return { points };
}
