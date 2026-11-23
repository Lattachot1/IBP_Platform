import pytest

from optimization import manual
from optimization.engine import solve
from optimization.schemas import OptimizeRequest


def request(horizon, age):
    return OptimizeRequest(horizon_days=horizon, start_date="2026-11-02", time_limit_s=5,
                           num_search_workers=1, initial={"grade": "VCR412", "remain_days": 8,
                                                         "rx12_age": age, "rx34_age": 0}).model_dump()


def draft(age=41, cleaning=True, br_days=2):
    return manual.evaluate({**request(8 + br_days, age),
                            "campaigns": [{"grade": "VCR412", "days": 8}, {"grade": "BR150", "days": br_days}],
                            "cleanings": [{"pair": "RX3-4", "start": 8}] if cleaning else []})


@pytest.mark.parametrize(("age", "status"), [(41, "feasible"), (42, "conflicts")])
def test_exit_gate_after_last_day(age, status):
    result = draft(age)
    assert result["status"] == status
    if age == 42:
        assert any("age after VCR production is 50" in c["text"] for c in result["checks"])


def test_first_br_day_requires_cleaning_and_partial_clean_does_not_reset():
    assert any("must start cleaning" in c["text"] for c in draft(cleaning=False)["checks"])
    partial = draft()
    assert partial["pair_notes"]["RX3-4"].endswith("age at plan end: 8 days")
    assert any("5 more day(s)" in c["text"] for c in partial["checks"])
    assert draft(br_days=7)["pair_notes"]["RX3-4"].endswith("age at plan end: 0 days")


def test_solver_dispatches_rx12_and_starts_cleaning_rx34_on_return():
    req = request(15, 41)
    req["demand"] = {g: 0 for g in ("BR150L", "BR150B", "BR360B", "BR150LGN", "VCR412", "VCR617")}
    req["demand"]["BR150"] = 2000
    result = solve(req)
    assert result["status"] == "feasible"
    assert "campaign ends" in result["days"][7]["note"]
    assert all((day["p1"], day["p2"]) == ("prod", "clean") for day in result["days"][8:])
    assert result["pair_notes"]["RX3-4"].endswith("age at plan end: 0 days")
    assert manual.evaluate({**req, **manual.draft_from_result(result)})["status"] == "feasible"


@pytest.mark.parametrize(("age", "status"), [(41, "feasible"), (42, "infeasible")])
def test_open_vcr_on_sunday_reserves_age_for_owed_day(age, status):
    req = request(7, age)
    result = solve(req)
    assert result["status"] == status
    if status == "feasible":
        checked = manual.evaluate({**req, **manual.draft_from_result(result)})
        assert checked["status"] == "feasible"
        for plan in (result, checked):
            assert "campaign ends" not in plan["days"][-1]["note"]
            assert any("1 more required" in c["text"] for c in plan["checks"])
