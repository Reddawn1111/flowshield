import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Cell, CriticalAsset, GridState, MetroLine } from '../types/simulation';
import { createTerrainTexture } from '../engine/terrainTexture';
import hospitalIconUrl from '../../Icons/Hospital.png';
import powerIconUrl from '../../Icons/Powertation.png';
import railwayIconUrl from '../../Icons/Railway.png';


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

  // If over a river, canal, or bay, bridge smoothly over water (sea level is 0.0m)
  const isWater = grid[y0][x0].isRiver || grid[y0][x1].isRiver || grid[y1][x0].isRiver || grid[y1][x1].isRiver;
  if (isWater) {
    const bankZ = Math.max(0.0,
      !grid[y0][x0].isRiver ? z00 : 0.0,
      !grid[y0][x1].isRiver ? z10 : 0.0,
      !grid[y1][x0].isRiver ? z01 : 0.0,
      !grid[y1][x1].isRiver ? z11 : 0.0
    );
    elev = Math.max(elev, bankZ + 0.60, 0.80);
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
  const waterDepthDataRef = useRef<Uint8Array | null>(null);
  const waterDepthTextureRef = useRef<THREE.DataTexture | null>(null);

  // Lifeline groups
  const metroLineGroupRef = useRef<THREE.Group | null>(null);
  const metroTubeMeshRef = useRef<THREE.Mesh | null>(null);
  const roadInfraGroupRef = useRef<THREE.Group | null>(null);
  const beaconsGroupRef = useRef<THREE.Group | null>(null);
  const beaconMeshesRef = useRef<Map<string, { mesh: THREE.Sprite; asset: CriticalAsset }>>(new Map());

  // Textures for Critical Infrastructure Icons (from Icons folder)
  const textureLoader = useMemo(() => new THREE.TextureLoader(), []);
  const iconTextures = useMemo(() => {
    const hospitalTex = textureLoader.load(hospitalIconUrl);
    hospitalTex.colorSpace = THREE.SRGBColorSpace;
    const powerTex = textureLoader.load(powerIconUrl);
    powerTex.colorSpace = THREE.SRGBColorSpace;
    const metroTex = textureLoader.load(railwayIconUrl);
    metroTex.colorSpace = THREE.SRGBColorSpace;

    return {
      hospital: hospitalTex,
      power: powerTex,
      metro: metroTex,
    };
  }, [textureLoader]);


  // Interaction
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  // Dimension & scale constants
  const SPACING = 1.0;
  const VERTICAL_SCALE = 0.15;
  const FLOOD_SURFACE_THRESHOLD = 0.08; // 80mm threshold for overland flood visualization

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
    const aspect = container.clientWidth / container.clientHeight;
    const camera = new THREE.PerspectiveCamera(36, aspect, 1, 1000);
    camera.position.set(HALF_W * 1.5, Math.max(HALF_W, HALF_H) * 1.55, HALF_H * 1.75);
    cameraRef.current = camera;

    // RENDERER
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(container.clientWidth, container.clientHeight);
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
    controls.target.set(0, 1.5, 0);
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

    // Dynamic 2D water depth texture for continuous surface shading
    const waterData = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = grid[y][x];
        const bufferY = height - 1 - y;
        const idx = (bufferY * width + x) * 4;
        const isOverlandWater = !cell.isRiver && cell.buildingZ === 0;
        const depthVal = isOverlandWater ? Math.min(255, Math.floor(cell.h * 25.5)) : 0;
        waterData[idx] = depthVal;
        waterData[idx + 1] = cell.isRiver ? 255 : 0;
        waterData[idx + 2] = cell.hasBarrier ? 255 : 0;
        waterData[idx + 3] = 255;
      }
    }
    const waterTexture = new THREE.DataTexture(
      waterData,
      width,
      height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    waterTexture.minFilter = THREE.LinearFilter;
    waterTexture.magFilter = THREE.LinearFilter;
    waterTexture.needsUpdate = true;
    waterDepthDataRef.current = waterData;
    waterDepthTextureRef.current = waterTexture;

    const terrainTexture = createTerrainTexture(gridState);
    const terrainMat = new THREE.MeshStandardMaterial({
      map: terrainTexture,
      roughness: 0.75,
      metalness: 0.15,
      flatShading: false,
    });

    terrainMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWaterDepthMap = { value: waterTexture };
      shader.uniforms.uWaterColor = { value: new THREE.Color('#00E5FF') }; // Vibrant Cyan
      shader.uniforms.uMinDepth = { value: 0.05 };  // 0.05m threshold

      shader.fragmentShader = `
        uniform sampler2D uWaterDepthMap;
        uniform vec3 uWaterColor;
        uniform float uMinDepth;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        #include <map_fragment>
        
        #if defined( USE_UV ) || defined( USE_MAP )
        vec2 sampleUv = vMapUv;
        vec4 waterSample = texture2D( uWaterDepthMap, sampleUv );
        float waterDepth = waterSample.r * 10.0;
        float isPermanentWater = waterSample.g;
        
        if (waterDepth >= uMinDepth && isPermanentWater < 0.5) {
          float t = smoothstep(uMinDepth, uMinDepth + 0.08, waterDepth);
          diffuseColor.rgb = mix(diffuseColor.rgb, uWaterColor, t * 0.92);
        }
        #endif
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `
        #include <roughnessmap_fragment>
        #if defined( USE_UV ) || defined( USE_MAP )
        vec4 waterGlossSample = texture2D( uWaterDepthMap, vMapUv );
        float glossDepth = waterGlossSample.r * 10.0;
        if (glossDepth >= uMinDepth && waterGlossSample.g < 0.5) {
          float glossT = smoothstep(uMinDepth, uMinDepth + 0.10, glossDepth);
          roughnessFactor = mix(roughnessFactor, 0.08, glossT);
        }
        #endif
        `
      );
    };

    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = true;
    scene.add(terrainMesh);
    terrainMeshRef.current = terrainMesh;

    // 4. SOLID PERIMETER SKIRT WALLS (Connects 4 borders down to y = -2.0, cleanly enclosing bathymetry)
    const skirtGeo = new THREE.BufferGeometry();
    const skirtVerts: number[] = [];
    const skirtBottomY = -2.0;

    // Helper to add a vertical wall quad
    const addSkirtQuad = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
      // Triangle 1: (x1, y1, z1) -> (x2, y2, z2) -> (x2, skirtBottomY, z2)
      skirtVerts.push(x1, y1, z1, x2, y2, z2, x2, skirtBottomY, z2);
      // Triangle 2: (x1, y1, z1) -> (x2, skirtBottomY, z2) -> (x1, skirtBottomY, z1)
      skirtVerts.push(x1, y1, z1, x2, skirtBottomY, z2, x1, skirtBottomY, z1);
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
      const isUnderground = Boolean(line.isUnderground || line.type === 'subway');
      const points: THREE.Vector3[] = [];

      for (let i = 0; i < line.path.length; i++) {
        const pt = line.path[i];
        if (pt.x < 0 || pt.x >= width || pt.y < 0 || pt.y >= height) continue;
        const gx = Math.min(width - 1, Math.max(0, Math.floor(pt.x)));
        const gy = Math.min(height - 1, Math.max(0, Math.floor(pt.y)));
        const cell = grid[gy][gx];

        const posX = (pt.x * SPACING) - HALF_W + SPACING / 2;
        const posZ = (pt.y * SPACING) - HALF_H + SPACING / 2;
        const groundY = cell.terrainZ * VERTICAL_SCALE;

        if (isUnderground) {
          // Subterranean tube beneath terrain surface
          const undergroundY = groundY - 1.2;
          points.push(new THREE.Vector3(posX, undergroundY, posZ));
          // NO surface piers for underground lines!
        } else {
          // FAIL-SAFE: Never draw an elevated viaduct through a building!
          if (cell.buildingZ > 0) continue;

          const viaductY = groundY + 1.2;
          points.push(new THREE.Vector3(posX, viaductY, posZ));

          // Concrete support pier beneath viaduct node (spaced every 4 nodes)
          if (i % 4 === 0) {
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
        }
      }

      if (points.length >= 2) {
        // Continuous smooth Catmull-Rom spline with curve tension 0.5
        const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
        const tubeSegments = Math.max(96, points.length * 8);
        const tubeGeo = new THREE.TubeGeometry(curve, tubeSegments, isUnderground ? 0.22 : 0.20, 12, false);
        const tubeMat = isUnderground
          ? new THREE.MeshStandardMaterial({
              color: line.isOperational ? '#00e5ff' : '#ef4444',
              emissive: line.isOperational ? '#0284c7' : '#991b1b',
              emissiveIntensity: 1.3,
              roughness: 0.2,
              metalness: 0.8,
              transparent: true,
              opacity: 0.75,
              depthWrite: false,
            })
          : new THREE.MeshStandardMaterial({
              color: line.isOperational ? '#a855f7' : '#ef4444',
              emissive: line.isOperational ? '#6b21a8' : '#991b1b',
              emissiveIntensity: 0.9,
              roughness: 0.3,
              metalness: 0.8,
            });
        const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
        if (!isUnderground) tubeMesh.castShadow = true;
        metroGroup.add(tubeMesh);
        metroTubeMeshRef.current = tubeMesh;
      }
    }

    // 8B. RAILWAY INFRASTRUCTURE (Surface Tracks with Ballast & Twin Rails, and Underground Tunnels)
    const railGroup = new THREE.Group();
    scene.add(railGroup);

    if (gridState.railways && gridState.railways.length > 0) {
      const spanMetersX = gridState.spanMetersX || (width * 8.88);
      const spanMetersZ = gridState.spanMetersZ || (height * 8.88);

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

      const railVertices: number[] = [];
      const trackbedVertices: number[] = [];

      for (const rway of gridState.railways) {
        if (rway.points.length < 2) continue;

        if (rway.isUnderground) {
          // Render underground railway as subterranean conduit
          const undergroundPts: THREE.Vector3[] = [];
          for (const pt of rway.points) {
            const wx = toWorldX(pt[0]);
            const wz = toWorldZ(pt[1]);
            const gx = Math.min(width - 1, Math.max(0, Math.floor((wx + HALF_W) / SPACING)));
            const gz = Math.min(height - 1, Math.max(0, Math.floor((wz + HALF_H) / SPACING)));
            const gy = (grid[gz][gx].terrainZ * VERTICAL_SCALE) - 1.4;
            undergroundPts.push(new THREE.Vector3(wx, gy, wz));
          }
          if (undergroundPts.length >= 2) {
            const curve = new THREE.CatmullRomCurve3(undergroundPts, false, 'catmullrom', 0.5);
            const tubeGeo = new THREE.TubeGeometry(curve, Math.max(32, undergroundPts.length * 4), 0.18, 8, false);
            const tubeMat = new THREE.MeshStandardMaterial({
              color: '#06b6d4',
              emissive: '#0891b2',
              emissiveIntensity: 1.1,
              transparent: true,
              opacity: 0.65,
              depthWrite: false,
            });
            const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
            railGroup.add(tubeMesh);
          }
        } else {
          // Surface Railway: Dark ballast bed ribbon + Dual steel rails
          const trackbedHalfW = 0.28; // ~3.7m ballast width
          const railOffset = 0.12;    // ~1.6m gauge

          const centerline: Array<[number, number, number]> = [];
          for (let i = 0; i < rway.points.length - 1; i++) {
            const p1 = rway.points[i];
            const p2 = rway.points[i + 1];
            const x1 = toWorldX(p1[0]);
            const z1 = toWorldZ(p1[1]);
            const x2 = toWorldX(p2[0]);
            const z2 = toWorldZ(p2[1]);
            const segLen = Math.hypot(x2 - x1, z2 - z1);
            if (segLen < 0.001) continue;
            const steps = Math.max(1, Math.ceil(segLen / 0.5));
            const startIdx = i === 0 ? 0 : 1;
            for (let s = startIdx; s <= steps; s++) {
              const t = s / steps;
              const cx = x1 + t * (x2 - x1);
              const cz = z1 + t * (z2 - z1);
              const gx = Math.min(width - 1, Math.max(0, Math.floor((cx + HALF_W) / SPACING)));
              const gz = Math.min(height - 1, Math.max(0, Math.floor((cz + HALF_H) / SPACING)));
              const cy = (grid[gz][gx].terrainZ * VERTICAL_SCALE) + 0.06;
              centerline.push([cx, cy, cz]);
            }
          }

          if (centerline.length >= 2) {
            for (let i = 0; i < centerline.length - 1; i++) {
              const [ax, ay, az] = centerline[i];
              const [bx, by, bz] = centerline[i + 1];
              const dx = bx - ax;
              const dz = bz - az;
              const len = Math.hypot(dx, dz);
              if (len < 0.0001) continue;
              const nx = -dz / len;
              const nz = dx / len;

              // Trackbed Quad (dark ballast)
              trackbedVertices.push(
                ax - nx * trackbedHalfW, ay, az - nz * trackbedHalfW,
                ax + nx * trackbedHalfW, ay, az + nz * trackbedHalfW,
                bx + nx * trackbedHalfW, by, bz + nz * trackbedHalfW,
                ax - nx * trackbedHalfW, ay, az - nz * trackbedHalfW,
                bx + nx * trackbedHalfW, by, bz + nz * trackbedHalfW,
                bx - nx * trackbedHalfW, by, bz - nz * trackbedHalfW,
              );

              // Left & Right Steel Rails
              const r1x = ax - nx * railOffset, r1z = az - nz * railOffset;
              const r2x = bx - nx * railOffset, r2z = bz - nz * railOffset;
              const r3x = ax + nx * railOffset, r3z = az + nz * railOffset;
              const r4x = bx + nx * railOffset, r4z = bz + nz * railOffset;
              const railW = 0.035;

              railVertices.push(
                r1x - nx * railW, ay + 0.03, r1z - nz * railW,
                r1x + nx * railW, ay + 0.03, r1z + nz * railW,
                r2x + nx * railW, by + 0.03, r2z + nz * railW,
                r1x - nx * railW, ay + 0.03, r1z - nz * railW,
                r2x + nx * railW, by + 0.03, r2z + nz * railW,
                r2x - nx * railW, by + 0.03, r2z - nz * railW,

                r3x - nx * railW, ay + 0.03, r3z - nz * railW,
                r3x + nx * railW, ay + 0.03, r3z + nz * railW,
                r4x + nx * railW, by + 0.03, r4z + nz * railW,
                r3x - nx * railW, ay + 0.03, r3z - nz * railW,
                r4x + nx * railW, by + 0.03, r4z + nz * railW,
                r4x - nx * railW, by + 0.03, r4z - nz * railW,
              );
            }
          }
        }
      }

      if (trackbedVertices.length > 0) {
        const tbGeo = new THREE.BufferGeometry();
        tbGeo.setAttribute('position', new THREE.Float32BufferAttribute(trackbedVertices, 3));
        tbGeo.computeVertexNormals();
        const tbMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.9, metalness: 0.1 });
        const tbMesh = new THREE.Mesh(tbGeo, tbMat);
        railGroup.add(tbMesh);
      }

      if (railVertices.length > 0) {
        const rGeo = new THREE.BufferGeometry();
        rGeo.setAttribute('position', new THREE.Float32BufferAttribute(railVertices, 3));
        rGeo.computeVertexNormals();
        const rMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.3, metalness: 0.8 });
        const rMesh = new THREE.Mesh(rGeo, rMat);
        railGroup.add(rMesh);
      }
    }

    // 9. 2D FLAT RIBBON ROAD NETWORK (Strictly Bounded & Draped onto Terrain Heightmap)
    const roadInfraGroup = new THREE.Group();
    scene.add(roadInfraGroup);
    roadInfraGroupRef.current = roadInfraGroup;

    if (gridState.roads && gridState.roads.length > 0) {
      const roadVertices: number[] = [];
      const spanMetersX = gridState.spanMetersX || (width * 8.88);
      const spanMetersZ = gridState.spanMetersZ || (height * 8.88);

      // Coordinate converter: local meters [-spanX/2, spanX/2] -> Three.js world units [-HALF_W, HALF_W]
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

        const roadUvs: number[] = [];
        for (let j = 0; j < roadVertices.length; j += 3) {
          const vx = roadVertices[j];
          const vz = roadVertices[j + 2];
          const u = (vx + HALF_W) / (width * SPACING);
          const v = 1.0 - (vz + HALF_H) / (height * SPACING);
          roadUvs.push(u, v);
        }
        roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
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

        roadMat.onBeforeCompile = (shader) => {
          shader.uniforms.uWaterDepthMap = { value: waterTexture };
          shader.uniforms.uWaterColor = { value: new THREE.Color('#00E5FF') };
          shader.uniforms.uMinDepth = { value: 0.05 };

          shader.fragmentShader = `
            uniform sampler2D uWaterDepthMap;
            uniform vec3 uWaterColor;
            uniform float uMinDepth;
          ` + shader.fragmentShader;

          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <color_fragment>',
            `
            #include <color_fragment>
            #if defined( USE_UV )
            vec4 roadWaterSample = texture2D( uWaterDepthMap, vUv );
            float roadWaterDepth = roadWaterSample.r * 10.0;
            if (roadWaterDepth >= uMinDepth && roadWaterSample.g < 0.5) {
              float tRoad = smoothstep(uMinDepth, uMinDepth + 0.08, roadWaterDepth);
              diffuseColor.rgb = mix(diffuseColor.rgb, uWaterColor, tRoad * 0.92);
            }
            #endif
            `
          );

          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            `
            #include <roughnessmap_fragment>
            #if defined( USE_UV )
            vec4 roadGlossSample = texture2D( uWaterDepthMap, vUv );
            float roadGlossDepth = roadGlossSample.r * 10.0;
            if (roadGlossDepth >= uMinDepth && roadGlossSample.g < 0.5) {
              float tGloss = smoothstep(uMinDepth, uMinDepth + 0.10, roadGlossDepth);
              roughnessFactor = mix(roughnessFactor, 0.08, tGloss);
            }
            #endif
            `
          );
        };

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

    // Resize
    const handleResize = () => {
      if (!container || !camera || !renderer) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    // Animation Loop
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      // Gentle floating bob for icons above buildings
      beaconMeshesRef.current.forEach(({ mesh, asset }) => {
        const cell = grid[asset.y][asset.x];
        const groundY = cell.terrainZ * VERTICAL_SCALE;
        const bldgH = cell.buildingZ > 0 ? Math.max(0.6, cell.buildingZ * 0.45) : 0;
        const waterH = (cell.h > 0 ? cell.h * 1.5 : 0) * VERTICAL_SCALE;
        const topY = groundY + Math.max(bldgH, waterH);
        mesh.position.y = topY + 1.8 + Math.sin(elapsedTime * 3.0) * 0.25;
      });

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
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
    // 0. Update Dynamic Water Depth Data Texture for Ground & Road Surface Shaders
    const depthData = waterDepthDataRef.current;
    const depthTex = waterDepthTextureRef.current;
    if (depthData && depthTex) {
      for (let y = 0; y < height; y++) {
        const bufferY = height - 1 - y;
        for (let x = 0; x < width; x++) {
          const cell = grid[y][x];
          const idx = (bufferY * width + x) * 4;
          const isOverlandWater = !cell.isRiver && cell.buildingZ === 0;
          const depthVal = isOverlandWater ? Math.min(255, Math.floor(cell.h * 25.5)) : 0;
          depthData[idx] = depthVal;
          depthData[idx + 1] = cell.isRiver ? 255 : 0;
          depthData[idx + 2] = cell.hasBarrier ? 255 : 0;
          depthData[idx + 3] = 255;
        }
      }
      depthTex.needsUpdate = true;
    }

    // A. Update 3D Building Blocks (Dynamic InstancedMesh Re-instantiation & Scaling)
    const validBuildings = buildingCells;
    let bldgMesh = buildingsMeshRef.current;
    const scene = sceneRef.current;

    if (scene) {
      if (!bldgMesh || bldgMesh.count !== validBuildings.length) {
        if (bldgMesh) {
          scene.remove(bldgMesh);
          bldgMesh.geometry.dispose();
        }

        if (validBuildings.length > 0) {
          const baseBoxGeometry = new THREE.BoxGeometry(0.86, 1.0, 0.86);
          baseBoxGeometry.translate(0, 0.5, 0); // Origin at bottom of building
          const buildingMaterial = new THREE.MeshStandardMaterial({
            roughness: 0.85,
            metalness: 0.05,
            flatShading: true,
          });

          bldgMesh = new THREE.InstancedMesh(
            baseBoxGeometry,
            buildingMaterial,
            validBuildings.length
          );
          const bldgColors = new Float32Array(validBuildings.length * 3);
          bldgColors.fill(0.85);
          bldgMesh.instanceColor = new THREE.InstancedBufferAttribute(bldgColors, 3);
          bldgMesh.castShadow = true;
          bldgMesh.receiveShadow = true;
          scene.add(bldgMesh);
          buildingsMeshRef.current = bldgMesh;
        } else {
          buildingsMeshRef.current = null;
        }
      }

      if (bldgMesh && validBuildings.length > 0) {
        for (let i = 0; i < validBuildings.length; i++) {
          const cell = validBuildings[i];
          const posX = (cell.x * SPACING) - HALF_W + SPACING / 2;
          const posZ = (cell.y * SPACING) - HALF_H + SPACING / 2;
          const baseY = cell.terrainZ * VERTICAL_SCALE;
          const bldgHeight = Math.max(0.6, cell.buildingZ * 0.45);

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
    }

    // B. Update Volumetric 3D Water Mesh (Continuous Seamless Fluid Surface, Zero Voxel Steps)
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

      const numCornerX = width + 1;
      const numCornerY = height + 1;
      const totalCorners = numCornerX * numCornerY;

      const cornerWaterY = new Float32Array(totalCorners);
      const cornerBedY = new Float32Array(totalCorners);
      const cornerRiverCount = new Uint8Array(totalCorners);

      // Pass 1: Accumulate elevations at grid corner intersections from all active water cells (both standing water and pluvial flood)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const cell = grid[y][x];
          const isWaterCell = cell.isRiver || cell.h > 0.02;
          if (!isWaterCell) continue;

          // Universal hydrostatic surface elevation across coastal sea, lakes, basins, rivers & pluvial floodwaters
          const surfaceMeters = cell.terrainZ + cell.h;
          // Clean 0.015 offset above ground quad plane completely prevents z-fighting
          const surfaceY = Math.max(0.005, surfaceMeters * VERTICAL_SCALE + 0.015);
          const bedY = cell.terrainZ * VERTICAL_SCALE;

          const idx00 = y * numCornerX + x;
          const idx10 = y * numCornerX + (x + 1);
          const idx01 = (y + 1) * numCornerX + x;
          const idx11 = (y + 1) * numCornerX + (x + 1);

          cornerWaterY[idx00] += surfaceY; cornerBedY[idx00] += bedY; cornerRiverCount[idx00]++;
          cornerWaterY[idx10] += surfaceY; cornerBedY[idx10] += bedY; cornerRiverCount[idx10]++;
          cornerWaterY[idx01] += surfaceY; cornerBedY[idx01] += bedY; cornerRiverCount[idx01]++;
          cornerWaterY[idx11] += surfaceY; cornerBedY[idx11] += bedY; cornerRiverCount[idx11]++;
        }
      }

      // Pass 2: Normalize corner elevations
      for (let i = 0; i < totalCorners; i++) {
        if (cornerRiverCount[i] > 0) {
          cornerWaterY[i] /= cornerRiverCount[i];
          cornerBedY[i] /= cornerRiverCount[i];
        }
      }

      // Pass 3: Emit continuous shared-corner water surface quads and shoreline skirts
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const cell = grid[y][x];
          const isWaterCell = cell.isRiver || cell.h > 0.02;
          if (!isWaterCell) continue;

          const x0 = (x * SPACING) - HALF_W;
          const x1 = x0 + SPACING;
          const z0 = (y * SPACING) - HALF_H;
          const z1 = z0 + SPACING;

          const idx00 = y * numCornerX + x;
          const idx10 = y * numCornerX + (x + 1);
          const idx01 = (y + 1) * numCornerX + x;
          const idx11 = (y + 1) * numCornerX + (x + 1);

          // Guarantee water quad corners stay slightly above adjacent ground corners
          const wy00 = Math.max(cornerBedY[idx00] + 0.012, cornerWaterY[idx00]);
          const wy10 = Math.max(cornerBedY[idx10] + 0.012, cornerWaterY[idx10]);
          const wy11 = Math.max(cornerBedY[idx11] + 0.012, cornerWaterY[idx11]);
          const wy01 = Math.max(cornerBedY[idx01] + 0.012, cornerWaterY[idx01]);

          const by00 = cornerBedY[idx00];
          const by10 = cornerBedY[idx10];
          const by11 = cornerBedY[idx11];
          const by01 = cornerBedY[idx01];

          // Top continuous fluid surface (seamlessly shared corners between neighboring cells)
          pushQuad(
            x0, wy00, z0,
            x1, wy10, z0,
            x1, wy11, z1,
            x0, wy01, z1
          );

          // Shoreline & Perimeter Skirts (Vertical walls going DOWN from surface to bed where water meets dry ground)
          // North edge
          const isNorthDry = y === 0 || !(grid[y - 1][x].isRiver || grid[y - 1][x].h > 0.02);
          if (isNorthDry) {
            pushQuad(x0, wy00, z0, x1, wy10, z0, x1, by10, z0, x0, by00, z0);
          }

          // South edge
          const isSouthDry = y === height - 1 || !(grid[y + 1][x].isRiver || grid[y + 1][x].h > 0.02);
          if (isSouthDry) {
            pushQuad(x1, wy11, z1, x0, wy01, z1, x0, by01, z1, x1, by11, z1);
          }

          // West edge
          const isWestDry = x === 0 || !(grid[y][x - 1].isRiver || grid[y][x - 1].h > 0.02);
          if (isWestDry) {
            pushQuad(x0, wy01, z1, x0, wy00, z0, x0, by00, z0, x0, by01, z1);
          }

          // East edge
          const isEastDry = x === width - 1 || !(grid[y][x + 1].isRiver || grid[y][x + 1].h > 0.02);
          if (isEastDry) {
            pushQuad(x1, wy10, z0, x1, wy11, z1, x1, by11, z1, x1, by10, z0);
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

    // E. Update Floating Infrastructure 3D Icons
    const beaconsGroup = beaconsGroupRef.current;
    if (beaconsGroup) {
      beaconsGroup.clear();
      beaconMeshesRef.current.clear();

      for (const asset of assets) {
        const posX = (asset.x * SPACING) - HALF_W + SPACING / 2;
        const posZ = (asset.y * SPACING) - HALF_H + SPACING / 2;
        const cell = grid[asset.y][asset.x];
        const groundY = cell.terrainZ * VERTICAL_SCALE;
        const bldgH = cell.buildingZ > 0 ? Math.max(0.6, cell.buildingZ * 0.45) : 0;
        const waterH = (cell.h > 0 ? cell.h * 1.5 : 0) * VERTICAL_SCALE;
        const topY = groundY + Math.max(bldgH, waterH);
        const posY = topY + 1.8;

        let iconTexture = iconTextures.hospital;
        if (asset.type === 'power_station') iconTexture = iconTextures.power;
        if (asset.type === 'metro_station') iconTexture = iconTextures.metro;

        const isFlooded = asset.status === 'flooded' || asset.status === 'isolated';

        const spriteMat = new THREE.SpriteMaterial({
          map: iconTexture,
          transparent: true,
          depthTest: true,
          depthWrite: false,
          color: isFlooded ? new THREE.Color('#FF4D4D') : new THREE.Color('#FFFFFF'),
        });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.center.set(0.5, 0.05);
        sprite.position.set(posX, posY, posZ);
        const iconScale = isFlooded ? 2.6 : 2.2;
        sprite.scale.set(iconScale, iconScale, 1);
        sprite.renderOrder = 10;

        beaconsGroup.add(sprite);

        beaconMeshesRef.current.set(asset.id, { mesh: sprite, asset });
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
      className="w-full h-full cursor-grab active:cursor-grabbing relative overflow-hidden"
    />
  );
};
