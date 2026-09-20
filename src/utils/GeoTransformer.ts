import { BoundingBox } from '../services/elevationService';
import { OverpassResponse, OverpassElement } from '../services/overpassService';
import { RiverInflowStatus } from '../types/simulation';

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
  railways?: Array<{
    id: string;
    type: 'rail' | 'subway' | 'light_rail' | 'tram';
    isUnderground: boolean;
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
  riverInflowStatus?: RiverInflowStatus;
  bboxSpanKm?: number;
  bbox?: BoundingBox;
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
  private bboxSpanKm: number;

  constructor(
    centerLat: number,
    centerLon: number,
    locationName: string,
    bbox: BoundingBox,
    gridWidth: number = 90,
    gridHeight: number = 90,
    bboxSpanKm?: number
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
    this.bboxSpanKm = bboxSpanKm || parseFloat((this.spanMetersX / 1000.0).toFixed(3));
  }

  /**
   * Project WGS84 (lat, lon) to local Cartesian meters (X, Z) centered at (0, 0)
   * Uses exact geodesic degree meters:
   *   metersPerLonDegree = (pi / 180) * R * cos(lat_center * pi / 180)
   *   metersPerLatDegree = (pi / 180) * R
   */
  public project(lat: number, lon: number): [number, number] {
    const latCenterRad = (this.centerLat * Math.PI) / 180.0;
    const metersPerLonDegree = (Math.PI / 180.0) * EARTH_RADIUS * Math.cos(latCenterRad);
    const metersPerLatDegree = (Math.PI / 180.0) * EARTH_RADIUS;

    const x = (lon - this.centerLon) * metersPerLonDegree;
    const z = -((lat - this.centerLat) * metersPerLatDegree);
    return [parseFloat(x.toFixed(2)), parseFloat(z.toFixed(2))];
  }

  /**
   * Map local Cartesian (X, Z) to grid cell indices [gridX, gridY]
   * Incorporates scale = DIORAMA_WORLD_SIZE / (bboxSpanKm * 1000)
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
   * MultiPolygon Stitching
   * Assembles outer and inner member ways into closed polygon boundaries and holes
   */
  public stitchMultiPolygon(
    members: Array<{ type: string; ref: number; role?: string }>,
    wayMap: Map<number, OverpassElement>,
    nodeMap: Map<number, { lat: number; lon: number }>
  ): { outerRings: Array<Array<[number, number]>>; innerRings: Array<Array<[number, number]>> } {
    const outerWaySegments: number[][] = [];
    const innerWaySegments: number[][] = [];

    for (const m of members) {
      if (m.type !== 'way') continue;
      const way = wayMap.get(m.ref);
      if (!way || !way.nodes || way.nodes.length < 2) continue;

      const wTags = way.tags || {};
      const isSubterranean =
        wTags.tunnel === 'yes' ||
        wTags.tunnel === 'culvert' ||
        wTags.covered === 'yes' ||
        wTags.location === 'underground' ||
        (wTags.layer !== undefined && parseInt(wTags.layer) < 0);
      if (isSubterranean) continue;

      const role = (m.role || 'outer').toLowerCase();
      if (role === 'inner') {
        innerWaySegments.push([...way.nodes]);
      } else {
        outerWaySegments.push([...way.nodes]);
      }
    }

    const stitchSegments = (segments: number[][]): Array<Array<[number, number]>> => {
      const closedRings: Array<Array<[number, number]>> = [];
      const openSegments = [...segments];

      while (openSegments.length > 0) {
        let currentChain = openSegments.shift()!;

        let extended = true;
        while (extended) {
          extended = false;
          if (currentChain.length >= 4 && currentChain[0] === currentChain[currentChain.length - 1]) {
            break;
          }

          const lastNode = currentChain[currentChain.length - 1];
          const firstNode = currentChain[0];

          for (let i = 0; i < openSegments.length; i++) {
            const seg = openSegments[i];
            if (seg.length < 2) continue;

            if (seg[0] === lastNode) {
              currentChain.push(...seg.slice(1));
              openSegments.splice(i, 1);
              extended = true;
              break;
            } else if (seg[seg.length - 1] === lastNode) {
              const rev = [...seg].reverse();
              currentChain.push(...rev.slice(1));
              openSegments.splice(i, 1);
              extended = true;
              break;
            } else if (seg[seg.length - 1] === firstNode) {
              currentChain.unshift(...seg.slice(0, -1));
              openSegments.splice(i, 1);
              extended = true;
              break;
            } else if (seg[0] === firstNode) {
              const rev = [...seg].reverse();
              currentChain.unshift(...rev.slice(0, -1));
              openSegments.splice(i, 1);
              extended = true;
              break;
            }
          }
        }

        const pts: Array<[number, number]> = [];
        for (const nid of currentChain) {
          const n = nodeMap.get(nid);
          if (n) {
            pts.push(this.project(n.lat, n.lon));
          }
        }

        if (pts.length >= 3) {
          closedRings.push(pts);
        }
      }

      return closedRings;
    };

    return {
      outerRings: stitchSegments(outerWaySegments),
      innerRings: stitchSegments(innerWaySegments),
    };
  }

  /**
   * Transform raw Overpass data + Elevation grid into strongly-typed DigitalTwinDataset
   */
  public transform(
    elevationGrid: Float32Array,
    overpassData: OverpassResponse
  ): DigitalTwinDataset {
    // 1. Build node lookup map, way lookup map & relation index
    const nodeMap = new Map<number, { lat: number; lon: number; tags?: Record<string, string> }>();
    const wayMap = new Map<number, OverpassElement>();
    const waterWayIds = new Set<number>();

    for (const el of overpassData.elements) {
      if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
        nodeMap.set(el.id, { lat: el.lat, lon: el.lon, tags: el.tags });
      } else if (el.type === 'way') {
        wayMap.set(el.id, el);
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
              const way = wayMap.get(m.ref);
              const wTags = way?.tags || {};
              const isSubterranean =
                wTags.tunnel === 'yes' ||
                wTags.tunnel === 'culvert' ||
                wTags.covered === 'yes' ||
                wTags.location === 'underground' ||
                (wTags.layer !== undefined && parseInt(wTags.layer) < 0);
              if (!isSubterranean) {
                waterWayIds.add(m.ref);
              }
            }
          }
        }
      }
    }

    const buildings: DigitalTwinDataset['buildings'] = [];
    const roads: DigitalTwinDataset['roads'] = [];
    const railways: NonNullable<DigitalTwinDataset['railways']> = [];
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

          // Compute polygon footprint area
          let area = 0;
          for (let pi = 0; pi < footprint.length; pi++) {
            const [x1, z1] = footprint[pi];
            const [x2, z2] = footprint[(pi + 1) % footprint.length];
            area += (x1 * z2 - x2 * z1);
          }
          area = Math.abs(area) / 2;

          // Extract height or derive realistic architectural height variation
          let height: number;
          if (el.tags.height) {
            const parsed = parseFloat(el.tags.height);
            height = !isNaN(parsed) && parsed > 0 ? parsed : 10.5;
          } else if (el.tags['building:levels']) {
            const levels = parseFloat(el.tags['building:levels']);
            height = !isNaN(levels) && levels > 0 ? levels * 3.5 : 10.5;
          } else {
            // Procedural architectural height derivation based on typology, area & deterministic hash
            const bldgType = (el.tags.building || '').toLowerCase();
            const hash = Math.abs((el.id * 2654435761) ^ (Math.floor(centroidX * 10) * 73856093)) % 100;

            if (/commercial|office|retail|bank/.test(bldgType)) {
              const stories = 4 + (hash % 10); // 4 to 13 stories
              height = stories * 3.6;
            } else if (/apartments|hotel|dormitory/.test(bldgType)) {
              const stories = 3 + (hash % 8); // 3 to 10 stories
              height = stories * 3.4;
            } else if (/house|detached|terrace|cabin|shed|bungalow/.test(bldgType)) {
              const stories = 1 + (hash % 3); // 1 to 3 stories
              height = stories * 3.2;
            } else if (/industrial|warehouse/.test(bldgType)) {
              height = 7.0 + (hash % 6);
            } else {
              // Generic building: scale by footprint area + deterministic distribution
              if (area > 800) {
                // Large footprint: civic or major commercial complex (occasional signature high-rise)
                const stories = hash > 85 ? 14 + (hash % 12) : 5 + (hash % 7);
                height = stories * 3.5;
              } else if (area > 300) {
                // Medium footprint: 3 to 8 stories
                const stories = 3 + (hash % 6);
                height = stories * 3.4;
              } else {
                // Small footprint: 1 to 4 stories
                const stories = 1 + (hash % 4);
                height = stories * 3.2;
              }
            }
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
      // 2B. PARSE MULTIPOLYGON BUILDINGS & RELATIONS (Shibuya Scramble Square, Station, Hikarie)
      // -------------------------------------------------------------
      if (
        el.type === 'relation' &&
        el.tags &&
        (el.tags.building !== undefined || el.tags.type === 'multipolygon') &&
        el.members &&
        el.members.length > 0
      ) {
        const stitched = this.stitchMultiPolygon(el.members, wayMap, nodeMap);

        let height = 18.0; // default for complex relation structures
        if (el.tags.height) {
          const parsed = parseFloat(el.tags.height);
          if (!isNaN(parsed) && parsed > 0) height = parsed;
        } else if (el.tags['building:levels']) {
          const levels = parseFloat(el.tags['building:levels']);
          if (!isNaN(levels) && levels > 0) height = levels * 3.5;
        } else {
          let foundMember = false;
          for (const m of el.members) {
            const w = wayMap.get(m.ref);
            if (w?.tags?.height) {
              const parsed = parseFloat(w.tags.height);
              if (!isNaN(parsed) && parsed > 0) {
                height = parsed;
                foundMember = true;
                break;
              }
            } else if (w?.tags?.['building:levels']) {
              const levels = parseFloat(w.tags['building:levels']);
              if (!isNaN(levels) && levels > 0) {
                height = levels * 3.5;
                foundMember = true;
                break;
              }
            }
          }
          if (!foundMember) {
            const relHash = Math.abs(el.id * 2654435761) % 100;
            const stories = 6 + (relHash % 14); // 6 to 19 stories for large multi-wing complexes
            height = stories * 3.6;
          }
        }

        const halfW = this.spanMetersX / 2;
        const halfH = this.spanMetersZ / 2;

        for (let rIdx = 0; rIdx < stitched.outerRings.length; rIdx++) {
          const outerRing = stitched.outerRings[rIdx];
          if (outerRing.length < 3) continue;

          let sumX = 0, sumZ = 0;
          for (const [vx, vz] of outerRing) {
            sumX += vx;
            sumZ += vz;
          }
          const centroidX = sumX / outerRing.length;
          const centroidZ = sumZ / outerRing.length;

          if (centroidX < -halfW || centroidX > halfW || centroidZ < -halfH || centroidZ > halfH) {
            continue;
          }

          const [gx, gy] = this.toGridCoords(centroidX, centroidZ);
          const baseElevation = this.sampleElevation(elevationGrid, gx, gy);

          buildings.push({
            id: `bldg_rel_${el.id}_${rIdx}`,
            footprint: outerRing,
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
      // 3B. PARSE RAILWAYS & METRO TRACKS (With Underground Support & Clipping)
      // -------------------------------------------------------------
      if (el.type === 'way' && el.tags && el.tags.railway && el.nodes && el.nodes.length >= 2) {
        const rway = el.tags.railway;
        if (['rail', 'subway', 'light_rail', 'tram', 'narrow_gauge'].includes(rway)) {
          const isUnderground = el.tags.tunnel === 'yes' ||
            el.tags.tunnel === 'building_passage' ||
            parseInt(el.tags.layer || '0') < 0 ||
            el.tags.location === 'underground' ||
            rway === 'subway';

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
                    railways.push({
                      id: `rail_${el.id}_${railways.length}`,
                      type: (rway === 'narrow_gauge' ? 'rail' : rway) as 'rail' | 'subway' | 'light_rail' | 'tram',
                      isUnderground,
                      points: currentChain,
                    });
                  }
                  currentChain = [pA, pB];
                }
              }
            } else {
              if (currentChain.length >= 2) {
                railways.push({
                  id: `rail_${el.id}_${railways.length}`,
                  type: (rway === 'narrow_gauge' ? 'rail' : rway) as 'rail' | 'subway' | 'light_rail' | 'tram',
                  isUnderground,
                  points: currentChain,
                });
              }
              currentChain = [];
            }
          }
          if (currentChain.length >= 2) {
            railways.push({
              id: `rail_${el.id}_${railways.length}`,
              type: (rway === 'narrow_gauge' ? 'rail' : rway) as 'rail' | 'subway' | 'light_rail' | 'tram',
              isUnderground,
              points: currentChain,
            });
          }
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
        // Filter out underground culverts & subterranean tunnels
        const tags = el.tags || {};
        const isSubterranean =
          tags.tunnel === 'yes' ||
          tags.tunnel === 'culvert' ||
          tags.covered === 'yes' ||
          tags.location === 'underground' ||
          (tags.layer !== undefined && parseInt(tags.layer) < 0);
        if (isSubterranean) {
          continue; // Do NOT carve or place surface water for buried subterranean culverts!
        }

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
            type: el.tags?.waterway || el.tags?.water || el.tags?.natural || 'water',
            points: rawPoints,
            isClosed,
          });
        }
      }

      // 5B. PARSE WATER MULTIPOLYGON RELATIONS (Large basins, harbours, reservoirs)
      if (
        el.type === 'relation' &&
        isWaterBody &&
        el.members &&
        el.members.length > 0
      ) {
        const rTags = el.tags || {};
        const isRelSubterranean =
          rTags.tunnel === 'yes' ||
          rTags.tunnel === 'culvert' ||
          rTags.covered === 'yes' ||
          rTags.location === 'underground' ||
          (rTags.layer !== undefined && parseInt(rTags.layer) < 0);
        if (isRelSubterranean) {
          continue;
        }

        const stitched = this.stitchMultiPolygon(el.members, wayMap, nodeMap);
        for (let rIdx = 0; rIdx < stitched.outerRings.length; rIdx++) {
          const ring = stitched.outerRings[rIdx];
          if (ring.length >= 3) {
            waterBodies.push({
              id: `water_rel_${el.id}_${rIdx}`,
              type: el.tags?.waterway || el.tags?.water || el.tags?.natural || 'water',
              points: ring,
              isClosed: true,
            });
          }
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
      railways,
      waterBodies,
      criticalAssets,
      bboxSpanKm: this.bboxSpanKm,
      bbox: this.bbox,
    };
  }
}
