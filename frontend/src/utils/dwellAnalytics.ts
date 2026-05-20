import type { TileLocation } from "../hooks/useTileLocations";

export type DwellViewMode = "timeline" | "overall";
export type DwellTimeFilter = "day" | "week" | "month" | "year" | "ever";

export type DwellOverallRow = {
  hotspotId: number;
  latitude: number;
  longitude: number;
  samples: number;
  minutesSpent: number;
  visitCount: number;
};

export type DwellVisitRow = {
  hotspotId: number;
  latitude: number;
  longitude: number;
  startObservedAt: string;
  endObservedAt: string;
  samples: number;
  minutesSpent: number;
};

type ClusterAccumulator = {
  hotspotId: number;
  latitudeSum: number;
  longitudeSum: number;
  samples: number;
  secondsSpent: number;
  visitCount: number;
};

type PointWithTime = {
  latitude: number;
  longitude: number;
  observedAt: Date;
};

const EARTH_RADIUS_METERS = 6_371_000;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  const c = 2 * Math.asin(Math.sqrt(a));
  return EARTH_RADIUS_METERS * c;
}

function getCutoffTime(reference: Date, filter: DwellTimeFilter): Date | null {
  if (filter === "ever") {
    return null;
  }

  const cutoff = new Date(reference);
  if (filter === "day") {
    cutoff.setDate(cutoff.getDate() - 1);
  } else if (filter === "week") {
    cutoff.setDate(cutoff.getDate() - 7);
  } else if (filter === "month") {
    cutoff.setMonth(cutoff.getMonth() - 1);
  } else if (filter === "year") {
    cutoff.setFullYear(cutoff.getFullYear() - 1);
  }

  return cutoff;
}

function normalizePoints(items: TileLocation[], filter: DwellTimeFilter, referenceIso: string): PointWithTime[] {
  const reference = new Date(referenceIso);
  if (Number.isNaN(reference.getTime())) {
    return [];
  }

  const cutoff = getCutoffTime(reference, filter);

  return items
    .map((item) => ({
      latitude: item.latitude,
      longitude: item.longitude,
      observedAt: new Date(item.observed_at),
    }))
    .filter((item) => !Number.isNaN(item.observedAt.getTime()))
    .filter((item) => (cutoff ? item.observedAt >= cutoff : true))
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
}

function findNearestCluster(
  clusters: ClusterAccumulator[],
  point: PointWithTime,
  mergeRadiusMeters: number,
): ClusterAccumulator | null {
  let bestCluster: ClusterAccumulator | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  clusters.forEach((cluster) => {
    if (cluster.samples <= 0) {
      return;
    }

    const centerLat = cluster.latitudeSum / cluster.samples;
    const centerLon = cluster.longitudeSum / cluster.samples;
    const distance = haversineMeters(point.latitude, point.longitude, centerLat, centerLon);
    if (distance <= mergeRadiusMeters && distance < bestDistance) {
      bestCluster = cluster;
      bestDistance = distance;
    }
  });

  return bestCluster;
}

function boundedGapSeconds(points: PointWithTime[], index: number, maxGapMinutes: number): number {
  if (index >= points.length - 1) {
    return 0;
  }

  const rawSeconds = Math.max(
    0,
    Math.floor((points[index + 1].observedAt.getTime() - points[index].observedAt.getTime()) / 1000),
  );

  return Math.min(rawSeconds, maxGapMinutes * 60);
}

export function analyzeDwellHotspots(
  items: TileLocation[],
  filter: DwellTimeFilter,
  referenceIso: string,
  mergeRadiusMeters = 50,
  maxGapMinutes = 30,
): { overall: DwellOverallRow[]; visits: DwellVisitRow[] } {
  const points = normalizePoints(items, filter, referenceIso);
  if (points.length === 0) {
    return { overall: [], visits: [] };
  }

  const clusterResult = assignPointsToClusters(points, mergeRadiusMeters);
  applyClusterDurations(clusterResult.clusters, points, clusterResult.pointHotspotIds, maxGapMinutes);

  return {
    overall: buildOverallRows(clusterResult.clusters),
    visits: buildVisitRows(clusterResult.clusters, points, clusterResult.pointHotspotIds, maxGapMinutes),
  };
}

function assignPointsToClusters(
  points: PointWithTime[],
  mergeRadiusMeters: number,
): { clusters: ClusterAccumulator[]; pointHotspotIds: number[] } {
  const clusters: ClusterAccumulator[] = [];
  const pointHotspotIds: number[] = [];

  points.forEach((point) => {
    const cluster = findNearestCluster(clusters, point, mergeRadiusMeters);
    if (!cluster) {
      const next: ClusterAccumulator = {
        hotspotId: clusters.length,
        latitudeSum: point.latitude,
        longitudeSum: point.longitude,
        samples: 1,
        secondsSpent: 0,
        visitCount: 0,
      };
      clusters.push(next);
      pointHotspotIds.push(next.hotspotId);
      return;
    }

    cluster.latitudeSum += point.latitude;
    cluster.longitudeSum += point.longitude;
    cluster.samples += 1;
    pointHotspotIds.push(cluster.hotspotId);
  });

  return { clusters, pointHotspotIds };
}

function applyClusterDurations(
  clusters: ClusterAccumulator[],
  points: PointWithTime[],
  pointHotspotIds: number[],
  maxGapMinutes: number,
) {
  pointHotspotIds.forEach((hotspotId, index) => {
    const gapSeconds = boundedGapSeconds(points, index, maxGapMinutes);
    clusters[hotspotId].secondsSpent += gapSeconds;
  });
}

function buildVisitRows(
  clusters: ClusterAccumulator[],
  points: PointWithTime[],
  pointHotspotIds: number[],
  maxGapMinutes: number,
): DwellVisitRow[] {
  const visits: DwellVisitRow[] = [];
  let startIndex = 0;

  while (startIndex < points.length) {
    const currentHotspotId = pointHotspotIds[startIndex];
    let endIndex = startIndex;
    while (endIndex + 1 < points.length && pointHotspotIds[endIndex + 1] === currentHotspotId) {
      endIndex += 1;
    }

    let visitSeconds = 0;
    for (let index = startIndex; index <= endIndex; index += 1) {
      visitSeconds += boundedGapSeconds(points, index, maxGapMinutes);
    }

    clusters[currentHotspotId].visitCount += 1;
    const cluster = clusters[currentHotspotId];
    const stopMs = points[endIndex].observedAt.getTime() + visitSeconds * 1000;

    visits.push({
      hotspotId: currentHotspotId,
      latitude: cluster.latitudeSum / cluster.samples,
      longitude: cluster.longitudeSum / cluster.samples,
      startObservedAt: points[startIndex].observedAt.toISOString(),
      endObservedAt: new Date(stopMs).toISOString(),
      samples: endIndex - startIndex + 1,
      minutesSpent: Math.floor(visitSeconds / 60),
    });

    startIndex = endIndex + 1;
  }

  return visits;
}

function buildOverallRows(clusters: ClusterAccumulator[]): DwellOverallRow[] {
  return clusters
    .filter((cluster) => cluster.samples > 0)
    .map((cluster) => ({
      hotspotId: cluster.hotspotId,
      latitude: cluster.latitudeSum / cluster.samples,
      longitude: cluster.longitudeSum / cluster.samples,
      samples: cluster.samples,
      minutesSpent: Math.floor(cluster.secondsSpent / 60),
      visitCount: cluster.visitCount,
    }));
}
