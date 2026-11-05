import { dispOf } from '../samplePlan';
import { formatNumber } from '@/lib/format';
import type { OptimizePlan } from '../useOptimizePlan';
import type { OptimizeResult } from '../types';

// Collapsible day-by-day table
export function DayByDayTable({ plan, view }: { plan: OptimizePlan; view: OptimizeResult }) {
  const { grades, conflictDays } = plan;
  return (
    <section className="opt-panel opt-details" aria-label="Day-by-day table">
      <details className="opt-details">
        <summary>Full day-by-day plan ({view.days.length} rows)</summary>
        <div className="opt-twrap">
          <table className="opt-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Grades (tons)</th>
                <th>Type</th>
                <th>Reactor</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {view.days.map((d, i) => (
                <tr key={d.iso} className={conflictDays.has(i) ? 'conflict' : ''}>
                  <td className={'mono' + (d.wknd ? ' wknd' : '')}>{d.date} · {d.wd}</td>
                  <td className="mono">
                    {d.parts
                      .map((p, k) => {
                        let seg = `${dispOf(p.grade, grades)} ${formatNumber(p.tons)}`;
                        if (d.chg && k === d.parts.length - 1 && d.parts.length > 1) {
                          seg += ` ≤ total ${formatNumber(d.cap ?? 0)}`;
                        }
                        return seg;
                      })
                      .join(' + ')}
                    {d.products && d.products.length > 0 && (
                      <div className="opt-dayprod">
                        {d.products.map((p) => `${p.material_no} ${formatNumber(p.tons)}`).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`opt-chip ${d.chg ? 'chg' : 'run'}`}>
                      {d.chg ? 'Changeover' : 'Production'}
                    </span>
                  </td>
                  <td className="mono">{d.rx}</td>
                  <td className={d.wknd ? 'wknd' : ''}>{d.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
