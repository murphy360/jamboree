import { useState } from "react";
import type { CustomArea } from "../hooks/useTileDetails";

type CustomAreasPanelProps = {
  areas: CustomArea[];
  onRename: (areaId: string, name: string) => Promise<void>;
  onDelete: (areaId: string) => Promise<void>;
};

type AreaRowProps = {
  area: CustomArea;
  onRename: (areaId: string, name: string) => Promise<void>;
  onDelete: (areaId: string) => Promise<void>;
};

function formatMinutes(value: number): string {
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

function AreaRow({ area, onRename, onDelete }: AreaRowProps) {
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
            <strong>{area.name}</strong>
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

export function CustomAreasPanel({ areas, onRename, onDelete }: CustomAreasPanelProps) {
  if (areas.length === 0) {
    return (
      <p className="tile-list-empty">
        No areas yet. Select 3+ hotspots and choose &ldquo;Create area&rdquo;.
      </p>
    );
  }

  return (
    <ul className="tile-details-list">
      {areas.map((area) => (
        <AreaRow key={area.area_id} area={area} onRename={onRename} onDelete={onDelete} />
      ))}
    </ul>
  );
}
