import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

import type { ToastMessage } from '../useScenarioSimulator';

export function Toast({ toastMessage }: { toastMessage: ToastMessage }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 transition-all transform ease-out duration-300">
      <div
        className={`px-4 py-3 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 border ${
          toastMessage.type === 'success'
            ? 'bg-emerald-600 text-white border-emerald-500'
            : toastMessage.type === 'error'
            ? 'bg-rose-600 text-white border-rose-500'
            : 'bg-slate-800 text-white border-slate-700'
        }`}
      >
        {toastMessage.type === 'success' && <CheckCircle2 className="w-5 h-5" />}
        {toastMessage.type === 'error' && <AlertTriangle className="w-5 h-5" />}
        {toastMessage.type === 'info' && <Info className="w-5 h-5" />}
        <span>{toastMessage.text}</span>
      </div>
    </div>
  );
}
