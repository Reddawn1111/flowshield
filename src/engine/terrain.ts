import { createNoise2D } from 'simplex-noise';
import { Cell, CriticalAsset, GridState, LandType, MetroLine } from '../types/simulation';

function smoothstep(min: number, max: number, value: number): number {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

export function generateTerrain(
  width: number = 90,
  height: number = 90,
  locationId: string = 'shibuya'
): GridState {
  const noiseMacro = createNoise2D();
  const noiseDetail = createNoise2D();
  const cells: Cell[] = [];
  const grid: Cell[][] = [];

  let assets: CriticalAsset[] = [];
  let metroLines: MetroLine[] = [];

  // =========================================================================
  // 1. LOCATION INFRASTRUCTURE & ASSETS SETUP
  // =========================================================================
  if (locationId === 'shibuya') {
    assets = [
      {
        id: 'hosp_shibuya_rc',
        type: 'hospital',
        name: 'Japanese Red Cross Medical Center (Hiroo)',
        x: Math.floor(width * 0.72),
        y: Math.floor(height * 0.62),
        status: 'operational',
      },
      {
        id: 'hosp_tokyu',
        type: 'hospital',
        name: 'Tokyu Shibuya Hospital',
        x: Math.floor(width * 0.28),
        y: Math.floor(height * 0.35),
        status: 'operational',
      },
      {
        id: 'sub_shibuya',
        type: 'power_station',
        name: 'TEPCO Shibuya Substation (Pumps)',
        x: Math.floor(width * 0.38),
        y: Math.floor(height * 0.58),
        status: 'operational',
        dependentZones: [
          { x: Math.floor(width * 0.46), y: Math.floor(height * 0.48), radius: 15 },
          { x: Math.floor(width * 0.52), y: Math.floor(height * 0.65), radius: 12 },
        ],
      },
      {
        id: 'sub_aoyama',
        type: 'power_station',
        name: 'Minato-Aoyama Substation',
        x: Math.floor(width * 0.78),
        y: Math.floor(height * 0.28),
        status: 'operational',
        dependentZones: [
          { x: Math.floor(width * 0.78), y: Math.floor(height * 0.28), radius: 14 },
        ],
      },
      {
        id: 'metro_shibuya_hub',
        type: 'metro_station',
        name: 'Shibuya Scramble Station (Ginza Line)',
        x: Math.floor(width * 0.46),
        y: Math.floor(height * 0.48),
        status: 'operational',
      },
      {
        id: 'metro_dogenzaka',
        type: 'metro_station',
        name: 'Dogenzaka West Metro',
        x: Math.floor(width * 0.24),
        y: Math.floor(height * 0.52),
        status: 'operational',
      },
      {
        id: 'metro_miyashita',
        type: 'metro_station',
        name: 'Miyashita Park Concourse',
        x: Math.floor(width * 0.50),
        y: Math.floor(height * 0.28),
        status: 'operational',
      },
      {
        id: 'metro_omotesando',
        type: 'metro_station',
        name: 'Omotesando Terminal',
        x: Math.floor(width * 0.78),
        y: Math.floor(height * 0.20),
        status: 'operational',
      },
    ];

    metroLines = [
      {
        id: 'ginza_line',
        name: 'Tokyo Metro Ginza Line',
        stations: ['metro_dogenzaka', 'metro_shibuya_hub', 'metro_miyashita', 'metro_omotesando'],
        path: [
          { x: Math.floor(width * 0.24), y: Math.floor(height * 0.52) },
          { x: Math.floor(width * 0.35), y: Math.floor(height * 0.50) },
          { x: Math.floor(width * 0.46), y: Math.floor(height * 0.48) },
          { x: Math.floor(width * 0.50), y: Math.floor(height * 0.38) },
          { x: Math.floor(width * 0.50), y: Math.floor(height * 0.28) },
          { x: Math.floor(width * 0.64), y: Math.floor(height * 0.24) },
          { x: Math.floor(width * 0.78), y: Math.floor(height * 0.20) },
        ],
        isOperational: true,
      },
    ];
  } else if (locationId === 'manhattan') {
    assets = [
      {
        id: 'hosp_downtown',
        type: 'hospital',
        name: 'NewYork-Presbyterian Lower Manhattan',
        x: Math.floor(width * 0.54),
        y: Math.floor(height * 0.45),
        status: 'operational',
      },
      {
        id: 'hosp_veterans',
        type: 'hospital',
        name: 'Manhattan VA Medical Center',
        x: Math.floor(width * 0.68),
        y: Math.floor(height * 0.22),
        status: 'operational',
      },
      {
        id: 'sub_coned_seaport',
        type: 'power_station',
        name: 'ConEdison South Seaport Substation',
        x: Math.floor(width * 0.65),
        y: Math.floor(height * 0.55),
        status: 'operational',
        dependentZones: [
          { x: Math.floor(width * 0.50), y: Math.floor(height * 0.65), radius: 18 },
        ],
      },
      {
        id: 'sub_tribeca',
        type: 'power_station',
        name: 'Tribeca Power Terminal',
        x: Math.floor(width * 0.38),
        y: Math.floor(height * 0.30),
        status: 'operational',
        dependentZones: [
          { x: Math.floor(width * 0.38), y: Math.floor(height * 0.30), radius: 14 },
        ],
      },
      {
        id: 'metro_fulton',
        type: 'metro_station',
        name: 'Fulton Street Transit Hub',
        x: Math.floor(width * 0.52),
        y: Math.floor(height * 0.52),
        status: 'operational',
      },
      {
        id: 'metro_wtc',
        type: 'metro_station',
        name: 'WTC Oculus Station',
        x: Math.floor(width * 0.44),
        y: Math.floor(height * 0.48),
        status: 'operational',
      },
      {
        id: 'metro_wallst',
        type: 'metro_station',
        name: 'Wall Street Station (Lines 4/5)',
        x: Math.floor(width * 0.54),
        y: Math.floor(height * 0.64),
        status: 'operational',
      },
      {
        id: 'metro_battery',
        type: 'metro_station',
        name: 'South Ferry - Battery Park',
        x: Math.floor(width * 0.50),
        y: Math.floor(height * 0.78),
        status: 'operational',
      },
    ];

    metroLines = [
      {
        id: 'mta_broadway',
        name: 'MTA Broadway / 7th Ave Trunk',
        stations: ['metro_battery', 'metro_wallst', 'metro_wtc', 'metro_fulton'],
        path: [
          { x: Math.floor(width * 0.50), y: Math.floor(height * 0.78) },
          { x: Math.floor(width * 0.54), y: Math.floor(height * 0.64) },
          { x: Math.floor(width * 0.44), y: Math.floor(height * 0.48) },
          { x: Math.floor(width * 0.52), y: Math.floor(height * 0.52) },
          { x: Math.floor(width * 0.48), y: Math.floor(height * 0.32) },
          { x: Math.floor(width * 0.46), y: Math.floor(height * 0.18) },
        ],
        isOperational: true,
      },
    ];
  } else if (locationId === 'singapore') {
    assets = [
      {
        id: 'hosp_sgh',
        type: 'hospital',
        name: 'Singapore General Hospital (SGH)',
        x: Math.floor(width * 0.25),
        y: Math.floor(height * 0.48),
        status: 'operational',
      },
      {
        id: 'hosp_raffles',
        type: 'hospital',
        name: 'Raffles Medical Hub',
        x: Math.floor(width * 0.55),
        y: Math.floor(height * 0.20),
        status: 'operational',
      },
      {
        id: 'sub_barrage',
        type: 'power_station',
        name: 'Marina Barrage Drainage Pumping Station',
        x: Math.floor(width * 0.68),
        y: Math.floor(height * 0.74),
        status: 'operational',
        dependentZones: [
          { x: Math.floor(width * 0.50), y: Math.floor(height * 0.55), radius: 20 },
        ],
      },
      {
        id: 'sub_cbd',
        type: 'power_station',
        name: 'Tanjong Pagar Power Substation',
        x: Math.floor(width * 0.32),
        y: Math.floor(height * 0.62),
        status: 'operational',
        dependentZones: [
          { x: Math.floor(width * 0.32), y: Math.floor(height * 0.62), radius: 14 },
        ],
      },
      {
        id: 'metro_bayfront',
        type: 'metro_station',
        name: 'Bayfront MRT Station (MBS)',
        x: Math.floor(width * 0.62),
        y: Math.floor(height * 0.52),
        status: 'operational',
      },
      {
        id: 'metro_raffles_pl',
        type: 'metro_station',
        name: 'Raffles Place MRT (CBD Interchange)',
        x: Math.floor(width * 0.42),
        y: Math.floor(height * 0.46),
        status: 'operational',
      },
      {
        id: 'metro_promenade',
        type: 'metro_station',
        name: 'Promenade MRT Station',
        x: Math.floor(width * 0.65),
        y: Math.floor(height * 0.34),
        status: 'operational',
      },
      {
        id: 'metro_marina_south',
        type: 'metro_station',
        name: 'Marina South Pier MRT',
        x: Math.floor(width * 0.58),
        y: Math.floor(height * 0.76),
        status: 'operational',
      },
    ];

    metroLines = [
      {
        id: 'downtown_mrt',
        name: 'Singapore Downtown & Circle MRT Line',
        stations: ['metro_raffles_pl', 'metro_promenade', 'metro_bayfront', 'metro_marina_south'],
        path: [
          { x: Math.floor(width * 0.42), y: Math.floor(height * 0.46) },
          { x: Math.floor(width * 0.54), y: Math.floor(height * 0.38) },
          { x: Math.floor(width * 0.65), y: Math.floor(height * 0.34) },
          { x: Math.floor(width * 0.62), y: Math.floor(height * 0.52) },
          { x: Math.floor(width * 0.58), y: Math.floor(height * 0.76) },
        ],
        isOperational: true,
      },
    ];
  } else {
    // Default Apex Metropole
    assets = [
      {
        id: 'hosp_apex',
        type: 'hospital',
        name: 'Apex General Hospital',
        x: Math.floor(width * 0.30),
        y: Math.floor(height * 0.68),
        status: 'operational',
      },
      {
        id: 'hosp_stjude',
        type: 'hospital',
        name: 'St. Jude Trauma Center',
        x: Math.floor(width * 0.70),
        y: Math.floor(height * 0.38),
        status: 'operational',
      },
      {
        id: 'sub_gamma',
        type: 'power_station',
        name: 'Substation Gamma (Pumps)',
        x: Math.floor(width * 0.22),
        y: Math.floor(height * 0.60),
        status: 'operational',
        dependentZones: [
          { x: Math.floor(width * 0.22), y: Math.floor(height * 0.60), radius: 15 },
          { x: Math.floor(width * 0.30), y: Math.floor(height * 0.72), radius: 12 },
        ],
      },
      {
        id: 'sub_alpha',
        type: 'power_station',
        name: 'Grid Station Alpha',
        x: Math.floor(width * 0.55),
        y: Math.floor(height * 0.30),
        status: 'operational',
        dependentZones: [
          { x: Math.floor(width * 0.55), y: Math.floor(height * 0.30), radius: 14 },
        ],
      },
      {
        id: 'metro_south',
        type: 'metro_station',
        name: 'South Estuary Metro',
        x: Math.floor(width * 0.18),
        y: Math.floor(height * 0.76),
        status: 'operational',
      },
      {
        id: 'metro_central',
        type: 'metro_station',
        name: 'Central Plaza Station',
        x: Math.floor(width * 0.42),
        y: Math.floor(height * 0.48),
        status: 'operational',
      },
      {
        id: 'metro_civic',
        type: 'metro_station',
        name: 'Civic Hub Metro',
        x: Math.floor(width * 0.62),
        y: Math.floor(height * 0.34),
        status: 'operational',
      },
      {
        id: 'metro_north',
        type: 'metro_station',
        name: 'North Ridge Terminal',
        x: Math.floor(width * 0.80),
        y: Math.floor(height * 0.18),
        status: 'operational',
      },
    ];

    metroLines = [
      {
        id: 'blue_line',
        name: 'Line 1 (Cross-City Express)',
        stations: ['metro_south', 'metro_central', 'metro_civic', 'metro_north'],
        path: [
          { x: Math.floor(width * 0.18), y: Math.floor(height * 0.76) },
          { x: Math.floor(width * 0.30), y: Math.floor(height * 0.62) },
          { x: Math.floor(width * 0.42), y: Math.floor(height * 0.48) },
          { x: Math.floor(width * 0.52), y: Math.floor(height * 0.40) },
          { x: Math.floor(width * 0.62), y: Math.floor(height * 0.34) },
          { x: Math.floor(width * 0.72), y: Math.floor(height * 0.25) },
          { x: Math.floor(width * 0.80), y: Math.floor(height * 0.18) },
        ],
        isOperational: true,
      },
    ];
  }

  // =========================================================================
  // 2. GRID GENERATION (ELEVATION, WATER, ROADS, BUILDINGS)
  // =========================================================================
  for (let y = 0; y < height; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const ny = y / height;

      let terrainZ = 1.0;
      let isRiver = false;
      let isRoadCell = false;
      let landType: LandType = 'residential';
      let buildingZ = 0.0;
      let population = 0;
      let drainageRate = 25.0;
      let infiltrationK = 15.0;

      // -------------------------------------------------------------------
      // A. SHIBUYA CROSSING, TOKYO
      // -------------------------------------------------------------------
      if (locationId === 'shibuya') {
        // Natural Valley Bowl Topography:
        // High West ridge (Dogenzaka/Shoto, nx < 0.4) and East ridge (Miyamasuzaka/Aoyama, nx > 0.6)
        // Valley bottom at nx ~ 0.48, where Shibuya Station and Scramble Crossing sit
        const valDist = Math.abs(nx - 0.48);
        const ridgeElev = Math.pow(valDist / 0.48, 1.4) * 11.5;
        const m1 = (noiseMacro(nx * 3.2, ny * 3.2) + 1) * 0.5;
        const m2 = (noiseDetail(nx * 6.5, ny * 6.5) + 1) * 0.5;
        terrainZ = 2.2 + ridgeElev + (m1 * 3.5) + (m2 * 1.5);

        // Subterranean Shibuya River culvert flowing south beneath the valley floor
        // (Option A: Omitted entirely from 3D surface view, retained purely as an invisible subterranean drainage conduit)
        const riverCenter = 0.50 + 0.04 * Math.sin(ny * Math.PI * 2.0);
        const distToRiver = Math.abs(nx - riverCenter);
        const isSubterraneanCulvert = distToRiver < 0.038 && ny > 0.28;
        isRiver = false; // Authentic Shibuya Crossing: clean dry pavement, no spurious open surface river trench

        // Road Network: Shibuya Scramble Crossing 5-way junction at (x=46, y=47)
        const isAvenueY = y === 22 || y === 47 || y === 72;
        const isAvenueX = x === 24 || x === 46 || x === 70;
        const isStreetY = y % 6 === 0;
        const isStreetX = x % 6 === 0;
        // Dogenzaka / Inokashira diagonal arterial
        const isDiagonalRoad = Math.abs((x - 46) - (y - 47) * 0.8) < 1.4 && x < 54;

        isRoadCell = (isAvenueX || isAvenueY || isStreetX || isStreetY || isDiagonalRoad);

        // Urban Zoning: scale building bounding box to cover the road network across the diorama
        const distToScramble = Math.hypot(nx - 0.48, ny - 0.50);
        const isCommercialWard = nx >= 0.04 && nx <= 0.96 && ny >= 0.04 && ny <= 0.96;

        if (isRoadCell) {
          landType = 'road';
          // Elevated subterranean drainage capacity directly above the culvert path
          drainageRate = isSubterraneanCulvert ? 45.0 : 22.0;
          infiltrationK = 2.0;
          population = 40;
          terrainZ = Math.max(0.7, terrainZ - 0.12);
        } else if (isCommercialWard) {
          // Iconic Shibuya Landmark Towers
          if (x === 48 && y === 48) {
            // Shibuya Scramble Square Tower (Supertall)
            landType = 'urban_high';
            buildingZ = 20.0;
            population = 480;
          } else if (x === 42 && y === 45) {
            // Shibuya 109 Fashion Landmark
            landType = 'urban_high';
            buildingZ = 13.5;
            population = 260;
          } else if (x === 51 && y === 47) {
            // Shibuya Hikarie Tower
            landType = 'urban_high';
            buildingZ = 17.0;
            population = 390;
          } else if (x === 46 && y === 44) {
            // QFRONT Media Tower
            landType = 'urban_high';
            buildingZ = 12.0;
            population = 240;
          } else {
            const bldgNoise = (noiseDetail(nx * 14.0, ny * 14.0) + 1) * 0.5;
            const parcelHash = ((x * 73856093) ^ (y * 19349663)) % 100;
            if (parcelHash < 30) {
              landType = 'green';
              buildingZ = 0.0;
              population = 20;
            } else if (bldgNoise > 0.48) {
              landType = 'urban_high';
              buildingZ = 6.5 + bldgNoise * 8.0;
              population = 160;
            } else {
              landType = 'urban_low';
              buildingZ = 3.5 + bldgNoise * 4.0;
              population = 85;
            }
          }
          drainageRate = isSubterraneanCulvert ? 45.0 : 18.0;
          infiltrationK = 1.0;
        } else {
          // Shoto & Aoyama outer residential heights (green slopes, low density)
          landType = 'green';
          buildingZ = 0.0;
          drainageRate = isSubterraneanCulvert ? 45.0 : 28.0;
          infiltrationK = 20.0;
          population = 10;
        }
      }
      // -------------------------------------------------------------------
      // B. LOWER MANHATTAN, NYC
      // -------------------------------------------------------------------
      else if (locationId === 'manhattan') {
        // Estuary peninsula tip surrounded by Hudson River (West) and East River (East)
        const isHudson = nx < 0.22 && ny > 0.12;
        const isEastRiver = nx > 0.76 && ny > 0.15;
        const isBatteryTip = ny > 0.82 && (nx < 0.35 || nx > 0.65);
        isRiver = isHudson || isEastRiver || isBatteryTip;

        const m1 = (noiseMacro(nx * 2.5, ny * 2.5) + 1) * 0.5;
        // Natural spine elevation along Broadway axis (nx ~ 0.50)
        const spineDist = Math.abs(nx - 0.50);
        const spineH = Math.max(0, 1.0 - spineDist * 3.5) * 4.5;
        const landElev = 1.5 + spineH + m1 * 1.5;
        const waterElev = 0.6;

        // Smooth continuous distance tapering to eliminate staircased cliff shoreline edges
        let shoreBlend = 1.0; // 0 = water, 1 = dry land
        if (nx < 0.26 && ny > 0.10) {
          // West Hudson shore
          shoreBlend = Math.min(shoreBlend, smoothstep(0.20, 0.25, nx));
        }
        if (nx > 0.72 && ny > 0.12) {
          // East River shore
          shoreBlend = Math.min(shoreBlend, 1.0 - smoothstep(0.74, 0.78, nx));
        }
        if (ny > 0.78 && (nx < 0.38 || nx > 0.62)) {
          // Battery tip
          shoreBlend = Math.min(shoreBlend, 1.0 - smoothstep(0.80, 0.86, ny));
        }

        terrainZ = isRiver
          ? waterElev
          : waterElev + (landElev - waterElev) * Math.max(0.2, shoreBlend);

        // Manhattan Grid (Avenues along Y, numbered streets along X)
        const isAve = x === 28 || x === 38 || x === 50 || x === 62 || x === 72;
        const isSt = y % 5 === 0 && y > 15 && y < 80;
        const isFDRHighway = (nx > 0.72 && nx <= 0.76) || (nx >= 0.22 && nx < 0.26);
        isRoadCell = (isAve || isSt || isFDRHighway) && !isRiver;

        const distToWTC = Math.hypot(nx - 0.44, ny - 0.48);
        // Urban Zoning: scale building bounding box to cover the full peninsula between Hudson & East rivers
        const isDowntown = nx >= 0.18 && nx <= 0.82 && ny >= 0.06 && ny <= 0.88;

        if (isRiver) {
          landType = 'river';
          drainageRate = 50.0;
          infiltrationK = 0.0;
        } else if (isRoadCell) {
          landType = 'road';
          drainageRate = 22.0;
          infiltrationK = 2.0;
          population = 45;
        } else if (isDowntown) {
          if (x === 44 && y === 48) {
            // One World Trade Center (Freedom Tower supertall)
            landType = 'urban_high';
            buildingZ = 22.0;
            population = 650;
          } else if (x === 52 && y === 62) {
            // Wall Street Financial Tower
            landType = 'urban_high';
            buildingZ = 18.0;
            population = 420;
          } else {
            const bldgNoise = (noiseDetail(nx * 15.0, ny * 15.0) + 1) * 0.5;
            const parcelHash = ((x * 73856093) ^ (y * 19349663)) % 100;
            if (parcelHash < 25) {
              landType = 'green';
              buildingZ = 0.0;
              population = 25;
            } else if (bldgNoise > 0.42) {
              landType = 'urban_high';
              buildingZ = 7.0 + bldgNoise * 9.5;
              population = 210;
            } else {
              landType = 'urban_low';
              buildingZ = 4.0 + bldgNoise * 4.0;
              population = 110;
            }
          }
          drainageRate = 18.0;
          infiltrationK = 1.0;
        } else {
          landType = 'green';
          buildingZ = 0.0;
          population = 15;
          drainageRate = 26.0;
          infiltrationK = 18.0;
        }
      }
      // -------------------------------------------------------------------
      // C. MARINA BAY, SINGAPORE
      // -------------------------------------------------------------------
      else if (locationId === 'singapore') {
        // Marina Bay waterfront basin at center-south, Singapore river entering North-West
        const bayDist = Math.hypot(nx - 0.54, ny - 0.58);
        const isBay = bayDist < 0.20;
        const riverCenter = 0.32 + 0.10 * Math.sin(ny * Math.PI * 3.0);
        const isSingRiver = Math.abs(nx - riverCenter) < 0.04 && ny < 0.55;
        isRiver = isBay || isSingRiver;

        const m1 = (noiseMacro(nx * 2.0, ny * 2.0) + 1) * 0.5;
        const landElev = 1.2 + m1 * 2.5;
        const waterElev = 0.7;

        // Continuous shoreline smoothstep tapering around Marina Bay and Singapore River
        const bayShoreFactor = smoothstep(0.17, 0.23, bayDist);
        const riverDist = Math.abs(nx - riverCenter);
        const riverShoreFactor = smoothstep(0.025, 0.052, riverDist);
        const shoreBlend = Math.min(bayShoreFactor, ny < 0.55 ? riverShoreFactor : 1.0);

        terrainZ = isRiver
          ? waterElev
          : waterElev + (landElev - waterElev) * Math.max(0.25, shoreBlend);

        // Boulevard grid around the bay
        const isAvenueX = x === 22 || x === 42 || x === 60 || x === 74;
        const isAvenueY = y === 20 || y === 44 || y === 68;
        const isStreet = x % 6 === 0 || y % 6 === 0;
        isRoadCell = (isAvenueX || isAvenueY || isStreet) && !isRiver;

        if (isRiver) {
          landType = 'river';
          drainageRate = 45.0;
          infiltrationK = 0.0;
        } else if (isRoadCell) {
          landType = 'road';
          drainageRate = 22.0;
          infiltrationK = 2.0;
          population = 30;
        } else if ((x === 62 || x === 64 || x === 66) && y === 54) {
          // Marina Bay Sands (Triple Tower Landmark)
          landType = 'urban_high';
          buildingZ = 17.5;
          population = 450;
        } else if (nx >= 0.06 && nx <= 0.94 && ny >= 0.06 && ny <= 0.94) {
          // CBD Banking Skyscraper District & Marina Urban Core
          const bldgNoise = (noiseDetail(nx * 12.0, ny * 12.0) + 1) * 0.5;
          landType = 'urban_high';
          buildingZ = 8.0 + bldgNoise * 8.0;
          population = 220;
          drainageRate = 20.0;
          infiltrationK = 1.0;
        } else {
          // Gardens by the Bay & Waterfront Parks
          landType = 'green';
          buildingZ = 0.0;
          population = 20;
          drainageRate = 28.0;
          infiltrationK = 20.0;
        }
      }
      // -------------------------------------------------------------------
      // D. APEX RIVER METROPOLE (DEFAULT)
      // -------------------------------------------------------------------
      else {
        const m1 = (noiseMacro(nx * 2.2, ny * 2.2) + 1) * 0.5;
        const m2 = (noiseDetail(nx * 4.8, ny * 4.8) + 1) * 0.5;
        const slope = (nx * 0.45 + (1 - ny) * 0.55);

        const riverCenter = 0.26 + 0.14 * Math.sin(ny * Math.PI * 2.3);
        const distToRiver = Math.abs(nx - riverCenter);
        isRiver = distToRiver < 0.045 && ny > 0.10;
        const riverTaper = smoothstep(0.045, 0.075, distToRiver);
        const riverCarve = (1.0 - riverTaper) * 3.2;

        const basinDist = Math.hypot(nx - 0.25, ny - 0.76);
        const isBasin = basinDist < 0.24;
        const basinTaper = smoothstep(0.18, 0.26, basinDist);
        const basinCarve = (1.0 - basinTaper) * 3.6;

        terrainZ = (slope * 12.0) + (m1 * 7.5) + (m2 * 2.5) - riverCarve - basinCarve;
        terrainZ = Math.max(0.8, parseFloat(terrainZ.toFixed(2)));

        const isAvenueY = y === 20 || y === 45 || y === 70;
        const isAvenueX = x === 22 || x === 48 || x === 74;
        const isStreetY = y % 6 === 0;
        const isStreetX = x % 6 === 0;
        isRoadCell = (isAvenueX || isAvenueY || isStreetX || isStreetY) && !isRiver;

        const urbanCenterDist = Math.hypot(nx - 0.48, ny - 0.52);
        // Urban Zoning: scale building bounding box across the plain along road avenues
        const isUrbanDistrict = nx >= 0.05 && nx <= 0.95 && ny >= 0.05 && ny <= 0.95 && terrainZ < 15.0 && !isBasin;

        if (isRiver) {
          landType = 'river';
          drainageRate = 45.0;
          infiltrationK = 0.0;
        } else if (isRoadCell) {
          landType = 'road';
          drainageRate = 22.0;
          infiltrationK = 2.0;
          population = 35;
          terrainZ = Math.max(0.7, terrainZ - 0.12);
        } else if (isUrbanDistrict) {
          const bldgNoise = (noiseDetail(nx * 14.0, ny * 14.0) + 1) * 0.5;
          const parcelHash = ((x * 73856093) ^ (y * 19349663)) % 100;
          if (parcelHash < 20) {
            landType = 'green';
            buildingZ = 0.0;
            population = 15;
          } else if (urbanCenterDist < 0.20 && bldgNoise > 0.45) {
            landType = 'urban_high';
            buildingZ = 6.0 + Math.pow(bldgNoise, 2) * 12.0;
            population = Math.floor(180 + bldgNoise * 150);
          } else {
            landType = 'urban_low';
            buildingZ = 3.0 + bldgNoise * 4.5;
            population = Math.floor(80 + bldgNoise * 80);
          }
          drainageRate = 16.0;
          infiltrationK = 2.0;
        } else if (isBasin && basinDist < 0.18) {
          landType = 'green';
          drainageRate = 12.0;
          infiltrationK = 18.0;
          population = 10;
        } else {
          landType = 'green';
          drainageRate = 28.0;
          infiltrationK = 22.0;
          population = 5;
        }
      }

      // Check designated critical asset
      const assetMatch = assets.find(a => a.x === x && a.y === y);
      if (assetMatch) {
        landType = 'critical_asset';
        buildingZ = assetMatch.type === 'hospital' ? 8.5 : assetMatch.type === 'power_station' ? 5.5 : 4.5;
        population = assetMatch.type === 'hospital' ? 350 : 160;
      }

      terrainZ = Math.max(0.7, parseFloat(terrainZ.toFixed(2)));
      const totalZ = parseFloat((terrainZ + buildingZ).toFixed(2));

      const cell: Cell = {
        x,
        y,
        z: totalZ,
        terrainZ,
        buildingZ: parseFloat(buildingZ.toFixed(2)),
        isRoad: isRoadCell,
        isRiver,
        h: 0.0,
        prevH: 0.0,
        dh_dt: 0.0,
        drainageRate,
        baseDrainage: drainageRate,
        infiltrationK,
        isObstructed: false,
        hasBarrier: false,
        landType,
        population,
        risk: 'safe',
        criticalAsset: assetMatch,
      };

      row.push(cell);
      cells.push(cell);
    }
    grid.push(row);
  }

  // =========================================================================
  // 3. BOUNDARY LAPLACIAN & BOX SMOOTHING PASS ON SHORELINE ELEVATIONS
  // =========================================================================
  // Smooths discrete quad transitions strictly on cells adjacent to water-land boundaries
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

  // Apply boundary smoothed elevations back to cell structures
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const cell = grid[y][x];
      cell.terrainZ = parseFloat(Math.max(0.6, smoothedTerrainZ[idx]).toFixed(2));
      cell.z = parseFloat((cell.terrainZ + cell.buildingZ).toFixed(2));
    }
  }

  return { width, height, cells, grid, assets, metroLines };
}
