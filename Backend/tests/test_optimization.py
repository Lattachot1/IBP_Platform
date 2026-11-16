"""
The CP-SAT engine self-test (optimization/selftest.py) as pytest cases.

Each scenario is solved once, checked against plant_config.yaml by the
self-test's own validator (independent of the solver), round-tripped
through the hand-edit evaluator, and then broken on purpose to see the
evaluator flag it. Slow (minutes): the solver may run to its time limit.
"""

import pytest

from optimization import manual, selftest
from optimization.engine import solve
from optimization.schemas import EvaluateRequest, OptimizeRequest


@pytest.fixture(scope="module")
def solved():
    """label -> (solver result, failed checks); every scenario solved once."""
    out = {}
    for label, kwargs in selftest.SCENARIOS.items():
        selftest.FAILURES.clear()
        result = selftest.scenario(label, **kwargs)
        out[label] = (result, list(selftest.FAILURES))
    return out


@pytest.mark.parametrize("label", selftest.SCENARIOS)
def test_plan_obeys_plant_rules(solved, label):
    result, failures = solved[label]
    assert result["status"] == "feasible", result.get("message")
    assert failures == []


def test_plan_reacts_to_demand(solved):
    def mains(result):
        return [d["parts"][-1]["grade"] for d in result.get("days", [])]

    default = solved["S1 default 28d"][0]
    heavy_vcr = solved["S2 heavy VCR-412 demand"][0]
    assert mains(default) and mains(heavy_vcr)
    assert mains(default) != mains(heavy_vcr)


def test_last_day_counts_towards_the_reactor_age_limit():
    # The age recursion used to stop one day short of the horizon, so a plan
    # could push a pair past its 60-day limit on its final day and the
    # hand-edit evaluator then flagged what the solver had allowed (a flaky
    # conflict, depending on which optimum the solver happened to pick).
    req = OptimizeRequest(horizon_days=14, time_limit_s=20)
    res = solve(req.model_dump())
    assert res["status"] == "feasible", res.get("message")
    draft = manual.draft_from_result(res)
    ev = manual.evaluate(EvaluateRequest(**req.model_dump(), **draft).model_dump())
    assert ev["conflicts"] == 0
    # max age now includes the last day's production (day start + true end)
    max_age = next(c["text"] for c in res["checks"] if "RX1-2 max age in plan" in c["text"])
    assert "≤ 60" in max_age and "61" not in max_age
