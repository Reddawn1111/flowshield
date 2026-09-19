import React from 'react';
import { CloudRain, Droplets, CloudDrizzle } from 'lucide-react';

interface RainSliderProps {
  rainfallRate: number;
  onRainfallChange: (rate: number) => void;
}

export const RainSlider: React.FC<RainSliderProps> = ({
  rainfallRate,
  onRainfallChange,
}) => {
  const getIntensityLabel = (rate: number) => {
    if (rate === 0) return { label: 'Dry (0 mm/hr)', color: 'text-slate-400', bg: 'bg-slate-800/80 border-slate-700' };
    if (rate <= 30) return { label: 'Moderate Rain', color: 'text-sky-400', bg: 'bg-sky-500/15 border-sky-500/30' };
    if (rate <= 70) return { label: 'Heavy Downpour', color: 'text-cyan-400', bg: 'bg-cyan-500/15 border-cyan-500/30' };
    if (rate <= 110) return { label: 'Severe Cloudburst', color: 'text-amber-400', bg: 'bg-amber-500/15 border-amber-500/30' };
    return { label: 'Extreme Torrential Storm', color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/30' };
  };

  const intensity = getIntensityLabel(rainfallRate);

  const quickPresets = [
    { label: '0 mm/h', value: 0 },
    { label: '25 mm/h', value: 25 },
    { label: '65 mm/h', value: 65 },
    { label: '110 mm/h', value: 110 },
  ];

  return (
    <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800/90 p-4 rounded-2xl shadow-2xl flex flex-col gap-3 w-80 select-none">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
          {rainfallRate === 0 ? (
            <CloudDrizzle className="w-4 h-4 text-slate-400" />
          ) : rainfallRate > 70 ? (
            <CloudRain className="w-4 h-4 text-amber-400 animate-pulse" />
          ) : (
            <Droplets className="w-4 h-4 text-cyan-400" />
          )}
          <span>Precipitation Dial</span>
        </span>
        <span className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${intensity.bg} ${intensity.color}`}>
          {rainfallRate} mm/hr
        </span>
      </div>

      {/* Intensity Badge */}
      <div className="flex items-center justify-between text-xs px-1">
        <span className="text-[11px] text-slate-400">Current Storm Regime:</span>
        <span className={`font-semibold text-[11px] ${intensity.color}`}>
          {intensity.label}
        </span>
      </div>

      {/* Slider Input */}
      <div className="px-1 flex flex-col gap-1.5">
        <input
          type="range"
          min="0"
          max="150"
          step="5"
          value={rainfallRate}
          onChange={(e) => onRainfallChange(parseFloat(e.target.value))}
          className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none shadow-inner"
        />
        <div className="flex justify-between text-[9px] font-mono text-slate-500">
          <span>0 (Dry)</span>
          <span>50 mm/h</span>
          <span>100 mm/h</span>
          <span>150 (Extreme)</span>
        </div>
      </div>

      {/* Quick Dial Presets */}
      <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-slate-800/80">
        {quickPresets.map((preset) => {
          const isSelected = rainfallRate === preset.value;
          return (
            <button
              key={preset.value}
              type="button"
              onClick={() => onRainfallChange(preset.value)}
              className={`py-1 px-1 rounded-lg text-center text-[10px] font-mono font-medium transition-all border ${
                isSelected
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-[0_0_10px_rgba(0,240,255,0.2)]'
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
