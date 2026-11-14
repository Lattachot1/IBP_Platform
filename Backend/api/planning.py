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
from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from optimization.engine import plant_groups
from planning_data import imports, products, store
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
