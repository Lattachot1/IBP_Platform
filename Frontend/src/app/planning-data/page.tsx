'use client';

import { AppHeader } from '@/components/AppHeader';
import { CsvImportPanel } from '@/features/planning-data/components/CsvImportPanel';
import { ProductMaster } from '@/features/planning-data/components/ProductMaster';
import { useCsvImport, usePlanningViews, useProductMaster } from '@/features/planning-data/usePlanningData';

export default function PlanningDataPage() {
  const master = useProductMaster();
  const views = usePlanningViews();
  const imports = useCsvImport(() => void views.refresh());

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      <AppHeader />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">Planning Data</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Product master, stock, lots in QC, sales orders and the monthly forecast that the product-level plan is built from
        </p>
      </div>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* One table per product: master data and its planning inputs together */}
        <ProductMaster master={master} views={views} />
        <CsvImportPanel imp={imports} />
      </main>
    </div>
  );
}
