"""Feed the client's Sale forecast into dbo.DemandForecasts.

The 'Sale forecast' sheet of the Product Status workbook holds the
planner's own demand: one row per customer within a market segment (the
'Grade name' column) and one column per month. Segments roll up to the
plant groups by their grade token (BR150(MN) ST -> BR150) and the totals
are upserted as Source='manual' rows - the planner's level, which
overrides the engine's statistical forecast in planning. That also gives
demand to BR150LGN, whose billing history is too short for an engine
model. Segments of grades that are not a plant group (BR150GN) are
skipped and listed. The workbook stays on the host, never in git.
"""

import logging
import re
from datetime import date, datetime, timezone
from typing import List, Optional, Tuple

from planning_data.records import Forecast

log = logging.getLogger("ibp.planning_data.sale_forecast")

SALE_EDITOR = "sale forecast file"

# Longest first: BR150LGN / BR150GN / BR150B / BR150L must win over BR150
_GROUP_PREFIXES = ("BR150LGN", "BR150GN", "BR150B", "BR150L", "BR360B", "VCR412", "VCR617", "BR150")

_SUMMARY_SEGMENT = re.compile(r"total|og sales|grand", re.IGNORECASE)

_last: dict = {"status": "never"}


def group_of_segment(segment: str, groups: List[str]) -> Optional[str]:
    """'BR150(MN) ST' -> 'BR150'; None when the segment's grade is no group."""
    plain = re.sub(r"[\s\-]+", "", segment)
    for prefix in _GROUP_PREFIXES:
        if plain.startswith(prefix):
            return prefix if prefix in set(groups) else None
    return None


def find_status_workbook():
    """The client's Product Status workbook in DemandModel/ (never in git)."""
    from forecasting.data import DATA_DIR

    workbooks = sorted(DATA_DIR.glob("Product Status*.xlsx"))
    if not workbooks:
        raise FileNotFoundError(
            "no DemandModel/Product Status*.xlsx found - put the client's workbook there")
    return workbooks[0]


def parse_sale_forecast(workbook, groups: List[str], from_month: date
                        ) -> Tuple[List[Forecast], List[str], List[date]]:
    """'Sale forecast' rows -> (manual forecast rows from from_month on,
    segments skipped because their grade is no plant group, months read).

    A segment's monthly demand is the sum of its customer rows; rows whose
    grade name is a summary line (totals, OG sales) are ignored.
    """
    sheet = workbook["Sale forecast"]
    rows_iter = sheet.iter_rows(min_row=2, values_only=True)
    header = next(rows_iter)
    months = [(i, date(c.year, c.month, 1)) for i, c in enumerate(header) if isinstance(c, datetime)]
    usable = [(i, m) for i, m in months if m >= from_month]

    by_segment: dict = {}
    segment = None
    for row in rows_iter:
        if row[0] is not None:
            segment = re.sub(r"\s+", " ", str(row[0])).strip()
        if segment is None or _SUMMARY_SEGMENT.search(segment):
            continue
        for index, month in usable:
            value = row[index] if index < len(row) else None
            if isinstance(value, (int, float)) and value:
                month_tons = by_segment.setdefault(segment, {})
                month_tons[month] = month_tons.get(month, 0.0) + float(value)

    totals: dict = {}
    skipped: List[str] = []
    for segment, month_tons in by_segment.items():
        group = group_of_segment(segment, groups)
        if group is None:
            skipped.append(segment)
            continue
        for month, tons in month_tons.items():
            totals[(group, month)] = totals.get((group, month), 0.0) + tons

    rows = [Forecast(group_code=g, forecast_month=m, source="manual", tons=round(t, 3))
            for (g, m), t in sorted(totals.items())]
    return rows, skipped, sorted({m for _, m in months})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def publish(dry_run: bool = False, today: Optional[date] = None, workbook=None) -> dict:
    """Upsert the Sale forecast as 'manual' rows; returns a report.

    Raises FileNotFoundError (no workbook), StoreUnavailable (database
    down) or WriteRejected (rows refused).
    """
    global _last
    from optimization.engine import plant_groups
    from planning_data import store

    groups = [g["id"] for g in plant_groups()]
    from_month = (today or date.today()).replace(day=1)
    if workbook is None:
        import openpyxl
        workbook = openpyxl.load_workbook(find_status_workbook(), read_only=True)
    rows, skipped, months_read = parse_sale_forecast(workbook, groups, from_month)
    written = store.get_store().upsert_forecasts(rows, SALE_EDITOR, dry_run=dry_run)
    months = sorted({r.forecast_month for r in rows})
    report = {
        "status": "checked" if dry_run else "published",
        "at": _now(),
        "rows": len(rows),
        "groups": sorted({r.group_code for r in rows}),
        "first_month": months[0].strftime("%Y-%m") if months else None,
        "last_month": months[-1].strftime("%Y-%m") if months else None,
        "months_in_file": len(months_read),
        "skipped_segments": skipped,
        "dry_run": dry_run,
        **written.as_dict(),
    }
    if not dry_run:
        _last = report
    return report


def clear(dry_run: bool = False) -> dict:
    """Delete the manual rows this import wrote, so the engine's forecast
    takes over again. Returns how many rows (would be) deleted."""
    global _last
    from planning_data import store

    deleted = store.get_store().delete_forecasts_by_editor(SALE_EDITOR, dry_run=dry_run)
    report = {"status": "checked" if dry_run else "cleared", "deleted": deleted, "dry_run": dry_run}
    if not dry_run:
        _last = report
    return report


def last_publish() -> dict:
    """What the last publish did, for /api/health."""
    return dict(_last)
