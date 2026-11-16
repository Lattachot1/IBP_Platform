"""The Sale forecast import: workbook segments -> manual group forecasts.

The fixture mimics the client's 'Sale forecast' sheet: a header row with
one datetime column per month, then per segment one row per customer
(the segment's grade name is a merged cell, empty on the rows below it).
"""

from datetime import date, datetime

import openpyxl
import pytest
from fastapi.testclient import TestClient

import database
import main
from planning_data import products, store
import planning_data.sale_forecast as sale_forecast
from planning_data.sale_forecast import group_of_segment, parse_sale_forecast

client = TestClient(main.app)

GROUPS = ["BR150", "BR150B", "BR360B", "VCR412", "VCR617", "BR150L", "BR150LGN"]


@pytest.fixture(autouse=True)
def memory_mode(monkeypatch):
    """Memory mode: mock products, empty planning tables."""
    monkeypatch.setattr(database, "_conn_params", None)
    monkeypatch.setattr(products, "_memory_store", products.MemoryProductStore(products.load_mock_products()))
    planning = store.MemoryPlanningStore()
    monkeypatch.setattr(store, "_memory_store", planning)
    return planning


def build_workbook() -> openpyxl.Workbook:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sale forecast"
    ws.append(["2025-08-15", "Receive 15/08/2025"])
    ws.append(["Grade name", "Customer name", "Country",
               datetime(2026, 10, 1), datetime(2026, 11, 1), datetime(2026, 12, 1)])
    ws.append(["BR150(MN) ST", "Deestone", "Thailand", 100, 120, None])
    ws.append([None, "Otani", "Thailand", 50, None, 60])
    ws.append(["BR150 MN Total", None, None, 150, 120, 60])          # summary line: ignored
    ws.append(["BR150LGN (MN) SH", "MSC", "Thailand", None, 40, None])
    ws.append(["BR150GN (GPS) CT", "CT", "Thailand", 10, 10, 10])    # no plant group: skipped
    return wb


def test_group_of_segment_matches_the_longest_grade_prefix():
    assert group_of_segment("BR150(MN) ST", GROUPS) == "BR150"
    assert group_of_segment("BR150LGN (MN) SH", GROUPS) == "BR150LGN"
    assert group_of_segment("BR150L-MN(Tire)", GROUPS) == "BR150L"
    assert group_of_segment("VCR-412 (GPS)-BS", GROUPS) == "VCR412"
    assert group_of_segment("BR150GN (GPS) CT", ["BR150"]) is None


def test_parse_sums_customer_rows_and_skips_summaries_and_unknown_grades():
    rows, skipped, months = parse_sale_forecast(build_workbook(), GROUPS, date(2026, 11, 1))
    assert months == [date(2026, 10, 1), date(2026, 11, 1), date(2026, 12, 1)]
    got = {(r.group_code, r.forecast_month): r.tons for r in rows}
    assert got == {
        ("BR150", date(2026, 11, 1)): 120.0,           # October is before from_month: dropped
        ("BR150", date(2026, 12, 1)): 60.0,
        ("BR150LGN", date(2026, 11, 1)): 40.0,
    }
    assert all(r.source == "manual" for r in rows)
    assert skipped == ["BR150GN (GPS) CT"]


def test_endpoint_publishes_manual_rows_and_clear_gives_the_engine_back(monkeypatch, tmp_path):
    path = tmp_path / "Product Status 2026.xlsx"
    build_workbook().save(path)
    monkeypatch.setattr(sale_forecast, "find_status_workbook", lambda: path)

    checked = client.post("/api/v1/forecasts/from-sale-forecast?dry_run=true").json()
    assert checked["status"] == "checked" and checked["rows"] == 3
    assert client.get("/api/v1/forecasts").json() == []          # dry run kept nothing

    published = client.post("/api/v1/forecasts/from-sale-forecast").json()
    assert published["status"] == "published" and (published["inserted"], published["updated"]) == (3, 0)
    manual = [(r["group_code"], r["forecast_month"][:7], r["tons"])
              for r in client.get("/api/v1/forecasts").json() if r["source"] == "manual"]
    assert ("BR150LGN", "2026-11", 40.0) in manual

    counted = client.delete("/api/v1/forecasts/sale-forecast?dry_run=true").json()
    assert counted == {"status": "checked", "deleted": 3, "dry_run": True}
    cleared = client.delete("/api/v1/forecasts/sale-forecast").json()
    assert cleared == {"status": "cleared", "deleted": 3, "dry_run": False}
    assert client.get("/api/v1/forecasts").json() == []
