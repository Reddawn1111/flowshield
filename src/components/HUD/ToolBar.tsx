import React from 'react';
import { MousePointer, ShieldPlus, AlertTriangle, Trash2 } from 'lucide-react';

interface ToolBarProps {
  activeTool: 'inspect' | 'sandbag' | 'obstruct';
  onSelectTool: (tool: 'inspect' | 'sandbag' | 'obstruct') => void;
  onClearSandbags: () => void;
}

export const ToolBar: React.FC<ToolBarProps> = ({
  activeTool,
  onSelectTool,
  onClearSandbags,
}) => {
  return (
    <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800/90 p-1.5 rounded-2xl shadow-xl flex items-center gap-1 text-xs">
      <button
        onClick={() => onSelectTool('inspect')}
        title="Inspect Mode: Click any column to view elevation & water depth"
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl transition-all font-medium ${
          activeTool === 'inspect'
            ? 'bg-cyan-500 text-slate-950 shadow-md font-bold'
            : 'text-slate-300 hover:text-white hover:bg-slate-800'
        }`}
      >
        <MousePointer className="w-3.5 h-3.5" />
        <span>Inspect</span>
      </button>

      <button
        onClick={() => onSelectTool('sandbag')}
        title="Defense Tool: Click on 3D terrain to erect sandbag flood barriers"
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl transition-all font-medium ${
          activeTool === 'sandbag'
            ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
            : 'text-slate-300 hover:text-white hover:bg-slate-800'
        }`}
      >
        <ShieldPlus className="w-3.5 h-3.5" />
        <span>Place Barrier</span>
      </button>

      <button
        onClick={() => onSelectTool('obstruct')}
        title="Failure Tool: Click to simulate a clogged stormwater canal/culvert"
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl transition-all font-medium ${
          activeTool === 'obstruct'
            ? 'bg-red-500 text-white shadow-md font-bold'
            : 'text-slate-300 hover:text-white hover:bg-slate-800'
        }`}
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        <span>Clog Drain</span>
      </button>

      <div className="w-px h-5 bg-slate-800 mx-1" />

      <button
        onClick={onClearSandbags}
        title="Reset all sandbag barriers and drain clogs"
        className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
