"""Stock from the Product Status workbook (InventoryDaily_ZMMR021 sheet).

The sheet is the raw SAP stock report: one row per material, batch and
storage location, where the batch name ends in the market code
('908301HM' -> HM) and 'Mat + Spec.' already combines material and market
into the product code ('400003-ST'). parse() keeps the UNRESTRICTED tons
of the LATEST dated rows per product code - the same definition as the
SAP stock CSV import (In Quality Insp / Blocked stay out: until they
clear QC they are the qc-lots import's business). Quantities are KG and
are divided by 1000 to tons.

'Mat + Spec.' is a formula, so the file must have been saved by Excel at
least once for its values to be readable; when the cache is empty the
code falls back to material + '-' + the batch's trailing letters.
"""

import re
from datetime import date, datetime
from typing import Optional

from planning_data.imports import Parsed
from planning_data.records import StockRow

_BATCH_MARKET = re.compile(r"([A-Z]+)$")

_COL_DATE, _COL_MATERIAL, _COL_BATCH, _COL_CODE, _COL_UNRESTRICTED = 0, 2, 4, 6, 9


def parse(workbook, products: dict) -> Parsed:
    """InventoryDaily rows -> Parsed with the stock rows of the latest date.

    `workbook` must be an open openpyxl workbook loaded with
    data_only=True (tests pass one; the API endpoint loads the file
    itself). Product codes that are not in the master are warned about
    and left out, so one stray row cannot block the rest of the file.
    """
    parsed = Parsed(kind="stock-workbook")
    latest: Optional[date] = None
    tons: dict = {}                   # product code -> unrestricted tons
    for row_no, row in enumerate(workbook["InventoryDaily_ZMMR021"].iter_rows(min_row=2, values_only=True),
                                 start=2):
        raw = row[_COL_DATE]
        if not isinstance(raw, datetime):
            continue
        day = date(raw.year, raw.month, raw.day)
        parsed.rows_read += 1
        if latest is not None and day < latest:
            continue                  # an older day: only the latest one is a snapshot
        if latest is None or day > latest:
            latest, tons = day, {}
        code = _code_of(row)
        if code is None:
            parsed.warn(row_no, "Mat + Spec.",
                        "no readable product code - open and save the workbook in Excel first")
            continue
        if code not in products:
            parsed.warn(row_no, "Mat + Spec.",
                        "unknown product %s - add it to the product master first" % code)
            continue
        kg = row[_COL_UNRESTRICTED]
        if isinstance(kg, (int, float)) and kg:
            tons[code] = tons.get(code, 0.0) + float(kg) / 1000.0

    if latest is None:
        parsed.error(None, None, "the sheet has no dated rows")
        return parsed
    parsed.snapshot_date = latest
    parsed.records = [StockRow(material_no=code, on_hand_tons=round(t, 3)) for code, t in sorted(tons.items())]
    if not parsed.records:
        parsed.error(None, None,
                     "no unrestricted stock rows could be read for %s - open and save the workbook "
                     "in Excel first (the 'Mat + Spec.' formulas must have calculated values)"
                     % latest.isoformat())
    return parsed


def _code_of(row) -> Optional[str]:
    """The product code: the 'Mat + Spec.' cell, else material + '-' + the
    batch's trailing letters."""
    code = row[_COL_CODE]
    if isinstance(code, str) and code.strip():
        return code.strip().upper()
    material = str(row[_COL_MATERIAL]).strip() if row[_COL_MATERIAL] is not None else ""
    batch = str(row[_COL_BATCH]).strip() if row[_COL_BATCH] is not None else ""
    suffix = _BATCH_MARKET.search(batch.upper())
    if material and suffix:
        return "%s-%s" % (material.split("-")[0].upper(), suffix.group(1))
    return None


def load_status_workbook(data_only: bool = True):
    """The first DemandModel/Product Status*.xlsx, opened for reading."""
    import openpyxl

    from planning_data.sale_forecast import find_status_workbook

    return openpyxl.load_workbook(find_status_workbook(), read_only=True, data_only=data_only)
