import { Polygon, Tooltip } from "react-leaflet";
import type { CustomArea } from "../hooks/useTileDetails";
import { getAreaPolygonStyle } from "../utils/areaStyles";

type AreaPolygonsProps = {
  areas: CustomArea[];
  visibleLabels: Record<string, boolean>;
  onToggleLabel: (areaId: string) => void;
};

export function AreaPolygons({ areas, visibleLabels, onToggleLabel }: AreaPolygonsProps) {
  return (
    <>
      {areas.map((area) => {
        const positions = area.polygon.map((point) => [point.latitude, point.longitude] as [number, number]);
        const isLabelVisible = Boolean(visibleLabels[area.area_id]);

        return (
          <Polygon
            key={area.area_id}
            positions={positions}
            pathOptions={getAreaPolygonStyle(area.name)}
            eventHandlers={{
              click: (event) => {
                event.originalEvent.stopPropagation();
                onToggleLabel(area.area_id);
              },
            }}
          >
            {isLabelVisible ? (
              <Tooltip permanent direction="center" className="map-area-label">
                {area.name}
              </Tooltip>
            ) : null}
          </Polygon>
        );
      })}
    </>
  );
}