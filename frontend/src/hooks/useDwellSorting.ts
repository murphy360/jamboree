import { useMemo, useState } from "react";
import { analyzeDwellHotspots, type DwellTimeFilter, type DwellViewMode } from "../utils/dwellAnalytics";
import type { TileDetails, AreaPolygonPoint, CustomArea } from "./useTileDetails";

type OverallSort = "minutes" | "visits" | "samples";
type TimelineSort = "recent" | "oldest";

export type DwellLocationKind = "area" | "hotspot";

export type DwellOverallDisplayRow = {
  entryId: string;
  locationKind: DwellLocationKind;
  locationLabel: string;
  latitude: number;
  longitude: number;
  samples: number;
  minutesSpent: number;
  visitCount: number;
};

export type DwellTimelineDisplayRow = {
  entryId: string;
  hotspotId: number;
  latitude: number;
  longitude: number;
  startObservedAt: string;
  endObservedAt: string;
  samples: number;
  minutesSpent: number;
  locationKind: DwellLocationKind;
  locationLabel: string;
};

export type SelectableLocationRow = {
  entryId: string;
  locationKind: DwellLocationKind;
  locationLabel: string;
  latitude: number;
  longitude: number;
  centers: AreaPolygonPoint[];
  samples: number;
  minutesSpent: number;
  visitCount: number;
};

type LocationDescriptor = {
  entryId: string;
  locationKind: DwellLocationKind;
  locationLabel: string;
  areaId?: string;
};

type TimelineDisplayRowWithArea = DwellTimelineDisplayRow & { areaId?: string };

const DEFAULT_TRANSIENT_VISIT_MAX_MINUTES = 8;
const DEFAULT_AREA_LABEL_PRIORITY = "subcamp:300,camp:220,village:180,headquarters:120,hq:110,patch:40,piggot:30";

type AreaPriorityRule = {
  keyword: string;
  weight: number;
};

function getTransientVisitMaxMinutes(): number {
  const configured = Number(import.meta.env.VITE_DWELL_TRANSIENT_VISIT_MAX_MINUTES ?? "");
  if (!Number.isFinite(configured) || configured < 0) {
    return DEFAULT_TRANSIENT_VISIT_MAX_MINUTES;
  }
  return configured;
}

function parseAreaPriorityRules(value: string): AreaPriorityRule[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const [rawKeyword, rawWeight] = part.split(":");
      const keyword = (rawKeyword ?? "").trim().toLowerCase();
      const weight = Number((rawWeight ?? "").trim());
      if (!keyword || !Number.isFinite(weight)) {
        return null;
      }
      return { keyword, weight } satisfies AreaPriorityRule;
    })
    .filter((rule): rule is AreaPriorityRule => Boolean(rule));
}

const AREA_PRIORITY_RULES = parseAreaPriorityRules(
  import.meta.env.VITE_AREA_LABEL_PRIORITY ?? DEFAULT_AREA_LABEL_PRIORITY,
);

function areaPriorityScore(area: CustomArea): number {
  const name = area.name.toLowerCase();
  let best = 0;
  AREA_PRIORITY_RULES.forEach((rule) => {
    if (name.includes(rule.keyword)) {
      best = Math.max(best, rule.weight);
    }
  });
  return best;
}

function pointInPolygon(lat: number, lon: number, polygon: AreaPolygonPoint[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  const epsilon = 1e-9;

  const pointOnSegment = (
    pointLat: number,
    pointLon: number,
    startLat: number,
    startLon: number,
    endLat: number,
    endLon: number,
  ): boolean => {
    const cross = (pointLat - startLat) * (endLon - startLon) - (pointLon - startLon) * (endLat - startLat);
    if (Math.abs(cross) > epsilon) return false;

    const dot = (pointLat - startLat) * (endLat - startLat) + (pointLon - startLon) * (endLon - startLon);
    if (dot < -epsilon) return false;

    const squaredLen = (endLat - startLat) ** 2 + (endLon - startLon) ** 2;
    return dot <= squaredLen + epsilon;
  };

  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i += 1) {
    const piLat = polygon[i].latitude;
    const piLon = polygon[i].longitude;
    const pjLat = polygon[j].latitude;
    const pjLon = polygon[j].longitude;

    if (pointOnSegment(lat, lon, piLat, piLon, pjLat, pjLon)) return true;

    const lonCrosses = (piLon > lon) !== (pjLon > lon);
    if (lonCrosses) {
      const latIntersect =
        ((pjLat - piLat) * (lon - piLon)) / (pjLon - piLon) +
        piLat;
      if (lat < latIntersect) inside = !inside;
    }
    j = i;
  }
  return inside;
}

function polygonAreaScore(polygon: AreaPolygonPoint[]): number {
  if (polygon.length < 3) {
    return 0;
  }

  let areaTwice = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const nextIndex = (index + 1) % polygon.length;
    const current = polygon[index];
    const next = polygon[nextIndex];
    areaTwice += current.longitude * next.latitude - next.longitude * current.latitude;
  }

  return Math.abs(areaTwice) / 2;
}

function getLocationDescriptor(lat: number, lon: number, hotspotId: number, areas: CustomArea[]): LocationDescriptor {
  const containingAreas = areas.filter((candidate) => pointInPolygon(lat, lon, candidate.polygon));
  const area = containingAreas.length > 0
    ? containingAreas.reduce((best, current) => {
      const bestPriority = areaPriorityScore(best);
      const currentPriority = areaPriorityScore(current);
      if (currentPriority !== bestPriority) {
        return currentPriority > bestPriority ? current : best;
      }
      return polygonAreaScore(current.polygon) > polygonAreaScore(best.polygon) ? current : best;
    })
    : null;

  if (area) {
    return {
      entryId: `area:${area.area_id}`,
      locationKind: "area",
      locationLabel: area.name,
      areaId: area.area_id,
    };
  }

  return {
    entryId: `hotspot:${hotspotId}`,
    locationKind: "hotspot",
    locationLabel: `Hotspot #${hotspotId + 1}`,
  };
}

function mergeConsecutiveAreaVisits(visits: TimelineDisplayRowWithArea[]): TimelineDisplayRowWithArea[] {
  if (visits.length === 0) {
    return [];
  }

  const merged: TimelineDisplayRowWithArea[] = [];

  visits.forEach((visit) => {
    const prev = merged[merged.length - 1];
    const sameAreaAsPrevious =
      prev &&
      visit.locationKind === "area" &&
      prev.locationKind === "area" &&
      Boolean(visit.areaId) &&
      visit.areaId === prev.areaId;

    if (!sameAreaAsPrevious || !prev) {
      merged.push({ ...visit });
      return;
    }

    const combinedSamples = prev.samples + visit.samples;
    prev.endObservedAt = visit.endObservedAt;
    prev.minutesSpent += visit.minutesSpent;
    prev.latitude = (prev.latitude * prev.samples + visit.latitude * visit.samples) / combinedSamples;
    prev.longitude = (prev.longitude * prev.samples + visit.longitude * visit.samples) / combinedSamples;
    prev.samples = combinedSamples;
  });

  return merged;
}

function mergeVisitRows(
  first: TimelineDisplayRowWithArea,
  second: TimelineDisplayRowWithArea,
): TimelineDisplayRowWithArea {
  const combinedSamples = first.samples + second.samples;
  return {
    ...first,
    endObservedAt: second.endObservedAt,
    minutesSpent: first.minutesSpent + second.minutesSpent,
    samples: combinedSamples,
    latitude: (first.latitude * first.samples + second.latitude * second.samples) / combinedSamples,
    longitude: (first.longitude * first.samples + second.longitude * second.samples) / combinedSamples,
  };
}

function suppressTransientAreaTransitions(
  visits: TimelineDisplayRowWithArea[],
  transientVisitMaxMinutes: number,
): TimelineDisplayRowWithArea[] {
  if (visits.length < 3 || transientVisitMaxMinutes <= 0) {
    return visits;
  }

  const smoothed = visits.map((visit) => ({ ...visit }));
  let changed = true;

  while (changed) {
    changed = false;

    for (let index = 0; index <= smoothed.length - 3; index += 1) {
      const first = smoothed[index];
      const middle = smoothed[index + 1];
      const last = smoothed[index + 2];

      const hasMatchingAreaBounds =
        first.locationKind === "area" &&
        last.locationKind === "area" &&
        Boolean(first.areaId) &&
        first.areaId === last.areaId;

      if (!hasMatchingAreaBounds) {
        continue;
      }

      if (middle.locationKind === "area" && middle.areaId === first.areaId) {
        continue;
      }

      if (middle.minutesSpent > transientVisitMaxMinutes) {
        continue;
      }

      const mergedFirstLast = mergeVisitRows(first, middle);
      const mergedAll = mergeVisitRows(mergedFirstLast, last);
      smoothed.splice(index, 3, mergedAll);
      changed = true;
      break;
    }
  }

  return smoothed;
}

export function useDwellSorting(details: TileDetails, areaPolygons: AreaPolygonPoint[][]) {
  const [viewMode, setViewMode] = useState<DwellViewMode>("overall");
  const [timeFilter, setTimeFilter] = useState<DwellTimeFilter>("ever");
  const [overallSort, setOverallSort] = useState<OverallSort>("minutes");
  const [timelineSort, setTimelineSort] = useState<TimelineSort>("recent");

  const dwellForOverall = useMemo(
    () => analyzeDwellHotspots(details.items, timeFilter, details.last_observed_at, 50, 30, areaPolygons),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [details.items, details.last_observed_at, timeFilter, details.custom_areas],
  );

  const dwellForTimeline = useMemo(
    () => analyzeDwellHotspots(details.items, timeFilter, details.last_observed_at, 50, 30),
    [details.items, details.last_observed_at, timeFilter],
  );

  const allOverall = useMemo(() => {
    const buckets = new Map<string, DwellOverallDisplayRow>();

    dwellForTimeline.overall.forEach((cluster) => {
      const descriptor = getLocationDescriptor(
        cluster.latitude,
        cluster.longitude,
        cluster.hotspotId,
        details.custom_areas,
      );
      const existing = buckets.get(descriptor.entryId);
      if (!existing) {
        buckets.set(descriptor.entryId, {
          entryId: descriptor.entryId,
          locationKind: descriptor.locationKind,
          locationLabel: descriptor.locationLabel,
          latitude: cluster.latitude,
          longitude: cluster.longitude,
          samples: cluster.samples,
          minutesSpent: cluster.minutesSpent,
          visitCount: cluster.visitCount,
        });
        return;
      }

      const combinedSamples = existing.samples + cluster.samples;
      const nextLat =
        (existing.latitude * existing.samples + cluster.latitude * cluster.samples) / combinedSamples;
      const nextLon =
        (existing.longitude * existing.samples + cluster.longitude * cluster.samples) / combinedSamples;

      existing.latitude = nextLat;
      existing.longitude = nextLon;
      existing.samples = combinedSamples;
      existing.minutesSpent += cluster.minutesSpent;
      existing.visitCount += cluster.visitCount;
    });

    const items = [...buckets.values()];
    if (overallSort === "visits") items.sort((a, b) => b.visitCount - a.visitCount || b.minutesSpent - a.minutesSpent);
    else if (overallSort === "samples") items.sort((a, b) => b.samples - a.samples || b.minutesSpent - a.minutesSpent);
    else items.sort((a, b) => b.minutesSpent - a.minutesSpent || b.visitCount - a.visitCount);
    return items;
  }, [details.custom_areas, dwellForTimeline.overall, overallSort]);

  const sortedOverall = useMemo(() => allOverall.slice(0, 12), [allOverall]);

  const selectableLocations = useMemo(() => {
    const areaById = new Map(details.custom_areas.map((area) => [area.area_id, area]));
    return allOverall.map((item) => {
      if (item.locationKind === "area") {
        const areaId = item.entryId.slice("area:".length);
        const area = areaById.get(areaId);
        return {
          entryId: item.entryId,
          locationKind: item.locationKind,
          locationLabel: item.locationLabel,
          latitude: item.latitude,
          longitude: item.longitude,
          centers: area ? area.polygon : [{ latitude: item.latitude, longitude: item.longitude }],
          samples: item.samples,
          minutesSpent: item.minutesSpent,
          visitCount: item.visitCount,
        } satisfies SelectableLocationRow;
      }

      return {
        entryId: item.entryId,
        locationKind: item.locationKind,
        locationLabel: item.locationLabel,
        latitude: item.latitude,
        longitude: item.longitude,
        centers: [{ latitude: item.latitude, longitude: item.longitude }],
        samples: item.samples,
        minutesSpent: item.minutesSpent,
        visitCount: item.visitCount,
      } satisfies SelectableLocationRow;
    });
  }, [allOverall, details.custom_areas]);

  const sortedTimeline = useMemo(() => {
    const timelineRows = dwellForTimeline.visits.map((visit) => ({
      ...visit,
      ...getLocationDescriptor(visit.latitude, visit.longitude, visit.hotspotId, details.custom_areas),
    }));

    const transientVisitMaxMinutes = getTransientVisitMaxMinutes();
    const consecutiveMerged = mergeConsecutiveAreaVisits(timelineRows);
    const items = suppressTransientAreaTransitions(consecutiveMerged, transientVisitMaxMinutes);

    if (timelineSort === "oldest") {
      items.sort(
        (a, b) =>
          new Date(a.startObservedAt).getTime() - new Date(b.startObservedAt).getTime() ||
          b.minutesSpent - a.minutesSpent,
      );
    } else {
      items.sort(
        (a, b) =>
          new Date(b.startObservedAt).getTime() - new Date(a.startObservedAt).getTime() ||
          b.minutesSpent - a.minutesSpent,
      );
    }
    return items;
  }, [details.custom_areas, dwellForTimeline.visits, timelineSort]);

  return {
    viewMode, setViewMode,
    timeFilter, setTimeFilter,
    overallSort, setOverallSort,
    timelineSort, setTimelineSort,
    dwell: dwellForOverall,
    sortedOverall,
    selectableLocations,
    sortedTimeline,
  };
}
