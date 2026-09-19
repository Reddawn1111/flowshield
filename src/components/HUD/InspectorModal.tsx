import React from 'react';
import { X, MapPin, Mountain, Droplet, Gauge, Shield, AlertOctagon } from 'lucide-react';
import { Cell } from '../../types/simulation';

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
