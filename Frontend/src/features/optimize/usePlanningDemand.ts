import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { describeFailure, getJson } from '@/lib/apiClient';
import { demandError, demandMonths, type DemoScenario, type MonthlyDemand, type PlanForm } from './planForm';

interface ProductDemandCell {
  month: string;
  tons: number | null;
  ordered_tons: number;
  group_ordered_tons: number;
  forecast_share: number;
}

interface DemandProduct {
  material_no: string;
  description: string;
  group_code: string;
  is_active: boolean;
  months: ProductDemandCell[];
}

function fetchProducts(first: string, months: number) {
  return getJson<DemandProduct[]>(`/api/v1/product-demand-grid?start_month=${first.slice(0, 7)}&months=${months}`);
}

export async function makeScenarioDemand({ form, gradeDemand }: DemoScenario): Promise<PlanForm> {
  const months = demandMonths(form);
  const products = await fetchProducts(months[0], months.length);
  const monthlyDemand: MonthlyDemand = {};
  for (const product of products) {
    for (const cell of product.months) {
      const total = Number(gradeDemand[cell.month]?.[product.group_code] ?? 0);
      const extra = Math.max(0, total - cell.group_ordered_tons) * cell.forecast_share;
      if (extra > 0) {
        (monthlyDemand[cell.month] ??= {})[product.material_no] = String(
          Math.round((cell.ordered_tons + extra) * 1000) / 1000,
        );
      }
    }
  }
  return { ...form, monthlyDemand };
}

export function usePlanningDemand(form: PlanForm, setForm: Dispatch<SetStateAction<PlanForm>>) {
  const months = demandMonths(form);
  const [first] = months;
  const count = months.length;
  const scope = `${first}/${count}`;
  const latest = useRef(0);
  const [snapshot, setSnapshot] = useState<{ scope: string; products: DemandProduct[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (fill = false) => {
    const seq = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const products = await fetchProducts(first, count);
      if (seq !== latest.current) return;
      setSnapshot({ scope, products });
      if (fill) {
        setForm((previous) => {
          const previousMonths = demandMonths(previous);
          if (previousMonths[0] !== first || previousMonths.length !== count) return previous;
          const monthlyDemand = { ...previous.monthlyDemand };
          for (const month of previousMonths) monthlyDemand[month] = {};
          for (const product of products) {
            for (const cell of product.months) {
              if (cell.tons !== null && cell.tons > cell.ordered_tons) {
                monthlyDemand[cell.month][product.material_no] = String(cell.tons);
              }
            }
          }
          return { ...previous, monthlyDemand };
        });
      }
    } catch (err) {
      if (seq === latest.current) setError(describeFailure(err));
    } finally {
      if (seq === latest.current) setLoading(false);
    }
  }, [first, count, scope, setForm]);

  useEffect(() => {
    void load();
    return () => { latest.current += 1; };
  }, [load]);

  const products = snapshot?.scope === scope ? snapshot.products : [];
  const floors: Record<string, Record<string, number>> = {};
  for (const product of products) {
    for (const cell of product.months) (floors[cell.month] ??= {})[product.material_no] = cell.ordered_tons;
  }
  const invalid = months.some((month) => Object.entries(form.monthlyDemand[month] ?? {}).some(
    ([material, raw]) => demandError(raw, floors[month]?.[material] ?? 0) !== null,
  ));

  function update(month: string, material: string, raw: string) {
    setForm((previous) => ({
      ...previous,
      monthlyDemand: {
        ...previous.monthlyDemand,
        [month]: { ...previous.monthlyDemand[month], [material]: raw },
      },
    }));
  }

  return { months, products, floors, loading, error, invalid, load, update };
}
