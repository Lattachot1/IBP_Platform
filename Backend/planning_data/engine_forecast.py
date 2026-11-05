"""Feed the forecast engine's monthly forecast into dbo.DemandForecasts.

The engine forecasts tons per billing grade ("UBEPOL BR150") for the 12
months after its last complete month; the planner reads a forecast per
product group (BR150) and month. publish() turns one into the other and
upserts the rows with Source = 'engine', so:
- a planner's 'manual' row for the same group and month still overrides it
- re-publishing after a retrain replaces the previous engine numbers
- months before the current one are left out (nothing to plan there)

After every successful training the backend publishes on its own, but only
with a database configured: the in-memory store holds the fictitious mock
set, and mixing real forecasts into it would make that set meaningless.
POST /api/v1/forecasts/from-engine publishes on demand in either mode.
"""

import logging
from datetime import date, datetime, timezone
from typing import Iterable, List, Optional, Tuple

import database
from planning_data.records import Forecast
from planning_data.sql import StoreUnavailable, WriteRejected

log = logging.getLogger("ibp.planning_data.engine_forecast")

GRADE_PREFIX = "UBEPOL "
ENGINE_EDITOR = "forecast engine"
HORIZON_MONTHS = 12

_last: dict = {"status": "never"}


def group_of_grade(grade: str, groups: Iterable[str]) -> Optional[str]:
    """'UBEPOL BR150' -> 'BR150' when that is a group of plant_config.yaml, else None."""
    code = grade[len(GRADE_PREFIX):] if grade.startswith(GRADE_PREFIX) else grade
    return code if code in set(groups) else None


def _month(period: str) -> date:
    year, month = period.split("-")[:2]
    return date(int(year), int(month), 1)


def engine_rows(engine: dict, groups: List[str], from_month: date) -> Tuple[List[Forecast], List[str]]:
    """Engine forecast -> (group-month rows from `from_month` on, grades without a plant group)."""
    from forecasting import service

    rows, skipped = [], []
    for grade, info in sorted(engine["grades"].items()):
        group = group_of_grade(grade, groups)
        if group is None:
            skipped.append(grade)
            continue
        result = service.forecast(info, HORIZON_MONTHS, 0.0)
        for period, tons in zip(result["periods"], result["forecast_tons"]):
            month = _month(str(period))
            if month >= from_month:
                rows.append(Forecast(group_code=group, forecast_month=month, source="engine",
                                     tons=round(max(0.0, float(tons)), 3)))
    return rows, skipped


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> date:
    return date.today()


def publish(engine: dict, dry_run: bool = False, today: Optional[date] = None) -> dict:
    """Upsert the engine's forecast as 'engine' rows; returns a report.

    Raises StoreUnavailable (database down) or WriteRejected (rows refused).
    """
    global _last
    from optimization.engine import plant_groups
    from planning_data import store

    groups = [g["id"] for g in plant_groups()]
    from_month = (today or _today()).replace(day=1)
    rows, skipped = engine_rows(engine, groups, from_month)
    written = store.get_store().upsert_forecasts(rows, ENGINE_EDITOR, dry_run=dry_run)
    months = sorted({r.forecast_month for r in rows})
    report = {
        "status": "checked" if dry_run else "published",
        "at": _now(),
        "trained_at": engine.get("trained_at"),
        "rows": len(rows),
        "groups": sorted({r.group_code for r in rows}),
        "first_month": months[0].strftime("%Y-%m") if months else None,
        "last_month": months[-1].strftime("%Y-%m") if months else None,
        "skipped_grades": skipped,
        "dry_run": dry_run,
        **written.as_dict(),
    }
    if not dry_run:
        _last = report
    return report


def publish_after_training(engine: dict) -> None:
    """Startup / retrain hook: publish in database mode; never raises."""
    global _last
    if not database.is_configured():
        _last = {"status": "skipped", "at": _now(),
                 "reason": "in-memory mode: the mock planning data is kept as it is "
                           "(POST /api/v1/forecasts/from-engine publishes on demand)"}
        return
    try:
        report = publish(engine)
        log.info("[Forecast] Published %d engine forecast rows (%s..%s) to dbo.DemandForecasts",
                 report["rows"], report["first_month"], report["last_month"])
    except (StoreUnavailable, WriteRejected) as exc:
        _last = {"status": "failed", "at": _now(), "error": str(exc)}
        log.warning("[Forecast WARNING] Could not publish the engine forecast: %s", exc)


def last_publish() -> dict:
    """What the last publish did, for /api/health."""
    return dict(_last)
