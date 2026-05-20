export type AreaPolygonPoint = {
  latitude: number;
  longitude: number;
};

export type CustomArea = {
  area_id: string;
  tile_uuid: string;
  name: string;
  polygon: AreaPolygonPoint[];
  samples: number;
  minutes_spent: number;
  created_at: string;
  updated_at: string;
};
