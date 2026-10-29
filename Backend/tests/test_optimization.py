"""
The CP-SAT engine self-test (optimization/selftest.py) as pytest cases.

Each scenario is solved once, checked against plant_config.yaml by the
self-test's own validator (independent of the solver), round-tripped
through the hand-edit evaluator, and then broken on purpose to see the
evaluator flag it. Slow (minutes): the solver may run to its time limit.
"""

import pytest

from optimization import selftest


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
