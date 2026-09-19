import { ScenarioPreset } from '../types/simulation';

export const SCENARIO_PRESETS: ScenarioPreset[] = [
  {
    id: 'normal_rain',
    name: 'Normal Seasonal Rain',
    description: 'Steady 15 mm/hr monsoonal rain. Urban storm drainage and river conduits clear water with minimal surface ponding.',
    rainfallRate: 15,
    tag: 'Standard',
  },
  {
    id: 'cloudburst',
    name: 'Torrential Cloudburst',
    description: 'Catastrophic cloudburst dumping 85 mm/hr across the watershed. Overwhelms street storm sewers and tests flood defenses.',
    rainfallRate: 85,
    tag: 'Severe',
  },
  {
    id: 'cascading_grid_failure',
    name: 'Power Grid Failure + Blocked Outfall',
    description: 'Substation Gamma flooded and outfall sluice gates jammed, triggering cascading shutdown of all southern stormwater pumping stations.',
    rainfallRate: 45,
    initialFailures: ['sub_gamma'],
    obstructedZones: [
      { x: 20, y: 56, radius: 15 },
      { x: 28, y: 68, radius: 12 },
    ],
    tag: 'Failure',
  },
  {
    id: 'river_surge',
    name: 'River Basin Surge',
    description: 'Upstream mountain reservoir emergency discharge surges into the river corridor at 140 m³/s, threatening arterial bridges and metro crossings.',
    rainfallRate: 35,
    riverSurgeInflow: 140,
    tag: 'Surge',
  },
];
