import { BoundingBox, fetchElevationGrid } from './elevationService';
import { fetchOverpassData } from './overpassService';
import { GeoTransformer, DigitalTwinDataset } from '../utils/GeoTransformer';

export interface IngestionParams {
  lat: number;
  lon: number;
  name: string;
  boxSizeMeters?: number;
  onProgress?: (step: string, percent: number) => void;
}

/**
 * Master Ingestion Pipeline
 * Coordinates DEM elevation fetching, Overpass vector extraction, and Mercator coordinate transformation.
 */
export async function runIngestionPipeline(
  params: IngestionParams
): Promise<DigitalTwinDataset> {
  const { lat, lon, name, boxSizeMeters = 800, onProgress } = params;

  // 1. Calculate Bounding Box around center (boxSizeMeters x boxSizeMeters)
  onProgress?.('Resolving WGS84 Geodetic Frame & Bounding Box...', 15);

  const halfM = boxSizeMeters / 2;
  const dLat = halfM / 111320.0;
  const latRad = (lat * Math.PI) / 180.0;
  const dLon = halfM / (111320.0 * Math.max(0.1, Math.cos(latRad)));

  const bbox: BoundingBox = {
    south: parseFloat((lat - dLat).toFixed(6)),
    north: parseFloat((lat + dLat).toFixed(6)),
    west: parseFloat((lon - dLon).toFixed(6)),
    east: parseFloat((lon + dLon).toFixed(6)),
  };

  // 2. Fetch Terrain Elevation Grid (DEM) asynchronously
  onProgress?.('Querying Open-Meteo Elevation Grid (DEM)...', 35);
  const elevationGridPromise = fetchElevationGrid(bbox, 90, 90);

  // 3. Fetch Vector Infrastructure (Buildings, Roads, Lifelines)
  onProgress?.('Extracting OSM 3D Buildings, Highways & Lifelines...', 60);
  const overpassPromise = fetchOverpassData(bbox);

  // Await both in parallel
  const [elevationGrid, overpassData] = await Promise.all([
    elevationGridPromise,
    overpassPromise,
  ]);

  // 4. Coordinate Transformation & Geometry Parsing
  onProgress?.('Running Mercator Coordinate Transformation...', 85);
  const transformer = new GeoTransformer(lat, lon, name, bbox, 90, 90);
  const dataset = transformer.transform(elevationGrid, overpassData);

  // 5. Finalize
  onProgress?.('Digital Twin Ingestion Complete. Initializing Viewport...', 100);
  return dataset;
}
