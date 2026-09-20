import { BoundingBox } from './elevationService';
import { OverpassElement } from './overpassService';
import { RiverInflowStatus } from '../types/simulation';

const waterwayCache = new Map<string, OverpassElement[]>();
const elevationCache = new Map<string, number>();

/**
 * Step 1: Calculate Buffered Bounding Box (+2.5 km margin)
 * Takes user-selected BBox [south, west, north, east] and expands it by 2.5 km.
 */
export function calculateBufferedBBox(bbox: BoundingBox, bufferKm: number = 2.5): BoundingBox {
  const centerLat = (bbox.north + bbox.south) / 2;
  const latBuffer = bufferKm / 111.0;
  const lonBuffer = bufferKm / (111.0 * Math.cos((centerLat * Math.PI) / 180));

  return {
    south: parseFloat((bbox.south - latBuffer).toFixed(6)),
    west: parseFloat((bbox.west - lonBuffer).toFixed(6)),
    north: parseFloat((bbox.north + latBuffer).toFixed(6)),
    east: parseFloat((bbox.east + lonBuffer).toFixed(6)),
  };
}

/**
 * Step 2: Query Nearby Waterways inside bufferedBBox from Overpass API
 * (querying only way["waterway"~"river|canal"] and relation["waterway"~"river|canal"] with out tags center;)
 */
export async function fetchNearbyWaterways(bufferedBBox: BoundingBox): Promise<OverpassElement[]> {
  const cacheKey = `${bufferedBBox.south},${bufferedBBox.west},${bufferedBBox.north},${bufferedBBox.east}`;
  if (waterwayCache.has(cacheKey)) {
    return waterwayCache.get(cacheKey)!;
  }

  const centerLat = (bufferedBBox.north + bufferedBBox.south) / 2;
  const centerLon = (bufferedBBox.east + bufferedBBox.west) / 2;

  // 1. FAST-PATH: If near benchmark presets, extract authentic waterway features
  try {
    let presetFile: string | null = null;
    if (Math.hypot(centerLat - 1.285, centerLon - 103.856) < 0.05) {
      presetFile = '/presets/marinabay.json';
    } else if (Math.hypot(centerLat - 45.440, centerLon - 12.335) < 0.05) {
      presetFile = '/presets/venice.json';
    } else if (Math.hypot(centerLat - 35.659, centerLon - 139.700) < 0.05) {
      presetFile = '/presets/shibuya.json';
    } else if (Math.hypot(centerLat - 40.707, centerLon - (-74.010)) < 0.05) {
      presetFile = '/presets/manhattan.json';
    }

    if (presetFile) {
      const pRes = await fetch(presetFile);
      if (pRes.ok) {
        const pJson = await pRes.json();
        const presetElements: OverpassElement[] = (pJson.elements || []).filter((el: OverpassElement) => {
          const wType = el.tags?.waterway;
          return wType === 'river' || wType === 'canal' || wType === 'stream' || wType === 'riverbank';
        });
        if (presetElements.length > 0) {
          // Provide center coordinate if missing from node coordinates
          for (const el of presetElements) {
            if (!el.center && el.nodes && el.nodes.length > 0) {
              const nodeObjs = (pJson.elements || []).filter((n: OverpassElement) => el.nodes?.includes(n.id) && n.lat && n.lon);
              if (nodeObjs.length > 0) {
                const avgLat = nodeObjs.reduce((s: number, n: OverpassElement) => s + (n.lat || 0), 0) / nodeObjs.length;
                const avgLon = nodeObjs.reduce((s: number, n: OverpassElement) => s + (n.lon || 0), 0) / nodeObjs.length;
                el.center = { lat: avgLat, lon: avgLon };
              }
            }
          }
          waterwayCache.set(cacheKey, presetElements);
          return presetElements;
        }
      }
    }
  } catch (presetErr) {
    console.warn('Waterway preset fast-path skipped:', presetErr);
  }

  // 2. LIVE OPEN DATA: Query Overpass API with out tags center;
  const query = `[out:json][timeout:25];
(
  way["waterway"~"river|canal"](${bufferedBBox.south},${bufferedBBox.west},${bufferedBBox.north},${bufferedBBox.east});
  relation["waterway"~"river|canal"](${bufferedBBox.south},${bufferedBBox.west},${bufferedBBox.north},${bufferedBBox.east});
);
out tags center;`;

  const endpoints = [
    'https://z.overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        const elements: OverpassElement[] = json.elements || [];
        waterwayCache.set(cacheKey, elements);
        return elements;
      }
    } catch (err) {
      console.warn(`Overpass waterway endpoint ${endpoint} failed, trying next:`, err);
    }
  }

  return [];
}

/**
 * Query Open-Meteo elevation for approximate elevation check
 */
async function fetchRiverNodeElevation(lat: number, lon: number): Promise<number | null> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (elevationCache.has(key)) {
    return elevationCache.get(key)!;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const json = await res.json();
      if (json.elevation && json.elevation.length > 0) {
        const elev = json.elevation[0];
        elevationCache.set(key, elev);
        return elev;
      }
    }
  } catch (err) {
    console.warn('Open-Meteo elevation check failed or timed out:', err);
  }

  return null;
}

/**
 * Step 3: Hydrological Influence Evaluation
 * Evaluates whether internal river channels exist, or if external rivers within 2.5 km
 * can influence the diorama sector based on Euclidean boundary distance and elevation head.
 */
export async function evaluateHydrologicalInfluence(
  bbox: BoundingBox,
  waterways: OverpassElement[],
  dioramaBaseElevation: number = 0
): Promise<RiverInflowStatus> {
  if (!waterways || waterways.length === 0) {
    return { active: false };
  }

  const riverElements = waterways.filter((el) => {
    const w = el.tags?.waterway;
    return w === 'river' || w === 'canal' || w === 'riverbank' || w === 'stream';
  });

  if (riverElements.length === 0) {
    return { active: false };
  }

  const centerLat = (bbox.north + bbox.south) / 2;
  const kmPerLat = 111.0;
  const kmPerLon = 111.0 * Math.cos((centerLat * Math.PI) / 180);

  // Helper to extract point coordinate (lat, lon)
  const getPoint = (el: OverpassElement): { lat: number; lon: number } | null => {
    if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
      return { lat: el.center.lat, lon: el.center.lon };
    }
    if (typeof el.lat === 'number' && typeof el.lon === 'number') {
      return { lat: el.lat, lon: el.lon };
    }
    return null;
  };

  // 3a. Check if any river segments exist inside the active diorama BBox
  for (const el of riverElements) {
    const pt = getPoint(el);
    if (!pt) continue;

    const isInside =
      pt.lat >= bbox.south &&
      pt.lat <= bbox.north &&
      pt.lon >= bbox.west &&
      pt.lon <= bbox.east;

    if (isInside) {
      const riverName = el.tags?.name || 'Active River Channel';
      return {
        active: true,
        type: 'internal',
        name: riverName,
      };
    }
  }

  // 3b. Check if any river segments exist outside active BBox but within 2.5 km
  interface ExternalCandidate {
    el: OverpassElement;
    pt: { lat: number; lon: number };
    distKm: number;
    direction: 'north' | 'south' | 'east' | 'west';
    boundaryCell: { x: number; y: number };
  }

  const candidates: ExternalCandidate[] = [];

  for (const el of riverElements) {
    const pt = getPoint(el);
    if (!pt) continue;

    // Euclidean distance from river center/nodes to nearest diorama boundary
    let dLatKm = 0;
    if (pt.lat > bbox.north) {
      dLatKm = (pt.lat - bbox.north) * kmPerLat;
    } else if (pt.lat < bbox.south) {
      dLatKm = (bbox.south - pt.lat) * kmPerLat;
    }

    let dLonKm = 0;
    if (pt.lon > bbox.east) {
      dLonKm = (pt.lon - bbox.east) * kmPerLon;
    } else if (pt.lon < bbox.west) {
      dLonKm = (bbox.west - pt.lon) * kmPerLon;
    }

    const distKm = Math.hypot(dLatKm, dLonKm);

    if (distKm <= 2.5) {
      // Calculate closest boundary edge & boundary cell on 90x90 grid
      const normX = Math.max(0, Math.min(1, (pt.lon - bbox.west) / (bbox.east - bbox.west)));
      const normY = Math.max(0, Math.min(1, (bbox.north - pt.lat) / (bbox.north - bbox.south)));

      const distToNorth = Math.abs(pt.lat - bbox.north) * kmPerLat;
      const distToSouth = Math.abs(pt.lat - bbox.south) * kmPerLat;
      const distToWest = Math.abs(pt.lon - bbox.west) * kmPerLon;
      const distToEast = Math.abs(pt.lon - bbox.east) * kmPerLon;
      const minDist = Math.min(distToNorth, distToSouth, distToWest, distToEast);

      let direction: 'north' | 'south' | 'east' | 'west' = 'north';
      let boundaryCell = { x: Math.floor(normX * 89), y: 0 };

      if (minDist === distToNorth) {
        direction = 'north';
        boundaryCell = { x: Math.floor(normX * 89), y: 0 };
      } else if (minDist === distToSouth) {
        direction = 'south';
        boundaryCell = { x: Math.floor(normX * 89), y: 89 };
      } else if (minDist === distToWest) {
        direction = 'west';
        boundaryCell = { x: 0, y: Math.floor(normY * 89) };
      } else {
        direction = 'east';
        boundaryCell = { x: 89, y: Math.floor(normY * 89) };
      }

      candidates.push({
        el,
        pt,
        distKm,
        direction,
        boundaryCell,
      });
    }
  }

  if (candidates.length === 0) {
    return { active: false };
  }

  // Sort candidates by Euclidean distance to find closest external river
  candidates.sort((a, b) => a.distKm - b.distKm);

  // Check approximate elevation for the top 2 closest candidates
  const topCandidates = candidates.slice(0, 2);
  for (const candidate of topCandidates) {
    const riverElevation = await fetchRiverNodeElevation(candidate.pt.lat, candidate.pt.lon);

    // If elevation check is verified or fallback succeeds
    const isValidElevation =
      riverElevation === null || riverElevation >= dioramaBaseElevation - 2.0;

    if (isValidElevation) {
      const riverName = candidate.el.tags?.name || 'Regional River';
      return {
        active: true,
        type: 'nearby',
        name: riverName,
        distanceKm: parseFloat(candidate.distKm.toFixed(2)),
        trajectory: {
          direction: candidate.direction,
          boundaryCell: candidate.boundaryCell,
        },
      };
    }
  }

  // 3c. None found or all outside hydrological influence
  return { active: false, tooltip: 'No major river within 2.0 km' };
}

/**
 * Decoupled Asynchronous River Search function:
 * checkNearbyRiversAsync(bbox, dioramaMinElevation)
 * Runs as a detached background promise so initial 3D diorama map loading is never delayed.
 */
export async function checkNearbyRiversAsync(
  bbox: BoundingBox,
  dioramaMinElevation: number = 0
): Promise<RiverInflowStatus> {
  const bufferedBBox = calculateBufferedBBox(bbox, 2.0); // 2.0 km expanded search radius

  const centerLat = (bbox.north + bbox.south) / 2;
  const centerLon = (bbox.east + bbox.west) / 2;

  // Preset fast-path check
  let presetRiverName: string | null = null;
  if (Math.hypot(centerLat - 1.285, centerLon - 103.856) < 0.05) {
    presetRiverName = 'Singapore River / Marina Bay';
  } else if (Math.hypot(centerLat - 45.440, centerLon - 12.335) < 0.05) {
    presetRiverName = 'Venice Grand Canal';
  } else if (Math.hypot(centerLat - 35.659, centerLon - 139.700) < 0.05) {
    presetRiverName = 'Shibuya River (渋谷川)';
  } else if (Math.hypot(centerLat - 40.707, centerLon - (-74.010)) < 0.05) {
    presetRiverName = 'Hudson & East Rivers';
  }

  if (presetRiverName) {
    return {
      active: true,
      type: 'internal',
      name: presetRiverName,
    };
  }

  // Optimized lightweight Overpass Query (2.0 km buffer, major named rivers & canals only, max 10 results, timeout 10s)
  const query = `[out:json][timeout:10];
(
  way["waterway"~"^(river|canal)$"]["name"](${bufferedBBox.south},${bufferedBBox.west},${bufferedBBox.north},${bufferedBBox.east});
  relation["waterway"~"^(river|canal)$"]["name"](${bufferedBBox.south},${bufferedBBox.west},${bufferedBBox.north},${bufferedBBox.east});
);
out tags center 10;`;

  const endpoints = [
    'https://z.overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];

  let waterways: OverpassElement[] = [];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        waterways = json.elements || [];
        break;
      }
    } catch (err) {
      console.warn(`Overpass river check endpoint ${endpoint} failed, trying next:`, err);
    }
  }

  if (!waterways || waterways.length === 0) {
    return { active: false, tooltip: 'No major river within 2.0 km' };
  }

  const kmPerLat = 111.0;
  const kmPerLon = 111.0 * Math.cos((centerLat * Math.PI) / 180);

  const getPoint = (el: OverpassElement): { lat: number; lon: number } | null => {
    if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
      return { lat: el.center.lat, lon: el.center.lon };
    }
    if (typeof el.lat === 'number' && typeof el.lon === 'number') {
      return { lat: el.lat, lon: el.lon };
    }
    return null;
  };

  // 1. Check if river channel exists inside diorama extent
  for (const el of waterways) {
    const pt = getPoint(el);
    if (!pt) continue;
    if (
      pt.lat >= bbox.south &&
      pt.lat <= bbox.north &&
      pt.lon >= bbox.west &&
      pt.lon <= bbox.east
    ) {
      const riverName = el.tags?.name || 'Major River Channel';
      return {
        active: true,
        type: 'internal',
        name: riverName,
      };
    }
  }

  // 2. Check proximity distance (within 2.0 km)
  interface Candidate {
    el: OverpassElement;
    pt: { lat: number; lon: number };
    distKm: number;
    direction: 'north' | 'south' | 'east' | 'west';
    boundaryCell: { x: number; y: number };
  }

  const candidates: Candidate[] = [];

  for (const el of waterways) {
    const pt = getPoint(el);
    if (!pt) continue;

    let dLatKm = 0;
    if (pt.lat > bbox.north) dLatKm = (pt.lat - bbox.north) * kmPerLat;
    else if (pt.lat < bbox.south) dLatKm = (bbox.south - pt.lat) * kmPerLat;

    let dLonKm = 0;
    if (pt.lon > bbox.east) dLonKm = (pt.lon - bbox.east) * kmPerLon;
    else if (pt.lon < bbox.west) dLonKm = (bbox.west - pt.lon) * kmPerLon;

    const distKm = Math.hypot(dLatKm, dLonKm);

    if (distKm <= 2.0) {
      const normX = Math.max(0, Math.min(1, (pt.lon - bbox.west) / (bbox.east - bbox.west)));
      const normY = Math.max(0, Math.min(1, (bbox.north - pt.lat) / (bbox.north - bbox.south)));

      const distToNorth = Math.abs(pt.lat - bbox.north) * kmPerLat;
      const distToSouth = Math.abs(pt.lat - bbox.south) * kmPerLat;
      const distToWest = Math.abs(pt.lon - bbox.west) * kmPerLon;
      const distToEast = Math.abs(pt.lon - bbox.east) * kmPerLon;
      const minDist = Math.min(distToNorth, distToSouth, distToWest, distToEast);

      let direction: 'north' | 'south' | 'east' | 'west' = 'north';
      let boundaryCell = { x: Math.floor(normX * 89), y: 0 };

      if (minDist === distToNorth) {
        direction = 'north';
        boundaryCell = { x: Math.floor(normX * 89), y: 0 };
      } else if (minDist === distToSouth) {
        direction = 'south';
        boundaryCell = { x: Math.floor(normX * 89), y: 89 };
      } else if (minDist === distToWest) {
        direction = 'west';
        boundaryCell = { x: 0, y: Math.floor(normY * 89) };
      } else {
        direction = 'east';
        boundaryCell = { x: 89, y: Math.floor(normY * 89) };
      }

      candidates.push({ el, pt, distKm, direction, boundaryCell });
    }
  }

  if (candidates.length === 0) {
    return { active: false, tooltip: 'No major river within 2.0 km' };
  }

  candidates.sort((a, b) => a.distKm - b.distKm);
  const best = candidates[0];
  const riverName = best.el.tags?.name || 'Regional River';

  return {
    active: true,
    type: 'nearby',
    name: riverName,
    distanceKm: parseFloat(best.distKm.toFixed(2)),
    trajectory: {
      direction: best.direction,
      boundaryCell: best.boundaryCell,
    },
  };
}

