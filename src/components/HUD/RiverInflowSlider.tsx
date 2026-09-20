import React from 'react';
import { Waves, Navigation, AlertCircle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { RiverInflowStatus } from '../../types/simulation';

interface RiverInflowSliderProps {
  riverSurge: number;
  onRiverSurgeChange: (rate: number) => void;
  status: RiverInflowStatus;
}

export const RiverInflowSlider: React.FC<RiverInflowSliderProps> = ({
  riverSurge,
  onRiverSurgeChange,
  status,
}) => {
  const isChecking = Boolean(status.checking || status.type === 'checking');
  const tooltipText = status.tooltip || "No river channel within 2.5 km of this sector";

  const getSurgeLabel = (rate: number) => {
    if (isChecking) return { label: 'Querying Overpass...', color: 'text-cyan-300', bg: 'bg-cyan-500/15 border-cyan-500/30' };
    if (!status.active) return { label: 'Inflow Inactive', color: 'text-slate-500', bg: 'bg-slate-800/80 border-slate-700' };
    if (rate === 0) return { label: 'Baseline Flow (0 m³/s)', color: 'text-slate-400', bg: 'bg-slate-800/80 border-slate-700' };
    if (rate <= 60) return { label: 'Moderate Runoff', color: 'text-cyan-400', bg: 'bg-cyan-500/15 border-cyan-500/30' };
    if (rate <= 160) return { label: 'High Surge Inflow', color: 'text-sky-400', bg: 'bg-sky-500/15 border-sky-500/30' };
    if (rate <= 240) return { label: 'Severe River Overflow', color: 'text-amber-400', bg: 'bg-amber-500/15 border-amber-500/30' };
    return { label: 'Catastrophic Deluge Wave', color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/30' };
  };

  const surgeInfo = getSurgeLabel(riverSurge);

  const quickPresets = [
    { label: '0 m³/s', value: 0 },
    { label: '60 m³/s', value: 60 },
    { label: '180 m³/s', value: 180 },
    { label: '280 m³/s', value: 280 },
  ];

  return (
    <div
      className={`bg-slate-900/90 backdrop-blur-md border border-slate-800/90 p-4 rounded-2xl shadow-2xl flex flex-col gap-3 w-80 select-none transition-all ${
        !status.active && !isChecking ? 'opacity-80' : ''
      }`}
      title={!status.active && !isChecking ? tooltipText : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
          <Waves className={`w-4 h-4 ${isChecking ? 'text-cyan-400 animate-spin' : status.active ? 'text-sky-400 animate-pulse' : 'text-slate-500'}`} />
          <span>River Inflow Dial</span>
        </span>
        <span
          className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${surgeInfo.bg} ${surgeInfo.color}`}
        >
          {isChecking ? 'Checking...' : status.active ? `${riverSurge} m³/s` : 'Offline'}
        </span>
      </div>

      {/* Dynamic Hydrological Influence Badge */}
      <div className="flex flex-col gap-1.5">
        {isChecking && (
          <div className="flex items-center gap-2 p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[11px] font-mono animate-pulse">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span className="leading-tight font-semibold">Checking for nearby rivers...</span>
          </div>
        )}

        {!isChecking && status.active && status.type === 'nearby' && (
          <div className="flex items-center justify-between bg-sky-500/15 border border-sky-500/30 px-2.5 py-1.5 rounded-xl text-[11px] font-mono">
            <div className="flex items-center gap-1.5 text-sky-300 font-bold truncate">
              <Navigation className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="truncate">
                {`Nearby Inflow: ${status.name || 'River'} (~${(status.distanceKm ?? 0).toFixed(1)} km)`}
              </span>
            </div>
            {status.trajectory?.direction && (
              <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-200 border border-sky-400/40 shrink-0 ml-1 font-bold">
                {status.trajectory.direction}
              </span>
            )}
          </div>
        )}

        {!isChecking && status.active && status.type === 'internal' && (
          <div className="flex items-center justify-between bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1.5 rounded-xl text-[11px] font-mono">
            <div className="flex items-center gap-1.5 text-emerald-300 font-bold truncate">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="truncate">
                {`Direct River Channel: ${status.name || 'Active'}`}
              </span>
            </div>
            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-400/40 shrink-0 ml-1 font-bold">
              Direct
            </span>
          </div>
        )}

        {!isChecking && !status.active && (
          <div
            className="flex items-center gap-2 p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300/90 text-[11px] font-mono"
            title={tooltipText}
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
            <span className="leading-tight">{tooltipText}</span>
          </div>
        )}

        {/* Current Inflow Regime Label */}
        {!isChecking && status.active && (
          <div className="flex items-center justify-between text-xs px-1">
            <span className="text-[11px] text-slate-400">Headwater Flux:</span>
            <span className={`font-semibold text-[11px] ${surgeInfo.color}`}>
              {surgeInfo.label}
            </span>
          </div>
        )}
      </div>

      {/* Slider Input */}
      <div className="px-1 flex flex-col gap-1.5 relative">
        <input
          type="range"
          min="0"
          max="300"
          step="10"
          value={status.active && !isChecking ? riverSurge : 0}
          disabled={!status.active || isChecking}
          title={!status.active && !isChecking ? tooltipText : undefined}
          onChange={(e) => onRiverSurgeChange(parseFloat(e.target.value))}
          className={`w-full h-2 rounded-lg appearance-none focus:outline-none shadow-inner transition-all ${
            status.active && !isChecking
              ? 'bg-slate-800 cursor-pointer accent-sky-400'
              : 'bg-slate-950/80 cursor-not-allowed accent-slate-600 opacity-60'
          }`}
        />
        <div className="flex justify-between text-[9px] font-mono text-slate-500">
          <span>0 (Base)</span>
          <span>100 m³/s</span>
          <span>200 m³/s</span>
          <span>300 (Max)</span>
        </div>
      </div>

      {/* Quick Dial Presets */}
      <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-slate-800/80">
        {quickPresets.map((preset) => {
          const isSelected = status.active && !isChecking && riverSurge === preset.value;
          return (
            <button
              key={preset.value}
              type="button"
              disabled={!status.active || isChecking}
              title={!status.active && !isChecking ? tooltipText : undefined}
              onClick={() => onRiverSurgeChange(preset.value)}
              className={`py-1 px-1 rounded-lg text-center text-[10px] font-mono font-medium transition-all border ${
                !status.active || isChecking
                  ? 'bg-slate-950/30 text-slate-600 border-slate-900 cursor-not-allowed'
                  : isSelected
                  ? 'bg-sky-500/20 text-sky-300 border-sky-500/50 shadow-[0_0_10px_rgba(56,189,248,0.2)]'
                  : 'bg-slate-950/50 text-slate-400 border-slate-800/80 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default RiverInflowSlider;
