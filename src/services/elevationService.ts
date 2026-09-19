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

      output[y * gridWidth + x] = elev;
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
            const elev = (r * 256 + g + b / 256) - 32768;
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
      // Gentle slope modulated with high-frequency rolling harmonics
      const baseSlope = (nx - 0.5) * 8.0 + (ny - 0.5) * 4.0;
      const hills =
        Math.sin(nx * Math.PI * 3.5 + centerLon) * 3.0 +
        Math.cos(ny * Math.PI * 4.2 + centerLat) * 2.5;
      output[y * gridWidth + x] = Math.max(1.0, 15.0 + baseSlope + hills);
    }
  }
  return output;
}

/**
 * Normalizes DEM so minimum elevation is offset to base height >= 0.8m
 */
function normalizeElevationGrid(grid: Float32Array): Float32Array {
  let minElev = Infinity;
  let maxElev = -Infinity;

  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v < minElev) minElev = v;
    if (v > maxElev) maxElev = v;
  }

  const range = maxElev - minElev;
  const BASE_HEIGHT = 0.85;

  // Scale gently: if elevation difference is huge (> 100m in 1.2km), compress it gracefully
  const scale = range > 60 ? 60 / range : 1.0;

  const result = new Float32Array(grid.length);
  for (let i = 0; i < grid.length; i++) {
    const norm = (grid[i] - minElev) * scale;
    result[i] = parseFloat((norm + BASE_HEIGHT).toFixed(2));
  }

  return result;
}
