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

function getLocationDescriptor(lat: number, lon: number, hotspotId: number, areas: CustomArea[]): LocationDescriptor {
  const area = areas.find((candidate) => pointInPolygon(lat, lon, candidate.polygon));
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
    const items = dwellForTimeline.visits.map((visit) => ({
      ...visit,
      ...getLocationDescriptor(visit.latitude, visit.longitude, visit.hotspotId, details.custom_areas),
    }));
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
