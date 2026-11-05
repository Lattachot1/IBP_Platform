import Link from 'next/link';
import { Database, Factory, Layers } from 'lucide-react';

export function DashboardHeader({ backendOnline }: { backendOnline: boolean | null }) {
  return (
    <header className="bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 text-white border-b border-slate-800 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-inner font-black text-xl tracking-wider text-white">
              UBE
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                  Integrated Business Planning (IBP) Platform
                </h1>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  PoC v1.0
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-300 mt-0.5 flex items-center gap-2">
                <span className="text-blue-400 font-semibold">UBE Chemicals (Asia) PCL</span>
                <span className="text-slate-500">•</span>
                <span>&quot;One Platform · One Data · One Plan&quot;</span>
                <span className="text-slate-500">•</span>
                <span className="text-amber-400 font-medium">Topic 45 | Team CALTLAPSE</span>
              </p>
            </div>
          </div>

          {/* Status & Actions */}
          <div className="flex items-center gap-3 self-end md:self-auto">
            <Link
              href="/planning-data"
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <Database className="w-3.5 h-3.5" />
              Planning Data
            </Link>
            <Link
              href="/optimize"
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <Factory className="w-3.5 h-3.5" />
              Production Optimization
            </Link>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs text-slate-300">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  backendOnline === true
                    ? 'bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400'
                    : backendOnline === false
                    ? 'bg-amber-400'
                    : 'bg-slate-400'
                }`}
              />
              <span>
                {backendOnline === true
                  ? 'Backend Live (Port 8080)'
                  : backendOnline === false
                  ? 'Backend Offline'
                  : 'Connecting Engine...'}
              </span>
            </div>

            <div className="px-3 py-1.5 rounded-lg bg-blue-900/40 border border-blue-700/50 text-xs font-medium text-blue-200 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-blue-400" />
              <span>Pilot Product Family: Line A</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
