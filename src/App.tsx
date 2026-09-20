import React, { useState, useEffect, useRef, useCallback } from 'react';
import { generateTerrain } from './engine/terrain';
import { simulateStep } from './engine/physics';
import { runDamagePass } from './engine/damageAssessment';
import { Cell, GridState, SimulationAnalytics, RiverInflowStatus } from './types/simulation';
import { LOCATION_PROFILES } from './types/locations';
import { loadTerrainData, DigitalTwinDataset } from './engine/dataBridge';
import { PhysicsWorkerClient } from './engine/physicsWorkerClient';
import { Scene3D } from './components/Scene3D';
import { MapGIS2D } from './components/HUD/MapGIS2D';
import { Header } from './components/HUD/Header';
import { TimeEngineBar } from './components/HUD/TimeEngineBar';
import { RainSlider } from './components/HUD/RainSlider';
import { RiverInflowSlider } from './components/HUD/RiverInflowSlider';
import { AnalyticsPanel } from './components/HUD/AnalyticsPanel';
import { InspectorModal } from './components/HUD/InspectorModal';
import { ToolBar } from './components/HUD/ToolBar';
import { Legend } from './components/HUD/Legend';
import { HelpModal } from './components/HUD/HelpModal';
import { MainMenuModal } from './components/HUD/MainMenuModal';
import { checkNearbyRiversAsync } from './services/riverHydrologyService';
import { BoundingBox } from './services/elevationService';

// Deep clone helper
const cloneGrid = (g: GridState): GridState => {
  const newCells: Cell[] = [];
  const newGrid: Cell[][] = [];
  for (let y = 0; y < g.height; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < g.width; x++) {
      const c = { ...g.grid[y][x] };
      row.push(c);
      newCells.push(c);
    }
    newGrid.push(row);
  }
  const newAssets = g.assets.map(a => ({ ...a }));
  const newMetroLines = g.metroLines.map(m => ({ ...m, path: [...m.path] }));
  return {
    width: g.width,
    height: g.height,
    cells: newCells,
    grid: newGrid,
    assets: newAssets,
    metroLines: newMetroLines,
    roads: g.roads ? [...g.roads] : undefined,
    railways: g.railways ? [...g.railways] : undefined,
    spanMetersX: g.spanMetersX,
    spanMetersZ: g.spanMetersZ,
    bboxSpanKm: g.bboxSpanKm,
  };
};

export const App: React.FC = () => {
  // Current Location & Viewport Switcher State
  const [currentLocationName, setCurrentLocationName] = useState<string>('Shibuya Crossing, Tokyo');
  const [currentLocationId, setCurrentLocationId] = useState<string>('shibuya');
  const [isMainMenuOpen, setIsMainMenuOpen] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<'3d' | '2d' | 'split'>('3d');

  // Bounding Box state for 2D GIS map alignment
  const [activeBBox, setActiveBBox] = useState<BoundingBox>(() => ({
    south: 35.655,
    west: 139.695,
    north: 35.664,
    east: 139.706,
  }));

  // Grid State (90x90 = 8,100 columns)
  const [gridState, setGridState] = useState<GridState>(() => generateTerrain(90, 90, 'shibuya'));
  const [terrainVersion, setTerrainVersion] = useState<number>(0);
  const pristineBaselineRef = useRef<GridState>(cloneGrid(gridState));
  const baseGridRef = useRef<GridState>(gridState);
  const gridStateRef = useRef<GridState>(gridState);
  const workerClientRef = useRef<PhysicsWorkerClient | null>(null);
  const simulationEpochRef = useRef<number>(0);

  // Synchronize latest grid state ref for worker calculations
  useEffect(() => {
    gridStateRef.current = gridState;
  }, [gridState]);

  // Initialize Web Worker
  useEffect(() => {
    workerClientRef.current = new PhysicsWorkerClient();
    return () => {
      workerClientRef.current?.terminate();
    };
  }, []);

  // Time & Playback
  const [currentHour, setCurrentHour] = useState<number>(0);
  const currentHourRef = useRef<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(5); // 5x default

  // Precipitation / Rainfall & River Inflow
  const [rainfallRate, setRainfallRate] = useState<number>(85);
  const [riverSurge, setRiverSurge] = useState<number>(180);
  const [riverInflowStatus, setRiverInflowStatus] = useState<RiverInflowStatus>(() => ({
    active: true,
    type: 'internal',
    name: 'Shibuya River (渋谷川)',
  }));

  // Decoupled Background River Detection Trigger
  const triggerDecoupledRiverCheck = useCallback((bbox: BoundingBox, initialStatus?: RiverInflowStatus) => {
    if (initialStatus && initialStatus.active && initialStatus.type === 'internal') {
      setRiverInflowStatus(initialStatus);
      return;
    }

    setRiverInflowStatus({
      active: false,
      checking: true,
      type: 'checking',
      name: 'Checking for nearby rivers...',
    });

    checkNearbyRiversAsync(bbox)
      .then((resStatus) => {
        setRiverInflowStatus(resStatus);
        if (!resStatus.active) {
          setRiverSurge(0);
        }
      })
      .catch((err) => {
        console.warn('Background river check fallback:', err);
        setRiverInflowStatus({ active: false, tooltip: 'No major river within 2.0 km' });
        setRiverSurge(0);
      });
  }, []);

  // Automation / Test listener for dynamic river inflow status validation
  useEffect(() => {
    const handleTestStatus = (e: Event) => {
      const customEvent = e as CustomEvent<RiverInflowStatus>;
      if (customEvent.detail) {
        setRiverInflowStatus(customEvent.detail);
        if (!customEvent.detail.active) {
          setRiverSurge(0);
        }
      }
    };
    window.addEventListener('test-river-inflow-status', handleTestStatus);
    return () => window.removeEventListener('test-river-inflow-status', handleTestStatus);
  }, []);

  // Tools & Selection
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [activeTool, setActiveTool] = useState<'inspect' | 'sandbag' | 'obstruct'>('inspect');
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);

  // Analytics
  const [analytics, setAnalytics] = useState<SimulationAnalytics>(() => ({
    totalWaterVolumeM3: 0,
    affectedPopulation: 0,
    timeToCriticalSec: null,
    safePct: 100,
    warningPct: 0,
    criticalPct: 0,
    criticalAssets: gridState.assets,
    metroOperational: true,
    cascadingAlerts: [],
    maxDepthM: 0,
  }));

  // Timeline cache for instant scrubbing
  const timelineCache = useRef<Map<number, { gridState: GridState; analytics: SimulationAnalytics }>>(new Map());

  // Reset function
  const handleReset = useCallback(() => {
    setIsRunning(false);
    simulationEpochRef.current += 1;
    currentHourRef.current = 0;
    setCurrentHour(0);
    const fresh = cloneGrid(pristineBaselineRef.current);
    for (const c of fresh.cells) {
      c.h = c.isRiver ? (c.baseDepth || 2.5) : 0;
      c.prevH = c.h;
      c.dh_dt = 0;
      c.risk = 'safe';
      c.hasBarrier = false;
      c.isObstructed = false;
    }
    for (const a of fresh.assets) {
      a.status = 'operational';
    }
    for (const m of fresh.metroLines) {
      m.isOperational = true;
    }
    gridStateRef.current = fresh;
    setGridState(fresh);
    setTerrainVersion(v => v + 1);
    timelineCache.current.clear();
    
    const initialAnalytics: SimulationAnalytics = {
      totalWaterVolumeM3: 0,
      affectedPopulation: 0,
      timeToCriticalSec: null,
      safePct: 100,
      warningPct: 0,
      criticalPct: 0,
      criticalAssets: fresh.assets,
      metroOperational: true,
      cascadingAlerts: [],
      maxDepthM: 0,
    };

    timelineCache.current.set(0, {
      gridState: cloneGrid(fresh),
      analytics: initialAnalytics,
    });
    setAnalytics(initialAnalytics);
    setSelectedCell(null);
  }, []);

  // Handle Real-World Dataset Ingestion Bridge
  const handleLoadTerrainData = useCallback((dataset: DigitalTwinDataset) => {
    setIsRunning(false);
    simulationEpochRef.current += 1;
    currentHourRef.current = 0;
    setCurrentHour(0);
    setCurrentLocationName(dataset.center.name);

    if (dataset.bbox) {
      setActiveBBox(dataset.bbox);
    }

    const fresh = loadTerrainData(dataset);
    pristineBaselineRef.current = cloneGrid(fresh);
    baseGridRef.current = fresh;
    gridStateRef.current = fresh;
    setGridState(fresh);
    setTerrainVersion(v => v + 1);
    timelineCache.current.clear();

    const initialAnalytics: SimulationAnalytics = {
      totalWaterVolumeM3: 0,
      affectedPopulation: 0,
      timeToCriticalSec: null,
      safePct: 100,
      warningPct: 0,
      criticalPct: 0,
      criticalAssets: fresh.assets,
      metroOperational: true,
      cascadingAlerts: [],
      maxDepthM: 0,
    };

    timelineCache.current.set(0, {
      gridState: cloneGrid(fresh),
      analytics: initialAnalytics,
    });
    setAnalytics(initialAnalytics);
    setSelectedCell(null);

    // Detached background river search
    if (dataset.bbox) {
      triggerDecoupledRiverCheck(dataset.bbox, dataset.riverInflowStatus);
    }
  }, [triggerDecoupledRiverCheck]);

  // Handle Location Switch from Main Menu
  const handleSelectLocation = (locId: string) => {
    setCurrentLocationId(locId);
    setIsRunning(false);
    simulationEpochRef.current += 1;
    currentHourRef.current = 0;
    setCurrentHour(0);

    const locProfile = LOCATION_PROFILES.find(l => l.id === locId);
    const fresh = generateTerrain(90, 90, locId);
    pristineBaselineRef.current = cloneGrid(fresh);
    baseGridRef.current = fresh;
    gridStateRef.current = fresh;
    setGridState(fresh);
    setTerrainVersion(v => v + 1);
    timelineCache.current.clear();

    let bbox: BoundingBox = { south: 35.655, west: 139.695, north: 35.664, east: 139.706 };
    let presetRiverStatus: RiverInflowStatus = { active: false };

    if (locId === 'shibuya') {
      bbox = { south: 35.655, west: 139.695, north: 35.664, east: 139.706 };
      presetRiverStatus = { active: true, type: 'internal', name: 'Shibuya River (渋谷川)' };
    } else if (locId === 'singapore') {
      bbox = { south: 1.279, west: 103.854, north: 1.288, east: 103.864 };
      presetRiverStatus = { active: true, type: 'internal', name: 'Singapore River / Marina Bay' };
    } else if (locId === 'manhattan') {
      bbox = { south: 40.702, west: -74.015, north: 40.713, east: -74.003 };
      presetRiverStatus = { active: true, type: 'internal', name: 'Hudson & East Rivers' };
    } else if (locId === 'venice') {
      bbox = { south: 45.434, west: 12.321, north: 45.443, east: 12.333 };
      presetRiverStatus = { active: true, type: 'internal', name: 'Venice Grand Canal' };
    } else if (locId === 'apex') {
      bbox = { south: 22.314, west: 114.164, north: 22.324, east: 114.174 };
      presetRiverStatus = { active: true, type: 'internal', name: 'Apex River Delta' };
    }

    setActiveBBox(bbox);
    setRiverInflowStatus(presetRiverStatus);

    if (locProfile) {
      setRainfallRate(locProfile.defaultRainfallRate);
      setRiverSurge(presetRiverStatus.active ? locProfile.defaultRiverSurge : 0);
    }

    const initialAnalytics: SimulationAnalytics = {
      totalWaterVolumeM3: 0,
      affectedPopulation: 0,
      timeToCriticalSec: null,
      safePct: 100,
      warningPct: 0,
      criticalPct: 0,
      criticalAssets: fresh.assets,
      metroOperational: true,
      cascadingAlerts: [],
      maxDepthM: 0,
    };

    timelineCache.current.set(0, {
      gridState: cloneGrid(fresh),
      analytics: initialAnalytics,
    });
    setAnalytics(initialAnalytics);
    setSelectedCell(null);

    // Fire background check for external locations if needed
    triggerDecoupledRiverCheck(bbox, presetRiverStatus);
  };

  // Interactive user actions
  const handleCellAction = (x: number, y: number, action: 'sandbag' | 'obstruct') => {
    setGridState((prev) => {
      const cloned = cloneGrid(prev);
      const target = cloned.grid[y][x];
      if (action === 'sandbag') {
        target.hasBarrier = !target.hasBarrier;
      } else if (action === 'obstruct') {
        target.isObstructed = !target.isObstructed;
      }
      if (selectedCell && selectedCell.x === x && selectedCell.y === y) {
        setSelectedCell({ ...target });
      }
      return cloned;
    });
  };

  const handleClearSandbags = () => {
    setGridState((prev) => {
      const cloned = cloneGrid(prev);
      for (const cell of cloned.cells) {
        cell.hasBarrier = false;
        cell.isObstructed = false;
      }
      return cloned;
    });
  };

  // Simulation Step Interval Loop via Web Worker
  useEffect(() => {
    if (!isRunning) return;

    let isTicking = false;
    const intervalMs = 50; // 20 ticks / sec

    const timer = setInterval(async () => {
      if (isTicking) return;
      isTicking = true;
      const currentEpoch = simulationEpochRef.current;

      try {
        const currentH = currentHourRef.current;

        if (currentH >= 24) {
          setIsRunning(false);
          isTicking = false;
          return;
        }

        const dtHours = 0.012 * speed;
        const nextHour = Math.min(24, currentH + dtHours);

        const client = workerClientRef.current;
        const result = client
          ? await client.step(gridStateRef.current, {
              rainfallRate,
              dtHours,
              riverSurgeInflow: riverSurge,
            })
          : simulateStep(gridStateRef.current, {
              rainfallRate,
              dtHours,
              riverSurgeInflow: riverSurge,
            });

        // STALE RESULT DISCARD CHECK:
        // If user clicked Reset, scrubbed time, or switched location while worker was calculating, discard result immediately!
        if (simulationEpochRef.current !== currentEpoch) {
          isTicking = false;
          return;
        }

        const { nextState, analytics: newAnalytics } = result;
        // Analytical damage assessment pass — pure read-only sweep of H values
        newAnalytics.damageReport = runDamagePass(nextState.grid);
        gridStateRef.current = nextState;

        setGridState({ ...nextState, cells: [...nextState.cells] });
        setAnalytics(newAnalytics);
        currentHourRef.current = nextHour;
        setCurrentHour(nextHour);

        // Cache state
        const cacheKey = Math.round(nextHour * 10) / 10;
        if (!timelineCache.current.has(cacheKey)) {
          timelineCache.current.set(cacheKey, {
            gridState: cloneGrid(nextState),
            analytics: newAnalytics,
          });
        }

        if (selectedCell) {
          const updated = nextState.grid[selectedCell.y][selectedCell.x];
          setSelectedCell({ ...updated });
        }
      } catch (err) {
        console.error('Simulation loop error:', err);
      } finally {
        isTicking = false;
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isRunning, speed, rainfallRate, riverSurge, selectedCell]);

  // Scrubbing handler
  const handleScrubTime = (targetHour: number) => {
    // Invalidate any in-flight simulation worker steps to prevent late overwriting
    simulationEpochRef.current += 1;
    // Pause simulation if it's running to prevent race conditions
    if (isRunning) {
      setIsRunning(false);
    }
    
    // Clamp target hour to valid range [0, 24]
    const clampedHour = Math.max(0, Math.min(24, targetHour));
    currentHourRef.current = clampedHour;
    setCurrentHour(clampedHour);

    // Instant O(1) reset back to 0.0h
    if (clampedHour === 0) {
      const fresh = cloneGrid(pristineBaselineRef.current);
      for (const c of fresh.cells) {
        c.h = c.isRiver ? (c.baseDepth || 2.5) : 0;
        c.prevH = c.h;
        c.dh_dt = 0;
        c.risk = 'safe';
        c.hasBarrier = false;
        c.isObstructed = false;
      }
      gridStateRef.current = fresh;
      setGridState(fresh);
      const cached0 = timelineCache.current.get(0);
      if (cached0) {
        setAnalytics(cached0.analytics);
      }
      return;
    }

    const cacheKey = Math.round(clampedHour * 10) / 10;
    const cached = timelineCache.current.get(cacheKey);

    if (cached) {
      const cloned = cloneGrid(cached.gridState);
      gridStateRef.current = cloned;
      setGridState(cloned);
      setAnalytics(cached.analytics);
    } else {
      // Find the nearest cached time below the target hour
      let startTime = 0;
      let startState = cloneGrid(pristineBaselineRef.current);
      let startAnalytics = analytics;
      
      // Get all cache keys and find the largest one <= clampedHour
      const cacheKeys = Array.from(timelineCache.current.keys())
        .filter(key => key <= clampedHour)
        .sort((a, b) => b - a); // descending
      
      if (cacheKeys.length > 0) {
        const nearestKey = cacheKeys[0];
        const nearestCache = timelineCache.current.get(nearestKey);
        if (nearestCache) {
          startTime = nearestKey;
          startState = cloneGrid(nearestCache.gridState);
          startAnalytics = nearestCache.analytics;
        }
      }
      
      let sim = startState;
      let t = startTime;
      // Fast adaptive catch-up step to prevent UI thread lock
      const step = Math.min(0.20, Math.max(0.05, (clampedHour - startTime) / 8));
      let lastAnalytics = startAnalytics;

      while (t < clampedHour) {
        const currentDt = Math.min(step, clampedHour - t);
        const res = simulateStep(sim, {
          rainfallRate,
          dtHours: currentDt,
          riverSurgeInflow: riverSurge,
        });
        sim = res.nextState;
        lastAnalytics = res.analytics;
        t += currentDt;
      }

      // Attach damage report for the scrubbed-to time point
      lastAnalytics.damageReport = runDamagePass(sim.grid);

      gridStateRef.current = sim;
      setGridState(sim);
      setAnalytics(lastAnalytics);
      
      // Cache the result for future scrubbing
      timelineCache.current.set(cacheKey, {
        gridState: cloneGrid(sim),
        analytics: lastAnalytics,
      });
    }
  };

  return (
    <div className="relative w-screen h-screen bg-[#07090e] overflow-hidden select-none flex">
      {/* 3D DIORAMA VIEWPORT */}
      {(viewMode === '3d' || viewMode === 'split') && (
        <div className={`relative h-full ${viewMode === 'split' ? 'w-1/2 border-r border-slate-800' : 'w-full'}`}>
          <Scene3D
            key={terrainVersion}
            gridState={gridState}
            onSelectCell={setSelectedCell}
            selectedCell={selectedCell}
            activeTool={activeTool}
            onCellAction={handleCellAction}
          />
        </div>
      )}

      {/* 2D GIS MAP VIEWPORT */}
      {(viewMode === '2d' || viewMode === 'split') && (
        <div className={`relative h-full ${viewMode === 'split' ? 'w-1/2' : 'w-full'}`}>
          <MapGIS2D
            gridState={gridState}
            bbox={activeBBox}
            locationName={currentLocationName}
            currentHour={currentHour}
          />
        </div>
      )}

      {/* TOP HEADER */}
      <Header
        isRunning={isRunning}
        currentLocationName={currentLocationName}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onResetScene={handleReset}
        onOpenHelp={() => setIsHelpOpen(true)}
        onOpenMainMenu={() => {
          setIsRunning(false);
          setIsMainMenuOpen(true);
        }}
      />

      {/* LEFT CONTROL PANEL */}
      <div className="absolute top-20 left-4 flex flex-col gap-3 pointer-events-auto z-20">
        <RainSlider
          rainfallRate={rainfallRate}
          onRainfallChange={setRainfallRate}
        />

        <RiverInflowSlider
          riverSurge={riverSurge}
          onRiverSurgeChange={setRiverSurge}
          status={riverInflowStatus}
        />

        <ToolBar
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          onClearSandbags={handleClearSandbags}
        />

        <Legend />
      </div>

      {/* RIGHT ANALYTICS PANEL */}
      <div className="absolute top-20 right-4 flex flex-col gap-3 pointer-events-auto z-20">
        <AnalyticsPanel analytics={analytics} />
      </div>

      {/* INSPECTOR MODAL */}
      <InspectorModal
        cell={selectedCell}
        onClose={() => setSelectedCell(null)}
        onToggleBarrier={(x, y) => handleCellAction(x, y, 'sandbag')}
        onToggleObstruction={(x, y) => handleCellAction(x, y, 'obstruct')}
      />

      {/* BOTTOM TIME ENGINE BAR */}
      <div className="absolute bottom-5 left-4 right-4 pointer-events-none z-20 flex justify-center">
        <div className="pointer-events-auto w-full max-w-2xl">
          <TimeEngineBar
            key={currentLocationName}
            currentHour={currentHour}
            isRunning={isRunning}
            speed={speed}
            onTogglePlay={() => setIsRunning(!isRunning)}
            onReset={handleReset}
            onSpeedChange={setSpeed}
            onScrubTime={handleScrubTime}
          />
        </div>
      </div>

      {/* HELP MODAL */}
      <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

      {/* MAIN MENU MISSION / LOCATION PORTAL */}
      <MainMenuModal
        isOpen={isMainMenuOpen}
        onLoadTerrainData={handleLoadTerrainData}
        onClose={() => setIsMainMenuOpen(false)}
      />
    </div>
  );
};

export default App;
