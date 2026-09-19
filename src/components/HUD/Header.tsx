import React from 'react';
import { Activity, ShieldAlert, Waves, RotateCcw, HelpCircle, Globe, MapPin } from 'lucide-react';

interface HeaderProps {
  isRunning: boolean;
  currentLocationName: string;
  onResetScene: () => void;
  onOpenHelp: () => void;
  onOpenMainMenu: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isRunning,
  currentLocationName,
  onResetScene,
  onOpenHelp,
  onOpenMainMenu,
}) => {
  return (
    <header className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none z-20">
      {/* Brand & Title */}
      <div className="flex items-center gap-3 bg-slate-900/85 backdrop-blur-md border border-slate-800/80 px-4 py-2.5 rounded-xl shadow-2xl pointer-events-auto">
        <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
          <Waves className="w-5 h-5 animate-pulse" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-sky-200 to-white bg-clip-text text-transparent">
              FLOWSHIELD
            </h1>
            <span className="text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              3D Hydrodynamic
            </span>
          </div>
          <p className="text-[11px] text-slate-400">
            Flood Simulation & Early Warning Command Center
          </p>
        </div>
      </div>

      {/* Center Location Pill */}
      <button
        onClick={onOpenMainMenu}
        className="hidden md:flex items-center gap-2.5 bg-slate-900/90 hover:bg-slate-800/90 border border-cyan-500/40 hover:border-cyan-400 px-4 py-2 rounded-xl text-xs font-mono text-cyan-300 hover:text-white transition-all shadow-[0_0_15px_rgba(0,240,255,0.15)] pointer-events-auto group cursor-pointer"
        title="Click to Change Location in Main Menu"
      >
        <MapPin className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" />
        <span className="font-bold tracking-wide">{currentLocationName}</span>
        <span className="text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
          Switch Location
        </span>
      </button>

      {/* Status & Quick Actions */}
      <div className="flex items-center gap-2 pointer-events-auto">
        {/* Main Menu / Change Location Button */}
        <button
          onClick={onOpenMainMenu}
          className="flex items-center gap-2 bg-gradient-to-r from-cyan-500/20 to-blue-600/20 hover:from-cyan-500/30 hover:to-blue-600/30 text-cyan-300 hover:text-white border border-cyan-500/40 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-lg transition-all"
          title="Open Location & Mission Portal"
        >
          <Globe className="w-4 h-4 text-cyan-400" />
          <span className="hidden sm:inline">Main Menu</span>
        </button>

        <div className="flex items-center gap-2 bg-slate-900/85 backdrop-blur-md border border-slate-800/80 px-3.5 py-2 rounded-xl text-xs font-mono">
          <span className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-cyan-400 animate-ping' : 'bg-emerald-400'}`} />
          <span className="text-slate-300 font-semibold tracking-wide">
            {isRunning ? 'SIMULATION ACTIVE' : 'SYSTEM READY'}
          </span>
        </div>

        <button
          onClick={onResetScene}
          title="Reset Simulation"
          className="p-2.5 rounded-xl bg-slate-900/85 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-all shadow-lg"
        >
          <RotateCcw className="w-4 h-4" />
        </button>

        <button
          onClick={onOpenHelp}
          title="Guide & Reference"
          className="p-2.5 rounded-xl bg-slate-900/85 hover:bg-slate-800 text-slate-300 hover:text-cyan-400 border border-slate-800 transition-all shadow-lg"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
