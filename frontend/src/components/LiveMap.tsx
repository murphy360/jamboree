import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import type { TileLocation } from "../hooks/useTileLocations";

type LiveMapProps = {
  locations: TileLocation[];
};

const DEFAULT_CENTER: [number, number] = [38.076, -81.073];

export function LiveMap({ locations }: LiveMapProps) {
  return (
    <section className="map-frame">
      <MapContainer center={DEFAULT_CENTER} zoom={14} className="map-canvas">
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
