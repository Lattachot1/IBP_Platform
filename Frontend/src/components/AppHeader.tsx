'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Database, Factory, LayoutDashboard } from 'lucide-react';
import { getJson } from '@/lib/apiClient';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/optimize', label: 'Production Optimization', icon: Factory },
  { href: '/planning-data', label: 'Planning Data', icon: Database },
];

/** Shared app header: brand, the three pages and a live backend dot. */
export function AppHeader() {
  const pathname = usePathname();
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    getJson<{ status: string }>('/api/health')
      .then(() => {
        if (alive) setOnline(true);
      })
      .catch(() => {
        if (alive) setOnline(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <header className="bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 text-white border-b border-slate-800 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-black text-lg tracking-wider text-white">
            UBE
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight text-white leading-tight">UBE IBP Platform</div>
            <div className="text-xs text-slate-300">
              UBE Chemicals (Asia) PCL · &quot;One Platform · One Data · One Plan&quot;
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs font-semibold">
          <nav className="flex items-center gap-2 flex-wrap" aria-label="Main">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={
                    'px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors border ' +
                    (active
                      ? 'bg-sky-100 text-slate-900 border-sky-200'
                      : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-white')
                  }
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-slate-300">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                online === true ? 'bg-emerald-400' : online === false ? 'bg-slate-400' : 'bg-amber-400'
              }`}
            />
            <span>{online === true ? 'Backend online' : online === false ? 'Backend offline' : 'Connecting…'}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
