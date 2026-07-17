import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import * as EsriLeaflet from "esri-leaflet";

type ArcGISLayersProps = {
  showNSJRegions?: boolean;
  showSummitLakes?: boolean;
};

export function ArcGISLayers({
  showNSJRegions = true,
  showSummitLakes = true,
}: ArcGISLayersProps) {
  const map = useMap();

  useEffect(() => {
    const layers: L.Layer[] = [];

    // Add NSJ General Regions overlay
    if (showNSJRegions) {
      try {
        const featureLayer = EsriLeaflet.featureLayer({
          url: "https://services1.arcgis.com/RpUtm89cWZfyYWZf/ArcGIS/rest/services/NSJ_General_Regions/FeatureServer/0",
          style: () => ({
            color: "#0078D4",
            weight: 2,
            opacity: 0.7,
            fillOpacity: 0.1,
          }),
        });
        featureLayer.addTo(map);
        layers.push(featureLayer);
      } catch (e) {
        console.error("Failed to load NSJ_General_Regions:", e);
      }
    }

    if (showSummitLakes) {
      try {
        const featureLayer = EsriLeaflet.featureLayer({
          url: "https://services1.arcgis.com/RpUtm89cWZfyYWZf/arcgis/rest/services/Summit_Lakes/FeatureServer/0",
          style: () => ({
            color: "#14b8a6",
            weight: 2,
            opacity: 0.8,
            fillOpacity: 0.08,
          }),
        });
        featureLayer.addTo(map);
        layers.push(featureLayer);
      } catch (e) {
        console.error("Failed to load Summit_Lakes:", e);
      }
    }

    return () => {
      layers.forEach((layer) => {
        if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      });
    };
  }, [map, showNSJRegions]);

  return null;
}
