"""Stock from the Product Status workbook's InventoryDaily_ZMMR021 sheet.

The fixture mimics the raw SAP stock report: one row per material, batch
and storage location, quantities in KG, with 'Mat + Spec.' as the
cached product code ('400003-ST') and a batch-suffix fallback for rows
whose cache is empty.
"""

from datetime import datetime

import openpyxl
import pytest
from fastapi.testclient import TestClient

import database
import main
from planning_data import products, stock_workbook, store

client = TestClient(main.app)

PRODUCTS = ("400003-ST,WS", "400003-NN", "400003-HM")


def workbook_master():
    """A market-level master with just the codes the fixture file uses."""
    from planning_data.products import Product

    return [Product(material_no=c, description=c, group_code="BR150", min_stock_tons=0,
                    is_active=True, updated_at="2026-11-13T00:00:00Z", updated_by="test")
            for c in PRODUCTS]


@pytest.fixture(autouse=True)
def memory_mode(monkeypatch):
    """Memory mode: the market-level master, empty planning tables, and the
    catalog aliases folding the SAP codes into the combined product."""
    monkeypatch.setattr(database, "_conn_params", None)
    monkeypatch.setattr(products, "_memory_store", products.MemoryProductStore(workbook_master()))
    monkeypatch.setattr(store, "_memory_store", store.MemoryPlanningStore())
    monkeypatch.setattr(stock_workbook, "codespec_aliases",
                        lambda: {"400003-ST": "400003-ST,WS", "400003-WS": "400003-ST,WS"})


def build_workbook() -> openpyxl.Workbook:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "InventoryDaily_ZMMR021"
    header = ["date", "Plant", "Material", "Material Description", "Batch", "On - Off",
              "Mat + Spec.", "Storage Location", "Base Unit of Measure", "Unrestricted"]
    ws.append(header)
    day = lambda d: datetime(2026, 11, d)  # noqa: E731
    ws.append([day(13), 1203, "400003", "UBEPOL AE150MN", "908301HM", None, "400003-ST", "TSLW", "KG", 105000])
    ws.append([day(13), 1203, "400003", "UBEPOL AE150MN", "908301HM", None, "400003-ST", "TSLW2", "KG", 5000])
    ws.append([day(13), 1203, "400003", "UBEPOL AE150MN", "908152WS", None, "400003-WS", "TSLW", "KG", 10000])  # alias: folds into 400003-ST
    ws.append([day(13), 1203, "400003", "UBEPOL AE150MN", "908152NN", None, "400003-NN", "TSLW", "KG", 23100])
    ws.append([day(13), 1203, "400003", "UBEPOL AE150MN", "908301HM", None, None, "TSLW", "KG", 7000])  # cache empty -> batch fallback
    ws.append([day(13), 1203, "400003", "UBEPOL AE150MN", "908152NN", None, "400003-NN", "QC", "KG", None])  # no unrestricted
    ws.append([day(12), 1203, "400003", "UBEPOL AE150MN", "908301HM", None, "400003-ST", "TSLW", "KG", 999999])  # older day
    ws.append([day(13), 1203, "999999", "UNKNOWN", None, None, "999999-XY", "TSLW", "KG", 8000])  # not in the master
    return wb


def products_index():
    return {code: None for code in ("400003-ST", "400003-WS", "400003-NN", "400003-HM", "400003-ST,WS")}


def test_parse_keeps_the_latest_day_per_product_in_tons():
    parsed = stock_workbook.parse(build_workbook(), products_index())
    assert parsed.snapshot_date == datetime(2026, 11, 13).date()
    assert parsed.errors == []
    rows = {r.material_no: r.on_hand_tons for r in parsed.records}
    # KG / 1000, summed: the ST and WS rows fold into the combined product
    assert rows == {"400003-ST,WS": 120.0, "400003-NN": 23.1, "400003-HM": 7.0}
    assert any("unknown product 999999-XY" in w.message for w in parsed.warnings)


def test_parse_reports_an_uncalculated_sheet():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "InventoryDaily_ZMMR021"
    ws.append(["date", "Plant", "Material", "Material Description", "Batch", "On - Off",
               "Mat + Spec.", "Storage Location", "Base Unit of Measure", "Unrestricted"])
    ws.append([datetime(2026, 11, 13), 1203, "400003", "UBEPOL AE150MN", None, None, None, "TSLW", "KG", 1000])
    parsed = stock_workbook.parse(wb, products_index())
    assert parsed.records == []
    assert parsed.errors and "open and save the workbook in Excel" in parsed.errors[0].message


def test_endpoint_imports_the_workbook_stock(monkeypatch, tmp_path):
    path = tmp_path / "Product Status 2026.xlsx"
    build_workbook().save(path)
    monkeypatch.setattr(stock_workbook, "load_status_workbook", lambda data_only=True: (
        openpyxl.load_workbook(path, read_only=True, data_only=data_only)))

    checked = client.post("/api/v1/imports/stock-workbook?dry_run=true").json()
    assert checked["kind"] == "stock-workbook"
    assert checked["snapshot_date"] == "2026-11-13" and checked["records"] == 3
    assert client.get("/api/v1/stock").json()["snapshot_date"] is None      # dry run kept nothing

    published = client.post("/api/v1/imports/stock-workbook").json()
    assert (published["inserted"], published["replaced"]) == (3, 0)
    snapshot = client.get("/api/v1/stock").json()
    assert snapshot["snapshot_date"] == "2026-11-13"
    on_hand = {r["material_no"]: r["on_hand_tons"] for r in snapshot["rows"]}
    assert on_hand["400003-ST,WS"] == 120.0
