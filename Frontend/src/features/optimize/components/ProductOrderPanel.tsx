import { formatNumber } from '@/lib/format';
import { nameOf, type OptimizePlan } from '../useOptimizePlan';
import type { OptimizeResult } from '../types';

// Production order by product: tons of EACH product on EACH day, with row
// and column totals - the actionable answer to "what do we produce?".
// Shown whenever the plan carries a per-product split (planning-data mode
// or tons-per-product mode); hidden for a plain group-level plan.
export function ProductOrderPanel({ plan, view }: { plan: OptimizePlan; view: OptimizeResult }) {
  const { grades, productNames } = plan;
  const days = view.days;
  if (!days.some((d) => d.products && d.products.length > 0)) return null;

  // products in first-appearance order, with their group (for the color dot)
  const order: { material_no: string; group: string; slot: number }[] = [];
  const byMaterial: Record<string, { group: string; slot: number }> = {};
  for (const d of days) {
    for (const p of d.products ?? []) {
      if (byMaterial[p.material_no]) continue;
      const planned = view.planning?.products.find((q) => q.material_no === p.material_no);
      const fulfilled = view.product_fulfillment?.find((q) => q.material_no === p.material_no);
      const group = planned?.group ?? fulfilled?.group ?? '';
      const slot = grades.find((g) => g.id === group)?.slot ?? grades.length + 1;
      byMaterial[p.material_no] = { group, slot };
      order.push({ material_no: p.material_no, group, slot });
    }
  }

  const tonsOf = (d: (typeof days)[number], material: string) =>
    d.products?.find((p) => p.material_no === material)?.tons ?? 0;
  const dayTotal = (d: (typeof days)[number]) =>
    (d.products ?? []).reduce((a, p) => a + p.tons, 0);
  const rowTotal = (material: string) =>
    days.reduce((a, d) => a + tonsOf(d, material), 0);
  const grand = days.reduce((a, d) => a + dayTotal(d), 0);

  return (
    <section className="opt-panel" aria-label="Production order by product">
      <h2 className="opt-ph">Production order by product (tons per day)</h2>
      <div className="opt-orderwrap">
        <table className="opt-ordertable">
          <thead>
            <tr>
              <th>Product</th>
              {days.map((d, i) => (
                <th key={d.iso} className={d.wknd ? 'wknd' : ''} title={`${d.date} · ${d.wd}${d.chg ? ' · changeover' : ''}`}>
                  {i + 1}
                  <span className="opt-ordwd">{d.wd.slice(0, 2)}</span>
                </th>
              ))}
              <th className="opt-ordtot">Total</th>
            </tr>
          </thead>
          <tbody>
            {order.map(({ material_no, slot }) => {
              const total = rowTotal(material_no);
              return (
                <tr key={material_no}>
                  <td>
                    <span className="opt-gcode">
                      <i className="opt-dot" style={{ background: `var(--s${slot})` }} />
                      <span title={nameOf(productNames, material_no)}>{nameOf(productNames, material_no)}</span>
                    </span>
                  </td>
                  {days.map((d) => {
                    const tons = tonsOf(d, material_no);
                    return (
                      <td key={d.iso} className={tons ? 'mono' : 'zero' + (d.wknd ? ' wknd' : '')}>
                        {tons ? formatNumber(tons) : '·'}
                      </td>
                    );
                  })}
                  <td className="mono opt-ordtot">{formatNumber(total)}</td>
                </tr>
              );
            })}
            <tr className="total">
              <td>All products</td>
              {days.map((d) => (
                <td key={d.iso} className={d.wknd ? 'wknd' : ''}>{formatNumber(dayTotal(d))}</td>
              ))}
              <td className="opt-ordtot">{formatNumber(grand)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="opt-railnote">
        Tons of each product to produce per day (QC release lands {view.planning?.qc_days ?? 5} days later).
        Weekends are grey; the Total column is the production order per product for this plan.
      </p>
    </section>
  );
}
