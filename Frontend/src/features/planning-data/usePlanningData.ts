'use client';

import { useCallback, useEffect, useState } from 'react';

import { describeFailure } from '@/lib/apiClient';

import {
  ImportRejected,
  createProduct,
  getForecasts,
  getQcLots,
  getSalesOrders,
  getStock,
  importCsv,
  listGroups,
  listProducts,
  updateProduct,
  setStockAdjustment as putStockAdjustment,
} from './api';
import type {
  Forecast,
  ImportKind,
  ImportReport,
  NewProduct,
  Product,
  ProductChange,
  ProductGroup,
  QcLot,
  SalesOrder,
  StockSnapshot,
} from './types';

const byGroupThenMaterial = (a: Product, b: Product) =>
  a.group_code.localeCompare(b.group_code) || a.material_no.localeCompare(b.material_no);

// ---------------------------------------------------------------------------
// Product master
// ---------------------------------------------------------------------------
export function useProductMaster() {
  const [products, setProducts] = useState<Product[]>([]);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** material number being saved, or 'new' while adding */
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, groupList] = await Promise.all([listProducts(), listGroups()]);
      setProducts(list);
      setGroups(groupList);
      setError(null);
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Save a change; resolves to an error message, or null when saved. */
  const save = useCallback(async (materialNo: string, change: ProductChange): Promise<string | null> => {
    setBusy(materialNo);
    try {
      const saved = await updateProduct(materialNo, change);
      setProducts((list) => list.map((p) => (p.material_no === materialNo ? saved : p)).sort(byGroupThenMaterial));
      return null;
    } catch (err) {
      return describeFailure(err);
    } finally {
      setBusy(null);
    }
  }, []);

  /** Add a product; resolves to an error message, or null when added. */
  const add = useCallback(async (product: NewProduct): Promise<string | null> => {
    setBusy('new');
    try {
      const created = await createProduct(product);
      setProducts((list) => [...list, created].sort(byGroupThenMaterial));
      return null;
    } catch (err) {
      return describeFailure(err);
    } finally {
      setBusy(null);
    }
  }, []);

  return { products, groups, loading, error, busy, refresh, save, add };
}

export type ProductMasterState = ReturnType<typeof useProductMaster>;

// ---------------------------------------------------------------------------
// CSV import: check (dry run) first, then import the same file
// ---------------------------------------------------------------------------
export type ImportPhase = 'idle' | 'checking' | 'checked' | 'rejected' | 'importing' | 'imported' | 'failed';

export function useCsvImport(onImported: (kind: ImportKind) => void) {
  const [kind, setKindState] = useState<ImportKind>('sales-orders');
  const [file, setFileState] = useState<File | null>(null);
  const [stockDate, setStockDateState] = useState('');
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reset = () => {
    setPhase('idle');
    setReport(null);
    setMessage(null);
  };
  // any change of input invalidates the last check
  const setKind = (value: ImportKind) => {
    setKindState(value);
    reset();
  };
  const setFile = (value: File | null) => {
    setFileState(value);
    reset();
  };
  const setStockDate = (value: string) => {
    setStockDateState(value);
    reset();
  };

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setPhase(dryRun ? 'checking' : 'importing');
    setMessage(null);
    try {
      const result = await importCsv(kind, file, { dryRun, stockDate: stockDate || undefined });
      setReport(result);
      setPhase(dryRun ? 'checked' : 'imported');
      if (!dryRun) onImported(kind);
    } catch (err) {
      if (err instanceof ImportRejected) {
        setReport(err.report);
        setMessage(err.message);
        setPhase('rejected');
      } else {
        setReport(null);
        setMessage(describeFailure(err));
        setPhase('failed');
      }
    }
  };

  return {
    kind,
    setKind,
    file,
    setFile,
    stockDate,
    setStockDate,
    phase,
    report,
    message,
    check: () => send(true),
    commit: () => send(false),
    canCheck: file !== null && phase !== 'checking' && phase !== 'importing',
    canImport: phase === 'checked',
  };
}

export type CsvImportState = ReturnType<typeof useCsvImport>;

// ---------------------------------------------------------------------------
// What is in the planning tables now
// ---------------------------------------------------------------------------
export function usePlanningViews() {
  const [stock, setStock] = useState<StockSnapshot | null>(null);
  const [lots, setLots] = useState<QcLot[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l, o, f] = await Promise.all([getStock(), getQcLots(), getSalesOrders(), getForecasts()]);
      setStock(s);
      setLots(l);
      setOrders(o);
      setForecasts(f);
      setError(null);
    } catch (err) {
      setError(describeFailure(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Hand-enter one material's stock (null clears it back to the imported
   * value); resolves to an error message, or null when saved. */
  const setStockAdjustment = useCallback(async (materialNo: string, tons: number | null): Promise<string | null> => {
    try {
      const row = await putStockAdjustment(materialNo, tons);
      setStock((s) => {
        if (!s) return s;
        const others = s.adjustments.filter((a) => a.material_no !== materialNo);
        return { ...s, adjustments: row ? [...others, row] : others };
      });
      return null;
    } catch (err) {
      return describeFailure(err);
    }
  }, []);

  return { stock, lots, orders, forecasts, loading, error, refresh, setStockAdjustment };
}

export type PlanningViewsState = ReturnType<typeof usePlanningViews>;
