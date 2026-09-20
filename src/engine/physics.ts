import { Cell, CriticalAsset, GridState, SimulationAnalytics } from '../types/simulation';

export interface StepParams {
  rainfallRate: number;      // mm/hr
  dtHours: number;           // Timestep in hours
  riverSurgeInflow?: number; // Surge flow at headwaters
}

export function simulateStep(
  state: GridState,
  params: StepParams
): { nextState: GridState; analytics: SimulationAnalytics } {
  const { width, height, grid, assets, metroLines } = state;
  const { rainfallRate, dtHours, riverSurgeInflow = 0 } = params;

  const CELL_AREA_M2 = 100.0;
  const CELL_SPACING_M = 10.0;

  // 1. Precipitation & Inflow
  const rainfallMeters = (rainfallRate / 1000.0) * dtHours;

  const intermediateH: number[][] = [];
  const head: number[][] = [];

  for (let y = 0; y < height; y++) {
    const hRow: number[] = [];
    const headRow: number[] = [];

    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      cell.prevH = cell.h;

      // Direct precipitation inflow (streets, bare land, rivers receive rain; building roofs shed to drainage)
      let newH = cell.h;
      if (cell.buildingZ === 0) {
        newH += rainfallMeters;
      }

      // River surge inflow at upstream headwaters
      if (cell.isRiver && y < 6 && riverSurgeInflow > 0) {
        newH += (riverSurgeInflow / 1000.0) * dtHours * 2.5;
      }

      hRow.push(newH);

      // Hydraulic Head on ground: terrainZ + water depth + barrier (if user placed sandbag)
      const barrierHeight = cell.hasBarrier ? 1.8 : 0.0;
      const groundZ = cell.terrainZ + barrierHeight;
      headRow.push(groundZ + newH);
    }
    intermediateH.push(hRow);
    head.push(headRow);
  }

  // 2. 4-way Inter-Cell Gravity Flux (Diffusive Wave Overland Routing)
  const netFluxM3: number[][] = Array.from({ length: height }, () => Array(width).fill(0));
  const neighbors = [
    [0, -1], // North
    [0, 1],  // South
    [-1, 0], // West
    [1, 0],  // East
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const currentHead = head[y][x];
      const availableDepth = intermediateH[y][x];

      if (availableDepth <= 0.001) continue;

      let totalOutFlux = 0;
      const neighborFluxes: { nx: number; ny: number; volume: number }[] = [];

      // Channel conveyance boost: roads and river channels carry water faster (lower roughness)
      const currentCell = grid[y][x];
      const roughnessFactor = currentCell.isRoad ? 1.5 : currentCell.isRiver ? 1.8 : 1.0;
      const ALPHA = 0.55 * roughnessFactor;

      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const neighborHead = head[ny][nx];
          const headDiff = currentHead - neighborHead;

          // Flow downhill towards lower hydraulic head
          if (headDiff > 0.003) {
            const slope = headDiff / CELL_SPACING_M;
            // Discharge rate: diffusive wave approximation (Q ~ alpha * W * S^0.5 * d^1.25)
            const qRate = ALPHA * CELL_SPACING_M * Math.sqrt(Math.min(slope, 2.0)) * Math.pow(availableDepth, 1.2);
            const fluxVol = qRate * (dtHours * 3600.0);

            neighborFluxes.push({ nx, ny, volume: fluxVol });
            totalOutFlux += fluxVol;
          }
        } else {
          // Open / Free Outflow Boundary Condition
          // Neighbor is off the diorama pedestal into empty space.
          // Perimeter edge cells discharge runoff freely outward into the void!
          const isEdge = x === 0 || x === width - 1 || y === 0 || y === height - 1;
          if (isEdge && availableDepth > 0.005) {
            const freeSlope = 1.8;
            const qRate = ALPHA * CELL_SPACING_M * Math.sqrt(freeSlope) * Math.pow(availableDepth, 1.2);
            const fluxVol = qRate * (dtHours * 3600.0);

            neighborFluxes.push({ nx: -1, ny: -1, volume: fluxVol });
            totalOutFlux += fluxVol;
          }
        }
      }

      // CFL Conservation limit: outflux cannot exceed 20% of available water in cell per step
      const maxTransferVolume = availableDepth * CELL_AREA_M2 * 0.20;
      const scale = totalOutFlux > maxTransferVolume && totalOutFlux > 0
        ? maxTransferVolume / totalOutFlux
        : 1.0;

      for (const { nx, ny, volume } of neighborFluxes) {
        const actualFlux = volume * scale;
        netFluxM3[y][x] -= actualFlux;
        if (nx >= 0 && ny >= 0) {
          netFluxM3[ny][nx] += actualFlux;
        }
        // If nx < 0, ny < 0: this water leaves the system into the pedestal void!
      }
    }
  }

  // 3. Apply Drainage, Soil Infiltration, Update Depths & Risk
  let totalWaterVolumeM3 = 0;
  let affectedPopulation = 0;
  let safeCount = 0;
  let warningCount = 0;
  let criticalCount = 0;
  let maxDepthM = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      const isPerimeter = x === 0 || x === width - 1 || y === 0 || y === height - 1;
      const baseDepth = cell.baseDepth ?? (cell.isRiver ? (cell.terrainZ < 0 ? 2.0 : 1.0) : 0.0);

      // A. Infinite Ocean Sink: Boundary water cells absorb runoff and pin sea level
      if (cell.isRiver && isPerimeter) {
        cell.h = baseDepth;
        cell.dh_dt = 0;
        cell.risk = 'safe';
        continue;
      }

      const deltaH = netFluxM3[y][x] / CELL_AREA_M2;
      let postFlowH = Math.max(0.0, intermediateH[y][x] + (isNaN(deltaH) ? 0 : deltaH));
      if (isNaN(postFlowH) || !isFinite(postFlowH)) {
        postFlowH = 0.0;
      }
      postFlowH = Math.min(15.0, postFlowH);

      if (!cell.isRiver) {
        // Overland runoff on dry ground / city streets
        const effectiveInfiltration = cell.isRoad || cell.landType === 'urban_high'
          ? Math.min(2.0, cell.infiltrationK)
          : cell.infiltrationK;
        
        const activeDrainage = cell.isObstructed ? 0 : cell.drainageRate;
        const totalClearanceRate = (activeDrainage + effectiveInfiltration) / 1000.0; // m/hr
        const clearanceMeters = totalClearanceRate * dtHours;

        let finalH = Math.max(0.0, postFlowH - Math.min(postFlowH, clearanceMeters));

        // Open boundary condition for land edges: free runoff cascade prevents pooling at boundary wall
        if (isPerimeter && finalH < 0.08) {
          finalH = 0.0;
        } else if (finalH < 0.003) {
          finalH = 0.0;
        }

        cell.h = parseFloat((isNaN(finalH) || !isFinite(finalH) ? 0.0 : Math.min(15.0, finalH)).toFixed(3));
      } else {
        // Interior river / water body cell:
        // Hydrostatic equilibrium baseline. Surplus city runoff routes out.
        let waterBodyH = Math.max(baseDepth, postFlowH);
        if (waterBodyH > baseDepth) {
          const excess = waterBodyH - baseDepth;
          waterBodyH = baseDepth + excess * Math.max(0.0, 1.0 - dtHours * 2.0);
        }
        cell.h = parseFloat((isNaN(waterBodyH) || !isFinite(waterBodyH) ? baseDepth : Math.min(15.0, waterBodyH)).toFixed(3));
      }

      const riseRate = dtHours > 0 ? (cell.h - cell.prevH) / dtHours : 0;
      cell.dh_dt = isNaN(riseRate) || !isFinite(riseRate) ? 0 : parseFloat(riseRate.toFixed(3));

      // Risk Thresholds (Evaluated only on city / asset land):
      // For rivers/ocean, flood risk is 0 unless surface rises above baseline depth
      const floodOverGround = cell.isRiver ? Math.max(0.0, cell.h - baseDepth) : cell.h;

      if (floodOverGround >= 0.35 || (floodOverGround >= 0.15 && cell.dh_dt > 0.18)) {
        cell.risk = 'critical';
        criticalCount++;
        affectedPopulation += cell.population;
      } else if (floodOverGround >= 0.05) {
        cell.risk = 'warning';
        warningCount++;
      } else {
        cell.risk = 'safe';
        safeCount++;
      }

      totalWaterVolumeM3 += (cell.isRiver ? Math.max(0, cell.h - baseDepth) : cell.h) * CELL_AREA_M2;
      maxDepthM = Math.max(maxDepthM, floodOverGround);
    }
  }

  // 4. CASCADING INFRASTRUCTURE FAILURE ENGINE
  const cascadingAlerts: string[] = [];

  // A. Power Substations Check & Pump Grid Cascading Failure
  for (const asset of assets) {
    if (asset.type === 'power_station') {
      const stationCell = grid[asset.y][asset.x];
      if (stationCell.h >= 0.35) {
        if (asset.status !== 'flooded') {
          asset.status = 'flooded';
          cascadingAlerts.push(`⚡ CASCADING FAILURE: ${asset.name} inundated! Power cut to stormwater pumping network.`);
        }
        // Shut off all downstream dependent pumps in connected zones
        if (asset.dependentZones) {
          for (const zone of asset.dependentZones) {
            for (let zy = Math.max(0, zone.y - zone.radius); zy <= Math.min(height - 1, zone.y + zone.radius); zy++) {
              for (let zx = Math.max(0, zone.x - zone.radius); zx <= Math.min(width - 1, zone.x + zone.radius); zx++) {
                if (Math.hypot(zx - zone.x, zy - zone.y) <= zone.radius) {
                  grid[zy][zx].isObstructed = true; // Pumps dead!
                }
              }
            }
          }
        }
      } else if (stationCell.h >= 0.15) {
        asset.status = 'at_risk';
      } else {
        asset.status = 'operational';
      }
    }
  }

  // B. Hospitals Inundation & Road Access Cutoff Check
  for (const asset of assets) {
    if (asset.type === 'hospital') {
      const hospCell = grid[asset.y][asset.x];

      // Check access roads around hospital (radius 2 perimeter)
      let roadNeighborsCount = 0;
      let floodedRoadCount = 0;

      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const rx = asset.x + dx;
          const ry = asset.y + dy;
          if (rx >= 0 && rx < width && ry >= 0 && ry < height) {
            if (grid[ry][rx].isRoad) {
              roadNeighborsCount++;
              if (grid[ry][rx].h > 0.40) {
                floodedRoadCount++;
              }
            }
          }
        }
      }

      if (hospCell.h >= 0.40) {
        asset.status = 'flooded';
        cascadingAlerts.push(`🚨 CRITICAL EMERGENCY: ${asset.name} inundated! Ground floor evacuation required.`);
      } else if (roadNeighborsCount > 0 && floodedRoadCount >= roadNeighborsCount) {
        asset.status = 'isolated';
        cascadingAlerts.push(`🚑 ACCESS ISOLATED: All perimeter access roads to ${asset.name} submerged (>0.4m)!`);
      } else if (hospCell.h >= 0.15) {
        asset.status = 'at_risk';
      } else {
        asset.status = 'operational';
      }
    }
  }

  // C. Metro Network & Line Inundation Check
  let metroOperational = true;
  for (const asset of assets) {
    if (asset.type === 'metro_station') {
      const stationCell = grid[asset.y][asset.x];
      if (stationCell.h >= 0.35) {
        asset.status = 'flooded';
        metroOperational = false;
      } else if (stationCell.h >= 0.15) {
        asset.status = 'at_risk';
      } else {
        asset.status = 'operational';
      }
    }
  }

  for (const line of metroLines) {
    line.isOperational = metroOperational;
    if (!metroOperational && line.stations.some(sId => assets.find(a => a.id === sId)?.status === 'flooded')) {
      cascadingAlerts.push(`🚇 METRO HALTED: Track / station inundation on ${line.name}. Service suspended.`);
    }
  }

  // D. Road Network & Arterial Bridge Inundation Check
  const bridgeAvenues = [20, 45, 70];
  let bridgeOvertopped = false;
  for (const by of bridgeAvenues) {
    for (let bx = 0; bx < width; bx++) {
      if (grid[by][bx].isRiver && grid[by][bx].h >= 1.2) {
        bridgeOvertopped = true;
        break;
      }
    }
  }
  if (bridgeOvertopped) {
    cascadingAlerts.push(`🌉 ARTERIAL BRIDGE BREACH: Severe river surge overtopping Avenue Bridge! Crossing closed to traffic.`);
  }

  // Analytics
  const totalCells = width * height;
  const safePct = (safeCount / totalCells) * 100;
  const warningPct = (warningCount / totalCells) * 100;
  const criticalPct = (criticalCount / totalCells) * 100;

  let timeToCriticalSec: number | null = null;
  if (criticalCount > 0) {
    timeToCriticalSec = 0;
  } else if (warningCount > 0 && rainfallRate > 15) {
    const gap = 0.40 - maxDepthM;
    const riseRateM_hr = (rainfallRate * 0.65) / 1000;
    if (riseRateM_hr > 0) {
      timeToCriticalSec = Math.max(60, Math.floor((gap / riseRateM_hr) * 3600));
    }
  }

  const analytics: SimulationAnalytics = {
    totalWaterVolumeM3: Math.round(totalWaterVolumeM3),
    affectedPopulation,
    timeToCriticalSec,
    safePct: parseFloat(safePct.toFixed(1)),
    warningPct: parseFloat(warningPct.toFixed(1)),
    criticalPct: parseFloat(criticalPct.toFixed(1)),
    criticalAssets: assets,
    metroOperational,
    cascadingAlerts: Array.from(new Set(cascadingAlerts)), // Unique alerts
    maxDepthM: parseFloat(maxDepthM.toFixed(2)),
  };

  return { nextState: state, analytics };
}
