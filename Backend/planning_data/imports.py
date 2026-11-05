"""Parse uploaded CSV files into planning records, with a row-level report.

The SAP-style files (stock, QC lots, sales orders) follow the layout of the
client's exports, see sample_data/README.md:
- an optional title row may sit above the header (the header is found
  among the first rows), column names match case-insensitively and extra
  columns are ignored
- quantities are tons (SU = TO); SU = KG is converted; SAP's trailing
  minus ("12.5-") and thousands separators ("1,234.5") are understood
- dates are yyyy/mm/dd, yyyy-mm-dd or dd.mm.yyyy
- text is UTF-8 or Thai Windows (cp874)

A file is all-or-nothing: any error rejects the whole file, and the report
says which line and column. Warnings never block an import.
"""

import csv
import io
import math
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Dict, Iterable, List, Optional

from planning_data.records import Forecast, QcLot, SalesOrder, StockRow

MAX_BYTES = 5 * 1024 * 1024
MAX_REPORTED = 200            # problems listed in a report; the count is always exact
HEADER_SCAN_ROWS = 10
DATE_FORMATS = ("%Y/%m/%d", "%Y-%m-%d", "%d.%m.%Y")
TON_UNITS = {"": 1.0, "TO": 1.0, "TON": 1.0, "T": 1.0, "KG": 0.001}

QC_DECISIONS = {"": "in_qc", "A": "released", "R": "rejected"}
ORDER_STATUS = {
    "": "open", "open": "open", "in process": "open", "being processed": "open",
    "completed": "closed", "closed": "closed",
    "rejected": "cancelled", "cancelled": "cancelled",
}


@dataclass
class Problem:
    row: Optional[int]          # line in the file (1-based); None = the whole file
    column: Optional[str]
    message: str

    def as_dict(self) -> dict:
        return {"row": self.row, "column": self.column, "message": self.message}


@dataclass
class Parsed:
    kind: str
    rows_read: int = 0
    records: list = field(default_factory=list)
    errors: List[Problem] = field(default_factory=list)
    warnings: List[Problem] = field(default_factory=list)
    snapshot_date: Optional[date] = None      # stock only

    def error(self, row, column, message):
        self.errors.append(Problem(row, column, message))

    def warn(self, row, column, message):
        self.warnings.append(Problem(row, column, message))

    def report(self) -> dict:
        return {
            "kind": self.kind,
            "rows_read": self.rows_read,
            "records": len(self.records),
            "snapshot_date": self.snapshot_date.isoformat() if self.snapshot_date else None,
            "error_count": len(self.errors),
            "errors": [p.as_dict() for p in self.errors[:MAX_REPORTED]],
            "warning_count": len(self.warnings),
            "warnings": [p.as_dict() for p in self.warnings[:MAX_REPORTED]],
        }


class BadCell(ValueError):
    pass


# ----------------------------------------------------------------------------
# text and cell helpers
# ----------------------------------------------------------------------------
def decode(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp874"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise BadCell("the file is neither UTF-8 nor Thai Windows (cp874) text")


def number(text: str) -> float:
    raw = text.strip().replace(",", "")
    negative = raw.endswith("-")             # SAP writes negatives as "12.5-"
    if negative:
        raw = raw[:-1].strip()
    try:
        value = float(raw)
    except ValueError:
        raise BadCell("'%s' is not a number" % text.strip()) from None
    if not math.isfinite(value):
        raise BadCell("'%s' is not a finite number" % text.strip())
    return -value if negative else value


def tons(text: str, unit: str) -> float:
    factor = TON_UNITS.get(unit.strip().upper())
    if factor is None:
        raise BadCell("unit '%s' is not supported (use TO or KG)" % unit.strip())
    return round(number(text) * factor, 3)


def parse_date(text: str) -> date:
    raw = text.strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    raise BadCell("'%s' is not a date (use yyyy/mm/dd, yyyy-mm-dd or dd.mm.yyyy)" % raw)


def parse_month(text: str) -> date:
    """First day of a month from 'yyyy-mm', 'yyyy/mm' or a date on the 1st."""
    raw = text.strip()
    for fmt in ("%Y-%m", "%Y/%m"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    day = parse_date(raw)
    if day.day != 1:
        raise BadCell("'%s' is not the first day of a month" % raw)
    return day


class Table:
    """The data rows of a CSV file, located by its header row."""

    def __init__(self, text: str, required: List[str], optional: Iterable[str] = ()):
        self.required = required
        self.columns: Dict[str, int] = {}
        self.rows = []                  # (line number, cells)
        reader = csv.reader(io.StringIO(text))
        for cells in reader:
            line = reader.line_num
            if not self.columns:
                if line > HEADER_SCAN_ROWS:
                    break
                names = {c.strip().lower(): i for i, c in enumerate(cells)}
                if all(name.lower() in names for name in required):
                    self.columns = {name: names[name.lower()]
                                    for name in list(required) + list(optional) if name.lower() in names}
                continue
            if any(c.strip() for c in cells):
                self.rows.append((line, cells))

    @property
    def found(self) -> bool:
        return bool(self.columns)

    def has(self, name: str) -> bool:
        return name in self.columns

    def cell(self, cells: List[str], name: str) -> str:
        index = self.columns.get(name)
        if index is None or index >= len(cells):
            return ""
        return cells[index].strip()


def _open(kind: str, data: bytes, required: List[str], optional: Iterable[str] = ()):
    parsed = Parsed(kind=kind)
    try:
        text = decode(data)
    except BadCell as exc:
        parsed.error(None, None, str(exc))
        return parsed, None
    table = Table(text, required, optional)
    if not table.found:
        parsed.error(None, None, "header row not found in the first %d lines: expected the columns %s"
                     % (HEADER_SCAN_ROWS, ", ".join(required)))
        return parsed, None
    parsed.rows_read = len(table.rows)
    if not table.rows:
        parsed.error(None, None, "the file has a header but no data rows")
    return parsed, table


def _material(parsed: Parsed, table: Table, line: int, cells, products: dict) -> Optional[str]:
    material = table.cell(cells, "Material Number").upper()
    if not material:
        parsed.error(line, "Material Number", "material number is empty")
        return None
    if material not in products:
        parsed.error(line, "Material Number",
                     "unknown material %s - add it to the product master first" % material)
        return None
    return material


# ----------------------------------------------------------------------------
# the four file kinds
# ----------------------------------------------------------------------------
def parse_stock(data: bytes, products: dict, stock_date: Optional[date] = None) -> Parsed:
    """SAP stock list -> released stock per material (summed over storage locations).

    The snapshot date comes from a 'Stock Date' column or from `stock_date`.
    """
    parsed, table = _open("stock", data, ["Material Number", "Unrestricted"], ["Stock Date", "SU"])
    if table is None:
        return parsed
    totals: Dict[str, float] = {}
    dates = set()
    for line, cells in table.rows:
        day = table.cell(cells, "Stock Date")
        if day:
            try:
                dates.add(parse_date(day))
            except BadCell as exc:
                parsed.error(line, "Stock Date", str(exc))
        material = _material(parsed, table, line, cells, products)
        try:
            quantity = tons(table.cell(cells, "Unrestricted"), table.cell(cells, "SU"))
            if quantity < 0:
                raise BadCell("stock cannot be negative")
        except BadCell as exc:
            parsed.error(line, "Unrestricted", str(exc))
            continue
        if material:
            totals[material] = round(totals.get(material, 0.0) + quantity, 3)

    if len(dates) > 1:
        parsed.error(None, "Stock Date", "the file holds several stock dates (%s): upload one date per file"
                     % ", ".join(sorted(d.isoformat() for d in dates)))
    file_date = next(iter(dates)) if len(dates) == 1 else None
    if stock_date and file_date and stock_date != file_date:
        parsed.error(None, "Stock Date", "the file says %s but stock_date is %s" % (file_date, stock_date))
    parsed.snapshot_date = stock_date or file_date
    bad_dates = any(p.column == "Stock Date" for p in parsed.errors)
    if parsed.snapshot_date is None and not dates and not bad_dates:
        parsed.error(None, "Stock Date", "stock date missing: add a 'Stock Date' column or pass stock_date")
    parsed.records = [StockRow(material_no=m, on_hand_tons=t) for m, t in sorted(totals.items())]
    return parsed


def parse_qc_lots(data: bytes, products: dict) -> Parsed:
    """SAP inspection lots: blank usage decision = still in QC, A = released, R = rejected."""
    required = ["Inspection Lot", "Material Number", "Lot Qty", "Production Date", "Release Date"]
    parsed, table = _open("qc-lots", data, required, ["Usage Decision", "SU"])
    if table is None:
        return parsed
    seen: Dict[str, int] = {}
    for line, cells in table.rows:
        lot_no = table.cell(cells, "Inspection Lot")
        if not lot_no:
            parsed.error(line, "Inspection Lot", "inspection lot is empty")
            continue
        if lot_no in seen:
            parsed.error(line, "Inspection Lot", "lot %s is already on line %d" % (lot_no, seen[lot_no]))
            continue
        seen[lot_no] = line
        material = _material(parsed, table, line, cells, products)
        column = "Lot Qty"
        try:
            quantity = tons(table.cell(cells, "Lot Qty"), table.cell(cells, "SU"))
            if quantity <= 0:
                raise BadCell("lot quantity must be above 0")
            column = "Production Date"
            produced = parse_date(table.cell(cells, "Production Date"))
            column = "Release Date"
            released = parse_date(table.cell(cells, "Release Date"))
            if released < produced:
                raise BadCell("release date %s is before the production date %s" % (released, produced))
            column = "Usage Decision"
            decision = table.cell(cells, "Usage Decision").upper()
            if decision not in QC_DECISIONS:
                raise BadCell("unknown usage decision '%s' (expected blank, A or R)" % decision)
        except BadCell as exc:
            parsed.error(line, column, str(exc))
            continue
        if material:
            parsed.records.append(QcLot(lot_no=lot_no, material_no=material, tons=quantity,
                                        produced_date=produced, release_date=released,
                                        status=QC_DECISIONS[decision]))
    return parsed


def parse_sales_orders(data: bytes, products: dict) -> Parsed:
    """SAP sales order items. Items missing from a file are left as they are."""
    required = ["Sales Order Number", "Sales Order Item", "Material Number", "Order Qty", "Req. Delivery Date"]
    parsed, table = _open("sales-orders", data, required, ["Delivered Qty", "Status", "SU"])
    if table is None:
        return parsed
    seen: Dict[tuple, int] = {}
    for line, cells in table.rows:
        order_no = table.cell(cells, "Sales Order Number")
        column = "Sales Order Item"
        try:
            if not order_no:
                column = "Sales Order Number"
                raise BadCell("sales order number is empty")
            item = number(table.cell(cells, "Sales Order Item"))
            if item <= 0 or item != int(item):
                raise BadCell("item must be a positive whole number")
            key = (order_no, int(item))
            if key in seen:
                raise BadCell("order %s item %d is already on line %d" % (order_no, key[1], seen[key]))
            seen[key] = line
        except BadCell as exc:
            parsed.error(line, column, str(exc))
            continue
        material = _material(parsed, table, line, cells, products)
        unit = table.cell(cells, "SU")
        column = "Order Qty"
        try:
            ordered = tons(table.cell(cells, "Order Qty"), unit)
            if ordered <= 0:
                raise BadCell("order quantity must be above 0")
            column = "Delivered Qty"
            raw_delivered = table.cell(cells, "Delivered Qty")
            delivered = tons(raw_delivered, unit) if raw_delivered else 0.0
            if delivered < 0 or delivered > ordered:
                raise BadCell("delivered %s t must be between 0 and the ordered %s t" % (delivered, ordered))
            column = "Req. Delivery Date"
            due = parse_date(table.cell(cells, "Req. Delivery Date"))
            column = "Status"
            raw_status = table.cell(cells, "Status")
            status = ORDER_STATUS.get(raw_status.lower())
            if status is None:
                raise BadCell("unknown status '%s' (expected Open, In Process, Completed or Rejected)" % raw_status)
        except BadCell as exc:
            parsed.error(line, column, str(exc))
            continue
        if material:
            if status == "open" and not products[material].is_active:
                parsed.warn(line, "Material Number", "open order for the inactive product %s" % material)
            parsed.records.append(SalesOrder(order_no=order_no, item_no=key[1], material_no=material,
                                             tons=ordered, shipped_tons=delivered, due_date=due, status=status))
    return parsed


def parse_forecasts(data: bytes, groups: List[str]) -> Parsed:
    """Monthly forecast per product group. Source defaults to 'manual' (a planner's file)."""
    parsed, table = _open("forecasts", data, ["GroupCode", "ForecastMonth", "Tons"], ["Source"])
    if table is None:
        return parsed
    seen: Dict[tuple, int] = {}
    for line, cells in table.rows:
        group = table.cell(cells, "GroupCode").upper()
        column = "GroupCode"
        try:
            if group not in groups:
                raise BadCell("unknown product group '%s' (plant_config.yaml has %s)" % (group, ", ".join(groups)))
            column = "ForecastMonth"
            month = parse_month(table.cell(cells, "ForecastMonth"))
            column = "Source"
            source = table.cell(cells, "Source").lower() or "manual"
            if source not in ("engine", "manual"):
                raise BadCell("unknown source '%s' (expected engine or manual)" % source)
            column = "Tons"
            quantity = round(number(table.cell(cells, "Tons")), 3)
            if quantity < 0:
                raise BadCell("forecast cannot be negative")
            key = (group, month, source)
            if key in seen:
                column = "ForecastMonth"
                raise BadCell("%s %s (%s) is already on line %d" % (group, month.strftime("%Y-%m"), source, seen[key]))
            seen[key] = line
        except BadCell as exc:
            parsed.error(line, column, str(exc))
            continue
        parsed.records.append(Forecast(group_code=group, forecast_month=month, source=source, tons=quantity))
    return parsed
