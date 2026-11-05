import { Sparkles } from 'lucide-react';

import type { PresetType } from '../useScenarioSimulator';

// Benchmark presets (Capstone Slide 15)
export function PresetBar({ onApplyPreset }: { onApplyPreset: (preset: PresetType) => void }) {
  return (
    <section className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <Sparkles className="w-4 h-4 text-blue-600" />
        <span>Capstone Executive Presets:</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onApplyPreset('base')}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 transition-colors"
        >
          Preset 1: Base Case (10k, 0%)
        </button>
        <button
          onClick={() => onApplyPreset('surge')}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition-colors"
        >
          Preset 2: Demand Surge (+20%, No OT)
        </button>
        <button
          onClick={() => onApplyPreset('ot')}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors"
        >
          Preset 3: Add Overtime (+20% + OT)
        </button>
      </div>
    </section>
  );
}
