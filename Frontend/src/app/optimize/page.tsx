'use client';

import { AssumptionsPanel } from '@/features/optimize/components/AssumptionsPanel';
import { ConstraintChecks } from '@/features/optimize/components/ConstraintChecks';
import { DayByDayTable } from '@/features/optimize/components/DayByDayTable';
import { FulfillmentPanel } from '@/features/optimize/components/FulfillmentPanel';
import { KpiStrip } from '@/features/optimize/components/KpiStrip';
import { LoadingNotice } from '@/features/optimize/components/LoadingNotice';
import { OptimizeHeader } from '@/features/optimize/components/OptimizeHeader';
import { PlanInputRail } from '@/features/optimize/components/PlanInputRail';
import { PlanTooltip } from '@/features/optimize/components/PlanTooltip';
import { ProductionGantt } from '@/features/optimize/components/ProductionGantt';
import { QuickScenarios } from '@/features/optimize/components/QuickScenarios';
import { StageHeader } from '@/features/optimize/components/StageHeader';
import { useOptimizePlan } from '@/features/optimize/useOptimizePlan';
import './optimize.css';

export default function OptimizePage() {
  const plan = useOptimizePlan();
  const { data, view, phase, tip } = plan;

  return (
    <div className="opt-root">
      <OptimizeHeader plan={plan} />

      {data && <QuickScenarios plan={plan} />}

      {data && view && (
        <div className="opt-shell">
          {/* ================= input rail ================= */}
          <PlanInputRail plan={plan} data={data} />

          {/* ================= main stage ================= */}
          <main className="opt-stage">
            <StageHeader plan={plan} view={view} />
            <KpiStrip plan={plan} view={view} />
            <ProductionGantt plan={plan} data={data} view={view} />
            <FulfillmentPanel view={view} />
            <ConstraintChecks plan={plan} view={view} />
            <DayByDayTable plan={plan} view={view} />
            <AssumptionsPanel view={view} />
          </main>
        </div>
      )}

      {phase === 'loading' && <LoadingNotice />}

      {tip && <PlanTooltip tip={tip} />}
    </div>
  );
}
