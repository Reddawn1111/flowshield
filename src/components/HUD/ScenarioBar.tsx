import React from 'react';
import { CloudRain, AlertTriangle, Cpu, Droplets } from 'lucide-react';
import { ScenarioPreset } from '../../types/simulation';
import { SCENARIO_PRESETS } from '../../engine/scenarios';

interface ScenarioBarProps {
  currentScenario: string;
  rainfallRate: number;
  onSelectScenario: (scenario: ScenarioPreset) => void;
  onRainfallChange: (rate: number) => void;
}

export const ScenarioBar: React.FC<ScenarioBarProps> = ({
  currentScenario,
  rainfallRate,
  onSelectScenario,
  onRainfallChange,
}) => {
  return (
    <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800/90 p-3 rounded-2xl shadow-2xl flex flex-col gap-2.5 w-80">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
          <CloudRain className="w-4 h-4 text-cyan-400" />
          <span>Scenarios</span>
        </span>
        <span className="text-[11px] font-mono text-cyan-400 font-bold bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20">
          {rainfallRate} mm/hr
        </span>
      </div>

      {/* Scenario Buttons */}
      <div className="grid grid-cols-2 gap-1.5">
        {SCENARIO_PRESETS.map((preset) => {
          const isActive = currentScenario === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => onSelectScenario(preset)}
              className={`p-2 rounded-xl text-left transition-all border flex flex-col gap-1 ${
                isActive
                  ? 'bg-cyan-500/15 border-cyan-500/60 text-white shadow-sm'
                  : 'bg-slate-950/40 border-slate-800/70 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[11px] font-semibold leading-tight line-clamp-1">{preset.name}</span>
                {preset.tag === 'Severe' && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />}
                {preset.tag === 'Failure' && <Cpu className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                {preset.tag === 'Surge' && <Droplets className="w-3 h-3 text-cyan-400 flex-shrink-0" />}
              </div>
              <span className="text-[9px] font-mono text-slate-500">{preset.rainfallRate} mm/hr</span>
            </button>
          );
        })}
      </div>

      {/* Manual Rainfall Rate Override Slider */}
      <div className="pt-1 border-t border-slate-800/80">
        <div className="flex justify-between text-[10px] text-slate-400 mb-1">
          <span>Manual Rain Dial</span>
          <span className="font-mono text-cyan-400">{rainfallRate} mm/hr</span>
        </div>
        <input
          type="range"
          min="0"
          max="120"
          step="5"
          value={rainfallRate}
          onChange={(e) => onRainfallChange(parseFloat(e.target.value))}
          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
        />
      </div>
    </div>
  );
};
