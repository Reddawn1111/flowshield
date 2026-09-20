import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Cell, CriticalAsset, GridState, MetroLine } from '../types/simulation';
import { createTerrainTexture } from '../engine/terrainTexture';

interface Scene3DProps {
  gridState: GridState;
  onSelectCell: (cell: Cell | null) => void;
  selectedCell: Cell | null;
  activeTool: 'inspect' | 'sandbag' | 'obstruct';
  onCellAction: (x: number, y: number, action: 'sandbag' | 'obstruct') => void;
}

/**
 * Bilinearly samples continuous ground elevation at world coordinate (x, z)
 * If crossing a water body, keeps the road elevated cleanly above water surface level
 */
function sampleTerrainElevation(
  x: number,
  z: number,
  grid: Cell[][],
  width: number,
  height: number,
  HALF_W: number,
  HALF_H: number,
  VERTICAL_SCALE: number
): number {
  const u = Math.max(0, Math.min(width - 1, ((x + HALF_W) / (HALF_W * 2)) * (width - 1)));
  const v = Math.max(0, Math.min(height - 1, ((z + HALF_H) / (HALF_H * 2)) * (height - 1)));

  const x0 = Math.floor(u);
  const x1 = Math.min(width - 1, x0 + 1);
  const y0 = Math.floor(v);
  const y1 = Math.min(height - 1, y0 + 1);

  const fx = u - x0;
  const fy = v - y0;

  const z00 = grid[y0][x0].terrainZ;
  const z10 = grid[y0][x1].terrainZ;
  const z01 = grid[y1][x0].terrainZ;
  const z11 = grid[y1][x1].terrainZ;

  let elev =
    (1 - fx) * (1 - fy) * z00 +
    fx * (1 - fy) * z10 +
    (1 - fx) * fy * z01 +
    fx * fy * z11;

  // If over a river or canal, bridge smoothly over water
  const isWater = grid[y0][x0].isRiver || grid[y0][x1].isRiver || grid[y1][x0].isRiver || grid[y1][x1].isRiver;
  if (isWater) {
    const maxBank = Math.max(z00, z10, z01, z11);
    elev = Math.max(elev + 0.45, maxBank + 0.20);
  }

  return elev * VERTICAL_SCALE;
}

export const Scene3D: React.FC<Scene3DProps> = ({
  gridState,
  onSelectCell,
  selectedCell,
  activeTool,
  onCellAction,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Core 3D objects
  const terrainMeshRef = useRef<THREE.Mesh | null>(null);
  const buildingsMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const waterMeshRef = useRef<THREE.Mesh | null>(null);
  const barriersMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const selectedHighlightRef = useRef<THREE.Mesh | null>(null);

  // Lifeline groups
  const metroLineGroupRef = useRef<THREE.Group | null>(null);
  const metroTubeMeshRef = useRef<THREE.Mesh | null>(null);
  const roadInfraGroupRef = useRef<THREE.Group | null>(null);
  const beaconsGroupRef = useRef<THREE.Group | null>(null);
  const beaconMeshesRef = useRef<Map<string, { mesh: THREE.Mesh; asset: CriticalAsset }>>(new Map());

  // Interaction
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  // Dimension & scale constants
  const SPACING = 1.0;
  const VERTICAL_SCALE = 0.45;

  const { width, height, cells, grid, assets, metroLines } = gridState;
  const HALF_W = (width * SPACING) / 2;
  const HALF_H = (height * SPACING) / 2;

  // Filter building cells only
  const buildingCells = useMemo(() => {
    return cells.filter(c => c.buildingZ > 0);
  }, [cells]);

  // Colors - Strictly Grayscale / Monochrome for Dry Buildings
  const COLOR_AMBER = useRef(new THREE.Color('#FFB300'));
  const COLOR_RED = useRef(new THREE.Color('#FF1744'));
  const COLOR_BLDG_HIGH = useRef(new THREE.Color('#E2E8F0')); // Architectural crisp light gray
  const COLOR_BLDG_MID = useRef(new THREE.Color('#94A3B8'));  // Matte architectural slate gray
  const COLOR_HOSPITAL = useRef(new THREE.Color('#34d399'));
  const COLOR_POWER = useRef(new THREE.Color('#fbbf24'));
  const COLOR_METRO = useRef(new THREE.Color('#c084fc'));

  const tempColor = useRef(new THREE.Color());
  const dummyMatrix = useRef(new THREE.Matrix4());
  const dummyPosition = useRef(new THREE.Vector3());
  const dummyScale = useRef(new THREE.Vector3());
  const dummyQuaternion = useRef(new THREE.Quaternion());

  // Dynamic water buffer pre-allocation (max 6,000 flooded cells * 18 vertices = 108,000 floats)
  const MAX_WATER_VERTS = 160000;
  const waterPositions = useRef(new Float32Array(MAX_WATER_VERTS * 3));
  const waterNormals = useRef(new Float32Array(MAX_WATER_VERTS * 3));

  // Tooltip
  const [hoveredAsset, setHoveredAsset] = useState<{ asset: CriticalAsset; screenPos: { x: number; y: number } } | null>(null);

  // 1. INITIALIZE SCENE, LIGHTS, PEDESTAL, SMOOTH TERRAIN, AND SKIRTS
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    // SCENE
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#07090e');
    scene.fog = new THREE.FogExp2('#07090e', 0.0035);
    sceneRef.current = scene;

    // CAMERA
    const initW = container.clientWidth > 0 ? container.clientWidth : (window.innerWidth > 0 ? window.innerWidth : 1200);
    const initH = container.clientHeight > 0 ? container.clientHeight : (window.innerHeight > 0 ? window.innerHeight : 700);
    const aspect = initW / initH;
    const camera = new THREE.PerspectiveCamera(36, aspect, 1, 1000);
    camera.position.set(HALF_W * 1.5, Math.max(HALF_W, HALF_H) * 1.55, HALF_H * 1.75);
    cameraRef.current = camera;

    // RENDERER
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(initW, initH);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // CONTROLS
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 4.0, 0);
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 25;
    controls.maxDistance = 260;
    controlsRef.current = controls;

    // LIGHTING - Neutral Architectural Illumination (No Blue/Cyan ambient wash)
    const ambientLight = new THREE.AmbientLight('#475569', 0.75);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight('#ffffff', 1.8);
    dirLight.position.set(HALF_W * 1.3, 90, HALF_H * 1.2);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 280;
    const d = Math.max(HALF_W, HALF_H) * 1.4;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0004;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight('#cbd5e1', 0.25);
    fillLight.position.set(-HALF_W, 45, -HALF_H);
    scene.add(fillLight);

    // 2. PEDESTAL BASE SLAB (Solid Black Slab with Soft Shadow)
    const pedestalW = width * SPACING + 2.0;
    const pedestalH = 4.0;
    const pedestalGeo = new THREE.BoxGeometry(pedestalW, pedestalH, pedestalW);
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: '#090d14',
      roughness: 0.92,
      metalness: 0.08,
    });
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.position.set(0, -pedestalH / 2, 0);
    pedestal.receiveShadow = true;
    scene.add(pedestal);

    // Accent pedestal rim
    const rimGeo = new THREE.BoxGeometry(pedestalW + 0.4, 0.35, pedestalW + 0.4);
    const rimMat = new THREE.MeshBasicMaterial({ color: '#182232' });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.position.set(0, -0.18, 0);
    scene.add(rimMesh);

    // Shadow receiver plane below pedestal
    const shadowGeo = new THREE.PlaneGeometry(350, 350);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.65 });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.position.set(0, -pedestalH - 0.05, 0);
    shadowMesh.receiveShadow = true;
    scene.add(shadowMesh);

    // 3. CONTINUOUS SMOOTH TERRAIN MESH
    const terrainGeo = new THREE.PlaneGeometry(
      width * SPACING,
      height * SPACING,
      width - 1,
      height - 1
    );
    terrainGeo.rotateX(-Math.PI / 2);

    // Populate smooth vertex heights
    const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const vIdx = j * width + i;
        const cell = grid[j][i];
        posAttr.setY(vIdx, cell.terrainZ * VERTICAL_SCALE);
      }
    }
    posAttr.needsUpdate = true;
    terrainGeo.computeVertexNormals();

    const terrainTexture = createTerrainTexture(gridState);
    const terrainMat = new THREE.MeshStandardMaterial({
      map: terrainTexture,
      roughness: 0.75,
      metalness: 0.15,
      flatShading: false,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = true;
    scene.add(terrainMesh);
    terrainMeshRef.current = terrainMesh;

    // 4. SOLID PERIMETER SKIRT WALLS (Connects 4 borders down to y = 0, eliminating gaps)
    const skirtGeo = new THREE.BufferGeometry();
    const skirtVerts: number[] = [];

    // Helper to add a vertical wall quad
    const addSkirtQuad = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
      // Triangle 1: (x1, y1, z1) -> (x2, y2, z2) -> (x2, 0, z2)
      skirtVerts.push(x1, y1, z1, x2, y2, z2, x2, 0, z2);
      // Triangle 2: (x1, y1, z1) -> (x2, 0, z2) -> (x1, 0, z1)
      skirtVerts.push(x1, y1, z1, x2, 0, z2, x1, 0, z1);
    };

    // North Skirt (y = 0)
    for (let x = 0; x < width - 1; x++) {
      const x1 = (x * SPACING) - HALF_W;
      const x2 = ((x + 1) * SPACING) - HALF_W;
      const z = -HALF_H;
      const y1 = grid[0][x].terrainZ * VERTICAL_SCALE;
      const y2 = grid[0][x + 1].terrainZ * VERTICAL_SCALE;
      addSkirtQuad(x1, y1, z, x2, y2, z);
    }
    // South Skirt (y = height - 1)
    for (let x = 0; x < width - 1; x++) {
      const x1 = ((x + 1) * SPACING) - HALF_W;
      const x2 = (x * SPACING) - HALF_W;
      const z = HALF_H;
      const y1 = grid[height - 1][x + 1].terrainZ * VERTICAL_SCALE;
      const y2 = grid[height - 1][x].terrainZ * VERTICAL_SCALE;
      addSkirtQuad(x1, y1, z, x2, y2, z);
    }
    // West Skirt (x = 0)
    for (let y = 0; y < height - 1; y++) {
      const x = -HALF_W;
      const z1 = ((y + 1) * SPACING) - HALF_H;
      const z2 = (y * SPACING) - HALF_H;
      const y1 = grid[y + 1][0].terrainZ * VERTICAL_SCALE;
      const y2 = grid[y][0].terrainZ * VERTICAL_SCALE;
      addSkirtQuad(x, y1, z1, x, y2, z2);
    }
    // East Skirt (x = width - 1)
    for (let y = 0; y < height - 1; y++) {
      const x = HALF_W;
      const z1 = (y * SPACING) - HALF_H;
      const z2 = ((y + 1) * SPACING) - HALF_H;
      const y1 = grid[y][width - 1].terrainZ * VERTICAL_SCALE;
      const y2 = grid[y + 1][width - 1].terrainZ * VERTICAL_SCALE;
      addSkirtQuad(x, y1, z1, x, y2, z2);
    }

    skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtVerts, 3));
    skirtGeo.computeVertexNormals();
    const skirtMat = new THREE.MeshStandardMaterial({
      color: '#0c1017',
      roughness: 0.9,
      metalness: 0.1,
    });
    const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    skirtMesh.castShadow = true;
    skirtMesh.receiveShadow = true;
    scene.add(skirtMesh);

    // 5. DISCRETE 3D BUILDING BLOCKS (InstancedMesh strictly for building parcels)
    const bldgBoxGeo = new THREE.BoxGeometry(0.86, 1.0, 0.86);
    bldgBoxGeo.translate(0, 0.5, 0); // Origin at bottom of building
    const bldgMat = new THREE.MeshStandardMaterial({
      roughness: 0.85,
      metalness: 0.05,
      flatShading: true,
    });

    const buildingsCount = buildingCells.length;
    const bldgMesh = new THREE.InstancedMesh(bldgBoxGeo, bldgMat, Math.max(1, buildingsCount));
    const bldgColors = new Float32Array(Math.max(1, buildingsCount) * 3);
    bldgColors.fill(0.85);
    bldgMesh.instanceColor = new THREE.InstancedBufferAttribute(bldgColors, 3);
    bldgMesh.castShadow = true;
    bldgMesh.receiveShadow = true;
    scene.add(bldgMesh);
    buildingsMeshRef.current = bldgMesh;

    // 6. VOLUMETRIC 3D WATER MESH (Dynamic fluid volume with zero sawtooth artifacts)
    const waterGeo = new THREE.BufferGeometry();
    waterGeo.setAttribute('position', new THREE.BufferAttribute(waterPositions.current, 3));
    waterGeo.setAttribute('normal', new THREE.BufferAttribute(waterNormals.current, 3));
    waterGeo.setDrawRange(0, 0);

    const waterMat = new THREE.MeshPhysicalMaterial({
      color: '#00F0FF',
      emissive: '#005b7f',
      emissiveIntensity: 0.35,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.84,
      transmission: 0.35,
      ior: 1.333,
      depthWrite: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1.0,
      polygonOffsetUnits: -1.0,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.castShadow = true;
    waterMesh.receiveShadow = true;
    scene.add(waterMesh);
    waterMeshRef.current = waterMesh;

    // 7. SANDBAG BARRIERS INSTANCED MESH
    const barrierGeo = new THREE.BoxGeometry(0.96, 0.45, 0.96);
    barrierGeo.translate(0, 0.225, 0);
    const barrierMat = new THREE.MeshStandardMaterial({
      color: '#e2e8f0',
      roughness: 0.8,
      metalness: 0.1,
    });
    const barriersMesh = new THREE.InstancedMesh(barrierGeo, barrierMat, 500);
    barriersMesh.count = 0;
    scene.add(barriersMesh);
    barriersMeshRef.current = barriersMesh;

    // 8. FIXED RIGID METRO VIADUCT INFRASTRUCTURE (Rock-solid elevation on concrete piers)
    const metroGroup = new THREE.Group();
    scene.add(metroGroup);
    metroLineGroupRef.current = metroGroup;

    for (const line of metroLines) {
      const points: THREE.Vector3[] = [];
      for (const pt of line.path) {
        if (pt.x < 0 || pt.x >= width || pt.y < 0 || pt.y >= height) continue;
        const cell = grid[pt.y][pt.x];
        // FAIL-SAFE: Never draw an elevated viaduct through a building!
        if (cell.buildingZ > 0) continue;

        const posX = (pt.x * SPACING) - HALF_W + SPACING / 2;
        const posZ = (pt.y * SPACING) - HALF_H + SPACING / 2;
        const groundY = cell.terrainZ * VERTICAL_SCALE;
        const viaductY = groundY + 1.2;
        points.push(new THREE.Vector3(posX, viaductY, posZ));

        // Concrete support pier beneath viaduct node (only on open ground)
        const pierHeight = viaductY - groundY + 0.1;
        const pierGeo = new THREE.CylinderGeometry(0.12, 0.15, pierHeight, 8);
        const pierMat = new THREE.MeshStandardMaterial({
          color: '#334155',
          roughness: 0.8,
          metalness: 0.1,
        });
        const pierMesh = new THREE.Mesh(pierGeo, pierMat);
        pierMesh.position.set(posX, groundY + pierHeight / 2, posZ);
        pierMesh.castShadow = true;
        metroGroup.add(pierMesh);
      }

      if (points.length >= 2) {
        const curve = new THREE.CatmullRomCurve3(points);
        const tubeGeo = new THREE.TubeGeometry(curve, 64, 0.20, 8, false);
        const tubeMat = new THREE.MeshStandardMaterial({
          color: line.isOperational ? '#a855f7' : '#ef4444',
          emissive: line.isOperational ? '#6b21a8' : '#991b1b',
          emissiveIntensity: 0.9,
          roughness: 0.3,
          metalness: 0.8,
        });
        const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
        tubeMesh.castShadow = true;
        metroGroup.add(tubeMesh);
        metroTubeMeshRef.current = tubeMesh;
      }
    }

    // 9. 2D FLAT RIBBON ROAD NETWORK (Strictly Bounded & Draped onto Terrain Heightmap)
    const roadInfraGroup = new THREE.Group();
    scene.add(roadInfraGroup);
    roadInfraGroupRef.current = roadInfraGroup;

    if (gridState.roads && gridState.roads.length > 0) {
      const roadVertices: number[] = [];
      const spanMetersX = 1200.0;
      const spanMetersZ = 1200.0;

      // Coordinate converter: meters [-600, 600] -> Three.js world units [-HALF_W, HALF_W]
      const toWorldX = (xm: number) => {
        const norm = (xm + spanMetersX / 2) / spanMetersX;
        const clampedNorm = Math.max(0.001, Math.min(0.999, norm));
        return (clampedNorm - 0.5) * (width * SPACING);
      };
      const toWorldZ = (zm: number) => {
        const norm = (zm + spanMetersZ / 2) / spanMetersZ;
        const clampedNorm = Math.max(0.001, Math.min(0.999, norm));
        return (clampedNorm - 0.5) * (height * SPACING);
      };

      for (const road of gridState.roads) {
        if (road.points.length < 2) continue;

        const isMajor = /primary|secondary|trunk|motorway/.test(road.type);
        const halfWidthUnits = isMajor ? 0.35 : 0.22; // ~9.3m major, ~5.8m minor

        // Collect densely sampled 3D centerline points draped onto terrain
        const centerline: Array<[number, number, number]> = [];

        for (let i = 0; i < road.points.length - 1; i++) {
          const p1 = road.points[i];
          const p2 = road.points[i + 1];

          const x1 = toWorldX(p1[0]);
          const z1 = toWorldZ(p1[1]);
          const x2 = toWorldX(p2[0]);
          const z2 = toWorldZ(p2[1]);

          const segLen = Math.hypot(x2 - x1, z2 - z1);
          if (segLen < 0.001) continue;

          // Subdivide every ~0.5 units (~6.6 meters)
          const steps = Math.max(1, Math.ceil(segLen / 0.5));

          const startIdx = i === 0 ? 0 : 1; // avoid duplicate joining nodes
          for (let s = startIdx; s <= steps; s++) {
            const t = s / steps;
            const cx = x1 + t * (x2 - x1);
            const cz = z1 + t * (z2 - z1);

            // Sample continuous smooth terrain elevation
            const groundY = sampleTerrainElevation(
              cx, cz, grid, width, height, HALF_W, HALF_H, VERTICAL_SCALE
            );
            // +0.15m vertical offset strictly eliminates z-fighting with ground
            const cy = groundY + 0.15;

            centerline.push([cx, cy, cz]);
          }
        }

        if (centerline.length < 2) continue;

        // Generate continuous 2D ribbon strip along the centerline
        const leftPoints: Array<[number, number, number]> = [];
        const rightPoints: Array<[number, number, number]> = [];

        for (let j = 0; j < centerline.length; j++) {
          const curr = centerline[j];
          let dx = 0, dz = 0;

          if (j === 0) {
            dx = centerline[1][0] - curr[0];
            dz = centerline[1][2] - curr[2];
          } else if (j === centerline.length - 1) {
            dx = curr[0] - centerline[j - 1][0];
            dz = curr[2] - centerline[j - 1][2];
          } else {
            dx = centerline[j + 1][0] - centerline[j - 1][0];
            dz = centerline[j + 1][2] - centerline[j - 1][2];
          }

          const len = Math.hypot(dx, dz) || 1.0;
          const ndx = dx / len;
          const ndz = dz / len;

          // Perpendicular normal in XZ plane
          const perpX = -ndz;
          const perpZ = ndx;

          // Clamp left and right vertices strictly to pedestal bounds
          const lx = Math.max(-HALF_W + 0.02, Math.min(HALF_W - 0.02, curr[0] + perpX * halfWidthUnits));
          const lz = Math.max(-HALF_H + 0.02, Math.min(HALF_H - 0.02, curr[2] + perpZ * halfWidthUnits));

          const rx = Math.max(-HALF_W + 0.02, Math.min(HALF_W - 0.02, curr[0] - perpX * halfWidthUnits));
          const rz = Math.max(-HALF_H + 0.02, Math.min(HALF_H - 0.02, curr[2] - perpZ * halfWidthUnits));

          leftPoints.push([lx, curr[1], lz]);
          rightPoints.push([rx, curr[1], rz]);
        }

        // Emit quad triangles along consecutive slices
        for (let j = 0; j < centerline.length - 1; j++) {
          const l0 = leftPoints[j];
          const r0 = rightPoints[j];
          const l1 = leftPoints[j + 1];
          const r1 = rightPoints[j + 1];

          // Triangle 1: l0 -> r0 -> l1
          roadVertices.push(l0[0], l0[1], l0[2]);
          roadVertices.push(r0[0], r0[1], r0[2]);
          roadVertices.push(l1[0], l1[1], l1[2]);

          // Triangle 2: r0 -> r1 -> l1
          roadVertices.push(r0[0], r0[1], r0[2]);
          roadVertices.push(r1[0], r1[1], r1[2]);
          roadVertices.push(l1[0], l1[1], l1[2]);
        }
      }

      if (roadVertices.length > 0) {
        const roadGeo = new THREE.BufferGeometry();
        roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVertices, 3));
        roadGeo.computeVertexNormals();

        const roadMat = new THREE.MeshStandardMaterial({
          color: '#2A2E39', // Dark asphalt
          roughness: 0.85,
          metalness: 0.1,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1.0,
          polygonOffsetUnits: -1.0,
        });

        const roadMesh = new THREE.Mesh(roadGeo, roadMat);
        roadMesh.receiveShadow = true;
        roadInfraGroup.add(roadMesh);
      }
    }

    // B. Streetlights along authentic road network curbs
    const poleGeo = new THREE.CylinderGeometry(0.035, 0.05, 1.4, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.5, metalness: 0.5 });
    const lampHeadGeo = new THREE.BoxGeometry(0.16, 0.08, 0.10);
    const lampHeadMat = new THREE.MeshStandardMaterial({
      color: '#fef08a',
      emissive: '#fef08a',
      emissiveIntensity: 1.2,
    });

    let lampCount = 0;
    for (let y = 4; y < height - 4; y += 5) {
      for (let x = 4; x < width - 4; x += 5) {
        const cell = grid[y][x];
        if (cell.isRoad && !cell.isRiver && cell.buildingZ === 0 && lampCount < 70) {
          lampCount++;
          const posX = (x * SPACING) - HALF_W + SPACING / 2;
          const posZ = (y * SPACING) - HALF_H + SPACING / 2 + 0.35;
          const posY = cell.terrainZ * VERTICAL_SCALE;

          const pole = new THREE.Mesh(poleGeo, poleMat);
          pole.position.set(posX, posY + 0.7, posZ);
          roadInfraGroup.add(pole);

          const lamp = new THREE.Mesh(lampHeadGeo, lampHeadMat);
          lamp.position.set(posX, posY + 1.4, posZ - 0.08);
          roadInfraGroup.add(lamp);
        }
      }
    }

    // 9. CRITICAL INFRASTRUCTURE FLOATING 3D BEACONS
    const beaconsGroup = new THREE.Group();
    scene.add(beaconsGroup);
    beaconsGroupRef.current = beaconsGroup;

    // 10. SELECTION HIGHLIGHT BOX
    const highlightGeo = new THREE.BoxGeometry(1.04, 1.0, 1.04);
    highlightGeo.translate(0, 0.5, 0);
    const highlightMat = new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true });
    const highlightMesh = new THREE.Mesh(highlightGeo, highlightMat);
    highlightMesh.visible = false;
    scene.add(highlightMesh);
    selectedHighlightRef.current = highlightMesh;

    // Resize Observer (Handles Streamlit hidden tabs becoming visible)
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return; // ignore when hidden
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Animation Loop
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      // Gentle floating bob & rotation for beacons
      beaconMeshesRef.current.forEach(({ mesh, asset }) => {
        mesh.rotation.y = elapsedTime * 1.5;
        const cell = grid[asset.y][asset.x];
        const baseGroundY = (cell.terrainZ + (cell.h > 0 ? cell.h * 1.5 : 0)) * VERTICAL_SCALE;
        mesh.position.y = baseGroundY + 2.4 + Math.sin(elapsedTime * 3.0) * 0.3;
      });

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      renderer.dispose();
      terrainGeo.dispose();
      terrainMat.dispose();
      terrainTexture.dispose();
      skirtGeo.dispose();
      skirtMat.dispose();
      bldgBoxGeo.dispose();
      bldgMat.dispose();
      waterGeo.dispose();
      waterMat.dispose();
      pedestalGeo.dispose();
      pedestalMat.dispose();
    };
  }, []);

  // 2. DYNAMIC UPDATES: BUILDINGS, WATER, BARRIERS, METRO & BEACONS ON SIMULATION TICK
  useEffect(() => {
    // A. Update 3D Building Blocks
    const bldgMesh = buildingsMeshRef.current;
    if (bldgMesh && buildingCells.length > 0) {
      for (let i = 0; i < buildingCells.length; i++) {
        const cell = buildingCells[i];
        const posX = (cell.x * SPACING) - HALF_W + SPACING / 2;
        const posZ = (cell.y * SPACING) - HALF_H + SPACING / 2;
        const baseY = cell.terrainZ * VERTICAL_SCALE;
        const bldgHeight = Math.max(0.4, cell.buildingZ * VERTICAL_SCALE);

        dummyPosition.current.set(posX, baseY, posZ);
        dummyScale.current.set(1, bldgHeight, 1);
        dummyMatrix.current.compose(dummyPosition.current, dummyQuaternion.current, dummyScale.current);
        bldgMesh.setMatrixAt(i, dummyMatrix.current);

        // Building color:
        // Alert Red for critical flood (H >= 0.40m)
        // Electric Amber for warning flood (H >= 0.15m)
        // Architectural off-white / light slate for dry
        if (cell.h >= 0.40) {
          tempColor.current.copy(COLOR_RED.current);
        } else if (cell.h >= 0.15) {
          tempColor.current.copy(COLOR_AMBER.current);
        } else if (cell.criticalAsset) {
          if (cell.criticalAsset.type === 'hospital') tempColor.current.copy(COLOR_HOSPITAL.current);
          else if (cell.criticalAsset.type === 'power_station') tempColor.current.copy(COLOR_POWER.current);
          else tempColor.current.copy(COLOR_METRO.current);
        } else if (cell.landType === 'urban_high') {
          tempColor.current.copy(COLOR_BLDG_HIGH.current);
        } else {
          tempColor.current.copy(COLOR_BLDG_MID.current);
        }

        bldgMesh.setColorAt(i, tempColor.current);
      }

      bldgMesh.instanceMatrix.needsUpdate = true;
      if (bldgMesh.instanceColor) bldgMesh.instanceColor.needsUpdate = true;
    }

    // B. Update Volumetric 3D Water Mesh (Continuous Smooth Fluid Surface, Zero Sawtooth Artifacts)
    const waterMesh = waterMeshRef.current;
    if (waterMesh) {
      const posArr = waterPositions.current;
      let vertPtr = 0;

      // Helper to push vertex
      const pushV = (px: number, py: number, pz: number) => {
        if (vertPtr + 3 > MAX_WATER_VERTS * 3) return;
        posArr[vertPtr++] = px;
        posArr[vertPtr++] = py;
        posArr[vertPtr++] = pz;
      };

      // Helper to push triangle
      const pushTri = (
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        cx: number, cy: number, cz: number
      ) => {
        pushV(ax, ay, az);
        pushV(bx, by, bz);
        pushV(cx, cy, cz);
      };

      // Helper to push quad (2 triangles)
      const pushQuad = (
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        cx: number, cy: number, cz: number,
        dx: number, dy: number, dz: number
      ) => {
        pushTri(ax, ay, az, bx, by, bz, cx, cy, cz);
        pushTri(ax, ay, az, cx, cy, cz, dx, dy, dz);
      };

      // Pre-pass: Compute smooth corner elevations for continuous water body
      const numCornerX = width + 1;
      const numCornerY = height + 1;
      const cornerWaterY = new Float32Array(numCornerX * numCornerY);
      const cornerGroundY = new Float32Array(numCornerX * numCornerY);
      const cornerWaterCount = new Uint8Array(numCornerX * numCornerY);
      const cornerGroundCount = new Uint8Array(numCornerX * numCornerY);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const cell = grid[y][x];
          const groundElevation = cell.terrainZ * VERTICAL_SCALE;

          const idx00 = y * numCornerX + x;
          const idx10 = y * numCornerX + (x + 1);
          const idx01 = (y + 1) * numCornerX + x;
          const idx11 = (y + 1) * numCornerX + (x + 1);

          cornerGroundY[idx00] += groundElevation; cornerGroundCount[idx00]++;
          cornerGroundY[idx10] += groundElevation; cornerGroundCount[idx10]++;
          cornerGroundY[idx01] += groundElevation; cornerGroundCount[idx01]++;
          cornerGroundY[idx11] += groundElevation; cornerGroundCount[idx11]++;

          if (cell.h > 0.02) {
            const surfaceElev = (cell.terrainZ + cell.h) * VERTICAL_SCALE + 0.02;
            cornerWaterY[idx00] += surfaceElev; cornerWaterCount[idx00]++;
            cornerWaterY[idx10] += surfaceElev; cornerWaterCount[idx10]++;
            cornerWaterY[idx01] += surfaceElev; cornerWaterCount[idx01]++;
            cornerWaterY[idx11] += surfaceElev; cornerWaterCount[idx11]++;
          }
        }
      }

      for (let i = 0; i < cornerWaterY.length; i++) {
        if (cornerWaterCount[i] > 0) cornerWaterY[i] /= cornerWaterCount[i];
        if (cornerGroundCount[i] > 0) cornerGroundY[i] /= cornerGroundCount[i];
      }

      // Emit smooth water quads & perimeter shoreline skirts
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const cell = grid[y][x];
          if (cell.h <= 0.02) continue;

          const x0 = (x * SPACING) - HALF_W;
          const x1 = x0 + SPACING;
          const z0 = (y * SPACING) - HALF_H;
          const z1 = z0 + SPACING;

          const idx00 = y * numCornerX + x;
          const idx10 = y * numCornerX + (x + 1);
          const idx01 = (y + 1) * numCornerX + x;
          const idx11 = (y + 1) * numCornerX + (x + 1);

          const wy00 = Math.max(cornerGroundY[idx00] + 0.015, cornerWaterY[idx00]);
          const wy10 = Math.max(cornerGroundY[idx10] + 0.015, cornerWaterY[idx10]);
          const wy11 = Math.max(cornerGroundY[idx11] + 0.015, cornerWaterY[idx11]);
          const wy01 = Math.max(cornerGroundY[idx01] + 0.015, cornerWaterY[idx01]);

          // 1. Top Smooth Fluid Surface Quad
          pushQuad(
            x0, wy00, z0,
            x1, wy10, z0,
            x1, wy11, z1,
            x0, wy01, z1
          );

          // 2. Volumetric Shoreline Skirts (Vertical side walls where water meets dry ground)
          // North edge
          if (y === 0 || grid[y - 1][x].h <= 0.02) {
            pushQuad(x0, wy00, z0, x1, wy10, z0, x1, cornerGroundY[idx10], z0, x0, cornerGroundY[idx00], z0);
          }
          // South edge
          if (y === height - 1 || grid[y + 1][x].h <= 0.02) {
            pushQuad(x1, wy11, z1, x0, wy01, z1, x0, cornerGroundY[idx01], z1, x1, cornerGroundY[idx11], z1);
          }
          // West edge
          if (x === 0 || grid[y][x - 1].h <= 0.02) {
            pushQuad(x0, wy01, z1, x0, wy00, z0, x0, cornerGroundY[idx00], z0, x0, cornerGroundY[idx01], z1);
          }
          // East edge
          if (x === width - 1 || grid[y][x + 1].h <= 0.02) {
            pushQuad(x1, wy10, z0, x1, wy11, z1, x1, cornerGroundY[idx11], z1, x1, cornerGroundY[idx10], z0);
          }
        }
      }

      const totalVerts = vertPtr / 3;
      const waterGeo = waterMesh.geometry as THREE.BufferGeometry;
      waterGeo.setDrawRange(0, totalVerts);
      waterGeo.attributes.position.needsUpdate = true;
      if (totalVerts > 0) {
        waterGeo.computeVertexNormals();
      }
    }

    // C. Update Sandbag Barriers Mesh
    const barriersMesh = barriersMeshRef.current;
    if (barriersMesh) {
      const barrierCells = cells.filter(c => c.hasBarrier);
      barriersMesh.count = barrierCells.length;
      for (let i = 0; i < barrierCells.length; i++) {
        const cell = barrierCells[i];
        const posX = (cell.x * SPACING) - HALF_W + SPACING / 2;
        const posZ = (cell.y * SPACING) - HALF_H + SPACING / 2;
        const posY = cell.terrainZ * VERTICAL_SCALE;

        dummyPosition.current.set(posX, posY, posZ);
        dummyScale.current.set(1, 1, 1);
        dummyMatrix.current.compose(dummyPosition.current, dummyQuaternion.current, dummyScale.current);
        barriersMesh.setMatrixAt(i, dummyMatrix.current);
      }
      barriersMesh.instanceMatrix.needsUpdate = true;
    }

    // D. Update Metro Line Status (Rigid Viaduct - Zero Shifting)
    if (metroTubeMeshRef.current && metroLines.length > 0) {
      const isOp = metroLines[0].isOperational;
      const mat = metroTubeMeshRef.current.material as THREE.MeshStandardMaterial;
      mat.color.set(isOp ? '#a855f7' : '#ef4444');
      mat.emissive.set(isOp ? '#6b21a8' : '#991b1b');
      mat.emissiveIntensity = isOp ? 0.9 : 1.25;
    }

    // E. Update Floating Infrastructure 3D Beacons
    const beaconsGroup = beaconsGroupRef.current;
    if (beaconsGroup) {
      beaconsGroup.clear();
      beaconMeshesRef.current.clear();

      for (const asset of assets) {
        const posX = (asset.x * SPACING) - HALF_W + SPACING / 2;
        const posZ = (asset.y * SPACING) - HALF_H + SPACING / 2;
        const cell = grid[asset.y][asset.x];
        const posY = (cell.terrainZ + (cell.h > 0 ? cell.h * 1.5 : 0)) * VERTICAL_SCALE + 2.4;

        const beaconGeo = new THREE.OctahedronGeometry(0.85, 0);
        let beaconColor = '#10b981'; // Emerald for hospital
        if (asset.type === 'power_station') beaconColor = '#f59e0b';
        if (asset.type === 'metro_station') beaconColor = '#a855f7';

        if (asset.status === 'flooded' || asset.status === 'isolated') {
          beaconColor = '#ef4444'; // Red for compromised
        }

        const beaconMat = new THREE.MeshStandardMaterial({
          color: beaconColor,
          emissive: beaconColor,
          emissiveIntensity: asset.status === 'flooded' ? 1.1 : 0.65,
          roughness: 0.2,
          metalness: 0.7,
        });

        const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
        beaconMesh.position.set(posX, posY, posZ);
        beaconMesh.castShadow = true;
        beaconsGroup.add(beaconMesh);

        beaconMeshesRef.current.set(asset.id, { mesh: beaconMesh, asset });
      }
    }

    // F. Update Selection Highlight Box
    if (selectedCell && selectedHighlightRef.current) {
      const posX = (selectedCell.x * SPACING) - HALF_W + SPACING / 2;
      const posZ = (selectedCell.y * SPACING) - HALF_H + SPACING / 2;
      const baseY = selectedCell.terrainZ * VERTICAL_SCALE;
      const totalH = Math.max(0.6, (selectedCell.buildingZ + selectedCell.h) * VERTICAL_SCALE + 0.1);

      selectedHighlightRef.current.position.set(posX, baseY, posZ);
      selectedHighlightRef.current.scale.set(1, totalH, 1);
      selectedHighlightRef.current.visible = true;
    } else if (selectedHighlightRef.current) {
      selectedHighlightRef.current.visible = false;
    }
  }, [gridState, selectedCell, HALF_W, HALF_H, buildingCells, cells, grid, assets, metroLines]);

  // 3. POINTER RAYCASTING FOR INSPECTION & TOOL APPLICATION
  const pointerStartPos = useRef({ x: 0, y: 0 });

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerStartPos.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const dist = Math.hypot(event.clientX - pointerStartPos.current.x, event.clientY - pointerStartPos.current.y);
    if (dist > 6) return; // Ignore orbit drags

    if (!containerRef.current || !cameraRef.current || !terrainMeshRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    mouseRef.current.set(x, y);
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

    // Raycast against terrain mesh or building instances
    const targets: THREE.Object3D[] = [terrainMeshRef.current];
    if (buildingsMeshRef.current) targets.push(buildingsMeshRef.current);

    const intersects = raycasterRef.current.intersectObjects(targets, false);
    if (intersects.length > 0) {
      const pt = intersects[0].point;
      const gridX = Math.floor((pt.x + HALF_W) / SPACING);
      const gridY = Math.floor((pt.z + HALF_H) / SPACING);

      if (gridX >= 0 && gridX < width && gridY >= 0 && gridY < height) {
        const cell = grid[gridY][gridX];

        if (activeTool === 'inspect') {
          onSelectCell(cell);
        } else if (activeTool === 'sandbag') {
          onCellAction(cell.x, cell.y, 'sandbag');
        } else if (activeTool === 'obstruct') {
          onCellAction(cell.x, cell.y, 'obstruct');
        }
      }
    } else if (activeTool === 'inspect') {
      onSelectCell(null);
    }
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing overflow-hidden"
      style={{ minHeight: '100vh' }}
    />
  );
};
