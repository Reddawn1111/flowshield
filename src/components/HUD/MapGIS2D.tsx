import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import { Compass, Layers, Shield, Maximize2, Radio } from 'lucide-react';
import { GridState } from '../../types/simulation';
import { BoundingBox } from '../../services/elevationService';

interface MapGIS2DProps {
  gridState: GridState;
  bbox?: BoundingBox;
  locationName: string;
  currentHour: number;
}

export const MapGIS2D: React.FC<MapGIS2DProps> = ({
  gridState,
  bbox,
  locationName,
  currentHour,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const imageOverlayRef = useRef<L.ImageOverlay | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [baseLayer, setBaseLayer] = useState<'optical' | 'sar'>('optical');
  const [floodedAreaHa, setFloodedAreaHa] = useState<number>(0);

  // Derived Bounding Box fallback if not explicitly passed
  const activeBBox: BoundingBox = bbox || {
    south: 35.655,
    west: 139.695,
    north: 35.664,
    east: 139.706,
  };

  const centerLat = (activeBBox.north + activeBBox.south) / 2;
  const centerLon = (activeBBox.east + activeBBox.west) / 2;
  const bboxBounds: L.LatLngBoundsExpression = [
    [activeBBox.south, activeBBox.west],
    [activeBBox.north, activeBBox.east],
  ];

  // Initialize offscreen canvas matching grid dimensions
  useEffect(() => {
    if (!offscreenCanvasRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = gridState.width || 90;
      canvas.height = gridState.height || 90;
      offscreenCanvasRef.current = canvas;
    }
  }, [gridState.width, gridState.height]);

  // REAL-TIME WATER MASK GENERATION (GridState Sync)
  // Dynamic HTML5 <canvas> matching width and height of simulation grid, updating on every physics tick
  const renderWaterMask = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    let canvas = offscreenCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      offscreenCanvasRef.current = canvas;
    }

    const gridWidth = gridState.width || 90;
    const gridHeight = gridState.height || 90;
    if (canvas.width !== gridWidth || canvas.height !== gridHeight) {
      canvas.width = gridWidth;
      canvas.height = gridHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(gridWidth, gridHeight);
    let floodedCount = 0;
    const cellAreaM2 = 100.0; // 10m x 10m

    // Iterate through gridState.cells
    for (let i = 0; i < gridState.cells.length; i++) {
      const cell = gridState.cells[i];

      // Calculate active flood depth above ground / resting water level
      const floodDepth = cell.isRiver
        ? Math.max(0.0, cell.h - (cell.baseDepth || 0))
        : cell.h;

      const pixelIdx = i * 4;

      if (floodDepth >= 0.08) {
        floodedCount++;
        // FLOODPY Cobalt Blue: rgb(0, 128, 255)
        imgData.data[pixelIdx]     = 0;    // R
        imgData.data[pixelIdx + 1] = 128;  // G
        imgData.data[pixelIdx + 2] = 255;  // B
        imgData.data[pixelIdx + 3] = 220;  // Alpha (85% opacity)
      } else {
        imgData.data[pixelIdx + 3] = 0;    // Transparent
      }
    }

    ctx.putImageData(imgData, 0, 0);
    const dataUrl = canvas.toDataURL();
    const latLngBounds = L.latLngBounds(bboxBounds);

    // Update or create Leaflet ImageOverlay
    if (imageOverlayRef.current) {
      imageOverlayRef.current.setUrl(dataUrl);
      imageOverlayRef.current.setBounds(latLngBounds);
    } else {
      const overlay = L.imageOverlay(dataUrl, latLngBounds, {
        opacity: 1.0,
        interactive: false,
        zIndex: 50,
      }).addTo(map);
      imageOverlayRef.current = overlay;
    }

    // Update inundated footprint area calculation
    const hectares = (floodedCount * cellAreaM2) / 10000.0;
    setFloodedAreaHa(parseFloat(hectares.toFixed(2)));
  }, [gridState, bboxBounds]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [centerLat, centerLon],
      zoom: 15,
      zoomControl: false,
      attributionControl: false,
    });

    map.fitBounds(bboxBounds, { padding: [10, 10] });

    // High-resolution ESRI World Imagery tiles
    const tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

    const layer = L.tileLayer(tileUrl, {
      maxZoom: 19,
      subdomains: 'abcd',
      className: baseLayer === 'sar' ? 'sar-radar-layer' : '',
    }).addTo(map);
    tileLayerRef.current = layer;

    // Draw initial bounding box rectangle graticule frame
    L.rectangle(bboxBounds, {
      color: '#0080ff',
      weight: 1.5,
      fill: false,
      dashArray: '4, 4',
    }).addTo(map);

    mapInstanceRef.current = map;

    // Render initial water mask immediately once map is attached
    renderWaterMask();

    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      clearTimeout(timer);
      imageOverlayRef.current = null;
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update water mask on every gridState tick or bounds change
  useEffect(() => {
    renderWaterMask();
  }, [renderWaterMask]);

  // Update map viewport when activeBBox changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.fitBounds(bboxBounds, { animate: true, duration: 0.5 });
  }, [activeBBox.south, activeBBox.west, activeBBox.north, activeBBox.east]);

  // Handle Base Layer Switch (Optical Satellite vs Synthetic SAR Radar)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    // High-resolution ESRI World Imagery tiles for both optical and synthetic SAR
    const tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

    const layer = L.tileLayer(tileUrl, {
      maxZoom: 19,
      subdomains: 'abcd',
      className: baseLayer === 'sar' ? 'sar-radar-layer' : '',
    }).addTo(map);
    tileLayerRef.current = layer;
  }, [baseLayer]);

  // Dynamic container resize observer to keep map centered during Split View / Full View changes
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const map = mapInstanceRef.current;
      if (map) {
        map.invalidateSize();
        map.fitBounds(bboxBounds, { padding: [10, 10] });
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [activeBBox.south, activeBBox.west, activeBBox.north, activeBBox.east]);

  // Latitude and Longitude Graticule Ticks
  const latTicks = [
    activeBBox.north,
    (activeBBox.north + activeBBox.south) / 2,
    activeBBox.south,
  ];
  const lonTicks = [
    activeBBox.west,
    (activeBBox.west + activeBBox.east) / 2,
    activeBBox.east,
  ];

  return (
    <div className="relative w-full h-full bg-[#050811] flex flex-col overflow-hidden select-none border-l border-slate-800">
      {/* Outer Cartographic Border Frame */}
      <div className="relative flex-1 w-full h-full p-6 flex flex-col justify-between">
        {/* Top Graticule Ticks (Longitude) */}
        <div className="absolute top-1 left-8 right-8 flex justify-between text-[10px] font-mono text-cyan-400/90 z-20 pointer-events-none">
          {lonTicks.map((lon, i) => (
            <div key={i} className="flex flex-col items-center">
              <span>{lon.toFixed(4)}° E</span>
              <div className="w-0.5 h-2 bg-cyan-500/60" />
            </div>
          ))}
        </div>

        {/* Bottom Graticule Ticks (Longitude) */}
        <div className="absolute bottom-1 left-8 right-8 flex justify-between text-[10px] font-mono text-cyan-400/90 z-20 pointer-events-none">
          {lonTicks.map((lon, i) => (
            <div key={i} className="flex flex-col items-center">
              <div className="w-0.5 h-2 bg-cyan-500/60" />
              <span>{lon.toFixed(4)}° E</span>
            </div>
          ))}
        </div>

        {/* Left Graticule Ticks (Latitude) */}
        <div className="absolute top-8 bottom-8 left-1 flex flex-col justify-between text-[10px] font-mono text-cyan-400/90 z-20 pointer-events-none">
          {latTicks.map((lat, i) => (
            <div key={i} className="flex items-center gap-1">
              <span>{lat.toFixed(4)}° N</span>
              <div className="h-0.5 w-2 bg-cyan-500/60" />
            </div>
          ))}
        </div>

        {/* Right Graticule Ticks (Latitude) */}
        <div className="absolute top-8 bottom-8 right-1 flex flex-col justify-between items-end text-[10px] font-mono text-cyan-400/90 z-20 pointer-events-none">
          {latTicks.map((lat, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="h-0.5 w-2 bg-cyan-500/60" />
              <span>{lat.toFixed(4)}° N</span>
            </div>
          ))}
        </div>

        {/* Map Canvas Container */}
        <div className="relative w-full h-full rounded-2xl overflow-hidden border-2 border-cyan-500/30 shadow-[0_0_30px_rgba(0,128,255,0.15)]">
          <div ref={mapContainerRef} className="w-full h-full z-0 cursor-grab active:cursor-grabbing" />

          {/* Floating Top Left Title HUD */}
          <div className="absolute top-3 left-3 z-10 bg-slate-950/90 backdrop-blur-md px-3.5 py-2 rounded-xl border border-cyan-500/40 text-xs font-mono shadow-xl flex items-center gap-3 pointer-events-auto">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_10px_#00f0ff]" />
            <div>
              <div className="font-extrabold text-slate-100 uppercase tracking-wider text-[11px]">
                {locationName}
              </div>
              <div className="text-[10px] text-cyan-400/90 flex items-center gap-2">
                <span>FLOWSHIELD 2D GIS / SAR</span>
                <span>•</span>
                <span>T +{currentHour.toFixed(1)}h</span>
              </div>
            </div>
          </div>

          {/* Floating Upper Right SVG North Arrow */}
          <div className="absolute top-3 right-3 z-10 bg-slate-950/90 backdrop-blur-md p-2.5 rounded-xl border border-slate-700/80 shadow-xl pointer-events-none flex flex-col items-center justify-center text-cyan-400">
            <svg className="w-7 h-7 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 19 21 12 17 5 21 12 2" fill="rgba(0, 240, 255, 0.2)" stroke="#00f0ff" />
            </svg>
            <span className="text-[9px] font-mono font-extrabold text-cyan-400 mt-0.5">N</span>
          </div>

          {/* Floating Lower Left Metric Scale Bar */}
          <div className="absolute bottom-28 left-4 z-20 bg-slate-950/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800 text-[10px] font-mono text-slate-300 pointer-events-none flex flex-col gap-1 shadow-xl">
            <div className="flex justify-between text-[9px] text-cyan-400">
              <span>0m</span>
              <span>250m</span>
              <span>500m</span>
            </div>
            <div className="w-32 h-1.5 bg-slate-800 rounded flex overflow-hidden border border-cyan-500/40">
              <div className="w-1/2 h-full bg-cyan-400" />
              <div className="w-1/2 h-full bg-slate-950" />
            </div>
          </div>

          {/* Floating Lower Right Base Layer Toggle & FLOODPY Legend */}
          <div className="absolute bottom-28 right-4 z-20 flex flex-col gap-2 items-end pointer-events-auto">
            {/* FLOODPY Cartographic HUD Legend */}
            <div className="bg-slate-950/90 backdrop-blur-md px-3.5 py-2.5 rounded-xl border border-cyan-500/40 text-xs font-mono shadow-2xl flex flex-col gap-1.5 min-w-[200px]">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-200 border-b border-slate-800 pb-1">
                <span className="flex items-center gap-1.5 text-cyan-400">
                  <Shield className="w-3.5 h-3.5" />
                  FLOODPY SAR Legend
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                  2D GIS
                </span>
              </div>

              <div className="flex items-center gap-2 text-[11px]">
                <div className="w-3.5 h-3.5 rounded bg-[#0080ff] border border-cyan-300 shadow-[0_0_8px_#0080ff]" />
                <span className="text-slate-200 font-semibold">Flooded Area (h ≥ 0.08m)</span>
              </div>

              <div className="flex justify-between items-center text-[10px] text-slate-400 pt-0.5">
                <span>Inundated Footprint:</span>
                <strong className="text-cyan-300 font-bold text-xs">{floodedAreaHa} ha ({((floodedAreaHa * 10000) / 1000000).toFixed(3)} km²)</strong>
              </div>

              <div className="text-[9px] text-slate-500 text-right font-bold pt-0.5 uppercase tracking-wider">
                FLOWSHIELD SAR / 2D Engine
              </div>
            </div>

            {/* Base Layer Switcher */}
            <div className="flex items-center gap-1 bg-slate-950/90 backdrop-blur-md p-1 rounded-xl border border-slate-800 text-[10px] font-mono">
              <button
                id="btn-optical-satellite"
                type="button"
                onClick={() => setBaseLayer('optical')}
                className={`px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all ${
                  baseLayer === 'optical'
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-[0_0_10px_rgba(0,240,255,0.2)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>Optical Satellite</span>
              </button>
              <button
                id="btn-synthetic-sar"
                type="button"
                onClick={() => setBaseLayer('sar')}
                className={`px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-all ${
                  baseLayer === 'sar'
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-[0_0_10px_rgba(0,240,255,0.2)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Radio className="w-3 h-3" />
                <span>Synthetic SAR Radar (Grayscale)</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Embedded CSS for Synthetic SAR Radar Grayscale Filter */}
      <style>{`
        .sar-radar-layer {
          filter: grayscale(100%) contrast(120%) !important;
        }
      `}</style>
    </div>
  );
};

export default MapGIS2D;
