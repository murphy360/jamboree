import { useState } from "react";
import type { AreaPolygonPoint } from "./useTileDetails";
import type { SelectableLocationRow } from "./useDwellSorting";

type UseDwellAreaSelectOptions = {
  selectableLocations: SelectableLocationRow[];
  onCreateArea: (
    name: string,
    centers: AreaPolygonPoint[],
    options?: { mergeIntoAreaId?: string; mergeSourceAreaIds?: string[] },
  ) => Promise<void>;
};

export function useDwellAreaSelect({ selectableLocations, onCreateArea }: UseDwellAreaSelectOptions) {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [areaNameInput, setAreaNameInput] = useState("");
  const [naming, setNaming] = useState(false);
  const [creating, setCreating] = useState(false);

  const selectedCenters = selectableLocations
    .filter((location) => selectedIds.has(location.entryId))
    .flatMap((location) => location.centers);

  const selectedHotspotCenters = selectableLocations
    .filter((location) => selectedIds.has(location.entryId) && location.locationKind === "hotspot")
    .flatMap((location) => location.centers);

  const centerKey = (point: AreaPolygonPoint) => `${point.latitude.toFixed(6)}:${point.longitude.toFixed(6)}`;
  const uniqueCenterMap = new Map<string, AreaPolygonPoint>();
  selectedCenters.forEach((center) => {
    uniqueCenterMap.set(centerKey(center), center);
  });
  const uniqueCenters = [...uniqueCenterMap.values()];

  const uniqueHotspotCenterMap = new Map<string, AreaPolygonPoint>();
  selectedHotspotCenters.forEach((center) => {
    uniqueHotspotCenterMap.set(centerKey(center), center);
  });
  const uniqueHotspotCenters = [...uniqueHotspotCenterMap.values()];

  const canCreate = selectedIds.size >= 2 && uniqueCenters.length >= 3;
  const selectedAreaLocations = selectableLocations.filter(
    (location) => selectedIds.has(location.entryId) && location.locationKind === "area",
  );
  const selectedAreaIds = selectedAreaLocations.map((location) => location.entryId.replace(/^area:/, ""));
  const mergeIntoAreaId = selectedAreaIds.length > 0 ? selectedAreaIds[0] : undefined;
  const mergeIntoAreaLabel = selectedAreaLocations[0]?.locationLabel;
  const mergeMode = !!mergeIntoAreaId;

  function toggleSelectMode() {
    setSelectMode((prev) => !prev);
    setSelectedIds(new Set());
    setNaming(false);
    setAreaNameInput("");
  }

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmCreate() {
    if (!canCreate) return;

    const trimmedName = areaNameInput.trim();
    if (!mergeMode && !trimmedName) return;
    const requestName = mergeMode ? (mergeIntoAreaLabel ?? trimmedName ?? "Merged Area") : trimmedName;

    setCreating(true);
    try {
      await onCreateArea(requestName, uniqueCenters, {
        mergeIntoAreaId,
        mergeSourceAreaIds: selectedAreaIds,
        hotspotCenters: uniqueHotspotCenters,
      });
      setNaming(false);
      setAreaNameInput("");
      setSelectedIds(new Set());
      setSelectMode(false);
    } finally {
      setCreating(false);
    }
  }

  function startCreateOrMerge() {
    if (!canCreate || creating) return;
    if (mergeMode) {
      void confirmCreate();
      return;
    }
    setNaming(true);
  }

  return {
    selectMode,
    selectedIds,
    areaNameInput,
    setAreaNameInput,
    naming,
    canCreate,
    mergeMode,
    mergeIntoAreaLabel,
    selectedCenterCount: uniqueCenters.length,
    setNaming,
    creating,
    toggleSelectMode,
    toggleId,
    startCreateOrMerge,
    confirmCreate,
  };
}
