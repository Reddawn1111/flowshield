/**
 * Elevation Service
 * Fetches digital elevation model (DEM) grids from Open-Meteo API with AWS Terrarium fallback.
 */

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Fetch elevation grid for a bounding box
 * @param bbox { south, west, north, east }
 * @param gridWidth Number of columns (default 90)
 * @param gridHeight Number of rows (default 90)
 * @returns Float32Array of size gridWidth * gridHeight normalized with lowest point >= 0
 */
export async function fetchElevationGrid(
  bbox: BoundingBox,
  gridWidth: number = 90,
  gridHeight: number = 90
): Promise<Float32Array> {
  try {
    const rawGrid = await fetchFromOpenMeteo(bbox, gridWidth, gridHeight);
    return normalizeElevationGrid(rawGrid);
  } catch (err) {
    console.warn('Open-Meteo elevation query failed, attempting Terrarium fallback:', err);
    try {
      const terrariumGrid = await fetchFromTerrarium(bbox, gridWidth, gridHeight);
      return normalizeElevationGrid(terrariumGrid);
    } catch (fallbackErr) {
      console.warn('Terrarium fallback failed, generating fallback DEM:', fallbackErr);
      const proceduralGrid = generateProceduralDEM(bbox, gridWidth, gridHeight);
      return normalizeElevationGrid(proceduralGrid);
    }
  }
}

/**
 * Query Open-Meteo Elevation API with batch sample points and bilinear interpolation
 */
async function fetchFromOpenMeteo(
  bbox: BoundingBox,
  gridWidth: number,
  gridHeight: number
): Promise<Float32Array> {
  const sampleCols = 9;
  const sampleRows = 9;
  const sampleLats: number[] = [];
  const sampleLons: number[] = [];

  for (let r = 0; r < sampleRows; r++) {
    // North to South (row 0 is North)
    const lat = bbox.north - (r / (sampleRows - 1)) * (bbox.north - bbox.south);
    for (let c = 0; c < sampleCols; c++) {
      // West to East (col 0 is West)
      const lon = bbox.west + (c / (sampleCols - 1)) * (bbox.east - bbox.west);
      sampleLats.push(parseFloat(lat.toFixed(6)));
      sampleLons.push(parseFloat(lon.toFixed(6)));
    }
  }

  const url = `https://api.open-meteo.com/v1/elevation?latitude=${sampleLats.join(',')}&longitude=${sampleLons.join(',')}`;
  
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open-Meteo elevation HTTP ${res.status}`);
  }

  const json = await res.json();
  const elevations: number[] = json.elevation;

  if (!elevations || elevations.length !== sampleCols * sampleRows) {
    throw new Error('Unexpected elevation array length from Open-Meteo');
  }

  // Sanitize raw sample points: clamp NoData (< -100), NaN, or negative ocean bathymetry to 0.0m
  for (let i = 0; i < elevations.length; i++) {
    const val = elevations[i];
    if (isNaN(val) || val === null || val === undefined || val < 0.0) {
      elevations[i] = 0.0;
    }
  }

  // 2D Bilinear Interpolation to target gridWidth x gridHeight
  const output = new Float32Array(gridWidth * gridHeight);

  for (let y = 0; y < gridHeight; y++) {
    const v = y / (gridHeight - 1); // 0 to 1
    const sampleY = v * (sampleRows - 1);
    const y0 = Math.floor(sampleY);
    const y1 = Math.min(sampleRows - 1, y0 + 1);
    const dy = sampleY - y0;

    for (let x = 0; x < gridWidth; x++) {
      const u = x / (gridWidth - 1); // 0 to 1
      const sampleX = u * (sampleCols - 1);
      const x0 = Math.floor(sampleX);
      const x1 = Math.min(sampleCols - 1, x0 + 1);
      const dx = sampleX - x0;

      // Sample 4 surrounding grid values
      const e00 = elevations[y0 * sampleCols + x0];
      const e10 = elevations[y0 * sampleCols + x1];
      const e01 = elevations[y1 * sampleCols + x0];
      const e11 = elevations[y1 * sampleCols + x1];

      // Bilinear formula
      const top = e00 * (1 - dx) + e10 * dx;
      const bottom = e01 * (1 - dx) + e11 * dx;
      const elev = top * (1 - dy) + bottom * dy;

      output[y * gridWidth + x] = Math.max(0.0, isNaN(elev) ? 0.0 : elev);
    }
  }

  return output;
}

/**
 * Fallback: AWS Nextzen Terrarium Tiles
 * Elevation formula: (R * 256 + G + B / 256) - 32768
 */
async function fetchFromTerrarium(
  bbox: BoundingBox,
  gridWidth: number,
  gridHeight: number
): Promise<Float32Array> {
  const centerLat = (bbox.north + bbox.south) / 2;
  const centerLon = (bbox.east + bbox.west) / 2;
  const zoom = 13;

  const n = Math.pow(2, zoom);
  const tileX = Math.floor(((centerLon + 180) / 360) * n);
  const latRad = (centerLat * Math.PI) / 180;
  const tileY = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );

  const tileUrl = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tileX}/${tileY}.png`;
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context failed'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

        const output = new Float32Array(gridWidth * gridHeight);
        for (let y = 0; y < gridHeight; y++) {
          const imgY = Math.floor((y / (gridHeight - 1)) * (canvas.height - 1));
          for (let x = 0; x < gridWidth; x++) {
            const imgX = Math.floor((x / (gridWidth - 1)) * (canvas.width - 1));
            const idx = (imgY * canvas.width + imgX) * 4;
            const r = imgData[idx];
            const g = imgData[idx + 1];
            const b = imgData[idx + 2];
            let elev = (r * 256 + g + b / 256) - 32768;
            if (isNaN(elev) || elev < 0.0) elev = 0.0;
            output[y * gridWidth + x] = elev;
          }
        }
        resolve(output);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error(`Failed to load Terrarium tile: ${tileUrl}`));
    img.src = tileUrl;
  });
}

/**
 * Procedural Fallback DEM when offline or rate-limited
 */
function generateProceduralDEM(
  bbox: BoundingBox,
  gridWidth: number,
  gridHeight: number
): Float32Array {
  const output = new Float32Array(gridWidth * gridHeight);
  const centerLat = (bbox.north + bbox.south) / 2;
  const centerLon = (bbox.east + bbox.west) / 2;

  for (let y = 0; y < gridHeight; y++) {
    const ny = y / (gridHeight - 1);
    for (let x = 0; x < gridWidth; x++) {
      const nx = x / (gridWidth - 1);
      const baseSlope = (nx - 0.5) * 8.0 + (ny - 0.5) * 4.0;
      const hills =
        Math.sin(nx * Math.PI * 3.5 + centerLon) * 3.0 +
        Math.cos(ny * Math.PI * 4.2 + centerLat) * 2.5;
      output[y * gridWidth + x] = Math.max(0.0, 15.0 + baseSlope + hills);
    }
  }
  return output;
}

/**
 * Sanitizes DEM elevation data:
 * 1. Clamps negative bathymetry and NoData (< -100, NaN) to 0.0m (sea level)
 * 2. Spatial clamp filter: Detects isolated spike vertices where Z(x, y) - average_neighbor_Z > 25m
 *    and clamps them to the neighbor average, eliminating coastal wall spikes.
 * 3. Normalizes elevations smoothly starting from 0.0m at sea level.
 */
function normalizeElevationGrid(
  grid: Float32Array,
  gridWidth: number = 90,
  gridHeight: number = 90
): Float32Array {
  const sanitized = new Float32Array(grid.length);

  // Pass 1: Raw value sanitation and baseline clamp to sea level (0.0m)
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (isNaN(v) || v === null || v === undefined || v < 0.0) {
      sanitized[i] = 0.0;
    } else {
      sanitized[i] = v;
    }
  }

  // Pass 2: Spatial spike suppression filter (eliminates coastal ridges and interpolation spikes)
  const filtered = new Float32Array(grid.length);
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const idx = y * gridWidth + x;
      const currentZ = sanitized[idx];

      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
            sum += sanitized[ny * gridWidth + nx];
            count++;
          }
        }
      }

      const avgNeighbor = count > 0 ? sum / count : currentZ;

      // If vertex is an isolated spike > 25m above surrounding neighbors, clamp to neighbor average
      if (currentZ - avgNeighbor > 25.0) {
        filtered[idx] = avgNeighbor;
      } else {
        filtered[idx] = currentZ;
      }
    }
  }

  // Pass 2.5: Coastal Skyscraper DSM Clutter Suppression
  // Satellite DEMs (like Copernicus/SRTM) frequently measure the rooftops of skyscraper clusters in coastal CBDs (e.g. Lower Manhattan, Marina Bay).
  // If the scene borders open sea (at least 15 perimeter cells <= 0.5m), clamp ground elevations to realistic coastal land topography (<= 16.0m).
  let seaPerimeterCount = 0;
  for (let x = 0; x < gridWidth; x++) {
    if (filtered[0 * gridWidth + x] <= 0.5) seaPerimeterCount++;
    if (filtered[(gridHeight - 1) * gridWidth + x] <= 0.5) seaPerimeterCount++;
  }
  for (let y = 1; y < gridHeight - 1; y++) {
    if (filtered[y * gridWidth + 0] <= 0.5) seaPerimeterCount++;
    if (filtered[y * gridWidth + (gridWidth - 1)] <= 0.5) seaPerimeterCount++;
  }

  if (seaPerimeterCount >= 15) {
    for (let i = 0; i < filtered.length; i++) {
      if (filtered[i] > 16.0) {
        filtered[i] = 16.0;
      }
    }
  }

  // Pass 3: Gentle dynamic scaling so extreme mountains compress gracefully into diorama
  let maxElev = 0.0;
  for (let i = 0; i < filtered.length; i++) {
    if (filtered[i] > maxElev) maxElev = filtered[i];
  }

  const scale = maxElev > 60 ? 60 / maxElev : 1.0;
  const result = new Float32Array(filtered.length);
  for (let i = 0; i < filtered.length; i++) {
    result[i] = parseFloat((filtered[i] * scale).toFixed(2));
  }

  return result;
}
