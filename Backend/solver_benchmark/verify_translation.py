"""Check that accepted full-size CP incumbents also extend to feasible MILPs."""
import argparse
import json
from pathlib import Path
import time

from ortools.linear_solver import pywraplp

from .mip_adapter import MipAdapter, validate_original
from .run import build


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('results', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = json.loads(args.results.read_text(encoding='utf-8'))
    checks = []
    for name, request in data['inputs'].items():
        candidates = [r for r in data['runs'] if r['case'] == name and r.get('assignment')]
        if not candidates:
            continue
        run = min(candidates, key=lambda r: r['weighted_cost_usd_score'])
        joint, _, _, _ = build(request)
        values = run['assignment']
        if validate_original(joint.model, values):
            raise ValueError('Input incumbent fails source-model validation')
        for formulation in ('disjunctive', 'convex_hull'):
            for backend in ('SCIP', 'CBC'):
                started = time.perf_counter()
                mip = MipAdapter(joint.model, backend, formulation)
                for v, x in zip(mip.variables, values):
                    v.SetBounds(x, x)
                mip.solver.SetNumThreads(1)
                mip.solver.SetTimeLimit(5000)
                status = mip.solver.Solve()
                ok = status == pywraplp.Solver.OPTIMAL and mip.solver.VerifySolution(1e-5, False)
                check = dict(case=name, solver=backend, element_formulation=formulation,
                             accepted=ok, status=status, build_and_check_s=time.perf_counter() - started,
                             source_model_sha256=run['model_sha256'], assignment_sha256=run['assignment_sha256'])
                checks.append(check)
                print(check, flush=True)
                if not ok:
                    raise ValueError('A valid CP incumbent was rejected by the translated MILP')
    if not checks:
        raise ValueError('No stored assignments to check')
    args.output.write_text(json.dumps(checks, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
