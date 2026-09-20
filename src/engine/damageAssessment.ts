import { Cell } from '../types/simulation';

// buildingZ is stored at HEIGHT_SCALE = 0.35 in dataBridge.ts
// Invert to recover the real architectural floor height:  realHeight = buildingZ / 0.35
const HEIGHT_SCALE_INV = 1.0 / 0.35; // ≈ 2.857
const METERS_PER_FLOOR = 3.5;        // average storey height (m)
const CELL_AREA_M2 = 100.0;          // 10m × 10m cell footprint
const COST_PER_M2_USD = 1200.0;      // JRC replacement value (USD/m²)
const CELL_SPACING_M = 10.0;         // inter-cell distance (m)
const ROAD_KM_PER_CELL = CELL_SPACING_M / 1000.0; // 0.01 km per road cell

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildingAssessment {
  /** Grid coordinates */
  cellX: number;
  cellY: number;
  /** Gross floor area (m²) = footprintArea × estimatedLevels */
  gfa: number;
  /** Estimated number of above-ground floors */
  estimatedLevels: number;
  /** Land use typology (matches Cell.landType) */
  buildingType: string;
  /** Dasymetric occupancy estimate (persons) */
  occupancy: number;
  /** Current water depth above ground (m) */
  waterDepthM: number;
  /** JRC empirical damage ratio α(H) ∈ [0.0, 1.0] */
  damageRatio: number;
  /** Structural loss: GFA × $1,200 × α */
  buildingLossUSD: number;
}

export interface RoadNetworkStatus {
  /** Total road cells on the grid */
  totalRoadCells: number;
  /** Road cells with H ≥ 0.15 m (impassable) */
  impassableRoadCells: number;
  /** Impassable road length in km (cells × 0.01 km) */
  impassableKm: number;
}

export interface DamageReport {
  /** Per-building structural assessments (one per building cell) */
  buildingAssessments: BuildingAssessment[];
  /** Sum of occupancies where H ≥ 0.30 m (displaced / shelter-needed threshold) */
  displacedCitizens: number;
  /** Sum of occupancies where H ≥ 1.20 m (life-threatening inundation) */
  lifeThreatenedCount: number;
  /** Total structural loss across all buildings (USD) */
  totalEconomicLossUSD: number;
  /** Road network operability metrics */
  roadNetwork: RoadNetworkStatus;
}

// ---------------------------------------------------------------------------
// JRC / Delft-FIAT Empirical Depth–Damage Function
// ---------------------------------------------------------------------------

/**
 * Compute the damage ratio α(H) for a given water depth H (metres).
 *
 * Piece-wise linear + exponential fit sourced from:
 *   JRC Technical Report EUR 28423 EN — Global Flood Depth-Damage Functions
 *   Huizinga, J. et al. (2017)
 *
 * @param H - Water depth above ground surface (metres). Must be ≥ 0.
 * @returns α ∈ [0.0, 1.0] — fraction of replacement value damaged.
 */
export function computeDamageRatio(H: number): number {
  if (H < 0.05) {
    return 0.0;
  }
  if (H < 0.30) {
    // α = 0.10 × (H / 0.30)
    return 0.10 * (H / 0.30);
  }
  if (H < 1.20) {
    // α = 0.10 + 0.45 × ((H − 0.30) / 0.90)
    return 0.10 + 0.45 * ((H - 0.30) / 0.90);
  }
  // α = min(0.95, 0.55 + 0.40 × (1 − e^(−1.5 × (H − 1.20))))
  return Math.min(0.95, 0.55 + 0.40 * (1.0 - Math.exp(-1.5 * (H - 1.20))));
}

// ---------------------------------------------------------------------------
// Geometric helpers
// ---------------------------------------------------------------------------

/**
 * Estimate the number of real floors from the grid-stored buildingZ value.
 * dataBridge stores: cell.buildingZ = scaledHeight where scaledHeight = realHeight × 0.35
 * So: realHeight = buildingZ / 0.35,  levels = realHeight / METERS_PER_FLOOR
 */
export function estimateLevels(buildingZ: number): number {
  const realHeightM = buildingZ * HEIGHT_SCALE_INV;
  return Math.max(1, Math.round(realHeightM / METERS_PER_FLOOR));
}

/**
 * Gross Floor Area (m²) for a single building cell.
 * Each grid cell covers CELL_AREA_M2 (100 m²); multiply by floor count.
 */
export function estimateGFA(buildingZ: number): number {
  return CELL_AREA_M2 * estimateLevels(buildingZ);
}

// ---------------------------------------------------------------------------
// Dasymetric Occupancy Model
// ---------------------------------------------------------------------------

/**
 * Estimate the number of persons normally present in this building cell.
 *
 * Rules (aligned with UN-SPIDER / CPHEEO guidelines):
 *   - urban_high / urban_low → residential default: round(GFA / 32.0 × 0.85)
 *   - critical_asset (hospital) → use cell.population directly (set by dataBridge)
 *   - road / river / green → 0 (no indoor occupants)
 *
 * @param cell   - The building Cell (must have buildingZ > 0)
 * @param gfa    - Pre-computed gross floor area (m²)
 * @returns Estimated occupant count (integer).
 */
export function estimateOccupancy(cell: Cell, gfa: number): number {
  switch (cell.landType) {
    case 'urban_high':
    case 'urban_low':
    case 'residential':
      // Residential: ~1 person per 32 m² net leasable area (85% occupancy)
      return Math.round((gfa / 32.0) * 0.85);

    case 'critical_asset':
      // Hospitals & substations: dataBridge assigns empirical staff + patients directly
      return cell.population;

    case 'road':
    case 'river':
    case 'green':
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Full-grid Damage Pass
// ---------------------------------------------------------------------------

/**
 * Run a full analytical damage assessment sweep over the 90×90 cell grid.
 *
 * This function is a **pure read-only pass** — it never mutates Cell fields.
 * Call it once per simulation tick after physics has updated Cell.h values.
 *
 * Complexity: O(width × height) = O(8,100) — typically < 1 ms per call.
 *
 * @param grid - Current 2D cell grid from GridState.
 * @returns    - A DamageReport aggregating all sub-reports.
 */
export function runDamagePass(grid: Cell[][]): DamageReport {
  const buildingAssessments: BuildingAssessment[] = [];
  let displacedCitizens = 0;
  let lifeThreatenedCount = 0;
  let totalEconomicLossUSD = 0;

  let totalRoadCells = 0;
  let impassableRoadCells = 0;

  const height = grid.length;
  const width = height > 0 ? grid[0].length : 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];

      // ── Road Network ─────────────────────────────────────────────────────
      if (cell.isRoad) {
        totalRoadCells++;
        if (cell.h >= 0.15) {
          impassableRoadCells++;
        }
      }

      // ── Building Cells Only ───────────────────────────────────────────────
      if (cell.buildingZ <= 0 || cell.isRiver) continue;

      const gfa = estimateGFA(cell.buildingZ);
      const levels = estimateLevels(cell.buildingZ);
      const occupancy = estimateOccupancy(cell, gfa);
      const H = cell.h;
      const alpha = computeDamageRatio(H);
      const lossUSD = gfa * COST_PER_M2_USD * alpha;

      buildingAssessments.push({
        cellX: x,
        cellY: y,
        gfa: parseFloat(gfa.toFixed(1)),
        estimatedLevels: levels,
        buildingType: cell.landType,
        occupancy,
        waterDepthM: parseFloat(H.toFixed(3)),
        damageRatio: parseFloat(alpha.toFixed(4)),
        buildingLossUSD: parseFloat(lossUSD.toFixed(0)),
      });

      totalEconomicLossUSD += lossUSD;

      // Population exposure thresholds
      if (H >= 1.20) {
        lifeThreatenedCount += occupancy;
        displacedCitizens += occupancy; // life-threat is also displaced
      } else if (H >= 0.30) {
        displacedCitizens += occupancy;
      }
    }
  }

  const impassableKm = parseFloat((impassableRoadCells * ROAD_KM_PER_CELL).toFixed(2));

  return {
    buildingAssessments,
    displacedCitizens,
    lifeThreatenedCount,
    totalEconomicLossUSD: parseFloat(totalEconomicLossUSD.toFixed(0)),
    roadNetwork: {
      totalRoadCells,
      impassableRoadCells,
      impassableKm,
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience: per-cell building assessment (for InspectorModal, no full pass)
// ---------------------------------------------------------------------------

/**
 * Compute damage metrics for a single cell on demand.
 * Used by InspectorModal to display live building stats without
 * needing to pass the full DamageReport down through props.
 *
 * Returns null if the cell is not a building cell.
 */
export function assessCell(cell: Cell): BuildingAssessment | null {
  if (cell.buildingZ <= 0 || cell.isRiver) return null;

  const gfa = estimateGFA(cell.buildingZ);
  const levels = estimateLevels(cell.buildingZ);
  const occupancy = estimateOccupancy(cell, gfa);
  const H = cell.h;
  const alpha = computeDamageRatio(H);
  const lossUSD = gfa * COST_PER_M2_USD * alpha;

  return {
    cellX: cell.x,
    cellY: cell.y,
    gfa: parseFloat(gfa.toFixed(1)),
    estimatedLevels: levels,
    buildingType: cell.landType,
    occupancy,
    waterDepthM: parseFloat(H.toFixed(3)),
    damageRatio: parseFloat(alpha.toFixed(4)),
    buildingLossUSD: parseFloat(lossUSD.toFixed(0)),
  };
}
