import { BoundingBox } from '../services/elevationService';
import { OverpassResponse, OverpassElement } from '../services/overpassService';

export interface DigitalTwinDataset {
  center: { lat: number; lon: number; name: string };
  gridDimensions: { width: number; height: number; cellSizeMeters: number };
  elevationGrid: Float32Array; // 2D grid flattened, size width * height
  buildings: Array<{
    id: string;
    footprint: Array<[number, number]>; // local (x, z) vertices in meters
    height: number;
    baseElevation: number;
  }>;
  roads: Array<{
    id: string;
    type: string;
    points: Array<[number, number]>; // local (x, z) points in meters
  }>;
  waterBodies: Array<{
    id: string;
    type: string;
    points: Array<[number, number]>; // local (x, z) points in meters
    isClosed: boolean;
  }>;
  criticalAssets: Array<{
    id: string;
    type: 'hospital' | 'power' | 'metro';
    name: string;
    gridX: number;
    gridY: number;
    position: [number, number, number]; // local (x, y, z)
  }>;
}

const EARTH_RADIUS = 6378137.0; // WGS84 equatorial radius in meters

/**
 * Cohen-Sutherland Line Clipping Algorithm
 * Strictly limits road segments to the active diorama bounding box [-minX, maxX] x [-minZ, maxZ]
 */
function computeOutCode(x: number, z: number, minX: number, maxX: number, minZ: number, maxZ: number): number {
  let code = 0;
  if (x < minX) code |= 1; // Left
  else if (x > maxX) code |= 2; // Right
  if (z < minZ) code |= 4; // Bottom
  else if (z > maxZ) code |= 8; // Top
  return code;
}

function clipSegment(
  x1: number, z1: number,
  x2: number, z2: number,
  minX: number, maxX: number,
  minZ: number, maxZ: number
): [[number, number], [number, number]] | null {
  let code1 = computeOutCode(x1, z1, minX, maxX, minZ, maxZ);
  let code2 = computeOutCode(x2, z2, minX, maxX, minZ, maxZ);
  let accept = false;

  let xA = x1, zA = z1, xB = x2, zB = z2;

  while (true) {
    if ((code1 | code2) === 0) {
      accept = true;
      break;
    } else if ((code1 & code2) !== 0) {
      break;
    } else {
      const codeOut = code1 !== 0 ? code1 : code2;
      let x = 0, z = 0;

      if (codeOut & 8) { // TOP
        x = xA + ((xB - xA) * (maxZ - zA)) / (zB - zA);
        z = maxZ;
      } else if (codeOut & 4) { // BOTTOM
        x = xA + ((xB - xA) * (minZ - zA)) / (zB - zA);
        z = minZ;
      } else if (codeOut & 2) { // RIGHT
        z = zA + ((zB - zA) * (maxX - xA)) / (xB - xA);
        x = maxX;
      } else if (codeOut & 1) { // LEFT
        z = zA + ((zB - zA) * (minX - xA)) / (xB - xA);
        x = minX;
      }

      if (codeOut === code1) {
        xA = x;
        zA = z;
        code1 = computeOutCode(xA, zA, minX, maxX, minZ, maxZ);
      } else {
        xB = x;
        zB = z;
        code2 = computeOutCode(xB, zB, minX, maxX, minZ, maxZ);
      }
    }
  }

  if (accept) {
    return [
      [parseFloat(xA.toFixed(2)), parseFloat(zA.toFixed(2))],
      [parseFloat(xB.toFixed(2)), parseFloat(zB.toFixed(2))]
    ];
  }
  return null;
}

export class GeoTransformer {
  private centerLat: number;
  private centerLon: number;
  private locationName: string;
  private bbox: BoundingBox;
  private gridWidth: number;
  private gridHeight: number;
  private spanMetersX: number;
  private spanMetersZ: number;

  constructor(
    centerLat: number,
    centerLon: number,
    locationName: string,
    bbox: BoundingBox,
    gridWidth: number = 90,
    gridHeight: number = 90
  ) {
    this.centerLat = centerLat;
    this.centerLon = centerLon;
    this.locationName = locationName;
    this.bbox = bbox;
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;

    // Compute bounding box dimensions in meters
    const [minX, minZ] = this.project(bbox.south, bbox.west);
    const [maxX, maxZ] = this.project(bbox.north, bbox.east);
    this.spanMetersX = Math.max(200, Math.abs(maxX - minX));
    this.spanMetersZ = Math.max(200, Math.abs(maxZ - minZ));
  }

  /**
   * Project WGS84 (lat, lon) to local Cartesian meters (X, Z) centered at (0, 0)
   * Formula:
   *   X = (lon - lon_center) * (pi / 180) * R * cos(lat_center * pi / 180)
   *   Z = -(lat - lat_center) * (pi / 180) * R
   */
  public project(lat: number, lon: number): [number, number] {
    const latCenterRad = (this.centerLat * Math.PI) / 180.0;
    const x =
      (lon - this.centerLon) *
      (Math.PI / 180.0) *
      EARTH_RADIUS *
      Math.cos(latCenterRad);
    const z = -((lat - this.centerLat) * (Math.PI / 180.0) * EARTH_RADIUS);
    return [parseFloat(x.toFixed(2)), parseFloat(z.toFixed(2))];
  }

  /**
   * Map local Cartesian (X, Z) to grid cell indices [gridX, gridY]
   */
  public toGridCoords(x: number, z: number): [number, number] {
    const u = (x + this.spanMetersX / 2) / this.spanMetersX;
    const v = (z + this.spanMetersZ / 2) / this.spanMetersZ;

    const gx = Math.floor(u * this.gridWidth);
    const gy = Math.floor(v * this.gridHeight);

    const clampedX = Math.max(0, Math.min(this.gridWidth - 1, gx));
    const clampedY = Math.max(0, Math.min(this.gridHeight - 1, gy));
    return [clampedX, clampedY];
  }

  /**
   * Sample elevation from DEM at grid coordinates (gx, gy)
   */
  public sampleElevation(elevationGrid: Float32Array, gx: number, gy: number): number {
    const idx = gy * this.gridWidth + gx;
    return elevationGrid[idx] || 0.8;
  }

  /**
   * Transform raw Overpass data + Elevation grid into strongly-typed DigitalTwinDataset
   */
  public transform(
    elevationGrid: Float32Array,
    overpassData: OverpassResponse
  ): DigitalTwinDataset {
    // 1. Build node lookup map & relation index
    const nodeMap = new Map<number, { lat: number; lon: number; tags?: Record<string, string> }>();
    const waterWayIds = new Set<number>();

    for (const el of overpassData.elements) {
      if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
        nodeMap.set(el.id, { lat: el.lat, lon: el.lon, tags: el.tags });
      } else if (
        el.type === 'relation' &&
        el.tags &&
        (el.tags.natural === 'water' ||
          el.tags.natural === 'bay' ||
          el.tags.natural === 'coastline' ||
          el.tags.waterway === 'riverbank' ||
          el.tags.waterway === 'dock' ||
          el.tags.water !== undefined)
      ) {
        if (el.members) {
          for (const m of el.members) {
            if (m.type === 'way') {
              waterWayIds.add(m.ref);
            }
          }
        }
      }
    }

    const buildings: DigitalTwinDataset['buildings'] = [];
    const roads: DigitalTwinDataset['roads'] = [];
    const waterBodies: DigitalTwinDataset['waterBodies'] = [];
    const criticalAssets: DigitalTwinDataset['criticalAssets'] = [];

    // Track critical asset positions to avoid overlapping duplicates
    const placedAssetCells = new Set<string>();

    for (const el of overpassData.elements) {
      // -------------------------------------------------------------
      // 2. PARSE BUILDINGS
      // -------------------------------------------------------------
      if (el.type === 'way' && el.tags && el.tags.building && el.nodes && el.nodes.length >= 3) {
        const footprint: Array<[number, number]> = [];
        let sumX = 0;
        let sumZ = 0;
        let validPoints = 0;

        for (const nodeId of el.nodes) {
          const node = nodeMap.get(nodeId);
          if (node) {
            const [x, z] = this.project(node.lat, node.lon);
            footprint.push([x, z]);
            sumX += x;
            sumZ += z;
            validPoints++;
          }
        }

        if (footprint.length >= 3 && validPoints > 0) {
          const centroidX = sumX / validPoints;
          const centroidZ = sumZ / validPoints;
          const halfW = this.spanMetersX / 2;
          const halfH = this.spanMetersZ / 2;
          if (centroidX < -halfW || centroidX > halfW || centroidZ < -halfH || centroidZ > halfH) {
            continue; // Skip buildings outside bounding box
          }
          const [gx, gy] = this.toGridCoords(centroidX, centroidZ);
          const baseElevation = this.sampleElevation(elevationGrid, gx, gy);

          // Extract height
          let height = 10.5; // default 3 stories
          if (el.tags.height) {
            const parsed = parseFloat(el.tags.height);
            if (!isNaN(parsed) && parsed > 0) height = parsed;
          } else if (el.tags['building:levels']) {
            const levels = parseFloat(el.tags['building:levels']);
            if (!isNaN(levels) && levels > 0) height = levels * 3.5;
          }

          buildings.push({
            id: `bldg_${el.id}`,
            footprint,
            height: parseFloat(height.toFixed(1)),
            baseElevation: parseFloat(baseElevation.toFixed(2)),
          });
        }
      }

      // -------------------------------------------------------------
      // 3. PARSE ROADS (With Strict Cohen-Sutherland Bounding Box Clipping)
      // -------------------------------------------------------------
      if (el.type === 'way' && el.tags && el.tags.highway && el.nodes && el.nodes.length >= 2) {
        const rawPoints: Array<[number, number]> = [];
        for (const nodeId of el.nodes) {
          const node = nodeMap.get(nodeId);
          if (node) {
            rawPoints.push(this.project(node.lat, node.lon));
          }
        }

        const halfW = this.spanMetersX / 2;
        const halfH = this.spanMetersZ / 2;

        let currentChain: Array<[number, number]> = [];
        for (let i = 0; i < rawPoints.length - 1; i++) {
          const clipped = clipSegment(
            rawPoints[i][0], rawPoints[i][1],
            rawPoints[i + 1][0], rawPoints[i + 1][1],
            -halfW, halfW, -halfH, halfH
          );
          if (clipped) {
            const [pA, pB] = clipped;
            if (currentChain.length === 0) {
              currentChain.push(pA, pB);
            } else {
              const last = currentChain[currentChain.length - 1];
              if (Math.hypot(last[0] - pA[0], last[1] - pA[1]) < 0.1) {
                currentChain.push(pB);
              } else {
                if (currentChain.length >= 2) {
                  roads.push({
                    id: `road_${el.id}_${roads.length}`,
                    type: el.tags.highway,
                    points: currentChain,
                  });
                }
                currentChain = [pA, pB];
              }
            }
          } else {
            if (currentChain.length >= 2) {
              roads.push({
                id: `road_${el.id}_${roads.length}`,
                type: el.tags.highway,
                points: currentChain,
              });
            }
            currentChain = [];
          }
        }
        if (currentChain.length >= 2) {
          roads.push({
            id: `road_${el.id}_${roads.length}`,
            type: el.tags.highway,
            points: currentChain,
          });
        }
      }

      // -------------------------------------------------------------
      // 4. PARSE CRITICAL INFRASTRUCTURE (Hospitals, Power, Metro)
      // -------------------------------------------------------------
      const tags = el.tags || {};
      let assetType: 'hospital' | 'power' | 'metro' | null = null;
      let assetName = tags.name || '';

      if (tags.amenity === 'hospital') {
        assetType = 'hospital';
        if (!assetName) assetName = 'Medical Center Emergency Ward';
      } else if (tags.power === 'substation' || tags['power:generator']) {
        assetType = 'power';
        if (!assetName) assetName = 'Regional Power Substation';
      } else if (tags.railway === 'station' || tags.station === 'subway' || tags.subway === 'yes') {
        assetType = 'metro';
        if (!assetName) assetName = 'Rapid Transit Metro Station';
      }

      if (assetType) {
        let lat = el.lat;
        let lon = el.lon;

        // If way, compute centroid
        if (el.type === 'way' && el.nodes && el.nodes.length > 0) {
          let sLat = 0, sLon = 0, count = 0;
          for (const nid of el.nodes) {
            const n = nodeMap.get(nid);
            if (n) {
              sLat += n.lat;
              sLon += n.lon;
              count++;
            }
          }
          if (count > 0) {
            lat = sLat / count;
            lon = sLon / count;
          }
        }

        if (lat !== undefined && lon !== undefined) {
          const [x, z] = this.project(lat, lon);
          const [gx, gy] = this.toGridCoords(x, z);
          const cellKey = `${gx},${gy}`;

          if (!placedAssetCells.has(cellKey)) {
            placedAssetCells.add(cellKey);
            const groundY = this.sampleElevation(elevationGrid, gx, gy);

            criticalAssets.push({
              id: `asset_${el.id}`,
              type: assetType,
              name: assetName,
              gridX: gx,
              gridY: gy,
              position: [x, groundY, z],
            });
          }
        }
      }

      // -------------------------------------------------------------
      // 5. PARSE WATER BODIES (Lakes, Bays, Reservoirs, Rivers, Docks, Coastlines)
      // -------------------------------------------------------------
      const isWaterBody =
        ((el.tags &&
          (el.tags.natural === 'water' ||
            el.tags.natural === 'bay' ||
            el.tags.natural === 'coastline' ||
            el.tags.natural === 'harbour' ||
            el.tags.waterway === 'river' ||
            el.tags.waterway === 'canal' ||
            el.tags.waterway === 'dock' ||
            el.tags.waterway === 'riverbank' ||
            el.tags.waterway === 'stream' ||
            el.tags.waterway === 'weir' ||
            el.tags.waterway === 'floating_barrier' ||
            el.tags.water !== undefined ||
            el.tags.landuse === 'basin' ||
            el.tags.landuse === 'reservoir' ||
            el.tags.seamark !== undefined) &&
          el.tags.amenity !== 'fountain') ||
          waterWayIds.has(el.id));

      if (el.type === 'way' && isWaterBody && el.nodes && el.nodes.length >= 2) {
        const rawPoints: Array<[number, number]> = [];
        for (const nodeId of el.nodes) {
          const node = nodeMap.get(nodeId);
          if (node) {
            const [x, z] = this.project(node.lat, node.lon);
            rawPoints.push([x, z]);
          }
        }
        if (rawPoints.length >= 2) {
          const isClosed = el.nodes[0] === el.nodes[el.nodes.length - 1];
          waterBodies.push({
            id: `water_${el.id}`,
            type: el.tags?.natural || el.tags?.waterway || el.tags?.water || 'water',
            points: rawPoints,
            isClosed,
          });
        }
      }
    }

    // Ensure we always have baseline critical infrastructure for simulation gameplay
    if (!criticalAssets.some(a => a.type === 'hospital')) {
      const gx = Math.floor(this.gridWidth * 0.72);
      const gy = Math.floor(this.gridHeight * 0.62);
      const x = (gx / this.gridWidth - 0.5) * this.spanMetersX;
      const z = (gy / this.gridHeight - 0.5) * this.spanMetersZ;
      criticalAssets.push({
        id: 'asset_synth_hosp',
        type: 'hospital',
        name: `${this.locationName} Emergency Hospital`,
        gridX: gx,
        gridY: gy,
        position: [x, this.sampleElevation(elevationGrid, gx, gy), z],
      });
    }

    if (!criticalAssets.some(a => a.type === 'power')) {
      const gx = Math.floor(this.gridWidth * 0.35);
      const gy = Math.floor(this.gridHeight * 0.55);
      const x = (gx / this.gridWidth - 0.5) * this.spanMetersX;
      const z = (gy / this.gridHeight - 0.5) * this.spanMetersZ;
      criticalAssets.push({
        id: 'asset_synth_pwr',
        type: 'power',
        name: `${this.locationName} Central Power Substation`,
        gridX: gx,
        gridY: gy,
        position: [x, this.sampleElevation(elevationGrid, gx, gy), z],
      });
    }

    if (!criticalAssets.some(a => a.type === 'metro')) {
      const gx = Math.floor(this.gridWidth * 0.48);
      const gy = Math.floor(this.gridHeight * 0.48);
      const x = (gx / this.gridWidth - 0.5) * this.spanMetersX;
      const z = (gy / this.gridHeight - 0.5) * this.spanMetersZ;
      criticalAssets.push({
        id: 'asset_synth_metro',
        type: 'metro',
        name: `${this.locationName} Central Subway Station`,
        gridX: gx,
        gridY: gy,
        position: [x, this.sampleElevation(elevationGrid, gx, gy), z],
      });
    }

    const cellSizeMeters = parseFloat((this.spanMetersX / this.gridWidth).toFixed(2));

    return {
      center: {
        lat: this.centerLat,
        lon: this.centerLon,
        name: this.locationName,
      },
      gridDimensions: {
        width: this.gridWidth,
        height: this.gridHeight,
        cellSizeMeters,
      },
      elevationGrid,
      buildings,
      roads,
      waterBodies,
      criticalAssets,
    };
  }
}
