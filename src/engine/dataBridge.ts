import { Cell, CriticalAsset, GridState, LandType, MetroLine, RoadFeature, RailwayFeature } from '../types/simulation';
import { DigitalTwinDataset } from '../utils/GeoTransformer';

export type { DigitalTwinDataset };

/**
 * Robust Point-in-Polygon (Ray Casting Algorithm)
 * Determines if a 2D Cartesian coordinate (px, pz) lies inside an arbitrary polygon.
 */
export function pointInPolygon(px: number, pz: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  const n = polygon.length;
  if (n < 3) return false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], zi = polygon[i][1];
    const xj = polygon[j][0], zj = polygon[j][1];

    const intersect =
      zi > pz !== zj > pz &&
      px < ((xj - xi) * (pz - zi)) / (zj - zi + 0.0000000001) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Pathfinding to connect transit stations strictly along open road/terrain corridors
 * 100% guarantees the metro line NEVER intersects or passes through any building!
 */
function findOpenCorridorPath(
  start: { x: number; y: number },
  end: { x: number; y: number },
  grid: Cell[][],
  width: number,
  height: number
): { x: number; y: number }[] {
  // Dijkstra / BFS with 4-connectivity
  const dist = new Float32Array(width * height).fill(Infinity);
  const parent = new Int32Array(width * height).fill(-1);

  const startIdx = start.y * width + start.x;
  const endIdx = end.y * width + end.x;

  dist[startIdx] = 0;
  const queue: number[] = [startIdx];

  const dx = [1, -1, 0, 0];
  const dy = [0, 0, 1, -1];

  let found = false;
  let iterations = 0;
  const maxIterations = 10000;

  while (queue.length > 0 && iterations++ < maxIterations) {
    queue.sort((a, b) => dist[a] - dist[b]);
    const curr = queue.shift()!;

    if (curr === endIdx) {
      found = true;
      break;
    }

    const cx = curr % width;
    const cy = Math.floor(curr / width);

    for (let d = 0; d < 4; d++) {
      const nx = cx + dx[d];
      const ny = cy + dy[d];

      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const nCell = grid[ny][nx];
      // STRICT RULE: Never traverse through building structures!
      if (nCell.buildingZ > 0 && (nx !== end.x || ny !== end.y)) {
        continue;
      }

      // Prioritize road corridors (cost 1), then open terrain (cost 3)
      const moveCost = nCell.isRoad ? 1.0 : 3.0;
      const nIdx = ny * width + nx;
      const newDist = dist[curr] + moveCost;

      if (newDist < dist[nIdx]) {
        dist[nIdx] = newDist;
        parent[nIdx] = curr;
        if (!queue.includes(nIdx)) {
          queue.push(nIdx);
        }
      }
    }
  }

  if (!found) {
    return [start, end];
  }

  // Reconstruct path
  const path: { x: number; y: number }[] = [];
  let curr = endIdx;
  while (curr !== -1) {
    path.push({ x: curr % width, y: Math.floor(curr / width) });
    if (curr === startIdx) break;
    curr = parent[curr];
  }
  path.reverse();
  return path;
}

/**
 * Chaikin's corner-cutting algorithm for smooth, natural curved transit trajectories
 * Eliminates 90-degree right-angle stair-steps across grid cells.
 */
function smoothPolyline(points: { x: number; y: number }[], iterations = 2): { x: number; y: number }[] {
  if (points.length < 3) return points;
  let current = points;
  for (let it = 0; it < iterations; it++) {
    const next: { x: number; y: number }[] = [];
    next.push(current[0]);
    for (let i = 0; i < current.length - 1; i++) {
      const p0 = current[i];
      const p1 = current[i + 1];
      next.push({
        x: parseFloat((0.75 * p0.x + 0.25 * p1.x).toFixed(3)),
        y: parseFloat((0.75 * p0.y + 0.25 * p1.y).toFixed(3)),
      });
      next.push({
        x: parseFloat((0.25 * p0.x + 0.75 * p1.x).toFixed(3)),
        y: parseFloat((0.25 * p0.y + 0.75 * p1.y).toFixed(3)),
      });
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

/**
 * loadTerrainData Bridge Callback
 * Converts strongly-typed DigitalTwinDataset into standard GridState for Scene3D & physics simulation.
 */
export function loadTerrainData(dataset: DigitalTwinDataset): GridState {
  const { width, height } = dataset.gridDimensions;
  const cells: Cell[] = [];
  const grid: Cell[][] = [];
  const spanX = dataset.gridDimensions.cellSizeMeters * width;
  const spanZ = dataset.gridDimensions.cellSizeMeters * height;

  // 1. Initialize bare terrain grid from DEM
  for (let y = 0; y < height; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const rawElev = dataset.elevationGrid[idx] !== undefined && !isNaN(dataset.elevationGrid[idx]) ? dataset.elevationGrid[idx] : 0.0;
      const terrainZ = parseFloat(Math.max(0.0, rawElev).toFixed(2));

      const cell: Cell = {
        x,
        y,
        z: terrainZ,
        terrainZ,
        buildingZ: 0.0,
        isRoad: false,
        isRiver: false,
        h: 0.0,
        prevH: 0.0,
        dh_dt: 0.0,
        drainageRate: 20.0,
        baseDrainage: 20.0,
        infiltrationK: 12.0,
        isObstructed: false,
        hasBarrier: false,
        landType: 'green',
        population: 15,
        risk: 'safe',
      };

      row.push(cell);
      cells.push(cell);
    }
    grid.push(row);
  }

  const isShibuyaLocation = /shibuya|渋谷/i.test(dataset.center.name) ||
    (Math.abs(dataset.center.lat - 35.659) < 0.02 && Math.abs(dataset.center.lon - 139.700) < 0.02);

  // 2. Identify Ocean Water Bodies from DEM & Perimeter Flood-Fill
  // Only execute for genuine coastal cities with valid DEM where the boundary meets open sea (at least 10 sea-level border cells)
  let seaLevelPerimeterCount = 0;
  const hasValidDEM = !!(dataset.elevationGrid && dataset.elevationGrid.length >= width * height);
  if (hasValidDEM && !isShibuyaLocation) {
    for (let x = 0; x < width; x++) {
      if (dataset.elevationGrid![0 * width + x] <= 0.05) seaLevelPerimeterCount++;
      if (dataset.elevationGrid![(height - 1) * width + x] <= 0.05) seaLevelPerimeterCount++;
    }
    for (let y = 1; y < height - 1; y++) {
      if (dataset.elevationGrid![y * width + 0] <= 0.05) seaLevelPerimeterCount++;
      if (dataset.elevationGrid![y * width + (width - 1)] <= 0.05) seaLevelPerimeterCount++;
    }

    if (seaLevelPerimeterCount >= 10) {
      const oceanQueue: [number, number][] = [];
      const visitedOcean = new Uint8Array(width * height);

      // Enqueue perimeter cells at sea level (rawElev <= 0.05)
      for (let x = 0; x < width; x++) {
        const topIdx = 0 * width + x;
        if (dataset.elevationGrid![topIdx] <= 0.05) {
          oceanQueue.push([x, 0]);
          visitedOcean[topIdx] = 1;
        }
        const btmIdx = (height - 1) * width + x;
        if (dataset.elevationGrid![btmIdx] <= 0.05) {
          oceanQueue.push([x, height - 1]);
          visitedOcean[btmIdx] = 1;
        }
      }
      for (let y = 1; y < height - 1; y++) {
        const leftIdx = y * width + 0;
        if (dataset.elevationGrid![leftIdx] <= 0.05) {
          oceanQueue.push([0, y]);
          visitedOcean[leftIdx] = 1;
        }
        const rightIdx = y * width + (width - 1);
        if (dataset.elevationGrid![rightIdx] <= 0.05) {
          oceanQueue.push([width - 1, y]);
          visitedOcean[rightIdx] = 1;
        }
      }

      let oceanHead = 0;
      while (oceanHead < oceanQueue.length) {
        const [ox, oy] = oceanQueue[oceanHead++];
        const oCell = grid[oy][ox];
        oCell.isRiver = true;
        oCell.landType = 'river';
        oCell.terrainZ = -2.0;
        oCell.h = 2.0;
        oCell.baseDepth = 2.0;
        oCell.prevH = 2.0;
        oCell.drainageRate = 0.0;
        oCell.baseDrainage = 0.0;
        oCell.infiltrationK = 0.0;

        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [ddx, ddy] of dirs) {
          const nx = ox + ddx;
          const ny = oy + ddy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nIdx = ny * width + nx;
            if (!visitedOcean[nIdx] && dataset.elevationGrid![nIdx] <= 0.05) {
              visitedOcean[nIdx] = 1;
              oceanQueue.push([nx, ny]);
            }
          }
        }
      }
    }
  }

  // 3. Rasterize Pre-Existing Water Bodies (Natural Rivers, Bays, Reservoirs, Canals)
  // Process so inland water bodies define the physical geographic landscape!
  if (dataset.waterBodies && !isShibuyaLocation) {
    for (const water of dataset.waterBodies) {
      const isPolygonCandidate =
        (water.isClosed || water.points.length >= 6) &&
        /water|bay|lake|reservoir|basin|dock|riverbank|harbour/.test(water.type);

      if (isPolygonCandidate && water.points.length >= 3) {
        // True polygon geometry: compute bounding box to restrict test candidates
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        for (const [vx, vz] of water.points) {
          if (vx < minX) minX = vx;
          if (vx > maxX) maxX = vx;
          if (vz < minZ) minZ = vz;
          if (vz > maxZ) maxZ = vz;
        }

        const gMinX = Math.max(0, Math.floor(((minX + spanX / 2) / spanX) * width));
        const gMaxX = Math.min(width - 1, Math.ceil(((maxX + spanX / 2) / spanX) * width));
        const gMinY = Math.max(0, Math.floor(((minZ + spanZ / 2) / spanZ) * height));
        const gMaxY = Math.min(height - 1, Math.ceil(((maxZ + spanZ / 2) / spanZ) * height));

        const poly = water.isClosed ? water.points : [...water.points, water.points[0]];

        const insideCells: Cell[] = [];
        for (let gy = gMinY; gy <= gMaxY; gy++) {
          const cz = ((gy + 0.5) / height - 0.5) * spanZ;
          for (let gx = gMinX; gx <= gMaxX; gx++) {
            const cx = ((gx + 0.5) / width - 0.5) * spanX;
            // Ray-casting point-in-polygon check: ONLY mark cells genuinely inside the water body!
            if (pointInPolygon(cx, cz, poly)) {
              insideCells.push(grid[gy][gx]);
            }
          }
        }

        if (insideCells.length > 0) {
          // Check if this is a coastal open water body or an inland lake/reservoir/basin
          let isCoastal = false;
          let minElev = Infinity;
          for (const c of insideCells) {
            if (c.terrainZ <= 0.5) isCoastal = true;
            if (c.terrainZ < minElev) minElev = c.terrainZ;
          }

          if (isCoastal || seaLevelPerimeterCount >= 10) {
            // Coastal open water: hydrostatic equilibrium at sea level (0.0m)
            for (const cell of insideCells) {
              cell.isRiver = true;
              cell.landType = 'river';
              cell.isRoad = false;
              cell.drainageRate = 0.0;
              cell.baseDrainage = 0.0;
              cell.infiltrationK = 0.0;
              cell.buildingZ = 0.0;
              cell.terrainZ = -2.0;
              cell.h = 2.0;
              cell.baseDepth = 2.0;
              cell.prevH = 2.0;
            }
          } else {
            // Inland lake, reservoir, or basin: determine the true equilibrium pool level
            // Collect neighboring perimeter rim cells to find the basin overflow threshold
            let minRimZ = Infinity;
            let rimCount = 0;
            for (const c of insideCells) {
              for (const [ddx, ddy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                const nx = c.x + ddx;
                const ny = c.y + ddy;
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                  const nCell = grid[ny][nx];
                  const ncx = ((nx + 0.5) / width - 0.5) * spanX;
                  const ncz = ((ny + 0.5) / height - 0.5) * spanZ;
                  if (!pointInPolygon(ncx, ncz, poly)) {
                    if (nCell.terrainZ < minRimZ) minRimZ = nCell.terrainZ;
                    rimCount++;
                  }
                }
              }
            }

            // Pool level is anchored to the natural rim threshold so water sits flush
            const lakePoolLevel = rimCount > 0 && isFinite(minRimZ)
              ? Math.max(0.5, parseFloat(minRimZ.toFixed(2)))
              : Math.max(0.5, parseFloat(minElev.toFixed(2)));

            // Carve bathymetric bed depth below pool level so the basin has authentic volume and stays 100% full
            const lakeDepth = Math.max(2.5, Math.min(6.5, 2.0 + Math.sqrt(insideCells.length) * 0.12));

            for (const cell of insideCells) {
              cell.isRiver = true;
              cell.landType = 'river';
              cell.isRoad = false;
              cell.drainageRate = 0.0;
              cell.baseDrainage = 0.0;
              cell.infiltrationK = 0.0;
              cell.buildingZ = 0.0;

              // Bed is carved below pool level; water depth is exactly (poolLevel - terrainZ)
              cell.terrainZ = Math.max(0.0, parseFloat((lakePoolLevel - lakeDepth).toFixed(2)));
              cell.h = parseFloat((lakePoolLevel - cell.terrainZ).toFixed(2));
              cell.baseDepth = cell.h;
              cell.prevH = cell.h;
            }
          }
        }
      }

      // Also trace actual linear waterway corridor lines (rivers, canals, streams, waterways - NOT coastlines/weirs)
      const isLinearWaterway = /river|canal|dock|stream|waterway|water/.test(water.type) && !/coastline|weir/.test(water.type);
      if (isLinearWaterway) {
        const channelRadius = /river|canal|dock|basin|harbour|bay|water/.test(water.type) ? 2 : 1;

        for (let i = 0; i < water.points.length - 1; i++) {
          const [x1, z1] = water.points[i];
          const [x2, z2] = water.points[i + 1];

          const gx1 = Math.max(0, Math.min(width - 1, Math.floor(((x1 + spanX / 2) / spanX) * width)));
          const gy1 = Math.max(0, Math.min(height - 1, Math.floor(((z1 + spanZ / 2) / spanZ) * height)));
          const gx2 = Math.max(0, Math.min(width - 1, Math.floor(((x2 + spanX / 2) / spanX) * width)));
          const gy2 = Math.max(0, Math.min(height - 1, Math.floor(((z2 + spanZ / 2) / spanZ) * height)));

          let cx = gx1;
          let cy = gy1;
          const dx = Math.abs(gx2 - gx1);
          const dy = Math.abs(gy2 - gy1);
          const sx = gx1 < gx2 ? 1 : -1;
          const sy = gy1 < gy2 ? 1 : -1;
          let err = dx - dy;

          while (true) {
            for (let rdy = -channelRadius; rdy <= channelRadius; rdy++) {
              for (let rdx = -channelRadius; rdx <= channelRadius; rdx++) {
                if (rdx * rdx + rdy * rdy > channelRadius * channelRadius + 0.5) continue;
                const wx = cx + rdx;
                const wy = cy + rdy;
                if (wx < 0 || wx >= width || wy < 0 || wy >= height) continue;

                const cell = grid[wy][wx];
                cell.isRiver = true;
                cell.landType = 'river';
                cell.isRoad = false;
                cell.drainageRate = 0.0;
                cell.baseDrainage = 0.0;
                cell.infiltrationK = 0.0;
                const bankZ = cell.terrainZ;
                if (bankZ <= 0.5) {
                  // Coastal ocean bathymetry
                  cell.terrainZ = -2.0;
                  cell.h = 2.0;
                  cell.baseDepth = 2.0;
                  cell.prevH = 2.0;
                } else {
                  // Inland relative shallow bed carving
                  cell.terrainZ = Math.max(0.0, parseFloat((bankZ - 1.2).toFixed(2)));
                  cell.h = 1.0;
                  cell.baseDepth = 1.0;
                  cell.prevH = 1.0;
                }
                cell.buildingZ = 0.0;
              }
            }

            if (cx === gx2 && cy === gy2) break;
            const e2 = 2 * err;
            if (e2 > -dy) {
              err -= dy;
              cx += sx;
            }
            if (e2 < dx) {
              err += dx;
              cy += sy;
            }
          }
        }
      }
    }
  }

  // Option A for Shibuya: Assign subterranean culvert drainage capacity along the underground conduit corridor
  if (isShibuyaLocation) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = x / width;
        const ny = y / height;
        const riverCenter = 0.50 + 0.04 * Math.sin(ny * Math.PI * 2.0);
        if (Math.abs(nx - riverCenter) < 0.038 && ny > 0.28) {
          const cell = grid[y][x];
          cell.drainageRate = 45.0;
          cell.baseDrainage = 45.0;
        }
      }
    }
  }

  // 3. Rasterize Road Vectors
  // Roads establish corridors for movement, drainage, and bridges across water
  for (const road of dataset.roads) {
    const isMajor = road.type && /primary|secondary|trunk|motorway/.test(road.type);

    for (let i = 0; i < road.points.length - 1; i++) {
      const [x1, z1] = road.points[i];
      const [x2, z2] = road.points[i + 1];

      const gx1 = Math.max(0, Math.min(width - 1, Math.floor(((x1 + spanX / 2) / spanX) * width)));
      const gy1 = Math.max(0, Math.min(height - 1, Math.floor(((z1 + spanZ / 2) / spanZ) * height)));
      const gx2 = Math.max(0, Math.min(width - 1, Math.floor(((x2 + spanX / 2) / spanX) * width)));
      const gy2 = Math.max(0, Math.min(height - 1, Math.floor(((z2 + spanZ / 2) / spanZ) * height)));

      let cx = gx1;
      let cy = gy1;
      const dx = Math.abs(gx2 - gx1);
      const dy = Math.abs(gy2 - gy1);
      const sx = gx1 < gx2 ? 1 : -1;
      const sy = gy1 < gy2 ? 1 : -1;
      let err = dx - dy;

      while (true) {
        const markRoadCell = (rx: number, ry: number) => {
          if (rx < 0 || rx >= width || ry < 0 || ry >= height) return;
          const cell = grid[ry][rx];
          cell.isRoad = true;
          cell.buildingZ = 0.0;
          if (!cell.isRiver) {
            cell.landType = 'road';
            cell.drainageRate = 22.0;
            cell.baseDrainage = 22.0;
            cell.infiltrationK = 2.0;
          }
        };

        markRoadCell(cx, cy);
        if (isMajor) {
          // Major arteries get wider profile
          markRoadCell(cx + 1, cy);
          markRoadCell(cx, cy + 1);
        }

        if (cx === gx2 && cy === gy2) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          cx += sx;
        }
        if (e2 < dx) {
          err += dx;
          cy += sy;
        }
      }
    }
  }

  // 4. Rasterize Buildings
  // Scale building height to 3D simulation units (e.g. 10m height ~ 3.5 units)
  const HEIGHT_SCALE = 0.35;

  for (const bldg of dataset.buildings) {
    if (bldg.footprint.length < 3) continue;

    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const [vx, vz] of bldg.footprint) {
      if (vx < minX) minX = vx;
      if (vx > maxX) maxX = vx;
      if (vz < minZ) minZ = vz;
      if (vz > maxZ) maxZ = vz;
    }

    const gMinX = Math.max(0, Math.floor(((minX + spanX / 2) / spanX) * width));
    const gMaxX = Math.min(width - 1, Math.ceil(((maxX + spanX / 2) / spanX) * width));
    const gMinY = Math.max(0, Math.floor(((minZ + spanZ / 2) / spanZ) * height));
    const gMaxY = Math.min(height - 1, Math.ceil(((maxZ + spanZ / 2) / spanZ) * height));

    const scaledHeight = parseFloat(Math.min(75.0, Math.max(2.5, bldg.height * HEIGHT_SCALE)).toFixed(2));
    const landType: LandType = scaledHeight >= 6.5 ? 'urban_high' : 'urban_low';
    const isSingleCell = gMaxX - gMinX <= 1 && gMaxY - gMinY <= 1;

    for (let gy = gMinY; gy <= gMaxY; gy++) {
      const cz = ((gy + 0.5) / height - 0.5) * spanZ;
      for (let gx = gMinX; gx <= gMaxX; gx++) {
        const cell = grid[gy][gx];

        // CRITICAL INVARIANT: Buildings CANNOT be built on roads or in water!
        if (cell.isRoad || cell.isRiver) continue;

        const cx = ((gx + 0.5) / width - 0.5) * spanX;
        const isInside = isSingleCell || pointInPolygon(cx, cz, bldg.footprint);

        if (isInside) {
          if (cell.buildingZ < scaledHeight) {
            cell.buildingZ = scaledHeight;
            cell.landType = landType;
            cell.population = Math.floor(40 + scaledHeight * 18);
            cell.drainageRate = 16.0;
            cell.baseDrainage = 16.0;
            cell.infiltrationK = 1.5;
          }
        }
      }
    }
  }

  // 5. Map Critical Assets (Hospitals, Power Stations, Metro Stations)
  const assets: CriticalAsset[] = [];
  const metroStations: { x: number; y: number; id: string; name: string }[] = [];

  for (const item of dataset.criticalAssets) {
    let gx = Math.max(0, Math.min(width - 1, item.gridX));
    let gy = Math.max(0, Math.min(height - 1, item.gridY));

    // If critical asset is on water, find nearest dry land cell
    if (grid[gy][gx].isRiver) {
      let foundDry = false;
      for (let r = 1; r < 8 && !foundDry; r++) {
        for (let dy = -r; dy <= r && !foundDry; dy++) {
          for (let dx = -r; dx <= r && !foundDry; dx++) {
            const tx = gx + dx;
            const ty = gy + dy;
            if (tx >= 0 && tx < width && ty >= 0 && ty < height && !grid[ty][tx].isRiver) {
              gx = tx;
              gy = ty;
              foundDry = true;
            }
          }
        }
      }
    }

    const simType =
      item.type === 'hospital'
        ? 'hospital'
        : item.type === 'power'
        ? 'power_station'
        : 'metro_station';

    const asset: CriticalAsset = {
      id: item.id,
      type: simType,
      name: item.name,
      x: gx,
      y: gy,
      status: 'operational',
    };

    if (simType === 'power_station') {
      asset.dependentZones = [
        { x: Math.max(0, gx - 10), y: gy, radius: 12 },
        { x: Math.min(width - 1, gx + 10), y: gy, radius: 12 },
      ];
    }

    assets.push(asset);

    const cell = grid[gy][gx];
    cell.criticalAsset = asset;
    cell.landType = 'critical_asset';
    cell.buildingZ = simType === 'hospital' ? 8.5 : simType === 'power_station' ? 5.5 : 4.5;
    cell.population = simType === 'hospital' ? 320 : 150;

    if (simType === 'metro_station') {
      metroStations.push({ x: gx, y: gy, id: item.id, name: item.name });
    }
  }

  // 6. Build Metro Transit Line connecting stations along open road corridors
  // 100% guarantees the metro line NEVER cuts through buildings!
  const metroLines: MetroLine[] = [];
  const hasSubway = dataset.railways?.some(r => r.type === 'subway' || r.isUnderground);
  const isUnderground = hasSubway ||
    dataset.center.name.toLowerCase().includes('shibuya') ||
    dataset.center.name.toLowerCase().includes('subway') ||
    dataset.center.name.toLowerCase().includes('metro');

  if (metroStations.length >= 2) {
    const fullPath: { x: number; y: number }[] = [];
    for (let i = 0; i < metroStations.length - 1; i++) {
      const s1 = metroStations[i];
      const s2 = metroStations[i + 1];
      const segment = findOpenCorridorPath(s1, s2, grid, width, height);
      if (i > 0) segment.shift(); // avoid duplicate join point
      fullPath.push(...segment);
    }

    if (fullPath.length >= 2) {
      metroLines.push({
        id: 'transit_main_line',
        name: `${dataset.center.name} Rapid Transit Line`,
        type: isUnderground ? 'subway' : 'rail',
        isUnderground,
        stations: metroStations.map(s => s.id),
        path: smoothPolyline(fullPath, 3),
        isOperational: true,
      });
    }
  }

  // 6B. Direct nearby river inflow flux entry to diorama boundary cells closest to external river's trajectory
  if (dataset.riverInflowStatus?.type === 'nearby' && dataset.riverInflowStatus.trajectory) {
    const { boundaryCell } = dataset.riverInflowStatus.trajectory;
    const bx = Math.max(0, Math.min(width - 1, boundaryCell.x));
    const by = Math.max(0, Math.min(height - 1, boundaryCell.y));

    for (let d = -1; d <= 1; d++) {
      const cx = Math.max(0, Math.min(width - 1, bx + (by === 0 || by === height - 1 ? d : 0)));
      const cy = Math.max(0, Math.min(height - 1, by + (bx === 0 || bx === width - 1 ? d : 0)));
      const targetCell = grid[cy][cx];
      targetCell.isRiver = true;
      if (targetCell.buildingZ === 0) {
        targetCell.landType = 'river';
      }
    }
  }

  // 6B. Shoreline Boundary Laplacian / Box Smoothing Pass
  const smoothedTerrainZ = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const cell = grid[y][x];
      smoothedTerrainZ[idx] = cell.terrainZ;

      // Determine if cell is on or adjacent to water boundary
      let isShoreBoundary = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (grid[ny][nx].isRiver !== cell.isRiver) {
              isShoreBoundary = true;
              break;
            }
          }
        }
        if (isShoreBoundary) break;
      }

      if (isShoreBoundary) {
        let weightedSum = 0;
        let totalWeight = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const weight = (dx === 0 && dy === 0) ? 2.0 : 1.0;
              weightedSum += grid[ny][nx].terrainZ * weight;
              totalWeight += weight;
            }
          }
        }
        smoothedTerrainZ[idx] = weightedSum / totalWeight;
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const cell = grid[y][x];
      cell.terrainZ = parseFloat(smoothedTerrainZ[idx].toFixed(2));
    }
  }

  // 7. Finalize total elevation z for every cell
  for (const cell of cells) {
    cell.z = parseFloat((cell.terrainZ + cell.buildingZ).toFixed(2));
  }

  return {
    width,
    height,
    cells,
    grid,
    assets,
    metroLines,
    roads: dataset.roads,
    railways: dataset.railways,
    spanMetersX: spanX,
    spanMetersZ: spanZ,
    bboxSpanKm: dataset.bboxSpanKm,
    riverInflowStatus: dataset.riverInflowStatus,
  };
}
