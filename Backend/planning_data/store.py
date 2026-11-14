"""Stock snapshots, QC lots, sales orders and forecasts: MS SQL or memory.

Writes come from the importers and are all-or-nothing:
- stock: a file is the full snapshot of its date, so it replaces every row
  of that date
- QC lots, sales orders, forecasts: upsert by key; rows missing from a file
  are left as they are
- dry_run=True runs the same writes and rolls them back, so a preview also
  passes the database constraints
- set_stock_adjustment is a hand-entered stock figure (not an import); it
  takes precedence over the imported snapshot and survives every import

Without a database the memory store starts with the fictitious data of
sample_data/mock/ (imported through the same parsers).
"""

import logging
import threading
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import List, Optional

import database
from planning_data import imports, products
from planning_data.records import Forecast, QcLot, SalesOrder, StockAdjustment, StockRow, StockSnapshot
from planning_data.sql import CONSTRAINT_ERRORS, DUPLICATE_KEY_ERRORS, WriteRejected, connection, error_number, utc

log = logging.getLogger("ibp.planning_data")

MOCK_DIR = Path(__file__).resolve().parents[1] / "sample_data" / "mock"


@dataclass
class WriteResult:
    inserted: int = 0
    updated: int = 0
    replaced: int = 0      # stock only: rows of the same date that were replaced

    def as_dict(self) -> dict:
        return asdict(self)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _in_range(value: date, start: Optional[date], end: Optional[date]) -> bool:
    return (start is None or value >= start) and (end is None or value <= end)


# ----------------------------------------------------------------------------
# In-memory store (no database configured)
# ----------------------------------------------------------------------------
class MemoryPlanningStore:
    def __init__(self):
        self._lock = threading.Lock()
        self._stock = {}        # date -> (loaded_at, loaded_by, [StockRow])
        self._adjusts = {}      # material_no -> StockAdjustment
        self._lots = {}         # lot_no -> QcLot
        self._orders = {}       # (order_no, item_no) -> SalesOrder
        self._forecasts = {}    # (group, month, source) -> Forecast

    # -- writes ---------------------------------------------------------------
    def replace_stock(self, snapshot_date: date, rows: List[StockRow], loaded_by: str, dry_run=False) -> WriteResult:
        with self._lock:
            previous = self._stock.get(snapshot_date)
            result = WriteResult(inserted=len(rows), replaced=len(previous[2]) if previous else 0)
            if not dry_run:
                self._stock[snapshot_date] = (_now(), loaded_by, list(rows))
        return result

    def set_stock_adjustment(self, material_no: str, tons: Optional[float], updated_by: str) -> Optional[StockAdjustment]:
        """A hand-entered stock figure for one material (tons=None clears it).

        Works with or without an imported snapshot: the adjustment is the
        planner's figure, it never touches or needs the imported rows."""
        with self._lock:
            if tons is None:
                self._adjusts.pop(material_no, None)
                return None
            adjustment = StockAdjustment(material_no=material_no, adjust_tons=tons,
                                         updated_at=_now(), updated_by=updated_by)
            self._adjusts[material_no] = adjustment
            return adjustment

    def _upsert(self, table: dict, records, key, dry_run) -> WriteResult:
        result = WriteResult()
        with self._lock:
            for record in records:
                k = key(record)
                if k in table:
                    result.updated += 1
                else:
                    result.inserted += 1
                if not dry_run:
                    table[k] = record.model_copy(update={"updated_at": _now()})
        return result

    def upsert_qc_lots(self, lots: List[QcLot], dry_run=False) -> WriteResult:
        return self._upsert(self._lots, lots, lambda r: r.lot_no, dry_run)

    def upsert_sales_orders(self, orders: List[SalesOrder], dry_run=False) -> WriteResult:
        return self._upsert(self._orders, orders, lambda r: (r.order_no, r.item_no), dry_run)

    def upsert_forecasts(self, forecasts: List[Forecast], updated_by: str, dry_run=False) -> WriteResult:
        stamped = [f.model_copy(update={"updated_by": updated_by}) for f in forecasts]
        return self._upsert(self._forecasts, stamped, lambda r: (r.group_code, r.forecast_month, r.source), dry_run)

    # -- reads ----------------------------------------------------------------
    def stock_snapshot(self, on: Optional[date] = None) -> StockSnapshot:
        with self._lock:
            dates = [d for d in self._stock if on is None or d <= on]
            adjustments = sorted(self._adjusts.values(), key=lambda a: a.material_no)
            if not dates:
                return StockSnapshot(adjustments=adjustments)
            day = max(dates)
            loaded_at, loaded_by, rows = self._stock[day]
        return StockSnapshot(snapshot_date=day, loaded_at=loaded_at, loaded_by=loaded_by,
                             rows=sorted(rows, key=lambda r: r.material_no), adjustments=adjustments)

    def qc_lots(self, status: Optional[str] = None) -> List[QcLot]:
        with self._lock:
            lots = [lot for lot in self._lots.values() if status is None or lot.status == status]
        return sorted(lots, key=lambda r: (r.release_date, r.lot_no))

    def sales_orders(self, status=None, due_from=None, due_to=None) -> List[SalesOrder]:
        with self._lock:
            orders = [o for o in self._orders.values()
                      if (status is None or o.status == status) and _in_range(o.due_date, due_from, due_to)]
        return sorted(orders, key=lambda r: (r.due_date, r.order_no, r.item_no))

    def forecasts(self, month_from=None, month_to=None) -> List[Forecast]:
        with self._lock:
            rows = [f for f in self._forecasts.values() if _in_range(f.forecast_month, month_from, month_to)]
        return sorted(rows, key=lambda r: (r.group_code, r.forecast_month, r.source))


# ----------------------------------------------------------------------------
# MS SQL store
# ----------------------------------------------------------------------------
_MERGE_QC_LOT = """
MERGE dbo.QcLots WITH (HOLDLOCK) AS t
USING (SELECT %s AS LotNo, %s AS MaterialNo, %s AS Tons, %s AS ProducedDate, %s AS ReleaseDate, %s AS Status) AS s
ON t.LotNo = s.LotNo
WHEN MATCHED THEN UPDATE SET MaterialNo = s.MaterialNo, Tons = s.Tons, ProducedDate = s.ProducedDate,
    ReleaseDate = s.ReleaseDate, Status = s.Status, UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (LotNo, MaterialNo, Tons, ProducedDate, ReleaseDate, Status)
    VALUES (s.LotNo, s.MaterialNo, s.Tons, s.ProducedDate, s.ReleaseDate, s.Status)
OUTPUT $action;
"""

_MERGE_SALES_ORDER = """
MERGE dbo.SalesOrders WITH (HOLDLOCK) AS t
USING (SELECT %s AS OrderNo, %s AS ItemNo, %s AS MaterialNo, %s AS Tons, %s AS ShippedTons,
              %s AS DueDate, %s AS Status) AS s
ON t.OrderNo = s.OrderNo AND t.ItemNo = s.ItemNo
WHEN MATCHED THEN UPDATE SET MaterialNo = s.MaterialNo, Tons = s.Tons, ShippedTons = s.ShippedTons,
    DueDate = s.DueDate, Status = s.Status, UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (OrderNo, ItemNo, MaterialNo, Tons, ShippedTons, DueDate, Status)
    VALUES (s.OrderNo, s.ItemNo, s.MaterialNo, s.Tons, s.ShippedTons, s.DueDate, s.Status)
OUTPUT $action;
"""

_MERGE_FORECAST = """
MERGE dbo.DemandForecasts WITH (HOLDLOCK) AS t
USING (SELECT %s AS GroupCode, %s AS ForecastMonth, %s AS Source, %s AS Tons, %s AS UpdatedBy) AS s
ON t.GroupCode = s.GroupCode AND t.ForecastMonth = s.ForecastMonth AND t.Source = s.Source
WHEN MATCHED THEN UPDATE SET Tons = s.Tons, UpdatedBy = s.UpdatedBy, UpdatedAt = SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (GroupCode, ForecastMonth, Source, Tons, UpdatedBy)
    VALUES (s.GroupCode, s.ForecastMonth, s.Source, s.Tons, s.UpdatedBy)
OUTPUT $action;
"""


def _execute(cursor, sql, params):
    """Run one statement; a constraint the importer missed becomes WriteRejected."""
    try:
        cursor.execute(sql, params)
    except Exception as exc:
        if error_number(exc) in CONSTRAINT_ERRORS + DUPLICATE_KEY_ERRORS:
            raise WriteRejected("the database refused the file: %s" % exc) from exc
        raise


def _finish(conn, dry_run: bool) -> None:
    if dry_run:
        conn.rollback()
    else:
        conn.commit()


class SqlPlanningStore:
    # -- writes ---------------------------------------------------------------
    def replace_stock(self, snapshot_date: date, rows: List[StockRow], loaded_by: str, dry_run=False) -> WriteResult:
        with connection() as conn, conn.cursor() as cursor:
            _execute(cursor, "DELETE FROM dbo.StockSnapshots WHERE SnapshotDate = %s;", (snapshot_date,))
            result = WriteResult(inserted=len(rows), replaced=max(cursor.rowcount, 0))
            for row in rows:
                _execute(cursor, "INSERT INTO dbo.StockSnapshots (SnapshotDate, MaterialNo, OnHandTons, LoadedBy) "
                                 "VALUES (%s, %s, %s, %s);",
                         (snapshot_date, row.material_no, row.on_hand_tons, loaded_by))
            _finish(conn, dry_run)
        return result

    def set_stock_adjustment(self, material_no: str, tons: Optional[float], updated_by: str) -> Optional[StockAdjustment]:
        """Upsert one hand-entered stock figure; None clears it again.

        Works with or without an imported snapshot: the adjustment is the
        planner's figure, it never touches or needs the imported rows."""
        stamped = None
        with connection() as conn, conn.cursor(as_dict=True) as cursor:
            if tons is None:
                cursor.execute("DELETE FROM dbo.StockAdjustments WHERE MaterialNo = %s;", (material_no,))
            else:
                _execute(cursor,
                         "MERGE dbo.StockAdjustments WITH (HOLDLOCK) AS t "
                         "USING (SELECT %s AS MaterialNo, %s AS AdjustTons, %s AS UpdatedBy) AS s "
                         "ON t.MaterialNo = s.MaterialNo "
                         "WHEN MATCHED THEN UPDATE SET AdjustTons = s.AdjustTons, UpdatedBy = s.UpdatedBy, "
                         "UpdatedAt = SYSUTCDATETIME() "
                         "WHEN NOT MATCHED THEN INSERT (MaterialNo, AdjustTons, UpdatedBy) "
                         "VALUES (s.MaterialNo, s.AdjustTons, s.UpdatedBy);",
                         (material_no, tons, updated_by))
                cursor.execute("SELECT UpdatedAt FROM dbo.StockAdjustments WHERE MaterialNo = %s;", (material_no,))
                stamped = utc(cursor.fetchone()["UpdatedAt"])
            _finish(conn, False)
        return None if tons is None else StockAdjustment(
            material_no=material_no, adjust_tons=tons, updated_at=stamped, updated_by=updated_by)

    def _merge(self, sql, params_list, dry_run) -> WriteResult:
        result = WriteResult()
        with connection() as conn, conn.cursor() as cursor:
            for params in params_list:
                _execute(cursor, sql, params)
                action = cursor.fetchone()[0]
                if action == "INSERT":
                    result.inserted += 1
                else:
                    result.updated += 1
            _finish(conn, dry_run)
        return result

    def upsert_qc_lots(self, lots: List[QcLot], dry_run=False) -> WriteResult:
        return self._merge(_MERGE_QC_LOT, [
            (r.lot_no, r.material_no, r.tons, r.produced_date, r.release_date, r.status) for r in lots
        ], dry_run)

    def upsert_sales_orders(self, orders: List[SalesOrder], dry_run=False) -> WriteResult:
        return self._merge(_MERGE_SALES_ORDER, [
            (r.order_no, r.item_no, r.material_no, r.tons, r.shipped_tons, r.due_date, r.status) for r in orders
        ], dry_run)

    def upsert_forecasts(self, forecasts: List[Forecast], updated_by: str, dry_run=False) -> WriteResult:
        return self._merge(_MERGE_FORECAST, [
            (r.group_code, r.forecast_month, r.source, r.tons, updated_by) for r in forecasts
        ], dry_run)

    # -- reads ----------------------------------------------------------------
    def stock_snapshot(self, on: Optional[date] = None) -> StockSnapshot:
        with connection() as conn, conn.cursor(as_dict=True) as cursor:
            if on is None:
                cursor.execute("SELECT MAX(SnapshotDate) AS Day FROM dbo.StockSnapshots;")
            else:
                cursor.execute("SELECT MAX(SnapshotDate) AS Day FROM dbo.StockSnapshots WHERE SnapshotDate <= %s;", (on,))
            day = cursor.fetchone()["Day"]
            # hand-entered figures are not dated, so they always come along
            cursor.execute("SELECT MaterialNo, AdjustTons, UpdatedAt, UpdatedBy FROM dbo.StockAdjustments "
                           "ORDER BY MaterialNo;")
            adjustments = cursor.fetchall()
            if day is None:
                return StockSnapshot(adjustments=[self._adjustment(r) for r in adjustments])
            cursor.execute("SELECT MaterialNo, OnHandTons, LoadedAt, LoadedBy FROM dbo.StockSnapshots "
                           "WHERE SnapshotDate = %s ORDER BY MaterialNo;", (day,))
            rows = cursor.fetchall()
        return StockSnapshot(
            snapshot_date=day,
            loaded_at=utc(max(r["LoadedAt"] for r in rows)),
            loaded_by=rows[0]["LoadedBy"],
            rows=[StockRow(material_no=r["MaterialNo"], on_hand_tons=float(r["OnHandTons"])) for r in rows],
            adjustments=[self._adjustment(r) for r in adjustments],
        )

    @staticmethod
    def _adjustment(row: dict) -> StockAdjustment:
        return StockAdjustment(material_no=row["MaterialNo"], adjust_tons=float(row["AdjustTons"]),
                               updated_at=utc(row["UpdatedAt"]), updated_by=row["UpdatedBy"])

    def qc_lots(self, status: Optional[str] = None) -> List[QcLot]:
        sql = "SELECT LotNo, MaterialNo, Tons, ProducedDate, ReleaseDate, Status, UpdatedAt FROM dbo.QcLots"
        params = None
        if status is not None:
            sql, params = sql + " WHERE Status = %s", (status,)
        with connection() as conn, conn.cursor(as_dict=True) as cursor:
            cursor.execute(sql + " ORDER BY ReleaseDate, LotNo;", params)
            rows = cursor.fetchall()
        return [QcLot(lot_no=r["LotNo"], material_no=r["MaterialNo"], tons=float(r["Tons"]),
                      produced_date=r["ProducedDate"], release_date=r["ReleaseDate"],
                      status=r["Status"], updated_at=utc(r["UpdatedAt"])) for r in rows]

    def sales_orders(self, status=None, due_from=None, due_to=None) -> List[SalesOrder]:
        where, params = [], []
        for clause, value in (("Status = %s", status), ("DueDate >= %s", due_from), ("DueDate <= %s", due_to)):
            if value is not None:
                where.append(clause)
                params.append(value)
        sql = ("SELECT OrderNo, ItemNo, MaterialNo, Tons, ShippedTons, DueDate, Status, UpdatedAt "
               "FROM dbo.SalesOrders" + (" WHERE " + " AND ".join(where) if where else "")
               + " ORDER BY DueDate, OrderNo, ItemNo;")
        with connection() as conn, conn.cursor(as_dict=True) as cursor:
            cursor.execute(sql, tuple(params) or None)
            rows = cursor.fetchall()
        return [SalesOrder(order_no=r["OrderNo"], item_no=r["ItemNo"], material_no=r["MaterialNo"],
                           tons=float(r["Tons"]), shipped_tons=float(r["ShippedTons"]), due_date=r["DueDate"],
                           status=r["Status"], updated_at=utc(r["UpdatedAt"])) for r in rows]

    def forecasts(self, month_from=None, month_to=None) -> List[Forecast]:
        where, params = [], []
        for clause, value in (("ForecastMonth >= %s", month_from), ("ForecastMonth <= %s", month_to)):
            if value is not None:
                where.append(clause)
                params.append(value)
        sql = ("SELECT GroupCode, ForecastMonth, Source, Tons, UpdatedAt, UpdatedBy FROM dbo.DemandForecasts"
               + (" WHERE " + " AND ".join(where) if where else "")
               + " ORDER BY GroupCode, ForecastMonth, Source;")
        with connection() as conn, conn.cursor(as_dict=True) as cursor:
            cursor.execute(sql, tuple(params) or None)
            rows = cursor.fetchall()
        return [Forecast(group_code=r["GroupCode"], forecast_month=r["ForecastMonth"], source=r["Source"],
                         tons=float(r["Tons"]), updated_at=utc(r["UpdatedAt"]), updated_by=r["UpdatedBy"])
                for r in rows]


# ----------------------------------------------------------------------------
# Store selection
# ----------------------------------------------------------------------------
_sql_store = SqlPlanningStore()
_memory_store: Optional[MemoryPlanningStore] = None
_memory_lock = threading.Lock()


def load_mock_data(store: MemoryPlanningStore, product_index: dict, groups: List[str]) -> None:
    """Fill a memory store with the sample_data/mock files (through the real parsers)."""
    read = lambda name: (MOCK_DIR / name).read_bytes()  # noqa: E731
    stock = imports.parse_stock(read("sap_stock.csv"), product_index)
    lots = imports.parse_qc_lots(read("sap_qc_lots.csv"), product_index)
    orders = imports.parse_sales_orders(read("sap_sales_orders.csv"), product_index)
    forecasts = imports.parse_forecasts(read("forecast_monthly.csv"), groups)
    for parsed in (stock, lots, orders, forecasts):
        if parsed.errors:
            raise ValueError("sample_data/mock is inconsistent: %s" % parsed.errors[0])
    store.replace_stock(stock.snapshot_date, stock.records, "sample data")
    store.upsert_qc_lots(lots.records)
    store.upsert_sales_orders(orders.records)
    store.upsert_forecasts(forecasts.records, "sample data")


def memory_store() -> MemoryPlanningStore:
    global _memory_store
    with _memory_lock:
        if _memory_store is None:
            from optimization.engine import plant_groups

            store = MemoryPlanningStore()
            index = {p.material_no: p for p in products.memory_store().list()}
            load_mock_data(store, index, [g["id"] for g in plant_groups()])
            log.warning("[Planning data] In-memory mode: loaded the fictitious sample_data/mock files")
            _memory_store = store
        return _memory_store


def get_store():
    """The database tables when a database is configured, otherwise memory."""
    return _sql_store if database.is_configured() else memory_store()
