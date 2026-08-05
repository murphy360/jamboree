import { useCallback, useMemo, useState, useEffect } from "react";
import type { AreaPolygonPoint } from "./useTileDetails";
import type { CustomArea } from "../types/react-leaflet-core";

type UseCustomAreasOptions = {
  baseUrl: string;
  tileUuid: string | null;
  onRefresh: () => void;
};

type CreateAreaOptions = {
  mergeIntoAreaId?: string;
  mergeSourceAreaIds?: string[];
  hotspotCenters?: AreaPolygonPoint[];
  preserveShape?: boolean;
};

type MergeUndoState = {
  areaId: string;
  areaName: string;
  mergedAt: string;
};

export function useCustomAreas({ baseUrl, tileUuid, onRefresh }: UseCustomAreasOptions) {
  const normalizedBaseUrl = useMemo(() => baseUrl.trim().replace(/\/$/, ""), [baseUrl]);

  const [areas, setAreas] = useState<CustomArea[]>([]);
  const [latestMergeUndo, setLatestMergeUndo] = useState<MergeUndoState | null>(null);

  const fetchAreas = useCallback(async () => {
    if (!tileUuid || !normalizedBaseUrl) {
      setAreas([]);
      return;
    }

    const response = await fetch(`${normalizedBaseUrl}/tiles/${encodeURIComponent(tileUuid)}/areas`);
    if (!response.ok) {
      return;
    }

    const data = await response.json();
    // Backend returns a list directly, not an object with areas property.
    setAreas(Array.isArray(data) ? data : data.areas || []);
  }, [normalizedBaseUrl, tileUuid]);

  const fetchLatestMergeUndo = useCallback(async () => {
    if (!tileUuid || !normalizedBaseUrl) {
      setLatestMergeUndo(null);
      return;
    }

    const response = await fetch(`${normalizedBaseUrl}/tiles/${encodeURIComponent(tileUuid)}/areas/merge-undo`);
    if (response.status === 404) {
      setLatestMergeUndo(null);
      return;
    }
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as MergeUndoState;
    setLatestMergeUndo(data);
  }, [normalizedBaseUrl, tileUuid]);

  useEffect(() => {
    void fetchAreas();
    void fetchLatestMergeUndo();
  }, [fetchAreas, fetchLatestMergeUndo]);

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
            preserve_shape: options?.preserveShape ?? false,
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
      await fetchAreas();
      await fetchLatestMergeUndo();
      onRefresh();
    },
    [normalizedBaseUrl, tileUuid, onRefresh, fetchAreas, fetchLatestMergeUndo],
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
      await fetchAreas();
      await fetchLatestMergeUndo();
      onRefresh();
    },
    [normalizedBaseUrl, tileUuid, onRefresh, fetchAreas, fetchLatestMergeUndo],
  );

  const updateAreaPolygon = useCallback(
    async (areaId: string, polygon: AreaPolygonPoint[]): Promise<void> => {
      if (!tileUuid || !normalizedBaseUrl) {
        return;
      }

      const response = await fetch(
        `${normalizedBaseUrl}/tiles/${encodeURIComponent(tileUuid)}/areas/${encodeURIComponent(areaId)}/polygon`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ polygon }),
        },
      );

      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(detail.detail ?? `Area polygon update failed (${response.status})`);
      }

      await fetchAreas();
      await fetchLatestMergeUndo();
      onRefresh();
    },
    [normalizedBaseUrl, tileUuid, onRefresh, fetchAreas, fetchLatestMergeUndo],
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
      await fetchAreas();
      await fetchLatestMergeUndo();
      onRefresh();
    },
    [normalizedBaseUrl, tileUuid, onRefresh, fetchAreas, fetchLatestMergeUndo],
  );

  const deleteAreas = useCallback(
    async (areaIds: string[]): Promise<void> => {
      if (!tileUuid || !normalizedBaseUrl || areaIds.length === 0) {
        return;
      }

      for (const areaId of areaIds) {
        const response = await fetch(
          `${normalizedBaseUrl}/tiles/${encodeURIComponent(tileUuid)}/areas/${encodeURIComponent(areaId)}`,
          { method: "DELETE" },
        );
        if (!response.ok && response.status !== 404) {
          throw new Error(`Delete failed (${response.status})`);
        }
      }

      await fetchAreas();
      await fetchLatestMergeUndo();
      onRefresh();
    },
    [normalizedBaseUrl, tileUuid, onRefresh, fetchAreas, fetchLatestMergeUndo],
  );

  const mergeAreas = useCallback(
    async (targetAreaId: string, sourceAreaIds: string[]): Promise<void> => {
      if (!tileUuid || !normalizedBaseUrl) {
        return;
      }
      if (!targetAreaId || sourceAreaIds.length === 0) {
        return;
      }

      const response = await fetch(
        `${normalizedBaseUrl}/tiles/${encodeURIComponent(tileUuid)}/areas`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "merge",
            cluster_centers: [],
            hotspot_centers: [],
            merge_into_area_id: targetAreaId,
            merge_source_area_ids: sourceAreaIds,
          }),
        },
      );

      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(detail.detail ?? `Merge failed (${response.status})`);
      }

      await fetchAreas();
      await fetchLatestMergeUndo();
      onRefresh();
    },
    [normalizedBaseUrl, tileUuid, onRefresh, fetchAreas, fetchLatestMergeUndo],
  );

  const undoMerge = useCallback(
    async (areaId: string): Promise<void> => {
      if (!tileUuid || !normalizedBaseUrl || !areaId) {
        return;
      }

      const response = await fetch(
        `${normalizedBaseUrl}/tiles/${encodeURIComponent(tileUuid)}/areas/${encodeURIComponent(areaId)}/undo-merge`,
        { method: "POST" },
      );

      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(detail.detail ?? `Undo merge failed (${response.status})`);
      }

      await fetchAreas();
      await fetchLatestMergeUndo();
      onRefresh();
    },
    [normalizedBaseUrl, tileUuid, onRefresh, fetchAreas, fetchLatestMergeUndo],
  );

  return {
    areas,
    createArea,
    renameArea,
    updateAreaPolygon,
    deleteArea,
    deleteAreas,
    mergeAreas,
    latestMergeUndo,
    undoMerge,
  };
}
