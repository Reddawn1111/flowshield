import React from 'react';
import { Play, Pause, RotateCcw, FastForward, Clock } from 'lucide-react';

interface TimeEngineBarProps {
  currentHour: number;
  isRunning: boolean;
  speed: number;
  onTogglePlay: () => void;
  onReset: () => void;
  onSpeedChange: (newSpeed: number) => void;
  onScrubTime: (targetHour: number) => void;
}

export const TimeEngineBar: React.FC<TimeEngineBarProps> = ({
  currentHour,
  isRunning,
  speed,
  onTogglePlay,
  onReset,
  onSpeedChange,
  onScrubTime,
}) => {
  const hours = Math.floor(currentHour);
  const minutes = Math.floor((currentHour - hours) * 60);
  const formattedTime = `T+${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;

  return (
    <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800/90 p-3 rounded-2xl shadow-2xl flex flex-col gap-2 w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-cyan-400 font-mono font-bold tracking-wider">
          <Clock className="w-4 h-4 text-cyan-400" />
          <span>{formattedTime}</span>
          <span className="text-slate-500 font-normal">/ 24h</span>
        </div>

        {/* Speed Controls */}
        <div className="flex items-center gap-1 bg-slate-950/60 p-0.5 rounded-lg border border-slate-800/60">
          {[1, 5, 20].map((s) => (
            <button
              key={s}
              onClick={() => onSpeedChange(s)}
              className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-bold transition-all ${
                speed === s
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Scrubbable Time Slider */}
      <div className="relative flex items-center py-1">
        <input
          type="range"
          min="0"
          max="24"
          step="0.05"
          value={currentHour}
          onChange={(e) => onScrubTime(parseFloat(e.target.value))}
          className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
        />
        <div
          className="absolute left-0 top-1 h-2 bg-gradient-to-r from-cyan-500 to-sky-400 rounded-lg pointer-events-none opacity-40"
          style={{ width: `${(currentHour / 24) * 100}%` }}
        />
      </div>

      {/* Play / Pause / Reset Buttons */}
      <div className="flex items-center justify-center gap-3 pt-1">
        <button
          onClick={onReset}
          title="Reset Simulation Clock"
          className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-all text-xs flex items-center gap-1.5 font-medium"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>

        <button
          onClick={onTogglePlay}
          className={`px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-lg ${
            isRunning
              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
              : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-500/20'
          }`}
        >
          {isRunning ? (
            <>
              <Pause className="w-4 h-4 fill-current" />
              <span>Pause Simulation</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Start Simulation</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
