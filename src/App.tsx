import React, { useState, useEffect, useRef, useCallback } from 'react';
import { generateTerrain } from './engine/terrain';
import { simulateStep } from './engine/physics';
import { Cell, GridState, SimulationAnalytics } from './types/simulation';
import { LOCATION_PROFILES } from './types/locations';
import { loadTerrainData, DigitalTwinDataset } from './engine/dataBridge';
import { PhysicsWorkerClient } from './engine/physicsWorkerClient';
import { Scene3D } from './components/Scene3D';
import { Header } from './components/HUD/Header';
import { TimeEngineBar } from './components/HUD/TimeEngineBar';
import { RainSlider } from './components/HUD/RainSlider';
import { AnalyticsPanel } from './components/HUD/AnalyticsPanel';
import { InspectorModal } from './components/HUD/InspectorModal';
import { ToolBar } from './components/HUD/ToolBar';
import { Legend } from './components/HUD/Legend';
import { HelpModal } from './components/HUD/HelpModal';
import { MainMenuModal } from './components/HUD/MainMenuModal';

export const App: React.FC = () => {
  // Current Location
  const [currentLocationName, setCurrentLocationName] = useState<string>('Shibuya Crossing, Tokyo');
  const [currentLocationId, setCurrentLocationId] = useState<string>('shibuya');
  const [isMainMenuOpen, setIsMainMenuOpen] = useState<boolean>(true);

  // Grid State (90x90 = 8,100 columns)
  const [gridState, setGridState] = useState<GridState>(() => generateTerrain(90, 90, 'shibuya'));
  const [terrainVersion, setTerrainVersion] = useState<number>(0);
  const baseGridRef = useRef<GridState>(gridState);
  const gridStateRef = useRef<GridState>(gridState);
  const workerClientRef = useRef<PhysicsWorkerClient | null>(null);

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
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(5); // 5x default

  // Precipitation / Rainfall
  const [rainfallRate, setRainfallRate] = useState<number>(85);
  const [riverSurge, setRiverSurge] = useState<number>(180);

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
    };
  };

  // Reset function
  const handleReset = useCallback(() => {
    setIsRunning(false);
    setCurrentHour(0);
    const fresh = cloneGrid(baseGridRef.current);
    for (const c of fresh.cells) {
      c.h = 0;
      c.prevH = 0;
      c.dh_dt = 0;
      c.risk = 'safe';
    }
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
    setCurrentHour(0);
    setCurrentLocationName(dataset.center.name);

    const fresh = loadTerrainData(dataset);
    baseGridRef.current = fresh;
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

  // Handle Location Switch from Main Menu
  const handleSelectLocation = (locId: string) => {
    setCurrentLocationId(locId);
    setIsRunning(false);
    setCurrentHour(0);

    const locProfile = LOCATION_PROFILES.find(l => l.id === locId);
    const fresh = generateTerrain(90, 90, locId);
    baseGridRef.current = fresh;
    setGridState(fresh);
    setTerrainVersion(v => v + 1);
    timelineCache.current.clear();

    if (locProfile) {
      setRainfallRate(locProfile.defaultRainfallRate);
      setRiverSurge(locProfile.defaultRiverSurge);
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

      try {
        let currentH = 0;
        setCurrentHour((prevHour) => {
          currentH = prevHour;
          return prevHour;
        });

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

        const { nextState, analytics: newAnalytics } = result;
        gridStateRef.current = nextState;

        setGridState({ ...nextState, cells: [...nextState.cells] });
        setAnalytics(newAnalytics);
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
    setCurrentHour(targetHour);
    const cacheKey = Math.round(targetHour * 10) / 10;
    const cached = timelineCache.current.get(cacheKey);

    if (cached) {
      setGridState(cloneGrid(cached.gridState));
      setAnalytics(cached.analytics);
    } else {
      let sim = cloneGrid(baseGridRef.current);
      let t = 0;
      const step = 0.1;
      let lastAnalytics = analytics;

      while (t < targetHour) {
        const res = simulateStep(sim, {
          rainfallRate,
          dtHours: step,
          riverSurgeInflow: riverSurge,
        });
        sim = res.nextState;
        lastAnalytics = res.analytics;
        t += step;
      }

      setGridState(sim);
      setAnalytics(lastAnalytics);
    }
  };

  return (
    <div className="relative w-screen h-screen bg-[#07090e] overflow-hidden select-none">
      {/* 3D Viewport with Continuous Terrain, Discrete Buildings, Metro & 3D Water Volume */}
      <Scene3D
        key={terrainVersion}
        gridState={gridState}
        onSelectCell={setSelectedCell}
        selectedCell={selectedCell}
        activeTool={activeTool}
        onCellAction={handleCellAction}
      />

      {/* TOP HEADER */}
      <Header
        isRunning={isRunning}
        currentLocationName={currentLocationName}
        onResetScene={handleReset}
        onOpenHelp={() => setIsHelpOpen(true)}
        onOpenMainMenu={() => setIsMainMenuOpen(true)}
      />

      {/* LEFT CONTROL PANEL */}
      <div className="absolute top-20 left-4 flex flex-col gap-3 pointer-events-auto z-20">
        <RainSlider
          rainfallRate={rainfallRate}
          onRainfallChange={setRainfallRate}
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
      <div className="absolute bottom-5 left-4 right-4 pointer-events-auto z-20">
        <TimeEngineBar
          currentHour={currentHour}
          isRunning={isRunning}
          speed={speed}
          onTogglePlay={() => setIsRunning(!isRunning)}
          onReset={handleReset}
          onSpeedChange={setSpeed}
          onScrubTime={handleScrubTime}
        />
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
