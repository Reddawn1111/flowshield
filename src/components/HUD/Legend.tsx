import React from 'react';

export const Legend: React.FC = () => {
  return (
    <div className="bg-slate-900/85 backdrop-blur-md border border-slate-800/90 p-3 rounded-2xl shadow-xl flex flex-col gap-2 text-xs">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        3D Visual Legend
      </span>
      <div className="flex flex-col gap-1.5 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-[#1e2430] border border-slate-700" />
          <span className="text-slate-300">Road Corridors (Asphalt)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-[#334155] border border-slate-400" />
          <span className="text-slate-300">3D River Bridges & Viaducts</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-gradient-to-t from-[#334155] to-[#cbd5e1] border border-slate-700" />
          <span className="text-slate-300">Dry Terrain & Towers</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-[#00E5FF] shadow-[0_0_8px_rgba(0,229,255,0.7)]" />
          <span className="text-slate-300 font-semibold text-cyan-400">Water (0.05m - 0.4m)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-[#FFB300]" />
          <span className="text-slate-300">Warning (0.1m - 0.25m)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-[#FF1744] shadow-[0_0_8px_rgba(255,23,68,0.8)]" />
          <span className="text-slate-300 font-semibold text-red-400">Critical Threat (&ge; 0.4m)</span>
        </div>
        <div className="flex items-center gap-2 pt-1 border-t border-slate-800">
          <span className="text-[10px]">🏥 ⚡ 🚇</span>
          <span className="text-slate-400 text-[10px]">Floating Lifeline Beacons</span>
        </div>
      </div>
    </div>
  );
};
