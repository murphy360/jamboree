import { useCallback, useMemo } from "react";
import type { AreaPolygonPoint } from "./useTileDetails";

type UseCustomAreasOptions = {
  baseUrl: string;
  tileUuid: string | null;
  onRefresh: () => void;
};

type CreateAreaOptions = {
  mergeIntoAreaId?: string;
  mergeSourceAreaIds?: string[];
  hotspotCenters?: AreaPolygonPoint[];
};

export function useCustomAreas({ baseUrl, tileUuid, onRefresh }: UseCustomAreasOptions) {
  const normalizedBaseUrl = useMemo(() => baseUrl.trim().replace(/\/$/, ""), [baseUrl]);

  const createArea = useCallback(
    async (name: string, clusterCenters: AreaPolygonPoint[], options?: CreateAreaOptions): Promise<void> => {
      if (!tileUuid || !normalizedBaseUrl) {
        return;
      }
      const mergeSourceAreaIds = options?.mergeSourceAreaIds ?? [];
      const hotspotCenters = options?.hotspotCenters ?? [];
      const response = await fetch(
        `${normalizedBaseUrl}/tiles/${encodeURIComponent(tileUuid)}/areas`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            cluster_centers: clusterCenters,
            hotspot_centers: hotspotCenters,
            merge_into_area_id: options?.mergeIntoAreaId,
            merge_source_area_ids: mergeSourceAreaIds,
          }),
        },
      );
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(detail.detail ?? `Create area failed (${response.status})`);
      }
      onRefresh();
    },
    [normalizedBaseUrl, tileUuid, onRefresh],
  );

  const renameArea = useCallback(
    async (areaId: string, name: string): Promise<void> => {
      if (!tileUuid || !normalizedBaseUrl) {
        return;
      }
      const response = await fetch(
        `${normalizedBaseUrl}/tiles/${encodeURIComponent(tileUuid)}/areas/${encodeURIComponent(areaId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );
      if (!response.ok) {
        throw new Error(`Rename failed (${response.status})`);
      }
      onRefresh();
    },
    [normalizedBaseUrl, tileUuid, onRefresh],
  );

  const deleteArea = useCallback(
    async (areaId: string): Promise<void> => {
      if (!tileUuid || !normalizedBaseUrl) {
        return;
      }
      const response = await fetch(
        `${normalizedBaseUrl}/tiles/${encodeURIComponent(tileUuid)}/areas/${encodeURIComponent(areaId)}`,
        { method: "DELETE" },
      );
      if (!response.ok && response.status !== 404) {
        throw new Error(`Delete failed (${response.status})`);
      }
      onRefresh();
    },
    [normalizedBaseUrl, tileUuid, onRefresh],
  );

  return { createArea, renameArea, deleteArea };
}
