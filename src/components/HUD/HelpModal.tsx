import React from 'react';
import { X, CheckCircle, Shield, Droplets, Cpu } from 'lucide-react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-xl w-full p-6 shadow-2xl flex flex-col gap-5 text-slate-200 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-cyan-400" />
            <h2 className="text-base font-extrabold text-white">
              FLOWSHIELD 3D Architecture & Demo Guide
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col gap-4 text-xs leading-relaxed max-h-[70vh] overflow-y-auto pr-1">
          {/* Mathematical Modeling */}
          <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 flex flex-col gap-2">
            <span className="font-bold text-cyan-400 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
              <Droplets className="w-4 h-4" /> 2D Hydrodynamic Physics Engine
            </span>
            <p className="text-slate-300">
              The simulation uses a 2D cellular hydrodynamic overland flow model solving continuity and shallow-water diffusive-wave mass transfer across an 80×80 column grid (6,400 cells):
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-400 font-mono text-[11px]">
              <li><strong>Precipitation</strong>: \(H \leftarrow H + (R / 1000) \cdot \Delta t\)</li>
              <li><strong>Drainage/Infiltration</strong>: \(H \leftarrow \max(0, H - (D / 1000) \cdot \Delta t)\)</li>
              <li><strong>Hydraulic Head</strong>: \(\eta = Z + H\) governs downhill flow across slope gradients</li>
              <li><strong>CFL Stability</strong>: Out-flux limiters preserve physical mass conservation</li>
            </ul>
          </div>

          {/* Visual Color Mapping */}
          <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800/80 flex flex-col gap-2">
            <span className="font-bold text-amber-400 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
              <Cpu className="w-4 h-4" /> Visual Design Matching
            </span>
            <p className="text-slate-300">
              The 3D canvas is built with Three.js <code className="text-cyan-400">InstancedMesh</code> atop a thick black beveled pedestal:
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
              <li><strong>Monochrome Grayscale</strong>: Base terrain elevation (dark riverbeds, lighter urban towers).</li>
              <li><strong>Vibrant Cyan (#00E5FF)</strong>: Dynamic flood accumulation in valleys and low-lying basins.</li>
              <li><strong>Vibrant Alert Red (#FF1744)</strong>: Critical risk threshold (H &ge; 0.4m or rapid water surge).</li>
              <li><strong>Electric Amber (#FFB300)</strong>: Early warning transition zones.</li>
            </ul>
          </div>

          {/* Demo Tips */}
          <div className="bg-cyan-500/10 p-3.5 rounded-2xl border border-cyan-500/30 flex flex-col gap-1.5">
            <span className="font-bold text-cyan-300 text-[11px] uppercase tracking-wider">
              💡 Presentation & Demo Walkthrough
            </span>
            <ol className="list-decimal list-inside space-y-1 text-slate-300">
              <li>Select <strong>"Torrential Flash Storm"</strong> and hit <strong>Play</strong> to see water collect in the cyan basin.</li>
              <li>Notice how the red critical alert lights up around the hospital and vulnerable residential blocks.</li>
              <li>Select the <strong>"Place Barrier"</strong> tool and click on columns around the basin to hold back the flood!</li>
              <li>Click any column in <strong>"Inspect"</strong> mode to see live height \(Z\), water depth \(H\), and risk status.</li>
            </ol>
          </div>
        </div>

        <div className="border-t border-slate-800 pt-3 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-500/20 transition-all"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
};
