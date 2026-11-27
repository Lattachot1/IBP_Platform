import { useState } from 'react';
import { demandError } from '../planForm';
import type { OptimizePlan } from '../useOptimizePlan';

const tonsFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

export function DemandInputs({ plan }: { plan: OptimizePlan }) {
  const { form, grades, solving, demand } = plan;
  const { months, products, floors, loading, error, load, update } = demand;
  const [group, setGroup] = useState('');
  const visible = group ? products.filter((product) => product.group_code === group) : products;

  return (
    <div>
      <button type="button" className="opt-addbtn" onClick={() => void load(true)} disabled={loading || solving}>
        {loading ? 'Loading planning data…' : 'Load from Planning Data'}
      </button>
      {error && <p role="alert" className="opt-railnote text-rose-600">Could not load planning data: {error}</p>}
      <div className="opt-field mt-2">
        <label htmlFor="opt-demand-group">Filter products by grade</label>
        <select id="opt-demand-group" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">All products</option>
          {grades.filter((grade) => products.some((product) => product.group_code === grade.id)).map((grade) => (
            <option key={grade.id} value={grade.id}>{grade.disp}</option>
          ))}
        </select>
      </div>
      {demand.invalid && (
        <p role="alert" className="opt-railnote text-rose-700">Correct the highlighted demand before running the plan.</p>
      )}
      <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-[11px] text-slate-700" aria-label="Monthly demand in tons per product">
          <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-2 py-1.5">Product</th>
              {months.map((month) => (
                <th key={month} scope="col" className="whitespace-nowrap px-2 py-1.5 text-right">
                  {month.slice(5, 7)}/{month.slice(0, 4)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((product) => (
              <tr key={product.material_no}>
                <th scope="row" className="sticky left-0 min-w-24 bg-white px-2 py-1 font-semibold">
                  <span title={product.material_no}>{product.description}</span>
                  <div className="font-normal text-slate-500">
                    {product.group_code}{!product.is_active && ' · orders only'}
                  </div>
                </th>
                {months.map((month) => {
                  const floor = floors[month]?.[product.material_no];
                  const raw = form.monthlyDemand[month]?.[product.material_no];
                  const issue = demandError(raw ?? '', floor ?? 0);
                  const noteId = `demand-${product.material_no}-${month}`;
                  return (
                    <td key={month} className="px-2 py-1 text-right align-top">
                      <input
                        aria-label={`Demand ${product.description} ${month.slice(0, 7)}`}
                        aria-describedby={noteId}
                        aria-invalid={issue ? true : undefined}
                        className={`w-20 rounded border px-1.5 py-0.5 text-right font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 ${issue ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`}
                        inputMode="decimal"
                        value={raw ?? (floor !== undefined ? String(floor) : '')}
                        placeholder={floor !== undefined ? String(floor) : '—'}
                        disabled={loading || !product.is_active}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => update(month, product.material_no, e.target.value)}
                      />
                      <div id={noteId} className={`mt-0.5 text-[10px] ${issue ? 'text-rose-700' : 'text-slate-500'}`}>
                        {floor !== undefined ? `Orders: ${tonsFormat.format(floor)} t` : 'Orders: —'}
                        {issue && <div>{issue}</div>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={months.length + 1} className="px-2 py-3 text-slate-500">
                  {loading ? 'Loading products…' : 'No active products to plan.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="opt-railnote">
        Load from Planning Data splits extra forecast by this month&apos;s order mix, using earlier orders when needed.
        Actual orders keep their due dates. Demand above each product&apos;s order total is due by month end.
      </p>
    </div>
  );
}
