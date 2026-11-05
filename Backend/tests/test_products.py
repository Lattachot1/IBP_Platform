"""
Product master: API, catalog, the dbo.Products store, the schema file,
the mock data set and the seed script.

Runs in memory mode on the fictitious sample_data/mock products. The SQL
store is exercised against a fake connection; CI has no SQL Server.
"""

import csv
import re
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

import database
import main
from optimization.engine import plant_groups
from planning_data import products, seed

client = TestClient(main.app)

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
MOCK = BACKEND / "sample_data" / "mock"


@pytest.fixture(autouse=True)
def memory_products(monkeypatch):
    """Every test starts from the mock product master, in memory mode."""
    monkeypatch.setattr(database, "_conn_params", None)
    store = products.MemoryProductStore(products.load_mock_products())
    monkeypatch.setattr(products, "_memory_store", store)
    return store


def _materials(body):
    return [p["material_no"] for p in body]


# ----------------------------------------------------------------------------
# list / get
# ----------------------------------------------------------------------------
def test_list_returns_every_product_by_group_then_material():
    body = client.get("/api/v1/products").json()
    assert len(body) == 13
    assert [(p["group_code"], p["material_no"]) for p in body] == sorted(
        (p["group_code"], p["material_no"]) for p in body)


def test_active_filter():
    assert len(client.get("/api/v1/products?active=true").json()) == 12
    assert _materials(client.get("/api/v1/products?active=false").json()) == ["990104"]


def test_get_one_product():
    body = client.get("/api/v1/products/990101").json()
    assert body["description"] == "UBEPOL BR150 MOCK-A"
    assert body["group_code"] == "BR150"
    assert body["min_stock_tons"] == 300
    assert client.get("/api/v1/products/does-not-exist").status_code == 404


# ----------------------------------------------------------------------------
# create
# ----------------------------------------------------------------------------
def test_create_normalizes_codes_and_lists_the_product():
    res = client.post("/api/v1/products", json={
        "material_no": " ab-7 ", "description": "UBEPOL BR150 NEW", "group_code": "br150",
        "min_stock_tons": 12.3456, "updated_by": "Planner A",
    })
    assert res.status_code == 201
    body = res.json()
    assert (body["material_no"], body["group_code"], body["min_stock_tons"]) == ("AB-7", "BR150", 12.346)
    assert body["is_active"] is True and body["updated_by"] == "Planner A"
    assert client.get("/api/v1/products/ab-7").status_code == 200


def test_create_existing_material_is_409():
    res = client.post("/api/v1/products", json={
        "material_no": "990101", "description": "again", "group_code": "BR150"})
    assert res.status_code == 409
    assert "already exists" in res.json()["detail"]


def test_create_with_unknown_group_is_422_and_names_the_groups():
    res = client.post("/api/v1/products", json={
        "material_no": "990999", "description": "x", "group_code": "BR999"})
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert "BR999" in detail
    assert all(g["id"] in detail for g in plant_groups())


@pytest.mark.parametrize("change", [
    {"min_stock_tons": -1},
    {"min_stock_tons": 2_000_000},
    {"material_no": "has space"},
    {"material_no": "x" * 41},
    {"description": ""},
    {"description": "d" * 101},
    {"updated_by": "u" * 51},
], ids=["negative-min", "huge-min", "bad-material", "long-material", "empty-desc", "long-desc", "long-editor"])
def test_create_validation(change):
    payload = {"material_no": "990998", "description": "ok", "group_code": "BR150", **change}
    assert client.post("/api/v1/products", json=payload).status_code == 422


@pytest.mark.parametrize("raw", ["NaN", "Infinity"])
def test_create_rejects_non_finite_minimum(raw):
    # httpx cannot emit NaN as JSON, so send the raw body
    res = client.post(
        "/api/v1/products",
        content='{"material_no": "990997", "description": "x", "group_code": "BR150", "min_stock_tons": %s}' % raw,
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 422


# ----------------------------------------------------------------------------
# patch (there is no delete)
# ----------------------------------------------------------------------------
def test_patch_changes_only_the_fields_sent():
    before = client.get("/api/v1/products/990102").json()
    res = client.patch("/api/v1/products/990102", json={"min_stock_tons": 150.5, "updated_by": "Planner B"})
    assert res.status_code == 200
    after = res.json()
    assert after["min_stock_tons"] == 150.5
    assert after["updated_by"] == "Planner B"
    assert {k: after[k] for k in ("description", "group_code", "is_active")} == \
           {k: before[k] for k in ("description", "group_code", "is_active")}
    assert after["updated_at"] >= before["updated_at"]


def test_deactivated_product_leaves_the_catalog_but_stays_readable():
    assert client.patch("/api/v1/products/990101", json={"is_active": False}).status_code == 200
    catalog = client.get("/api/v1/optimize/catalog").json()
    br150 = next(g for g in catalog["groups"] if g["id"] == "BR150")
    assert "990101" not in _materials(br150["products"])
    assert client.get("/api/v1/products/990101").json()["is_active"] is False


@pytest.mark.parametrize("payload, status", [
    ({}, 422),
    ({"updated_by": "only me"}, 422),
    ({"group_code": "BR999"}, 422),
    ({"min_stock_tons": -5}, 422),
])
def test_patch_rejections(payload, status):
    assert client.patch("/api/v1/products/990101", json=payload).status_code == status


def test_patch_missing_product_is_404():
    assert client.patch("/api/v1/products/nope", json={"is_active": False}).status_code == 404


def test_products_cannot_be_deleted():
    assert client.delete("/api/v1/products/990101").status_code == 405


# ----------------------------------------------------------------------------
# catalog
# ----------------------------------------------------------------------------
def test_catalog_follows_plant_config_with_active_products():
    body = client.get("/api/v1/optimize/catalog").json()
    assert [g["id"] for g in body["groups"]] == [g["id"] for g in plant_groups()]
    by_group = {g["id"]: _materials(g["products"]) for g in body["groups"]}
    assert by_group["BR150"] == ["990101", "990102", "990103"]   # 990104 is inactive
    assert all(by_group.values())
    assert body["unassigned"] == []
    first = body["groups"][0]
    assert {"id", "disp", "slot", "products"} <= set(first)
    assert set(first["products"][0]) == {"material_no", "description", "min_stock_tons"}


def test_catalog_reports_products_of_a_removed_group(memory_products):
    memory_products._rows["990777"] = products.Product(
        material_no="990777", description="old grade", group_code="BR777",
        min_stock_tons=0, is_active=True, updated_at=datetime.now(), updated_by="test")
    body = client.get("/api/v1/optimize/catalog").json()
    assert body["unassigned"] == [{"material_no": "990777", "description": "old grade",
                                   "min_stock_tons": 0, "group_code": "BR777"}]


# ----------------------------------------------------------------------------
# database mode: dbo.Products through a fake connection
# ----------------------------------------------------------------------------
class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.conn.executed.append((sql, params))
        if self.conn.error is not None:
            raise self.conn.error

    def fetchone(self):
        return self.conn.rows[0] if self.conn.rows else None

    def fetchall(self):
        return list(self.conn.rows)


class FakeConnection:
    def __init__(self, rows=(), error=None):
        self.rows, self.error = list(rows), error
        self.executed, self.committed, self.closed = [], False, False

    def cursor(self, as_dict=False):
        return FakeCursor(self)

    def commit(self):
        self.committed = True

    def close(self):
        self.closed = True


DB_ROW = {
    "MaterialNo": "990101", "Description": "UBEPOL BR150 MOCK-A", "GroupCode": "BR150",
    "MinStockTons": Decimal("10.500"), "IsActive": False,
    "UpdatedAt": datetime(2026, 11, 5, 8, 0, 0), "UpdatedBy": "Planner (Interactive)",
}


@pytest.fixture
def fake_db(monkeypatch):
    """Database mode with every connection handed out by the test."""
    conns = []

    def use(conn):
        conns.append(conn)
        monkeypatch.setattr(database, "_conn_params", {"server": "fake"})
        monkeypatch.setattr(database, "open_connection", lambda: conn)
        return conn

    yield use
    assert all(c.closed for c in conns)


def test_sql_rows_become_products(fake_db):
    fake_db(FakeConnection(rows=[DB_ROW]))
    body = client.get("/api/v1/products").json()
    assert body[0]["min_stock_tons"] == 10.5
    assert body[0]["is_active"] is False
    assert body[0]["updated_at"].startswith("2026-11-05T08:00:00") and body[0]["updated_at"].endswith(("Z", "+00:00"))


def test_sql_patch_sets_only_whitelisted_columns(fake_db):
    conn = fake_db(FakeConnection(rows=[DB_ROW]))
    res = client.patch("/api/v1/products/990101", json={"min_stock_tons": 10.5, "is_active": False})
    assert res.status_code == 200
    sql, params = conn.executed[0]
    assert re.search(r"SET MinStockTons = %s, IsActive = %s, UpdatedAt = SYSUTCDATETIME\(\), UpdatedBy = %s ", sql)
    assert params == (10.5, 0, "Planner (Interactive)", "990101")
    assert conn.committed


def test_sql_duplicate_key_is_409(fake_db):
    fake_db(FakeConnection(error=Exception(2627, b"Violation of PRIMARY KEY constraint 'PK_Products'")))
    res = client.post("/api/v1/products", json={"material_no": "990101", "description": "x", "group_code": "BR150"})
    assert res.status_code == 409


def test_sql_patch_of_missing_row_is_404(fake_db):
    fake_db(FakeConnection(rows=[]))
    assert client.patch("/api/v1/products/nope", json={"is_active": True}).status_code == 404


def test_database_down_is_503_everywhere(monkeypatch):
    monkeypatch.setattr(database, "_conn_params", {"server": "fake"})

    def down():
        raise OSError("connection refused")

    monkeypatch.setattr(database, "open_connection", down)
    assert client.get("/api/v1/products").status_code == 503
    assert client.get("/api/v1/optimize/catalog").status_code == 503
    res = client.post("/api/v1/products", json={"material_no": "990555", "description": "x", "group_code": "BR150"})
    assert res.status_code == 503
    assert "NOT saved" in res.json()["detail"]


# ----------------------------------------------------------------------------
# schema file, compose wiring and mock data
# ----------------------------------------------------------------------------
PLANNING_SQL = (REPO / "init-db" / "03-planning.sql").read_text(encoding="utf-8")


def _table_columns(table):
    block = re.search(r"CREATE TABLE dbo\.%s \((.*?)\n    \);" % table, PLANNING_SQL, re.S).group(1)
    return tuple(re.findall(r"^\s{8}(\w+)\s+(?:NVARCHAR|DECIMAL|BIT|DATETIME2|DATE|INT)\b", block, re.M))


def test_every_planning_table_is_created_idempotently():
    for table in ("Products", "StockSnapshots", "QcLots", "SalesOrders", "DemandForecasts"):
        assert "IF OBJECT_ID(N'dbo.%s', N'U') IS NULL" % table in PLANNING_SQL
        assert _table_columns(table)


def test_store_columns_match_the_products_table():
    assert _table_columns("Products") == products.COLUMNS
    assert set(products.EDITABLE.values()) <= set(products.COLUMNS)


def test_db_init_runs_the_planning_schema():
    compose = (REPO / "docker-compose.yml").read_text(encoding="utf-8")
    assert "/init-db/02-app-login.sql,/init-db/03-planning.sql" in compose


def test_mock_products_fit_the_table_and_the_plant_groups():
    with open(MOCK / "products.csv", encoding="utf-8", newline="") as fh:
        header = next(csv.reader(fh))
    assert tuple(header) == products.COLUMNS[:5]
    groups = {g["id"] for g in plant_groups()}
    assert {p.group_code for p in products.load_mock_products()} <= groups


def test_mock_sap_files_only_name_mock_products():
    known = {p.material_no for p in products.load_mock_products()}
    for name in ("sap_stock.csv", "sap_qc_lots.csv", "sap_sales_orders.csv"):
        with open(MOCK / name, encoding="utf-8", newline="") as fh:
            rows = list(csv.reader(fh))[1:]          # row 0 is the title row
        index = rows[0].index("Material Number")
        assert {r[index] for r in rows[1:]} <= known, name


# ----------------------------------------------------------------------------
# seed script
# ----------------------------------------------------------------------------
def test_billing_products_keeps_recent_materials_of_plant_groups():
    df = pd.DataFrame({
        "Material Number": ["100001", "100001", "100002", "100003", "100004", "100005"],
        "Mat Description": ["UBEPOL T1", "UBEPOL T1", "UBEPOL T2", "UBEPOL T3", "UBEPOL T4", "UBEPOL T5"],
        "Grade": ["UBEPOL BR150", "UBEPOL BR150", "UBEPOL VCR412", "UBEPOL BR150GN", "UBEPOL BR150", "UBEPOL BR150L"],
        "_date": pd.to_datetime(["2026-01-05", "2026-02-05", "2026-03-01", "2026-03-01", "2023-01-01", "2026-03-01"]),
        "_qty": [10.0, 5.0, 20.0, 3.0, 40.0, -2.0],
    })
    found, skipped = seed.billing_products(df, {"BR150", "BR150L", "VCR412"}, since=pd.Timestamp("2025-01-01").date())
    assert [(p.material_no, p.group_code, p.description, p.min_stock_tons) for p in found] == [
        ("100001", "BR150", "UBEPOL T1", 0.0),
        ("100002", "VCR412", "UBEPOL T2", 0.0),
    ]   # 100003: grade not in the plant, 100004: too old, 100005: only a return
    assert skipped == {"UBEPOL BR150GN": 1}


def test_seed_adds_missing_products_and_keeps_existing_ones(monkeypatch, capsys):
    existing = products.Product(
        material_no="990101", description="edited by a planner", group_code="BR150",
        min_stock_tons=999, is_active=True, updated_at=datetime.now(), updated_by="planner")
    target = products.MemoryProductStore([existing])
    monkeypatch.setattr(seed, "SqlProductStore", lambda: target)
    monkeypatch.setattr(database, "connect_database", lambda: None)
    monkeypatch.setattr(database, "is_configured", lambda: True)

    assert seed.main(["--source", "mock"]) == 0
    assert "Added 12 product(s); 1 already present" in capsys.readouterr().out
    assert len(target.list()) == 13
    assert target.get("990101").min_stock_tons == 999


def test_seed_without_a_database_writes_nothing(monkeypatch):
    monkeypatch.setattr(database, "connect_database", lambda: None)
    assert seed.main(["--source", "mock"]) == 1
    assert seed.main(["--source", "mock", "--dry-run"]) == 0
