'use client';
import { createContext, useContext, useMemo, useRef, useState, type ReactNode, type SetStateAction } from 'react';
import { copyScenario, evaluateScenario, initialScenario, validScenario, type ScenarioSnapshot } from '../lib/connectedScenario';
import type { ManualPlan, PlanAssumptions } from '../lib/manualPlanning';

function useScenarioState() {
  const seed = useRef(initialScenario()).current;
  const [state, setState] = useState<ScenarioSnapshot>(seed);
  const latest = useRef(state); latest.current = state;
  const [previewPlan, setPreviewPlan] = useState<ManualPlan | null>(null);
  const [past, setPast] = useState<ScenarioSnapshot[]>([]);
  const [future, setFuture] = useState<ScenarioSnapshot[]>([]);
  const [day, setDay] = useState(0);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('Initial shared mock scenario');
  const current = useMemo(() => evaluateScenario({ ...state, plan: previewPlan || state.plan }), [state, previewPlan]);
  const baseline = useMemo(() => evaluateScenario(seed), [seed]);
  const commit = (next: ScenarioSnapshot, message = 'Shared scenario updated') => {
    if (!validScenario(next)) { setNotice('Invalid scenario; current draft retained.'); return false; }
    if (JSON.stringify(next) === JSON.stringify(latest.current)) { setPreviewPlan(null); return true; }
    const previous = copyScenario(latest.current);
    setPast(history => [...history, previous].slice(-50)); setFuture([]);
    latest.current = copyScenario(next); setState(latest.current); setPreviewPlan(null); setRevision(r => r + 1); setNotice(message); return true;
  };
  const setPlan = (value: SetStateAction<ManualPlan>) => commit({ ...latest.current, plan: typeof value === 'function' ? value(latest.current.plan) : value }, 'Production / receipts / commitments updated');
  const setAssumptions = (value: SetStateAction<PlanAssumptions>) => commit({ ...latest.current, assumptions: typeof value === 'function' ? value(latest.current.assumptions) : value }, 'Shared assumptions updated');
  const undo = () => {
    const previous = past[past.length - 1]; if (!previous) return;
    const current = copyScenario(latest.current);
    setPast(p => p.slice(0, -1)); setFuture(f => [...f, current]); latest.current = previous; setState(previous); setPreviewPlan(null); setRevision(r => r + 1); setNotice('Shared change undone');
  };
  const redo = () => {
    const next = future[future.length - 1]; if (!next) return;
    const current = copyScenario(latest.current);
    setFuture(f => f.slice(0, -1)); setPast(p => [...p, current]); latest.current = next; setState(next); setPreviewPlan(null); setRevision(r => r + 1); setNotice('Shared change restored');
  };
  const exportScenario = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ status: 'shared_mock_not_factory_approved', snapshot: latest.current, evaluation: current, exported_at: new Date().toISOString() }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'ibp-connected-scenario.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return { state, seed, plan: state.plan, effectivePlan: previewPlan || state.plan, assumptions: state.assumptions, previewPlan, setPreviewPlan, setPlan, setAssumptions, commit, current, baseline, day, setDay, revision, notice, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0, exportScenario, reset: () => commit(copyScenario(seed), 'Shared scenario reset to the original mock') };
}
type ScenarioValue = ReturnType<typeof useScenarioState>;
const ScenarioContext = createContext<ScenarioValue | null>(null);
export function ScenarioProvider({ children }: { children: ReactNode }) { const value = useScenarioState(); return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>; }
export function useScenario() { const value = useContext(ScenarioContext); if (!value) throw new Error('ScenarioProvider is required'); return value; }
