export interface LocationProfile {
  id: string;
  name: string;
  subtitle: string;
  country: string;
  coordinates: {
    lat: number;
    lon: number;
    elevationM: number;
  };
  elevationProfile: string;
  floodVulnerability: string;
  primaryRisk: string;
  defaultRainfallRate: number;
  defaultRiverSurge: number;
  keyLandmarks: string[];
  infrastructureAssets: string[];
  themeColor: string;
}

export const LOCATION_PROFILES: LocationProfile[] = [
  {
    id: 'shibuya',
    name: 'Shibuya Crossing',
    subtitle: '渋谷スクランブル交差点',
    country: 'Tokyo, Japan',
    coordinates: {
      lat: 35.6595,
      lon: 139.7005,
      elevationM: 16.2,
    },
    elevationProfile: 'Topographic Valley Basin (Dogenzaka to Miyamasuzaka)',
    floodVulnerability: 'Flash cloudbursts ponding in natural station depression & subway concourse inundation',
    primaryRisk: 'Typhoon Hagibis-scale cloudburst & subterranean river culvert overflow',
    defaultRainfallRate: 110,
    defaultRiverSurge: 180,
    keyLandmarks: ['Shibuya Scramble Square Tower', 'Shibuya 109', 'QFRONT', 'Hikarie', 'Hachiko Plaza'],
    infrastructureAssets: ['Tokyo Metro Ginza & Fukutoshin Lines', 'Shibuya Red Cross Hospital', 'TEPCO Substation'],
    themeColor: '#00F0FF',
  },
  {
    id: 'manhattan',
    name: 'Lower Manhattan & Wall St',
    subtitle: 'Financial District & Battery Park',
    country: 'New York, USA',
    coordinates: {
      lat: 40.7075,
      lon: -74.0090,
      elevationM: 3.5,
    },
    elevationProfile: 'Narrow Estuary Peninsula bounded by Hudson & East Rivers',
    floodVulnerability: 'Superstorm tidal storm surges overtopping seawalls into transit tunnels',
    primaryRisk: 'Category 3 Hurricane storm surge & low-lying subway flooding',
    defaultRainfallRate: 90,
    defaultRiverSurge: 220,
    keyLandmarks: ['One World Trade Center', 'Wall Street CBD', 'Battery Park Esplanade', 'FDR Highway'],
    infrastructureAssets: ['MTA Subway Downtown Trunk', 'Downtown Medical Center', 'ConEd Waterfront Substation'],
    themeColor: '#38bdf8',
  },
  {
    id: 'singapore',
    name: 'Marina Bay Sands',
    subtitle: 'Downtown Core & Bay Reservoir',
    country: 'Singapore',
    coordinates: {
      lat: 1.2838,
      lon: 103.8591,
      elevationM: 2.1,
    },
    elevationProfile: 'Coastal Reclaimed Basin & Singapore River Estuary',
    floodVulnerability: 'Intense equatorial tropical downpours coupled with high spring tides',
    primaryRisk: 'Monsoon deluge exceeding Marina Barrage discharge pump capacity',
    defaultRainfallRate: 125,
    defaultRiverSurge: 140,
    keyLandmarks: ['Marina Bay Sands Integrated Resort', 'Bayfront Promenade', 'CBD Banking Towers', 'Marina Barrage'],
    infrastructureAssets: ['Downtown MRT Circle Line', 'Singapore General Hospital', 'Barrage Pumping Facility'],
    themeColor: '#10b981',
  },
  {
    id: 'apex',
    name: 'Apex River Metropole',
    subtitle: 'Delta Watershed & Mountain Conduits',
    country: 'Regional Hydro Twin',
    coordinates: {
      lat: 22.3193,
      lon: 114.1694,
      elevationM: 8.5,
    },
    elevationProfile: 'Mountain Watershed with Carved River Delta & Southern Basin',
    floodVulnerability: 'Overland runoff sheet flow channeling into urban street networks',
    primaryRisk: 'Torrential mountain cloudburst & river overflow',
    defaultRainfallRate: 85,
    defaultRiverSurge: 120,
    keyLandmarks: ['Central Civic Towers', 'Arterial River Bridges', 'South Wetlands Park'],
    infrastructureAssets: ['Cross-City Express Metro', 'Apex General Hospital', 'Substation Gamma'],
    themeColor: '#a855f7',
  },
];
