import { useEffect, useMemo, useState } from "react";
import type { CustomArea } from "../hooks/useTileDetails";

type CustomAreasPanelProps = {
  areas: CustomArea[];
  onRename: (areaId: string, name: string) => Promise<void>;
  onDelete: (areaId: string) => Promise<void>;
  onDeleteMany: (areaIds: string[]) => Promise<void>;
  onMergeAreas: (targetAreaId: string, sourceAreaIds: string[]) => Promise<void>;
  onUndoMerge: (areaId: string) => Promise<void>;
  latestMergeUndo: { areaId: string; areaName: string; mergedAt: string } | null;
  onFocusAreas?: (areaIds: string[]) => void;
};

type AreaRowProps = {
  area: CustomArea;
  selected: boolean;
  onToggleSelected: (areaId: string) => void;
  onFocusArea?: (areaId: string) => void;
  onRename: (areaId: string, name: string) => Promise<void>;
  onDelete: (areaId: string) => Promise<void>;
};

type SortMode = "samples-desc" | "samples-asc" | "name-asc" | "name-desc";

function formatMinutes(value: number): string {
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

function AreaRow({ area, selected, onToggleSelected, onFocusArea, onRename, onDelete }: AreaRowProps) {
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(area.name);
  const [busy, setBusy] = useState(false);

  async function confirmRename() {
    if (!nameInput.trim() || nameInput.trim() === area.name) {
      setEditing(false);
      setNameInput(area.name);
      return;
    }
    setBusy(true);
    try {
      await onRename(area.area_id, nameInput.trim());
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!confirm(`Delete area "${area.name}"? Hotspots will be recalculated.`)) return;
    setBusy(true);
    try {
      await onDelete(area.area_id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="tile-details-item tile-area-row">
      {editing ? (
        <div className="tile-area-create-row">
          <input
            className="tile-area-name-input"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void confirmRename(); if (e.key === "Escape") { setEditing(false); setNameInput(area.name); } }}
            autoFocus
          />
          <button type="button" className="tile-area-confirm" onClick={() => void confirmRename()} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="tile-area-cancel" onClick={() => { setEditing(false); setNameInput(area.name); }}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="tile-area-row-content">
          <div className="tile-area-row-info">
            <input
              type="checkbox"
              className="tile-area-checkbox"
              checked={selected}
              onChange={() => onToggleSelected(area.area_id)}
              aria-label={`Select ${area.name}`}
            />
            <button
              type="button"
              className="tile-area-name-btn"
              onClick={() => onFocusArea?.(area.area_id)}
              title="Center map on this area"
            >
              {area.name}
            </button>
            <span>{area.samples} samples</span>
            {area.minutes_spent > 0 && <span>{formatMinutes(area.minutes_spent)}</span>}
            <span>{area.polygon.length}-sided polygon</span>
          </div>
          <div className="tile-area-row-actions">
            <button type="button" className="tile-area-btn" onClick={() => setEditing(true)} disabled={busy}>
              Rename
            </button>
            <button type="button" className="tile-area-btn tile-area-btn-delete" onClick={() => void confirmDelete()} disabled={busy}>
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function CustomAreasPanel({
  areas,
  onRename,
  onDelete,
  onDeleteMany,
  onMergeAreas,
  onUndoMerge,
  latestMergeUndo,
  onFocusAreas,
}: CustomAreasPanelProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>("samples-desc");
  const [bulkBusy, setBulkBusy] = useState(false);

  const sortedAreas = useMemo(() => {
    const items = [...areas];
    items.sort((a, b) => {
      if (sortMode === "samples-desc") {
        return b.samples - a.samples || a.name.localeCompare(b.name);
      }
      if (sortMode === "samples-asc") {
        return a.samples - b.samples || a.name.localeCompare(b.name);
      }
      if (sortMode === "name-desc") {
        return b.name.localeCompare(a.name);
      }
      return a.name.localeCompare(b.name);
    });
    return items;
  }, [areas, sortMode]);

  const selectedAreas = useMemo(
    () => sortedAreas.filter((area) => selectedIds.has(area.area_id)),
    [sortedAreas, selectedIds],
  );

  useEffect(() => {
    const validIds = new Set(areas.map((area) => area.area_id));
    const nextSelectedIds = new Set(Array.from(selectedIds).filter((areaId) => validIds.has(areaId)));

    if (nextSelectedIds.size === selectedIds.size) {
      return;
    }

    setSelectedIds(nextSelectedIds);
    onFocusAreas?.(Array.from(nextSelectedIds));
  }, [areas, onFocusAreas, selectedIds]);

  const toggleSelected = (areaId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(areaId)) {
        next.delete(areaId);
      } else {
        next.add(areaId);
      }
      onFocusAreas?.(Array.from(next));
      return next;
    });
  };

  const selectAll = () => {
    const next = new Set(sortedAreas.map((area) => area.area_id));
    setSelectedIds(next);
    onFocusAreas?.(Array.from(next));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    onFocusAreas?.([]);
  };

  const handleDeleteSelected = async () => {
    if (selectedAreas.length === 0) {
      return;
    }
    if (!confirm(`Delete ${selectedAreas.length} selected areas?`)) {
      return;
    }
    setBulkBusy(true);
    try {
      await onDeleteMany(selectedAreas.map((area) => area.area_id));
      setSelectedIds(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  const handleMergeSelected = async () => {
    if (selectedAreas.length < 2) {
      return;
    }

    const target = selectedAreas[0];
    const sources = selectedAreas.slice(1);
    if (!confirm(`Merge ${sources.length} areas into "${target.name}"?`)) {
      return;
    }

    setBulkBusy(true);
    try {
      await onMergeAreas(
        target.area_id,
        sources.map((area) => area.area_id),
      );
      setSelectedIds(new Set([target.area_id]));
      onFocusAreas?.([target.area_id]);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleUndoMerge = async () => {
    if (!latestMergeUndo) {
      return;
    }

    if (!confirm(`Undo the last merge into "${latestMergeUndo.areaName}"?`)) {
      return;
    }

    setBulkBusy(true);
    try {
      await onUndoMerge(latestMergeUndo.areaId);
      setSelectedIds(new Set([latestMergeUndo.areaId]));
      onFocusAreas?.([latestMergeUndo.areaId]);
    } finally {
      setBulkBusy(false);
    }
  };

  if (areas.length === 0) {
    return (
      <p className="tile-list-empty">
        No areas yet. Select 3+ hotspots and choose &ldquo;Create area&rdquo;.
      </p>
    );
  }

  return (
    <>
      <div className="tile-area-toolbar">
        <label className="tile-area-sort">
          <span>Sort</span>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
            <option value="samples-desc">Samples (high to low)</option>
            <option value="samples-asc">Samples (low to high)</option>
            <option value="name-asc">Name (A-Z)</option>
            <option value="name-desc">Name (Z-A)</option>
          </select>
        </label>
        <div className="tile-area-selection-actions">
          <button type="button" className="tile-area-btn" onClick={selectAll} disabled={bulkBusy || sortedAreas.length === 0}>
            Select all
          </button>
          <button type="button" className="tile-area-btn" onClick={clearSelection} disabled={bulkBusy || selectedAreas.length === 0}>
            Clear
          </button>
          <button
            type="button"
            className="tile-area-btn"
            onClick={() => void handleMergeSelected()}
            disabled={bulkBusy || selectedAreas.length < 2}
            title="Merges into the first selected area in current sort order"
          >
            {bulkBusy ? "Working…" : "Merge selected"}
          </button>
          <button
            type="button"
            className="tile-area-btn"
            onClick={() => void handleUndoMerge()}
            disabled={bulkBusy || !latestMergeUndo}
            title={latestMergeUndo ? `Undo the last merge into ${latestMergeUndo.areaName}` : "No merge is available to undo"}
          >
            Undo merge
          </button>
          <button
            type="button"
            className="tile-area-btn tile-area-btn-delete"
            onClick={() => void handleDeleteSelected()}
            disabled={bulkBusy || selectedAreas.length === 0}
          >
            Delete selected
          </button>
        </div>
      </div>

      <p className="tile-history-meta">Selected: {selectedAreas.length}</p>

      <ul className="tile-details-list">
        {sortedAreas.map((area) => (
          <AreaRow
            key={area.area_id}
            area={area}
            selected={selectedIds.has(area.area_id)}
            onToggleSelected={toggleSelected}
            onFocusArea={(areaId) => onFocusAreas?.([areaId])}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </>
  );
}
