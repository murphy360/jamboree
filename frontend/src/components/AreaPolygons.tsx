import { Fragment } from "react";
import { divIcon, latLngBounds, point } from "leaflet";
import { Marker, Polygon } from "react-leaflet";
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
        const center = latLngBounds(positions).getCenter();
        const labelIcon = divIcon({
          className: "map-area-label-marker",
          html: `<div class="map-area-label-badge">${area.name}</div>`,
          iconSize: point(1, 1),
          iconAnchor: point(0, 0),
        });

        const handleClick = (event: { originalEvent?: MouseEvent }) => {
          event.originalEvent?.stopPropagation();
          onToggleLabel(area.area_id);
        };

        return (
          <Fragment key={area.area_id}>
            <Polygon
              positions={positions}
              interactive={true}
              bubblingMouseEvents={false}
              pathOptions={getAreaPolygonStyle(area.name)}
              eventHandlers={{ click: handleClick }}
            />
            {isLabelVisible ? <Marker position={center} icon={labelIcon} interactive={false} /> : null}
          </Fragment>
        );
      })}
    </>
  );
}