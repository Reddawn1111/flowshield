import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Globe,
  Compass,
  MapPin,
  CheckCircle2,
  ArrowRight,
  X,
  Layers,
  Activity,
  Cpu,
  Loader2,
} from 'lucide-react';
import { MapPicker2D } from './MapPicker2D';
import { searchNominatim, GeocodingResult } from '../../services/geocoding';
import { runIngestionPipeline } from '../../services/ingestionPipeline';
import { DigitalTwinDataset } from '../../utils/GeoTransformer';

interface PresetCard {
  id: string;
  name: string;
  country: string;
  subtitle: string;
  lat: number;
  lon: number;
  terrainType: string;
}

const PRESET_LOCATIONS: PresetCard[] = [
  {
    id: 'singapore',
    name: 'Marina Bay Sands',
    country: 'Singapore',
    subtitle: 'Downtown Core & Bay Reservoir',
    lat: 1.2838,
    lon: 103.8591,
    terrainType: 'Coastal basin & central bay reservoir',
  },
  {
    id: 'shibuya',
    name: 'Shibuya Crossing',
    country: 'Tokyo, Japan',
    subtitle: 'Shibuya Valley & Station Basin',
    lat: 35.6595,
    lon: 139.7006,
    terrainType: 'Topographic bowl & subterranean culverts',
  },
  {
    id: 'manhattan',
    name: 'Lower Manhattan & Wall St',
    country: 'New York, USA',
    subtitle: 'Financial District & Battery Park',
    lat: 40.7075,
    lon: -74.009,
    terrainType: 'Narrow peninsula bounded by Hudson & East Rivers',
  },
  {
    id: 'venice',
    name: 'Venice Grand Canal',
    country: 'Italy',
    subtitle: 'Lagoon Archipelago & Historic Center',
    lat: 45.4387,
    lon: 12.3271,
    terrainType: 'Sea-level lagoon & canal network',
  },
];

interface MainMenuModalProps {
  isOpen: boolean;
  onLoadTerrainData: (dataset: DigitalTwinDataset) => void;
  onClose: () => void;
}

export const MainMenuModal: React.FC<MainMenuModalProps> = ({
  isOpen,
  onLoadTerrainData,
  onClose,
}) => {
  if (!isOpen) return null;

  // Target coordinates & metadata
  const [targetLat, setTargetLat] = useState<number>(35.6595);
  const [targetLon, setTargetLon] = useState<number>(139.7006);
  const [targetName, setTargetName] = useState<string>('Shibuya Crossing, Tokyo');
  const [boxSizeMeters] = useState<number>(1200);

  // Search & Geocoding
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<GeocodingResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const debounceRef = useRef<number | null>(null);

  // Ingestion Pipeline State
  const [isIngesting, setIsIngesting] = useState<boolean>(false);
  const [progressStep, setProgressStep] = useState<string>('');
  const [progressPct, setProgressPct] = useState<number>(0);

  // Handle Nominatim search with 300ms debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    debounceRef.current = window.setTimeout(async () => {
      const results = await searchNominatim(searchQuery);
      setSearchResults(results);
      setIsSearching(false);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  if (!isOpen) return null;

  // Handle preset card click
  const handleSelectPreset = (preset: PresetCard) => {
    setTargetLat(preset.lat);
    setTargetLon(preset.lon);
    setTargetName(`${preset.name} (${preset.country})`);
    setSearchResults([]);
  };

  // Handle search autocomplete selection
  const handleSelectSearchResult = (res: GeocodingResult) => {
    setTargetLat(res.lat);
    setTargetLon(res.lon);
    setTargetName(res.displayName);
    setSearchQuery(res.name);
    setSearchResults([]);
  };

  // Handle click on 2D map
  const handleMapPin = (lat: number, lon: number) => {
    setTargetLat(parseFloat(lat.toFixed(5)));
    setTargetLon(parseFloat(lon.toFixed(5)));
    setTargetName(`Pinned Location (${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E)`);
    setSearchResults([]);
  };

  // Trigger Data Ingestion Pipeline
  const handleLaunch = async () => {
    setIsIngesting(true);
    setProgressPct(5);
    setProgressStep('Initializing Ingestion Pipeline...');

    try {
      const dataset = await runIngestionPipeline({
        lat: targetLat,
        lon: targetLon,
        name: targetName,
        boxSizeMeters,
        onProgress: (step, pct) => {
          setProgressStep(step);
          setProgressPct(pct);
        },
      });

      setTimeout(() => {
        setIsIngesting(false);
        onLoadTerrainData(dataset);
        onClose();
      }, 500);
    } catch (err) {
      console.error('Ingestion failed:', err);
      setIsIngesting(false);
      setProgressStep('Ingestion failed. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-4 select-none animate-in fade-in duration-200">
      {/* Container */}
      <div className="relative w-full max-w-6xl h-[92vh] flex flex-col bg-slate-900/95 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden">
        {/* Background glow accents */}
        <div className="absolute -top-32 -left-32 w-96 h-96 bg-cyan-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header */}
        <div className="flex items-center justify-between px-8 pt-6 pb-4 border-b border-slate-800">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_20px_rgba(0,240,255,0.2)]">
              <Globe className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-sky-200 to-white bg-clip-text text-transparent">
                  FLOWSHIELD MISSION PORTAL
                </h2>
                <span className="text-[10px] uppercase font-bold tracking-widest px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                  REAL-WORLD DATA INGESTION
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Query Open-Meteo DEM & OpenStreetMap Overpass vectors to construct accurate 3D urban flood digital twins.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-all border border-slate-700/60"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Geocoding Bar */}
        <div className="px-8 pt-4 pb-2 relative z-30">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search global city, address, or landmark (e.g. Shibuya Crossing, Marina Bay Sands, Manhattan, Venice)..."
              className="w-full pl-12 pr-12 py-3.5 bg-slate-950/90 border border-slate-700/80 rounded-2xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400/80 focus:ring-1 focus:ring-cyan-400/50 transition-all font-mono"
            />
            {isSearching && (
              <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-cyan-400 animate-spin" />
            )}

            {/* Autocomplete Dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900/98 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden z-40 max-h-60 overflow-y-auto">
                {searchResults.map((res) => (
                  <div
                    key={res.placeId}
                    onClick={() => handleSelectSearchResult(res)}
                    className="px-4 py-3 hover:bg-cyan-500/10 cursor-pointer border-b border-slate-800/60 last:border-0 flex items-center justify-between group transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <MapPin className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" />
                      <div>
                        <div className="text-sm font-bold text-slate-200 group-hover:text-cyan-300">
                          {res.name}
                        </div>
                        <div className="text-xs text-slate-400 truncate max-w-xl">
                          {res.displayName}
                        </div>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500 bg-slate-950 px-2 py-1 rounded">
                      {res.lat.toFixed(4)}°, {res.lon.toFixed(4)}°
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main Body Grid: Left Controls & Metadata, Right 2D Leaflet Map */}
        <div className="flex-1 px-8 py-3 grid grid-cols-1 lg:grid-cols-12 gap-5 overflow-hidden">
          {/* LEFT PANEL (5 cols): Presets & Metadata HUD */}
          <div className="lg:col-span-5 flex flex-col gap-4 overflow-y-auto pr-1">
            {/* Target Metadata HUD */}
            <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-mono tracking-wider text-cyan-400 font-bold flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  Target Coordinates & Ingestion BBox
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  READY
                </span>
              </div>

              <div className="text-sm font-extrabold text-slate-100 truncate">
                {targetName}
              </div>

              <div className="grid grid-cols-2 gap-2 mt-1 font-mono text-xs">
                <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                  <span className="text-[10px] text-slate-500 block">LATITUDE</span>
                  <span className="text-slate-200 font-bold">{targetLat.toFixed(5)}° N</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                  <span className="text-[10px] text-slate-500 block">LONGITUDE</span>
                  <span className="text-slate-200 font-bold">{targetLon.toFixed(5)}° E</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                  <span className="text-[10px] text-slate-500 block">BOUNDING BOX</span>
                  <span className="text-cyan-400 font-bold">1.2 km × 1.2 km (1.44 km²)</span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800">
                  <span className="text-[10px] text-slate-500 block">SIMULATION GRID</span>
                  <span className="text-emerald-400 font-bold">90 × 90 (8,100 Cells)</span>
                </div>
              </div>
            </div>

            {/* Benchmark Preset Urban Basins */}
            <div>
              <span className="text-xs uppercase font-mono tracking-wider text-slate-400 font-bold flex items-center gap-1.5 mb-2.5">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                Benchmark Urban Watershed Presets
              </span>

              <div className="grid grid-cols-1 gap-2.5">
                {PRESET_LOCATIONS.map((preset) => {
                  const isSelected =
                    Math.abs(preset.lat - targetLat) < 0.005 &&
                    Math.abs(preset.lon - targetLon) < 0.005;

                  return (
                    <div
                      key={preset.id}
                      onClick={() => handleSelectPreset(preset)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? 'bg-slate-800/90 border-cyan-400 shadow-[0_0_18px_rgba(0,240,255,0.2)] ring-1 ring-cyan-400'
                          : 'bg-slate-950/60 hover:bg-slate-800/40 border-slate-800/90 hover:border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-200">
                            {preset.name}
                          </span>
                          <span className="text-[11px] text-cyan-400/90 font-medium">
                            {preset.country}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {preset.terrainType}
                        </div>
                      </div>

                      {isSelected ? (
                        <div className="w-5 h-5 rounded-full bg-cyan-400 text-slate-950 flex items-center justify-center font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        </div>
                      ) : (
                        <div className="w-5 h-5 rounded-full border border-slate-700" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT PANEL (7 cols): Interactive 2D Picker Map */}
          <div className="lg:col-span-7 h-full flex flex-col">
            <div className="flex-1 w-full h-full min-h-[300px]">
              <MapPicker2D
                lat={targetLat}
                lon={targetLon}
                boxSizeMeters={boxSizeMeters}
                onSelectCoords={handleMapPin}
              />
            </div>
          </div>
        </div>

        {/* Bottom Action Footer */}
        <div className="px-8 py-4 border-t border-slate-800 bg-slate-950/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-xs font-mono text-slate-400">
              Target:{' '}
              <strong className="text-cyan-300">
                {targetLat.toFixed(4)}° N, {targetLon.toFixed(4)}° E
              </strong>
            </span>
          </div>

          {/* Center Progress Bar during ingestion */}
          {isIngesting && (
            <div className="flex-1 max-w-md mx-6 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-cyan-300 font-bold flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                  {progressStep}
                </span>
                <span className="text-cyan-400 font-bold">{progressPct}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300 rounded-full shadow-[0_0_12px_#00f0ff]"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Right Action Button */}
          <div>
            {isIngesting ? (
              <div className="px-6 py-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 font-mono text-xs font-bold flex items-center gap-2">
                <Cpu className="w-4 h-4 text-cyan-400 animate-pulse" />
                STREAMING DATASET...
              </div>
            ) : (
              <button
                onClick={handleLaunch}
                className="flex items-center gap-2.5 bg-gradient-to-r from-cyan-500 hover:from-cyan-400 to-blue-600 hover:to-blue-500 text-slate-950 font-extrabold text-sm px-7 py-3.5 rounded-2xl shadow-[0_0_25px_rgba(0,240,255,0.4)] hover:shadow-[0_0_35px_rgba(0,240,255,0.6)] transition-all transform hover:-translate-y-0.5 active:translate-y-0"
              >
                <span>INITIALIZE 3D TWIN & STREAM MAP</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
