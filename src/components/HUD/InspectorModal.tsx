import React from 'react';
import { X, MapPin, Mountain, Droplet, Gauge, Shield, AlertOctagon, TrendingUp, DollarSign, Users } from 'lucide-react';
import { Cell } from '../../types/simulation';
import { assessCell } from '../../engine/damageAssessment';

interface InspectorModalProps {
  cell: Cell | null;
  onClose: () => void;
  onToggleBarrier: (x: number, y: number) => void;
  onToggleObstruction: (x: number, y: number) => void;
}

export const InspectorModal: React.FC<InspectorModalProps> = ({
  cell,
  onClose,
  onToggleBarrier,
  onToggleObstruction,
}) => {
  if (!cell) return null;

  const getRiskBadge = () => {
    switch (cell.risk) {
      case 'critical':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">CRITICAL</span>;
      case 'warning':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">WARNING</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">SAFE</span>;
    }
  };

  // Compute per-cell damage assessment (null for non-building cells)
  const dmg = assessCell(cell);

  const formatLoss = (usd: number): string => {
    if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)} M`;
    if (usd >= 1_000)     return `$${(usd / 1_000).toFixed(1)} K`;
    return `$${usd.toFixed(0)}`;
  };

  // Damage ratio severity color
  const alphaColor = (alpha: number) => {
    if (alpha >= 0.55) return 'text-red-400';
    if (alpha >= 0.10) return 'text-amber-400';
    return 'text-emerald-400';
  };

  return (
    <div className="absolute top-20 right-4 bg-slate-900/95 backdrop-blur-md border border-slate-800 p-4 rounded-2xl shadow-2xl w-72 flex flex-col gap-3 z-30 animate-in fade-in duration-200">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
          <MapPin className="w-4 h-4 text-cyan-400" />
          <span>Column [{cell.x}, {cell.y}]</span>
        </div>
        <div className="flex items-center gap-2">
          {getRiskBadge()}
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {cell.criticalAsset && (
        <div className="bg-cyan-500/10 border border-cyan-500/25 px-2.5 py-1.5 rounded-xl text-xs font-bold text-cyan-300">
          📍 {cell.criticalAsset.name}
        </div>
      )}

      {/* Metrics List */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-950/50 p-2 rounded-xl border border-slate-800/60">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Mountain className="w-3 h-3 text-slate-400" /> Ground (Z)
          </span>
          <span className="text-sm font-mono font-bold text-slate-200 mt-0.5 block">
            {cell.z.toFixed(2)} m
          </span>
        </div>

        <div className="bg-slate-950/50 p-2 rounded-xl border border-slate-800/60">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Droplet className="w-3 h-3 text-cyan-400" /> Water Depth (H)
          </span>
          <span className="text-sm font-mono font-bold text-cyan-400 mt-0.5 block">
            {cell.h.toFixed(2)} m
          </span>
        </div>

        <div className="bg-slate-950/50 p-2 rounded-xl border border-slate-800/60">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Gauge className="w-3 h-3 text-slate-400" /> Drainage
          </span>
          <span className={`text-xs font-mono font-bold mt-0.5 block ${cell.isObstructed ? 'text-red-400' : 'text-emerald-400'}`}>
            {cell.isObstructed ? 'BLOCKED' : `${cell.drainageRate} mm/h`}
          </span>
        </div>

        <div className="bg-slate-950/50 p-2 rounded-xl border border-slate-800/60">
          <span className="text-[10px] text-slate-400 flex items-center gap-1">
            <Shield className="w-3 h-3 text-slate-400" /> Residents
          </span>
          <span className="text-xs font-mono font-bold text-slate-200 mt-0.5 block">
            {cell.population} pop
          </span>
        </div>
      </div>

      {/* ── Building Damage Analysis (only for building cells) ────────── */}
      {dmg && (
        <div className={`flex flex-col gap-2 rounded-xl border p-2.5 ${
          dmg.damageRatio >= 0.55
            ? 'bg-red-950/30 border-red-500/30'
            : dmg.damageRatio >= 0.10
            ? 'bg-amber-950/20 border-amber-500/25'
            : 'bg-slate-950/40 border-slate-800/60'
        }`}>
          {/* Section header */}
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800/60 pb-1.5">
            <AlertOctagon className="w-3 h-3 text-orange-400" />
            <span>Building Damage Analysis</span>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-1.5 text-[10px]">
            {/* GFA */}
            <div className="flex flex-col items-center bg-slate-900/60 rounded-lg px-1.5 py-1">
              <span className="text-slate-500 uppercase text-[8px] tracking-wide">GFA</span>
              <span className="font-mono font-bold text-slate-200">{dmg.gfa.toLocaleString()}</span>
              <span className="text-slate-600 text-[8px]">m²</span>
            </div>

            {/* Levels */}
            <div className="flex flex-col items-center bg-slate-900/60 rounded-lg px-1.5 py-1">
              <span className="text-slate-500 uppercase text-[8px] tracking-wide">Floors</span>
              <span className="font-mono font-bold text-slate-200">~{dmg.estimatedLevels}</span>
              <span className="text-slate-600 text-[8px]">lvl</span>
            </div>

            {/* Occupancy */}
            <div className="flex flex-col items-center bg-slate-900/60 rounded-lg px-1.5 py-1">
              <span className="text-slate-500 uppercase text-[8px] tracking-wide flex items-center gap-0.5">
                <Users className="w-2 h-2" />Occ.
              </span>
              <span className="font-mono font-bold text-slate-200">{dmg.occupancy}</span>
              <span className="text-slate-600 text-[8px]">persons</span>
            </div>
          </div>

          {/* Damage ratio + loss */}
          <div className="flex items-center justify-between bg-slate-900/60 rounded-lg px-2 py-1.5">
            <div className="flex flex-col">
              <span className="text-[9px] text-slate-500 uppercase tracking-wide flex items-center gap-0.5">
                <TrendingUp className="w-2.5 h-2.5" /> Damage α
              </span>
              <span className={`text-sm font-extrabold font-mono ${alphaColor(dmg.damageRatio)}`}>
                {(dmg.damageRatio * 100).toFixed(1)}%
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[9px] text-slate-500 uppercase tracking-wide flex items-center gap-0.5">
                <DollarSign className="w-2.5 h-2.5" /> Est. Loss
              </span>
              <span className={`text-sm font-extrabold font-mono ${
                dmg.buildingLossUSD > 500_000 ? 'text-red-400'
                : dmg.buildingLossUSD > 0 ? 'text-amber-400'
                : 'text-slate-500'
              }`}>
                {formatLoss(dmg.buildingLossUSD)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Actions for this Cell */}
      <div className="flex gap-2 pt-1 border-t border-slate-800">
        <button
          onClick={() => onToggleBarrier(cell.x, cell.y)}
          className={`flex-1 py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition-all ${
            cell.hasBarrier
              ? 'bg-amber-500/20 border-amber-500 text-amber-300'
              : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
          }`}
        >
          {cell.hasBarrier ? 'Remove Sandbags' : '+ Sandbag Barrier'}
        </button>

        <button
          onClick={() => onToggleObstruction(cell.x, cell.y)}
          className={`flex-1 py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition-all ${
            cell.isObstructed
              ? 'bg-red-500/20 border-red-500 text-red-300'
              : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
          }`}
        >
          {cell.isObstructed ? 'Clear Clog' : 'Block Drain'}
        </button>
      </div>
    </div>
  );
};
