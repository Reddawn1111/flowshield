import React from 'react';
import {
  Waves,
  Clock,
  AlertOctagon,
  Zap,
  Hospital,
  Train,
  ShieldAlert,
  Users,
  DollarSign,
  AlertTriangle,
  Route,
} from 'lucide-react';
import { SimulationAnalytics } from '../../types/simulation';

interface AnalyticsPanelProps {
  analytics: SimulationAnalytics;
}

export const AnalyticsPanel: React.FC<AnalyticsPanelProps> = ({ analytics }) => {
  const {
    totalWaterVolumeM3,
    timeToCriticalSec,
    safePct,
    warningPct,
    criticalPct,
    criticalAssets,
    metroOperational,
    maxDepthM,
    damageReport,
  } = analytics;

  // Calculate infrastructure stats
  const hospitals = criticalAssets.filter(a => a.type === 'hospital');
  const hospitalsCompromised = hospitals.filter(a => a.status === 'flooded' || a.status === 'isolated').length;

  const substations = criticalAssets.filter(a => a.type === 'power_station');
  const substationsFlooded = substations.filter(a => a.status === 'flooded').length;

  const formatCountdown = (seconds: number | null) => {
    if (seconds === null) return 'NO IMMINENT BREACH';
    if (seconds === 0) return 'CRITICAL BREACH ACTIVE';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  };

  // Format economic loss for display
  const formatUSD = (usd: number): string => {
    if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
    if (usd >= 1_000_000)     return `$${(usd / 1_000_000).toFixed(2)}M`;
    if (usd >= 1_000)         return `$${(usd / 1_000).toFixed(1)}K`;
    return `$${usd.toFixed(0)}`;
  };

  const displaced      = damageReport?.displacedCitizens ?? 0;
  const lifeThreat     = damageReport?.lifeThreatenedCount ?? 0;
  const lossUSD        = damageReport?.totalEconomicLossUSD ?? 0;
  const impassableKm   = damageReport?.roadNetwork.impassableKm ?? 0;

  const hasActiveDamage = lossUSD > 0 || displaced > 0;

  return (
    <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800/90 p-3.5 rounded-2xl shadow-2xl flex flex-col gap-3 w-88">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
          <AlertOctagon className="w-4 h-4 text-red-400" />
          <span>Hydro Digital Twin Analytics</span>
        </span>
        <span className="text-[10px] font-mono text-slate-400">
          Peak Depth: <strong className="text-cyan-400">{maxDepthM.toFixed(2)}m</strong>
        </span>
      </div>

      {/* Metric Cards — Water Volume & Hazard Level */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-950/50 p-2.5 rounded-xl border border-slate-800/70 flex flex-col">
          <div className="flex items-center gap-1.5 text-slate-400 text-[10px]">
            <Waves className="w-3 h-3 text-cyan-400" />
            <span>Water Volume</span>
          </div>
          <span className="text-base font-extrabold font-mono text-cyan-400 mt-1">
            {(totalWaterVolumeM3 / 1000).toFixed(1)}k <span className="text-[10px] text-slate-500 font-normal">m³</span>
          </span>
        </div>

        <div className="bg-slate-950/50 p-2.5 rounded-xl border border-slate-800/70 flex flex-col">
          <div className="flex items-center gap-1.5 text-slate-400 text-[10px]">
            <ShieldAlert className="w-3 h-3 text-red-400" />
            <span>Hazard Level</span>
          </div>
          <span className="text-base font-extrabold font-mono text-red-400 mt-1">
            {criticalPct.toFixed(1)}% <span className="text-[10px] text-slate-500 font-normal">critical</span>
          </span>
        </div>
      </div>

      {/* ── NEW: Population Exposure Card ─────────────────────────────── */}
      <div className={`p-2.5 rounded-xl border flex flex-col gap-1.5 ${
        lifeThreat > 0
          ? 'bg-red-950/40 border-red-500/40'
          : displaced > 0
          ? 'bg-amber-950/30 border-amber-500/30'
          : 'bg-slate-950/40 border-slate-800/70'
      }`}>
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <Users className="w-3 h-3 text-slate-400" />
          <span>Population Exposure</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {/* Displaced */}
          <div className="flex flex-col">
            <span className="text-[9px] text-slate-500 uppercase tracking-wide">Displaced</span>
            <span className={`text-sm font-extrabold font-mono ${displaced > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
              {displaced.toLocaleString()}
            </span>
            <span className="text-[9px] text-slate-600">H ≥ 0.30 m</span>
          </div>
          {/* Life-Threat */}
          <div className="flex flex-col">
            <span className="text-[9px] text-slate-500 uppercase tracking-wide flex items-center gap-0.5">
              <AlertTriangle className="w-2.5 h-2.5 text-red-500" />
              Life-Threat
            </span>
            <span className={`text-sm font-extrabold font-mono ${lifeThreat > 0 ? 'text-red-400 animate-pulse' : 'text-slate-500'}`}>
              {lifeThreat.toLocaleString()}
            </span>
            <span className="text-[9px] text-slate-600">H ≥ 1.20 m</span>
          </div>
        </div>
      </div>

      {/* ── NEW: Economic Damage Card ──────────────────────────────────── */}
      <div className={`p-2.5 rounded-xl border flex flex-col gap-1.5 ${
        hasActiveDamage
          ? 'bg-orange-950/30 border-orange-500/30'
          : 'bg-slate-950/40 border-slate-800/70'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <DollarSign className="w-3 h-3 text-slate-400" />
            <span>Economic Damage</span>
          </div>
          <span className={`text-sm font-extrabold font-mono ${lossUSD > 1_000_000 ? 'text-orange-400' : lossUSD > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
            {formatUSD(lossUSD)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-slate-500">
          <Route className="w-2.5 h-2.5 text-slate-600 flex-shrink-0" />
          <span>
            Road closures:{' '}
            <span className={`font-mono font-semibold ${impassableKm > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
              {impassableKm.toFixed(1)} km
            </span>
            {' '}impassable
          </span>
        </div>
      </div>

      {/* Countdown to Breach */}
      <div className="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className={`w-4 h-4 ${timeToCriticalSec === 0 ? 'text-red-400 animate-pulse' : 'text-amber-400'}`} />
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">Time to Critical Breach</span>
            <span className={`text-xs font-mono font-bold ${timeToCriticalSec === 0 ? 'text-red-400' : 'text-amber-300'}`}>
              {formatCountdown(timeToCriticalSec)}
            </span>
          </div>
        </div>
      </div>

      {/* CRITICAL INFRASTRUCTURE STATUS CARDS */}
      <div className="flex flex-col gap-1.5 bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/70">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          Infrastructure Lifelines
        </span>
        <div className="grid grid-cols-3 gap-1.5 text-[11px]">
          {/* Hospitals */}
          <div className={`p-2 rounded-lg border flex flex-col items-center text-center ${
            hospitalsCompromised > 0
              ? 'bg-red-500/15 border-red-500/40 text-red-300'
              : 'bg-slate-900 border-slate-800 text-emerald-400'
          }`}>
            <Hospital className="w-4 h-4 mb-0.5" />
            <span className="text-[9px] font-semibold text-slate-400 uppercase">Hospitals</span>
            <span className="font-mono font-bold text-xs">{hospitals.length - hospitalsCompromised}/{hospitals.length}</span>
          </div>

          {/* Substations */}
          <div className={`p-2 rounded-lg border flex flex-col items-center text-center ${
            substationsFlooded > 0
              ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
              : 'bg-slate-900 border-slate-800 text-amber-400'
          }`}>
            <Zap className="w-4 h-4 mb-0.5" />
            <span className="text-[9px] font-semibold text-slate-400 uppercase">Power Grid</span>
            <span className="font-mono font-bold text-xs">{substations.length - substationsFlooded}/{substations.length}</span>
          </div>

          {/* Metro Line */}
          <div className={`p-2 rounded-lg border flex flex-col items-center text-center ${
            !metroOperational
              ? 'bg-red-500/15 border-red-500/40 text-red-300'
              : 'bg-slate-900 border-slate-800 text-purple-400'
          }`}>
            <Train className="w-4 h-4 mb-0.5" />
            <span className="text-[9px] font-semibold text-slate-400 uppercase">Metro Rail</span>
            <span className="font-mono font-bold text-xs">{metroOperational ? 'ONLINE' : 'HALTED'}</span>
          </div>
        </div>
      </div>

      {/* Risk Distribution Progress Bar */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span>Watershed Threat Distribution</span>
          <span className="font-mono text-slate-300">{criticalPct}% Critical</span>
        </div>
        <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden flex border border-slate-800">
          <div className="bg-emerald-500 transition-all duration-300" style={{ width: `${safePct}%` }} />
          <div className="bg-amber-400 transition-all duration-300" style={{ width: `${warningPct}%` }} />
          <div className="bg-red-500 transition-all duration-300" style={{ width: `${criticalPct}%` }} />
        </div>
        <div className="flex items-center justify-between text-[9px] font-mono text-slate-400 pt-0.5">
          <span className="text-emerald-400">Safe {safePct}%</span>
          <span className="text-amber-400">Warn {warningPct}%</span>
          <span className="text-red-400">Crit {criticalPct}%</span>
        </div>
      </div>
    </div>
  );
};
