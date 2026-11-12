"""
CSV imports and reads of stock, QC lots, sales orders and forecasts.

Memory mode, starting from the mock product master and an empty planning
store; the SQL store is exercised against a fake connection (CI has no
SQL Server).
"""

from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import database
import main
from planning_data import imports, products, store
from planning_data.records import StockRow
from planning_data.sql import WriteRejected

client = TestClient(main.app)
MOCK = Path(__file__).resolve().parents[1] / "sample_data" / "mock"

ORDER_HEADER = ("Sales Order Number,Sales Order Item,Material Number,Mat Description,Sold-to Code,Plant,"
                "Order Qty,Delivered Qty,SU,Req. Delivery Date,Status\n")
LOT_HEADER = "Inspection Lot,Material Number,Lot Qty,SU,Production Date,Release Date,Usage Decision\n"


@pytest.fixture(autouse=True)
def memory_mode(monkeypatch):
    """Memory mode: mock products, empty planning tables."""
    monkeypatch.setattr(database, "_conn_params", None)
    monkeypatch.setattr(products, "_memory_store", products.MemoryProductStore(products.load_mock_products()))
    planning = store.MemoryPlanningStore()
    monkeypatch.setattr(store, "_memory_store", planning)
    return planning


def post(kind, body, **params):
    data = body if isinstance(body, bytes) else body.encode("utf-8")
    return client.post("/api/v1/imports/" + kind, content=data, params=params,
                       headers={"Content-Type": "text/csv"})


def mock(name):
    return (MOCK / name).read_bytes()


def problems(res):
    return [(p["row"], p["column"]) for p in res.json()["report"]["errors"]]


# ----------------------------------------------------------------------------
# the mock files import cleanly
# ----------------------------------------------------------------------------
def test_stock_import_sums_storage_locations():
    res = post("stock", mock("sap_stock.csv"))
    assert res.status_code == 200
    body = res.json()
    assert (body["rows_read"], body["records"], body["inserted"], body["replaced"]) == (15, 13, 13, 0)
    assert body["snapshot_date"] == "2026-11-06"
    snapshot = client.get("/api/v1/stock").json()
    assert snapshot["snapshot_date"] == "2026-11-06"
    on_hand = {r["material_no"]: r["on_hand_tons"] for r in snapshot["rows"]}
    assert on_hand["990101"] == 520 and on_hand["990301"] == 640 and on_hand["990202"] == 0


def test_qc_lots_import_maps_usage_decisions():
    res = post("qc-lots", mock("sap_qc_lots.csv"))
    assert res.status_code == 200 and res.json()["inserted"] == 21
    rejected = client.get("/api/v1/qc-lots?status=rejected").json()
    assert [(lot["material_no"], lot["produced_date"]) for lot in rejected] == [("990302", "2026-11-02")]
    in_qc = client.get("/api/v1/qc-lots?status=in_qc").json()
    assert in_qc and all(lot["release_date"] > "2026-11-06" for lot in in_qc)


def test_sales_orders_import_and_open_tons():
    res = post("sales-orders", mock("sap_sales_orders.csv"))
    assert res.status_code == 200
    assert (res.json()["inserted"], res.json()["updated"]) == (166, 0)
    overdue = client.get("/api/v1/sales-orders?status=open&due_to=2026-11-06").json()
    assert [(o["material_no"], o["tons"], o["shipped_tons"], o["open_tons"]) for o in overdue] == [
        ("990201", 60, 20, 40)]
    closed = client.get("/api/v1/sales-orders?status=closed").json()
    assert closed and all(o["open_tons"] == 0 for o in closed)


def test_reimport_updates_instead_of_duplicating():
    post("sales-orders", mock("sap_sales_orders.csv"))
    res = post("sales-orders", mock("sap_sales_orders.csv"))
    assert (res.json()["inserted"], res.json()["updated"]) == (0, 166)
    assert len(client.get("/api/v1/sales-orders").json()) == 166


def test_forecast_import_and_month_filter():
    res = post("forecasts", mock("forecast_monthly.csv"), updated_by="Planner A")
    assert res.status_code == 200 and res.json()["inserted"] == 19
    december = client.get("/api/v1/forecasts?month_from=2026-12-01&month_to=2026-12-01").json()
    assert len(december) == 7                     # 6 engine rows + the BR150 manual override
    assert {f["updated_by"] for f in december} == {"Planner A"}


def test_dry_run_reports_but_keeps_nothing():
    res = post("sales-orders", mock("sap_sales_orders.csv"), dry_run="true")
    assert res.status_code == 200
    assert res.json()["dry_run"] is True and res.json()["inserted"] == 166
    assert client.get("/api/v1/sales-orders").json() == []


# ----------------------------------------------------------------------------
# stock snapshots
# ----------------------------------------------------------------------------
STOCK_NO_DATE = "Material Number,Unrestricted,SU\n990101,100,TO\n990102,2500,KG\n"


def test_stock_date_from_parameter_and_kg_conversion():
    res = post("stock", STOCK_NO_DATE, stock_date="2026-11-01")
    assert res.status_code == 200
    rows = client.get("/api/v1/stock").json()["rows"]
    assert rows == [{"material_no": "990101", "on_hand_tons": 100}, {"material_no": "990102", "on_hand_tons": 2.5}]


def test_stock_needs_a_date():
    res = post("stock", STOCK_NO_DATE)
    assert res.status_code == 422
    assert "stock date missing" in res.json()["report"]["errors"][0]["message"]


def test_stock_date_parameter_must_match_the_file():
    res = post("stock", mock("sap_stock.csv"), stock_date="2026-11-07")
    assert res.status_code == 422
    assert problems(res) == [(None, "Stock Date")]


def test_stock_file_with_two_dates_is_rejected():
    body = "Stock Date,Material Number,Unrestricted\n2026/11/05,990101,1\n2026/11/06,990102,1\n"
    assert post("stock", body).status_code == 422


def test_stock_reimport_replaces_the_whole_date():
    post("stock", mock("sap_stock.csv"))
    res = post("stock", "Stock Date,Material Number,Unrestricted\n2026/11/06,990101,1\n")
    assert (res.json()["inserted"], res.json()["replaced"]) == (1, 13)
    assert len(client.get("/api/v1/stock").json()["rows"]) == 1


def test_stock_read_picks_the_latest_snapshot_on_or_before_a_date():
    post("stock", STOCK_NO_DATE, stock_date="2026-11-01")
    post("stock", mock("sap_stock.csv"))
    assert client.get("/api/v1/stock").json()["snapshot_date"] == "2026-11-06"
    assert client.get("/api/v1/stock?on=2026-11-05").json()["snapshot_date"] == "2026-11-01"
    assert client.get("/api/v1/stock?on=2026-10-01").json() == {
        "snapshot_date": None, "loaded_at": None, "loaded_by": None, "rows": []}


@pytest.mark.parametrize("cell, expected", [("12.5-", None), ("1,250.5", 1250.5), ("abc", None)])
def test_stock_numbers(cell, expected):
    res = post("stock", 'Stock Date,Material Number,Unrestricted\n2026/11/06,990101,"%s"\n' % cell)
    if expected is None:                          # SAP's trailing minus = negative stock
        assert res.status_code == 422 and problems(res) == [(2, "Unrestricted")]
    else:
        assert res.status_code == 200
        assert client.get("/api/v1/stock").json()["rows"][0]["on_hand_tons"] == expected


# ----------------------------------------------------------------------------
# row errors: the whole file is rejected and every problem is located
# ----------------------------------------------------------------------------
def test_one_bad_row_rejects_the_whole_file():
    body = (ORDER_HEADER
            + "9100000001,10,990101,x,800001,9001,40,0,TO,2026/11/20,Open\n"
            + "9100000002,10,123456,x,800001,9001,40,0,TO,2026/11/20,Open\n")
    res = post("sales-orders", body)
    assert res.status_code == 422
    assert "nothing was imported" in res.json()["detail"]
    assert problems(res) == [(3, "Material Number")]
    assert "product master" in res.json()["report"]["errors"][0]["message"]
    assert client.get("/api/v1/sales-orders").json() == []


@pytest.mark.parametrize("row, column", [
    ("9100000001,10,990101,x,1,9001,40,50,TO,2026/11/20,Open", "Delivered Qty"),
    ("9100000001,10,990101,x,1,9001,0,0,TO,2026/11/20,Open", "Order Qty"),
    ("9100000001,10,990101,x,1,9001,40,0,TO,2026/11/20,Pending", "Status"),
    ("9100000001,10,990101,x,1,9001,40,0,TO,20/11/2026,Open", "Req. Delivery Date"),
    ("9100000001,1.5,990101,x,1,9001,40,0,TO,2026/11/20,Open", "Sales Order Item"),
    ("9100000001,10,990101,x,1,9001,40,0,BAG,2026/11/20,Open", "Order Qty"),
    (",10,990101,x,1,9001,40,0,TO,2026/11/20,Open", "Sales Order Number"),
], ids=["delivered>ordered", "zero-qty", "status", "date-format", "item", "unit", "no-order-no"])
def test_order_row_errors(row, column):
    res = post("sales-orders", ORDER_HEADER + row + "\n")
    assert res.status_code == 422
    assert problems(res) == [(2, column)]


def test_duplicate_order_item_in_one_file():
    row = "9100000001,10,990101,x,1,9001,40,0,TO,2026/11/20,Open\n"
    res = post("sales-orders", ORDER_HEADER + row + row)
    assert problems(res) == [(3, "Sales Order Item")]
    assert "already on line 2" in res.json()["report"]["errors"][0]["message"]


def test_open_order_for_an_inactive_product_is_only_a_warning():
    res = post("sales-orders", ORDER_HEADER + "9100000001,10,990104,x,1,9001,40,0,TO,2026/11/20,Open\n")
    assert res.status_code == 200
    assert res.json()["warnings"][0]["message"] == "open order for the inactive product 990104"


@pytest.mark.parametrize("row, column", [
    ("040000000001,990101,10,TO,2026/11/06,2026/11/01,", "Release Date"),
    ("040000000001,990101,10,TO,2026/11/06,2026/11/11,X", "Usage Decision"),
    ("040000000001,990101,0,TO,2026/11/06,2026/11/11,", "Lot Qty"),
    (",990101,10,TO,2026/11/06,2026/11/11,", "Inspection Lot"),
], ids=["release-before-production", "decision", "zero-qty", "no-lot"])
def test_qc_lot_row_errors(row, column):
    res = post("qc-lots", LOT_HEADER + row + "\n")
    assert res.status_code == 422
    assert problems(res) == [(2, column)]


@pytest.mark.parametrize("row, column", [
    ("BR999,2026-11,manual,100", "GroupCode"),
    ("BR150,2026-11-15,manual,100", "ForecastMonth"),
    ("BR150,2026-11,robot,100", "Source"),
    ("BR150,2026-11,manual,-1", "Tons"),
], ids=["group", "mid-month", "source", "negative"])
def test_forecast_row_errors(row, column):
    res = post("forecasts", "GroupCode,ForecastMonth,Source,Tons\n" + row + "\n")
    assert res.status_code == 422
    assert problems(res) == [(2, column)]


def test_forecast_source_defaults_to_manual_and_month_forms():
    res = post("forecasts", "groupcode,forecastmonth,tons\nbr150,2026/11,100\nVCR412,2026-12-01,200\n")
    assert res.status_code == 200
    rows = client.get("/api/v1/forecasts").json()
    assert [(f["group_code"], f["forecast_month"], f["source"]) for f in rows] == [
        ("BR150", "2026-11-01", "manual"), ("VCR412", "2026-12-01", "manual")]


def test_error_count_is_exact_beyond_the_listed_problems(monkeypatch):
    monkeypatch.setattr(imports, "MAX_REPORTED", 2)
    body = ORDER_HEADER + "".join("91000000%02d,10,999999,x,1,9001,40,0,TO,2026/11/20,Open\n" % i for i in range(5))
    report = post("sales-orders", body).json()["report"]
    assert report["error_count"] == 5 and len(report["errors"]) == 2


# ----------------------------------------------------------------------------
# file-level checks
# ----------------------------------------------------------------------------
def test_missing_header_is_reported():
    res = post("sales-orders", "a,b,c\n1,2,3\n")
    assert res.status_code == 422
    assert problems(res) == [(None, None)]
    assert "header row not found" in res.json()["report"]["errors"][0]["message"]


def test_header_without_rows_is_rejected():
    assert post("qc-lots", LOT_HEADER).status_code == 422


def test_empty_body_is_422_and_huge_body_is_413(monkeypatch):
    assert post("stock", b"").status_code == 422
    monkeypatch.setattr(imports, "MAX_BYTES", 10)
    assert post("stock", STOCK_NO_DATE, stock_date="2026-11-01").status_code == 413


def test_thai_windows_and_bom_encodings():
    thai = ("รายงานสต็อก\nStock Date,Material Number,Mat Description,Unrestricted\n"
            "2026/11/06,990101,ยางสังเคราะห์,5\n")
    assert post("stock", thai.encode("cp874")).status_code == 200
    assert post("stock", thai.encode("utf-8-sig")).status_code == 200


def test_headers_match_case_insensitively_and_extra_columns_are_ignored():
    body = "STOCK DATE,material number,Plant,Something Else,UNRESTRICTED\n2026-11-06,990101,9001,zz,7\n"
    assert post("stock", body).status_code == 200


# ----------------------------------------------------------------------------
# store selection, database failures
# ----------------------------------------------------------------------------
def test_memory_mode_starts_with_the_mock_data(monkeypatch):
    monkeypatch.setattr(store, "_memory_store", None)
    assert len(client.get("/api/v1/sales-orders").json()) == 166
    assert client.get("/api/v1/stock").json()["snapshot_date"] == "2026-11-06"
    assert len(client.get("/api/v1/forecasts").json()) == 19


def test_database_down_is_503(monkeypatch):
    monkeypatch.setattr(database, "_conn_params", {"server": "fake"})

    def down():
        raise OSError("connection refused")

    monkeypatch.setattr(database, "open_connection", down)
    assert post("sales-orders", mock("sap_sales_orders.csv")).status_code == 503
    assert client.get("/api/v1/stock").status_code == 503
    assert client.get("/api/v1/forecasts").status_code == 503


def test_rows_the_database_refuses_are_422(monkeypatch, memory_mode):
    def refuse(*args, **kwargs):
        raise WriteRejected("the database refused the file: CHECK constraint")

    monkeypatch.setattr(memory_mode, "upsert_qc_lots", refuse)
    res = post("qc-lots", mock("sap_qc_lots.csv"))
    assert res.status_code == 422 and "refused" in res.json()["detail"]


class FakeCursor:
    def __init__(self, conn):
        self.conn, self.rowcount = conn, 3

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.conn.executed.append(sql)

    def fetchone(self):
        return (self.conn.actions.pop(0),)


class FakeConnection:
    def __init__(self, actions=()):
        self.actions, self.executed = list(actions), []
        self.committed = self.rolled_back = self.closed = False

    def cursor(self, as_dict=False):
        return FakeCursor(self)

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


@pytest.mark.parametrize("dry_run", [False, True])
def test_sql_merge_counts_and_dry_run_rolls_back(monkeypatch, dry_run):
    conn = FakeConnection(actions=["INSERT", "UPDATE", "INSERT"])
    monkeypatch.setattr(database, "_conn_params", {"server": "fake"})
    monkeypatch.setattr(database, "open_connection", lambda: conn)
    lots = imports.parse_qc_lots(mock("sap_qc_lots.csv"), {p.material_no: p for p in products.load_mock_products()})
    result = store.SqlPlanningStore().upsert_qc_lots(lots.records[:3], dry_run=dry_run)
    assert (result.inserted, result.updated) == (2, 1)
    assert all(sql.lstrip().startswith("MERGE dbo.QcLots") for sql in conn.executed)
    assert (conn.committed, conn.rolled_back, conn.closed) == (not dry_run, dry_run, True)


def test_sql_stock_replace_reports_the_deleted_rows(monkeypatch):
    conn = FakeConnection()
    monkeypatch.setattr(database, "_conn_params", {"server": "fake"})
    monkeypatch.setattr(database, "open_connection", lambda: conn)
    parsed = imports.parse_stock(mock("sap_stock.csv"), {p.material_no: p for p in products.load_mock_products()})
    result = store.SqlPlanningStore().replace_stock(parsed.snapshot_date, parsed.records, "test")
    assert (result.inserted, result.replaced) == (13, 3)
    assert conn.executed[0].startswith("DELETE FROM dbo.StockSnapshots")
    assert conn.committed


# ----------------------------------------------------------------------------
# hand edits of stock rows
# ----------------------------------------------------------------------------
def test_stock_row_can_be_hand_edited_until_the_next_import():
    post("stock", 'Stock Date,Material Number,Unrestricted\n2026/11/06,990101,5\n')
    edited = client.patch("/api/v1/stock/2026-11-06/990101", json={"tons": 10})
    assert edited.status_code == 200
    assert edited.json() == {"material_no": "990101", "on_hand_tons": 10}
    assert client.get("/api/v1/stock").json()["rows"][0]["on_hand_tons"] == 10
    # the next import of the same date resets the edit to the imported value
    post("stock", 'Stock Date,Material Number,Unrestricted\n2026/11/06,990101,5\n')
    assert client.get("/api/v1/stock").json()["rows"][0]["on_hand_tons"] == 5


def test_hand_edit_rejections():
    post("stock", 'Stock Date,Material Number,Unrestricted\n2026/11/06,990101,5\n')
    unknown = client.patch("/api/v1/stock/2026-11-06/999999", json={"tons": 1})
    assert unknown.status_code == 422 and "product master" in unknown.json()["detail"]
    wrong_day = client.patch("/api/v1/stock/2026-11-01/990101", json={"tons": 1})
    assert wrong_day.status_code == 404 and "no stock snapshot" in wrong_day.json()["detail"]
    not_there = client.patch("/api/v1/stock/2026-11-06/990202", json={"tons": 1})
    assert not_there.status_code == 404 and "not in the stock snapshot" in not_there.json()["detail"]
    assert client.patch("/api/v1/stock/2026-11-06/990101", json={"tons": -1}).status_code == 422
    assert client.get("/api/v1/stock").json()["rows"][0]["on_hand_tons"] == 5      # nothing changed


def test_sql_stock_hand_edit_commits(monkeypatch):
    conn = FakeConnection(actions=[1])                 # COUNT(1): the snapshot exists
    monkeypatch.setattr(database, "_conn_params", {"server": "fake"})
    monkeypatch.setattr(database, "open_connection", lambda: conn)
    row = store.SqlPlanningStore().update_stock_row(date(2026, 11, 6), "990101", 10)
    assert row == StockRow(material_no="990101", on_hand_tons=10)
    assert conn.executed[0].startswith("SELECT COUNT(1)")
    assert conn.executed[1].startswith("UPDATE dbo.StockSnapshots")
    assert (conn.committed, conn.rolled_back) == (True, False)


def test_sql_stock_hand_edit_on_a_missing_date_rolls_back(monkeypatch):
    conn = FakeConnection(actions=[0])                 # COUNT(1) = 0: no snapshot that day
    monkeypatch.setattr(database, "_conn_params", {"server": "fake"})
    monkeypatch.setattr(database, "open_connection", lambda: conn)
    with pytest.raises(ValueError):
        store.SqlPlanningStore().update_stock_row(date(2026, 11, 6), "990101", 10)
    assert (conn.committed, conn.rolled_back, conn.closed) == (False, True, True)
