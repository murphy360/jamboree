import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import type { TileLocation } from "../hooks/useTileLocations";

type LiveMapProps = {
  locations: TileLocation[];
};

const DEFAULT_CENTER: [number, number] = [38.076, -81.073];

type FitToLocationsProps = {
  locations: TileLocation[];
};

function FitToLocations({ locations }: FitToLocationsProps) {
  const map = useMap();

  useEffect(() => {
    if (locations.length === 0) {
      return;
    }

    if (locations.length === 1) {
      const onlyTile = locations[0];
      map.setView([onlyTile.latitude, onlyTile.longitude], 19, { animate: false });
      return;
    }

    const bounds: [number, number][] = locations.map((item) => [item.latitude, item.longitude]);
    map.fitBounds(bounds, {
      animate: false,
      maxZoom: 19,
      padding: [28, 28],
    });
  }, [locations, map]);

  return null;
}

export function LiveMap({ locations }: LiveMapProps) {
  return (
    <section className="map-frame">
      <MapContainer center={DEFAULT_CENTER} zoom={14} className="map-canvas">
        <FitToLocations locations={locations} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {locations.map((item) => (
          <Marker key={item.tile_uuid} position={[item.latitude, item.longitude]}>
            <Popup>
              <strong>{item.label}</strong>
              <br />
              Lat: {item.latitude.toFixed(5)}
              <br />
              Lng: {item.longitude.toFixed(5)}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </section>
  );
}
