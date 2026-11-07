'use client';

import { CsvImportPanel } from '@/features/planning-data/components/CsvImportPanel';
import { PlanningDataHeader } from '@/features/planning-data/components/PlanningDataHeader';
import { ProductMaster } from '@/features/planning-data/components/ProductMaster';
import { useCsvImport, usePlanningViews, useProductMaster } from '@/features/planning-data/usePlanningData';

export default function PlanningDataPage() {
  const master = useProductMaster();
  const views = usePlanningViews();
  const imports = useCsvImport(() => void views.refresh());

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      <PlanningDataHeader />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* One table per product: master data and its planning inputs together */}
        <ProductMaster master={master} views={views} />
        <CsvImportPanel imp={imports} />
      </main>
    </div>
  );
}
