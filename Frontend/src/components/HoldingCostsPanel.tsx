'use client';

import { RotateCcw, Warehouse } from 'lucide-react';
import { DEFAULT_HOLDING_COSTS, type HoldingCosts } from '../lib/optimizationApi';

export function HoldingCostsPanel({ rates, busy, onChange }: {
  rates: HoldingCosts; busy: boolean; onChange: (rates: HoldingCosts) => void;
}) {
  const numberInput = (label: string, value: number, set: (rate: number) => void) => <label key={label}><span>{label}</span><input aria-label={label + ' holding cost rate'} type="number" min={0} max={100000} step={0.5} value={value} disabled={busy} onChange={e => {
    const rate = e.currentTarget.valueAsNumber;
    if (Number.isFinite(rate) && rate >= 0 && rate <= 100000) set(rate);
  }} /><small>USD / t / month</small></label>;
  return <section className="holding-cost-controls" aria-label="Holding cost rates">
    <header><div><span className="eyebrow">COST ASSUMPTIONS / NO OVERTIME</span><h2><Warehouse size={18} />Holding cost rates</h2></div><div>
      <button className="button" disabled={busy} onClick={() => onChange({ finished_goods: Object.fromEntries(Object.keys(rates.finished_goods).map(code => [code, 0])), raw_material: 0 })}>Set holding costs to 0</button>
      <button className="icon-button" title="Restore demo holding rates" aria-label="Restore demo holding rates" disabled={busy} onClick={() => onChange(structuredClone(DEFAULT_HOLDING_COSTS))}><RotateCcw size={16} /></button>
    </div></header>
    <div className="holding-rate-grid">{Object.entries(rates.finished_goods).map(([code, rate]) => numberInput('FG ' + code, rate, value => onChange({ ...rates, finished_goods: { ...rates.finished_goods, [code]: value } })))}
      {numberInput('Raw material', rates.raw_material, value => onChange({ ...rates, raw_material: value }))}
    </div>
    <p>Monthly closing-stock rates / illustrative, not company-confirmed. Rate 0 removes holding charges from both reported costs and the objective; stock balances remain enforced.</p>
  </section>;
}
