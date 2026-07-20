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

    const getFeatureLabel = (properties: Record<string, unknown> | undefined): string | null => {
      const labelKeys = ["NAME", "Name", "name", "LABEL", "Label", "label", "TITLE", "Title", "title"];

      for (const key of labelKeys) {
        const value = properties?.[key];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }

      return null;
    };

    const addToggleableFeatureLayer = (url: string, styleColor: string, fillOpacity: number) => {
      const featureLayer = EsriLeaflet.featureLayer({
        url,
        style: () => ({
          color: styleColor,
          weight: 2,
          opacity: 0.85,
          fillOpacity,
        }),
      });

      featureLayer.on("createfeature", (event: { layer?: L.Layer; feature?: { properties?: Record<string, unknown> } }) => {
        const layer = event.layer;
        if (!layer || !(layer instanceof L.Path)) {
          return;
        }

        const label = getFeatureLabel(event.feature?.properties);
        if (!label) {
          return;
        }

        layer.bindTooltip(label, {
          direction: "center",
          className: "map-area-label",
          sticky: false,
          permanent: false,
          opacity: 1,
        });

        layer.on("click", (clickEvent: L.LeafletMouseEvent) => {
          clickEvent.originalEvent?.stopPropagation();
          if (layer.isTooltipOpen()) {
            layer.closeTooltip();
            return;
          }

          layer.openTooltip(clickEvent.latlng);
        });
      });

      featureLayer.addTo(map);
      layers.push(featureLayer);
    };

    // Add NSJ General Regions overlay
    if (showNSJRegions) {
      try {
        addToggleableFeatureLayer(
          "https://services1.arcgis.com/RpUtm89cWZfyYWZf/ArcGIS/rest/services/NSJ_General_Regions/FeatureServer/0",
          "#0078D4",
          0.1,
        );
      } catch (e) {
        console.error("Failed to load NSJ_General_Regions:", e);
      }
    }

    if (showSummitLakes) {
      try {
        addToggleableFeatureLayer(
          "https://services1.arcgis.com/RpUtm89cWZfyYWZf/arcgis/rest/services/Summit_Lakes/FeatureServer/0",
          "#14b8a6",
          0.08,
        );
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
  }, [map, showNSJRegions, showSummitLakes]);

  return null;
}
