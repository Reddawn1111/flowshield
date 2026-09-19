import * as THREE from 'three';
import { GridState } from '../types/simulation';

/**
 * Generates an ultra-crisp, publication-grade cartographic canvas texture
 * with true Marching-Squares topographic contour lines (Abstract Mountains style)
 * and urban road corridors.
 */
export function createTerrainTexture(gridState: GridState): THREE.CanvasTexture {
  const { width, height, grid } = gridState;
  const canvasSize = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }

  const cellPx = canvasSize / width;

  // 1. Base Terrain Shading with Elevation Gradient
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      const px = x * cellPx;
      const py = y * cellPx;

      // Deep dark slate/charcoal terrain
      const normZ = Math.min(1.0, Math.max(0.0, (cell.terrainZ - 0.8) / 18.0));
      // Base: #0d121c (valley) to #1c2738 (mountain peaks)
      const r = Math.round(13 + normZ * 16);
      const g = Math.round(18 + normZ * 22);
      const b = Math.round(28 + normZ * 30);

      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(px, py, cellPx + 0.5, cellPx + 0.5);

      // Natural riverbed
      if (cell.isRiver) {
        ctx.fillStyle = '#060c14';
        ctx.fillRect(px, py, cellPx + 0.5, cellPx + 0.5);
      }
    }
  }

  // 2. Continuous Marching Squares Topographic Contour Lines (Abstract Mountains Vector Style)
  ctx.save();
  const contourStep = 0.8; // Dense, elegant topographic contours
  const maxZ = 22.0;

  for (let level = 1.6; level <= maxZ; level += contourStep) {
    const isMajor = Math.abs(level % 3.2) < 0.01 || Math.abs(level % 3.2 - 3.2) < 0.01;
    const isSemiMajor = Math.abs(level % 1.6) < 0.01;

    if (isMajor) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.70)'; // Crisp glowing white
      ctx.lineWidth = 1.8;
    } else if (isSemiMajor) {
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.42)'; // Ice-blue
      ctx.lineWidth = 1.1;
    } else {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)'; // Subtle slate
      ctx.lineWidth = 0.7;
    }

    ctx.beginPath();

    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const z00 = grid[y][x].terrainZ;
        const z10 = grid[y][x + 1].terrainZ;
        const z11 = grid[y + 1][x + 1].terrainZ;
        const z01 = grid[y + 1][x].terrainZ;

        // Determine 4-bit index (TL=8, TR=4, BR=2, BL=1)
        let mask = 0;
        if (z00 >= level) mask |= 8;
        if (z10 >= level) mask |= 4;
        if (z11 >= level) mask |= 2;
        if (z01 >= level) mask |= 1;

        if (mask === 0 || mask === 15) continue;

        // Edge crossing interpolations
        const topX = x + (level - z00) / (z10 - z00 || 0.0001);
        const topY = y;

        const rightX = x + 1;
        const rightY = y + (level - z10) / (z11 - z10 || 0.0001);

        const botX = x + (level - z01) / (z11 - z01 || 0.0001);
        const botY = y + 1;

        const leftX = x;
        const leftY = y + (level - z00) / (z01 - z00 || 0.0001);

        const drawSeg = (x1: number, y1: number, x2: number, y2: number) => {
          ctx.moveTo(x1 * cellPx, y1 * cellPx);
          ctx.lineTo(x2 * cellPx, y2 * cellPx);
        };

        switch (mask) {
          case 1:  // BL
          case 14: // not BL
            drawSeg(leftX, leftY, botX, botY);
            break;
          case 2:  // BR
          case 13: // not BR
            drawSeg(botX, botY, rightX, rightY);
            break;
          case 3:  // BL + BR (Bottom)
          case 12: // TL + TR (Top)
            drawSeg(leftX, leftY, rightX, rightY);
            break;
          case 4:  // TR
          case 11: // not TR
            drawSeg(topX, topY, rightX, rightY);
            break;
          case 5:  // BL + TR (Saddle)
            drawSeg(leftX, leftY, topX, topY);
            drawSeg(botX, botY, rightX, rightY);
            break;
          case 6:  // TR + BR (Right)
          case 9:  // TL + BL (Left)
            drawSeg(topX, topY, botX, botY);
            break;
          case 7:  // not TL
          case 8:  // TL
            drawSeg(leftX, leftY, topX, topY);
            break;
          case 10: // TL + BR (Saddle)
            drawSeg(topX, topY, rightX, rightY);
            drawSeg(leftX, leftY, botX, botY);
            break;
        }
      }
    }
    ctx.stroke();
  }
  ctx.restore();

  // 3. Urban Road Network: Render authentic vector road corridors
  ctx.save();
  const spanX = 1200; // Total bounding box span in meters
  const spanZ = 1200;

  if (gridState.roads && gridState.roads.length > 0) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Pass A: Outer roadbed base (dark asphalt foundation)
    for (const road of gridState.roads) {
      if (road.points.length < 2) continue;
      const isMajor = /primary|secondary|trunk|motorway/.test(road.type);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = isMajor ? 18 : 10;
      ctx.beginPath();
      for (let i = 0; i < road.points.length; i++) {
        const px = ((road.points[i][0] + spanX / 2) / spanX) * canvasSize;
        const py = ((road.points[i][1] + spanZ / 2) / spanZ) * canvasSize;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Pass B: Inner driving surface
    for (const road of gridState.roads) {
      if (road.points.length < 2) continue;
      const isMajor = /primary|secondary|trunk|motorway/.test(road.type);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = isMajor ? 13 : 7;
      ctx.beginPath();
      for (let i = 0; i < road.points.length; i++) {
        const px = ((road.points[i][0] + spanX / 2) / spanX) * canvasSize;
        const py = ((road.points[i][1] + spanZ / 2) / spanZ) * canvasSize;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Pass C: Major artery dashed lane markings
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 1.4;
    for (const road of gridState.roads) {
      if (road.points.length < 2) continue;
      const isMajor = /primary|secondary|trunk|motorway/.test(road.type);
      if (!isMajor) continue;
      ctx.beginPath();
      for (let i = 0; i < road.points.length; i++) {
        const px = ((road.points[i][0] + spanX / 2) / spanX) * canvasSize;
        const py = ((road.points[i][1] + spanZ / 2) / spanZ) * canvasSize;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  } else {
    // Fallback: Contiguous raster cell road rendering
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = grid[y][x];
        if (!cell.isRoad) continue;

        const px = x * cellPx;
        const py = y * cellPx;

        ctx.fillStyle = '#111722';
        ctx.fillRect(px, py, cellPx, cellPx);

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(px + 0.5, py + 0.5, cellPx - 1, cellPx - 1);
      }
    }
  }
  ctx.restore();

  // 4. Subtle Outer Neatline
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
  ctx.lineWidth = 3.0;
  ctx.strokeRect(1.5, 1.5, canvasSize - 3, canvasSize - 3);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 16;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;

  return texture;
}
