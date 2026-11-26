"""Import and read the planning data: stock, QC lots, sales orders, forecasts.

Imports take the CSV file as the raw request body (Content-Type: text/csv),
for example:

    curl -X POST "http://localhost:8080/api/v1/imports/sales-orders?dry_run=true" \\
         -H "Content-Type: text/csv" --data-binary @sap_sales_orders.csv

Every import is all-or-nothing. A file with any error is rejected with 422
and a report naming each line and column; a good file answers 200 with
how many rows were inserted / updated (dry_run=true: what would happen,
nothing is kept). Materials must already be in the product master.

No login yet (roadmap step 5): anyone who can reach the backend can import
stock or hand-enter stock adjustments.
"""

import logging
import re
from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from optimization.engine import plant_groups
from optimization.planning import product_demand_grid
from planning_data import imports, products, stock_workbook, store
from planning_data.records import Forecast, QcLot, SalesOrder, StockAdjustment, StockSnapshot
from planning_data.sql import StoreUnavailable, WriteRejected

log = logging.getLogger("ibp.api.planning")

router = APIRouter(tags=["planning data"])

def _editor():
    # a fresh Query per parameter: one shared instance would carry the first parameter's name
    return Query(default=products.DEFAULT_EDITOR, min_length=1, max_length=50)


CSV_BODY = {
    "requestBody": {
        "required": True,
        "content": {"text/csv": {"schema": {"type": "string", "format": "binary"}}},
    }
}


def _unavailable(action: str) -> HTTPException:
    log.exception("[Database] Planning data: %s", action)
    return HTTPException(status_code=503, detail="Database unavailable: %s" % action)


async def _upload(request: Request) -> bytes:
    data = await request.body()
    if len(data) > imports.MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large (limit %d MB)" % (imports.MAX_BYTES // 2**20))
    if not data.strip():
        raise HTTPException(status_code=422, detail="The request body is empty: send the CSV file as the body")
    return data


def _product_index() -> dict:
    try:
        return {p.material_no: p for p in products.get_store().list()}
    except StoreUnavailable:
        raise _unavailable("could not load the product master")


def _finish(parsed: imports.Parsed, dry_run: bool, write) -> JSONResponse:
    """Reject a file with errors (422), otherwise write it and report the counts."""
    report = dict(parsed.report(), dry_run=dry_run)
    if parsed.errors:
        return JSONResponse(status_code=422, content={
            "detail": "%d problem(s) in the %s file - nothing was imported" % (len(parsed.errors), parsed.kind),
            "report": report,
        })
    try:
        result = write()
    except WriteRejected as exc:
        return JSONResponse(status_code=422, content={"detail": str(exc), "report": report})
    except StoreUnavailable:
        raise _unavailable("%s file NOT imported" % parsed.kind)
    return JSONResponse(status_code=200, content=dict(report, **result.as_dict()))


# ----------------------------------------------------------------------------
# imports
# ----------------------------------------------------------------------------
@router.post("/api/v1/imports/stock", openapi_extra=CSV_BODY)
async def handle_import_stock(request: Request, stock_date: Optional[date] = None,
                              dry_run: bool = False, loaded_by: str = _editor()):
    """SAP stock list. Replaces the whole snapshot of its date (from the
    'Stock Date' column, or `stock_date` when the file has none)."""
    data = await _upload(request)

    def run():
        parsed = imports.parse_stock(data, _product_index(), stock_date)
        return _finish(parsed, dry_run, lambda: store.get_store().replace_stock(
            parsed.snapshot_date, parsed.records, loaded_by, dry_run=dry_run))

    return await run_in_threadpool(run)


@router.post("/api/v1/imports/stock-workbook")
async def handle_import_stock_workbook(dry_run: bool = False, loaded_by: str = _editor()):
    """Stock from the Product Status workbook's InventoryDaily_ZMMR021
    sheet: the raw SAP stock report per material and batch, where the
    batch name carries the market code ('908301HM' -> 400003-HM). Keeps
    the UNRESTRICTED tons of the latest dated rows and replaces the whole
    snapshot of that date, like every stock import. dry_run=true counts
    the rows without keeping them."""
    def run():
        parsed = stock_workbook.parse(stock_workbook.load_status_workbook(), _product_index())
        return _finish(parsed, dry_run, lambda: store.get_store().replace_stock(
            parsed.snapshot_date, parsed.records, loaded_by, dry_run=dry_run))

    try:
        return await run_in_threadpool(run)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/api/v1/imports/qc-lots", openapi_extra=CSV_BODY)
async def handle_import_qc_lots(request: Request, dry_run: bool = False):
    """SAP inspection lots, upserted by lot number."""
    data = await _upload(request)

    def run():
        parsed = imports.parse_qc_lots(data, _product_index())
        return _finish(parsed, dry_run, lambda: store.get_store().upsert_qc_lots(parsed.records, dry_run=dry_run))

    return await run_in_threadpool(run)


@router.post("/api/v1/imports/sales-orders", openapi_extra=CSV_BODY)
async def handle_import_sales_orders(request: Request, dry_run: bool = False):
    """SAP sales order items, upserted by order + item. Items missing from the
    file are left as they are: close them by sending Completed or Rejected."""
    data = await _upload(request)

    def run():
        parsed = imports.parse_sales_orders(data, _product_index())
        return _finish(parsed, dry_run, lambda: store.get_store().upsert_sales_orders(parsed.records, dry_run=dry_run))

    return await run_in_threadpool(run)


@router.post("/api/v1/imports/forecasts", openapi_extra=CSV_BODY)
async def handle_import_forecasts(request: Request, dry_run: bool = False, updated_by: str = _editor()):
    """Monthly forecast per product group (GroupCode, ForecastMonth, Source, Tons),
    upserted by group + month + source."""
    data = await _upload(request)

    def run():
        parsed = imports.parse_forecasts(data, [g["id"] for g in plant_groups()])
        return _finish(parsed, dry_run, lambda: store.get_store().upsert_forecasts(
            parsed.records, updated_by, dry_run=dry_run))

    return await run_in_threadpool(run)


# ----------------------------------------------------------------------------
# hand-entered stock
# ----------------------------------------------------------------------------
class StockAdjustmentUpdate(BaseModel):
    tons: Optional[float] = Field(default=None, ge=0, allow_inf_nan=False)


@router.put("/api/v1/stock-adjustments/{material_no}", response_model=Optional[StockAdjustment])
def handle_set_stock_adjustment(material_no: str, req: StockAdjustmentUpdate,
                                updated_by: str = _editor()) -> Optional[StockAdjustment]:
    """Hand-enter one material's on-hand stock: the planner's corrected
    figure, used instead of the imported snapshot value and also when no
    snapshot has been imported at all (e.g. before the SAP feed arrives).
    `tons: null` clears the adjustment back to the imported value."""
    key = material_no.strip().upper()
    if key not in _product_index():
        raise HTTPException(status_code=422, detail="%s is not in the product master" % key)
    try:
        return store.get_store().set_stock_adjustment(key, req.tons, updated_by)
    except StoreUnavailable:
        raise _unavailable("could not save the stock adjustment")


# ----------------------------------------------------------------------------
# reads
# ----------------------------------------------------------------------------
@router.get("/api/v1/stock", response_model=StockSnapshot)
def handle_read_stock(on: Optional[date] = None) -> StockSnapshot:
    """The latest stock snapshot (on or before `on` when given) plus every
    hand-entered stock adjustment."""
    try:
        return store.get_store().stock_snapshot(on)
    except StoreUnavailable:
        raise _unavailable("could not load stock")


@router.get("/api/v1/qc-lots", response_model=List[QcLot])
def handle_read_qc_lots(status: Optional[Literal["in_qc", "released", "rejected"]] = None) -> List[QcLot]:
    try:
        return store.get_store().qc_lots(status)
    except StoreUnavailable:
        raise _unavailable("could not load QC lots")


@router.get("/api/v1/sales-orders", response_model=List[SalesOrder])
def handle_read_sales_orders(status: Optional[Literal["open", "closed", "cancelled"]] = None,
                             due_from: Optional[date] = None, due_to: Optional[date] = None) -> List[SalesOrder]:
    try:
        return store.get_store().sales_orders(status, due_from, due_to)
    except StoreUnavailable:
        raise _unavailable("could not load sales orders")


@router.get("/api/v1/forecasts", response_model=List[Forecast])
def handle_read_forecasts(month_from: Optional[date] = None, month_to: Optional[date] = None) -> List[Forecast]:
    try:
        return store.get_store().forecasts(month_from, month_to)
    except StoreUnavailable:
        raise _unavailable("could not load forecasts")


# ----------------------------------------------------------------------------
# hand-set forecasts (planner edits on the /optimize page)
# ----------------------------------------------------------------------------
_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _parse_month(text: str) -> date:
    if not _MONTH_RE.match(text or ""):
        raise HTTPException(status_code=422, detail="Month must look like '2026-11'")
    year, month = int(text[:4]), int(text[5:7])
    return date(year, month, 1)


def _shift_month(first: date, count: int) -> date:
    total = first.month - 1 + count
    return date(first.year + total // 12, total % 12 + 1, 1)


def _plant_group_ids() -> List[str]:
    return [g["id"] for g in plant_groups()]


@router.get("/api/v1/product-demand-grid")
def handle_product_demand_grid(start_month: str, months: int = Query(default=3, ge=1, le=12)) -> list:
    """Product order floors and proposed demand derived from stored grade forecasts."""
    first = _parse_month(start_month)
    month_starts = [_shift_month(first, offset) for offset in range(months)]
    try:
        st = store.get_store()
        return product_demand_grid(
            _plant_group_ids(), products.get_store().list(), st.sales_orders(),
            st.forecasts(first, month_starts[-1]), month_starts,
        )
    except StoreUnavailable:
        raise _unavailable("could not load the product demand grid")


class ForecastUpdate(BaseModel):
    tons: float = Field(ge=0, allow_inf_nan=False)


class ForecastCell(BaseModel):
    group_code: str
    month: date
    tons: Optional[float] = None
    source: Optional[Literal["manual", "engine"]] = None
    updated_by: Optional[str] = None
    ordered_tons: float = 0.0


@router.get("/api/v1/forecast-grid", response_model=List[ForecastCell])
def handle_forecast_grid(start_month: str, months: int = Query(default=3, ge=1, le=12)) -> List[ForecastCell]:
    """The effective monthly forecast per plant group over the given months -
    the manual row when one exists, else the engine's - plus each month's
    order tons, which is the floor a hand-set forecast may not go below."""
    first = _parse_month(start_month)
    last = _shift_month(first, months - 1)
    try:
        st = store.get_store()
        rows = st.forecasts(first, last)
        ordered = st.ordered_tons_by_month(_plant_group_ids(), first, _shift_month(last, 1))
    except StoreUnavailable:
        raise _unavailable("could not load the forecast grid")
    effective = {}
    for row in rows:
        key = (row.group_code, row.forecast_month)
        if row.source == "manual" or key not in effective:
            effective[key] = row
    cells = []
    for group in _plant_group_ids():
        month = first
        for _ in range(months):
            row = effective.get((group, month))
            cells.append(ForecastCell(
                group_code=group, month=month,
                tons=row.tons if row else None, source=row.source if row else None,
                updated_by=row.updated_by if row else None,
                ordered_tons=ordered.get((group, month), 0.0)))
            month = _shift_month(month, 1)
    return cells


@router.put("/api/v1/forecasts/{group_code}/{month}", response_model=Forecast)
def handle_set_forecast(group_code: str, month: str, req: ForecastUpdate,
                        updated_by: str = _editor()) -> Forecast:
    """Hand-set the effective monthly forecast of one group as a 'manual'
    row that overrides the engine's and the Sale forecast's number. The
    planner's rule: orders keep their own due dates and priority, so the
    hand-set forecast may never sit below the month's actual order tons -
    the part above them is demand without a due date, produced within the
    month."""
    month_date = _parse_month(month)
    if group_code not in _plant_group_ids():
        raise HTTPException(status_code=422, detail="%s is not a plant group" % group_code)
    try:
        st = store.get_store()
        ordered = st.ordered_tons_by_month([group_code], month_date, _shift_month(month_date, 1)) \
            .get((group_code, month_date), 0.0)
        if req.tons < ordered - 1e-9:
            raise HTTPException(status_code=422, detail=(
                "Forecast for %s %s cannot go below the month's order tons (%s t): "
                "orders keep their own due dates, the hand-set forecast only adds demand above them"
                % (group_code, month, format(ordered, "g"))))
        st.upsert_forecasts([Forecast(group_code=group_code, forecast_month=month_date,
                                      source="manual", tons=req.tons)], updated_by)
        return next(f for f in st.forecasts(month_date, month_date)
                    if f.group_code == group_code and f.source == "manual")
    except StoreUnavailable:
        raise _unavailable("could not save the hand-set forecast")


@router.delete("/api/v1/forecasts/{group_code}/{month}/manual")
def handle_clear_forecast(group_code: str, month: str) -> dict:
    """Remove the hand-set forecast of one group and month: the engine's or
    the Sale forecast's number shows through again (re-run the Sale forecast
    import to restore that file's value)."""
    month_date = _parse_month(month)
    if group_code not in _plant_group_ids():
        raise HTTPException(status_code=422, detail="%s is not a plant group" % group_code)
    try:
        return {"deleted": store.get_store().delete_forecast(group_code, month_date)}
    except StoreUnavailable:
        raise _unavailable("could not clear the hand-set forecast")
