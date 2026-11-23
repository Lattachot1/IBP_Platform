import pytest

from optimization import engine, manual
from optimization.schemas import OptimizeRequest


@pytest.mark.parametrize("outgoing", [0, 1, 30])
def test_changeover_split_follows_demand_and_keeps_the_pair_cap(outgoing):
    demand = {g["id"]: 0 for g in engine.plant_groups()}
    # Two normal days of 412, then the 190 t switch and six normal days of 617.
    demand.update(VCR412=2 * 230 + outgoing, VCR617=6 * 220 + 190 - outgoing)
    req = OptimizeRequest(start_date="2026-11-02", horizon_days=9, demand=demand,
                          num_search_workers=1, time_limit_s=5,
                          initial={"grade": "VCR412", "remain_days": 2, "rx12_age": 0}).model_dump()
    solved = engine.solve(req)
    assert solved["status"] == "feasible"
    draft = manual.draft_from_result(solved)
    assert draft["campaigns"] == [{"grade": "VCR412", "days": 2}, {"grade": "VCR617", "days": 7}]
    for plan in (solved, manual.evaluate({**req, **draft})):
        assert plan["status"] == "feasible"
        day = plan["days"][2]
        assert day["chg"] and day["main_grade"] == "VCR617" and day["cap"] == 190
        parts = {p["grade"]: p["tons"] for p in day["parts"]}
        assert parts.get("VCR412", 0) == outgoing
        assert parts["VCR617"] == 190 - outgoing
        assert plan["days"][3]["chg"] is False
        assert plan["kpis"]["shortage_tons"] == 0
