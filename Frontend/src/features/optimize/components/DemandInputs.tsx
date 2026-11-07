import { useState } from 'react';

import { formatNumber } from '@/lib/format';

import { groupDemand, groupUsesProducts, type PlanForm } from '../planForm';
import type { CatalogGroup, GradeMeta } from '../types';

interface DemandInputsProps {
  form: PlanForm;
  grades: GradeMeta[];
  /** groups with their products; null = no product master (group fields only) */
  catalog: CatalogGroup[] | null;
  updateDemand: (grade: string, raw: string) => void;
  updateProductDemand: (group: string, material: string, raw: string) => void;
}

// Demand per group, each group expandable into its products: once a product
// row holds tons the group total is their sum.
export function DemandInputs({ form, grades, catalog, updateDemand, updateProductDemand }: DemandInputsProps) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      {grades.map((g) => {
        const products = catalog?.find((c) => c.id === g.id)?.products ?? [];
        const expanded = open.has(g.id);
        const fromProducts = groupUsesProducts(form, g.id);
        return (
          <div key={g.id} className={'opt-demandgroup' + (expanded ? ' open' : '')}>
            <div className="opt-demandrow">
              <span className="opt-gcode">
                {products.length > 0 ? (
                  <button type="button" className="opt-expand" aria-expanded={expanded}
                    aria-label={`${expanded ? 'Hide' : 'Show'} the products of ${g.disp}`} onClick={() => toggle(g.id)}>
                    {expanded ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="opt-expand-gap" />
                )}
                <i className="opt-dot" style={{ background: `var(--s${g.slot})` }} />
                {g.disp}
              </span>
              <input
                type="number"
                min={0}
                value={fromProducts ? groupDemand(form, g.id) : form.demand[g.id] ?? 0}
                readOnly={fromProducts}
                className={fromProducts ? 'opt-sum' : undefined}
                title={fromProducts ? 'Sum of the product rows — clear them to type the group total again' : undefined}
                onChange={(e) => updateDemand(g.id, e.target.value)}
                aria-label={`demand ${g.disp}`}
              />
            </div>
            {expanded && (
              <div className="opt-prodrows">
                {products.map((p) => {
                  const value = form.productDemand[g.id]?.[p.material_no];
                  return (
                    <div className="opt-demandrow opt-prodrow" key={p.material_no}>
                      <span className="opt-pcode" title={p.description}>{p.description}</span>
                      <input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={value ? value : ''}
                        onChange={(e) => updateProductDemand(g.id, p.material_no, e.target.value)}
                        aria-label={`demand ${p.description}`}
                      />
                    </div>
                  );
                })}
                <p className="opt-railnote opt-prodnote">
                  {fromProducts
                    ? `${g.disp} = sum of its products (${formatNumber(groupDemand(form, g.id))} t). Clear them to type the group total again.`
                    : 'Type tons per product to build the group total from them.'}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
