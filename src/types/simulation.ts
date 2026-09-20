export type LandType = 'urban_high' | 'urban_low' | 'residential' | 'green' | 'river' | 'road' | 'critical_asset';

export type RiskLevel = 'safe' | 'warning' | 'critical';

export type InfrastructureType = 'hospital' | 'power_station' | 'metro_station';

export interface CriticalAsset {
  id: string;
  type: InfrastructureType;
  name: string;
  x: number;
  y: number;
  status: 'operational' | 'at_risk' | 'flooded' | 'isolated';
  dependentZones?: { x: number; y: number; radius: number }[]; // For substations powering pumps
}

export interface MetroLine {
  id: string;
  name: string;
  stations: string[];
  path: { x: number; y: number }[];
  isOperational: boolean;
}

export interface Cell {
  x: number;
  y: number;
  z: number;              // Total dry elevation (terrainZ + buildingZ)
  terrainZ: number;       // Natural ground elevation
  buildingZ: number;      // Height of building structure (0 if road/bare terrain)
  isRoad: boolean;        // Whether cell is part of the urban road network
  isRiver: boolean;       // Whether cell is part of the river channel
  h: number;              // Water depth in meters
  baseDepth?: number;     // Nominal hydrostatic baseline depth (e.g. 2.0m ocean, 1.0m river)
  prevH: number;          // Previous step water depth
  dh_dt: number;          // Rate of water rise (m/hr)
  drainageRate: number;   // Active drainage clearance (mm/hr)
  baseDrainage: number;   // Baseline drainage
  infiltrationK: number;  // Permeability/infiltration coefficient (mm/hr)
  isObstructed: boolean;  // Clogged drainage or lost power
  hasBarrier: boolean;    // Sandbag barrier placed by user
  landType: LandType;
  population: number;     // Estimated residents / commuters
  risk: RiskLevel;
  criticalAsset?: CriticalAsset;
}

export interface RoadFeature {
  id: string;
  type: string;
  points: Array<[number, number]>;
}

export interface GridState {
  width: number;
  height: number;
  cells: Cell[];
  grid: Cell[][];
  assets: CriticalAsset[];
  metroLines: MetroLine[];
  roads?: RoadFeature[];
  spanMetersX?: number;
  spanMetersZ?: number;
}

export interface ScenarioPreset {
  id: string;
  name: string;
  description: string;
  rainfallRate: number;       // mm/hr
  riverSurgeInflow?: number;  // Extra water added to river head
  initialFailures?: string[]; // Asset IDs forced to fail
  obstructedZones?: { x: number; y: number; radius: number }[];
  tag: 'Standard' | 'Severe' | 'Failure' | 'Surge';
}

export interface SimulationAnalytics {
  totalWaterVolumeM3: number;
  affectedPopulation: number;
  timeToCriticalSec: number | null; // Countdown in seconds
  safePct: number;
  warningPct: number;
  criticalPct: number;
  criticalAssets: CriticalAsset[];
  metroOperational: boolean;
  cascadingAlerts: string[];
  maxDepthM: number;
}
