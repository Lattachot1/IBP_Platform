import Link from 'next/link';
import { Factory, LayoutDashboard } from 'lucide-react';

export function PlanningDataHeader() {
  return (
    <header className="bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 text-white border-b border-slate-800 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Planning Data</h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-0.5">
            Product master, stock, lots in QC, sales orders and the monthly forecast that the product-level plan is built from
          </p>
        </div>
        <nav className="flex items-center gap-2 text-xs font-semibold">
          <Link href="/" className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center gap-1.5">
            <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard
          </Link>
          <Link href="/optimize" className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 flex items-center gap-1.5">
            <Factory className="w-3.5 h-3.5" /> Production Optimization
          </Link>
        </nav>
      </div>
    </header>
  );
}
