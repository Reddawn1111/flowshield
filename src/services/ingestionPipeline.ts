import { BoundingBox, fetchElevationGrid } from './elevationService';
import { fetchOverpassData } from './overpassService';
import { GeoTransformer, DigitalTwinDataset } from '../utils/GeoTransformer';
import {
  calculateBufferedBBox,
  fetchNearbyWaterways,
  evaluateHydrologicalInfluence,
} from './riverHydrologyService';

export interface IngestionParams {
  lat: number;
  lon: number;
  name: string;
  boxSizeMeters?: number;
  onProgress?: (step: string, percent: number) => void;
}

/**
 * Master Ingestion Pipeline
 * Coordinates DEM elevation fetching, Overpass vector extraction,
 * expanded 2.5 km waterway buffer queries, and Mercator coordinate transformation.
 */
export async function runIngestionPipeline(
  params: IngestionParams
): Promise<DigitalTwinDataset> {
  const { lat, lon, name, boxSizeMeters = 800, onProgress } = params;

  // 1. Calculate Bounding Box around center using direct geodesic formula
  onProgress?.('Resolving WGS84 Geodetic Frame & Bounding Box...', 15);

  const bboxSpanKm = (boxSizeMeters || 800) / 1000.0;
  const halfSpanLat = (bboxSpanKm / 2.0) / 111.0;
  const halfSpanLon = (bboxSpanKm / 2.0) / (111.0 * Math.cos((lat * Math.PI) / 180.0));

  const bbox: BoundingBox = {
    south: parseFloat((lat - halfSpanLat).toFixed(6)),
    north: parseFloat((lat + halfSpanLat).toFixed(6)),
    west: parseFloat((lon - halfSpanLon).toFixed(6)),
    east: parseFloat((lon + halfSpanLon).toFixed(6)),
  };

  // Expanded 2.5 km search buffer for nearby rivers & waterways
  const bufferedBBox = calculateBufferedBBox(bbox, 2.5);

  // 2. Fetch Terrain Elevation and 3D Infrastructure concurrently (different endpoints, zero collision)
  onProgress?.('Fetching Terrain Elevation & 3D Infrastructure...', 30);

  const elevationGridPromise = fetchElevationGrid(bbox, 90, 90)
    .then((res) => {
      onProgress?.('Elevation Grid Loaded...', 45);
      return res;
    })
    .catch((err) => {
      console.warn('Elevation fetch fallback:', err);
      return new Float32Array(90 * 90);
    });

  const overpassPromise = fetchOverpassData(bbox, bboxSpanKm)
    .then((res) => {
      onProgress?.('3D Infrastructure Loaded...', 65);
      return res;
    })
    .catch((err) => {
      console.warn('Overpass fetch fallback:', err);
      return { version: 0.6, generator: 'Fallback', elements: [] };
    });

  // Await Elevation & 3D Vector Ingestion
  const [elevationGrid, overpassData] = await Promise.all([
    elevationGridPromise,
    overpassPromise,
  ]);

  // 3. Coordinate Transformation & Geometry Parsing
  onProgress?.('Generating 3D Digital Twin Diorama...', 80);
  const transformer = new GeoTransformer(lat, lon, name, bbox, 90, 90, bboxSpanKm);
  const dataset = transformer.transform(elevationGrid, overpassData);

  // 4. Hydrological Influence Evaluation
  onProgress?.('Evaluating Regional Waterways & Watershed...', 90);

  try {
    // Fast path: Check if overpassData already contains internal waterways/rivers inside the sector
    const internalWaterways = overpassData.elements.filter((el) => {
      const w = el.tags?.waterway;
      const n = el.tags?.natural;
      return (
        w === 'river' ||
        w === 'canal' ||
        w === 'riverbank' ||
        w === 'stream' ||
        n === 'water'
      );
    });

    if (internalWaterways.length > 0 || (dataset.waterBodies && dataset.waterBodies.length > 0)) {
      const namedRiver = internalWaterways.find((el) => el.tags?.name);
      const riverName = namedRiver?.tags?.name || 'Active River Channel';
      dataset.riverInflowStatus = {
        active: true,
        type: 'internal',
        name: riverName,
      };
    } else {
      // Mark as checking state for asynchronous background query
      dataset.riverInflowStatus = {
        active: false,
        checking: true,
        type: 'checking',
        name: 'Checking for nearby rivers...',
      };
    }
  } catch (hydroErr) {
    console.warn('Hydrological influence evaluation fallback:', hydroErr);
    dataset.riverInflowStatus = {
      active: false,
      checking: true,
      type: 'checking',
      name: 'Checking for nearby rivers...',
    };
  }

  // 5. Finalize
  onProgress?.('Digital Twin Ready. Initializing Viewport...', 100);
  return dataset;
}
