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

        const handleClick = (event: { originalEvent?: MouseEvent }) => {
          event.originalEvent?.stopPropagation();
          onToggleLabel(area.area_id);
        };

        return (
          <Polygon
            key={area.area_id}
            positions={positions}
            interactive={true}
            bubblingMouseEvents={false}
            pathOptions={getAreaPolygonStyle(area.name)}
            eventHandlers={{ click: handleClick }}
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