"""Consume cached real monthly demand forecasts without fitting new models."""
import calendar
import hashlib
import json
import math
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

from plant_scheduling.schemas import GRADES
from .forecast_source import DemandForecastSource
from .schemas import IntegratedRequest, StrictModel

GRADE_MAP = {
    "BR150": "UBEPOL BR150", "BR150L": "UBEPOL BR150L",
    "VCR412": "UBEPOL VCR412", "VCR617": "UBEPOL VCR617",
}


class ForecastBridgeRequest(StrictModel):
    input: IntegratedRequest
    path: Literal["point", "lower", "upper"] = "point"
    allocation: Literal["calendar_days", "working_days"] = "calendar_days"
    partial_month_policy: Literal["prorate", "reject"] = "prorate"
    firm_orders_mode: Literal["preserve", "clear"] = "preserve"


def month_index(period):
    year, month = map(int, period.split("-"))
    return year * 12 + month - 1


def next_month(period):
    index = month_index(period) + 1
    return "%04d-%02d" % (index // 12, index % 12 + 1)


def availability(engine):
    rows = [{"grade": g, "product_id": product, "trained_through": engine["grades"][product]["trained_through"],
             "model_name": engine["grades"][product]["champion"]} for g, product in GRADE_MAP.items() if product in engine["grades"]]
    return {"trained_at": engine["trained_at"], "models": rows,
            "manual_grades": sorted(GRADES - {r["grade"] for r in rows}),
            "earliest_common_month": max((next_month(r["trained_through"]) for r in rows), default=None)}


def _round_tons(value):
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def apply_forecast(request: ForecastBridgeRequest, engine):
    try:
        from forecasting import service
    except ImportError as exc:
        raise RuntimeError("Demand forecast dependencies unavailable; existing inputs were not replaced") from exc
    r = request.input.model_dump()
    start = date.fromisoformat(r["plant"]["start_date"])
    h = r["plant"]["horizon_days"]
    dates = [start + timedelta(days=d) for d in range(h)]
    periods = sorted({d.strftime("%Y-%m") for d in dates})
    holidays = set(r["plant"]["holidays"])

    def eligible(day):
        return request.allocation == "calendar_days" or day.weekday() < 5 and day.isoformat() not in holidays

    mapped = [(g, p) for g, p in GRADE_MAP.items() if p in engine["grades"]]
    if not mapped:
        raise RuntimeError("No forecast models map to the six planning product groups; existing inputs were not replaced")
    grades, warnings = [], [
        "Monthly forecasts are allocated to daily planning buckets, not validated daily predictions or actual due dates.",
        "Existing firm orders are user inputs, not verified by the billing forecast. Stock, BOM, procurement rules and BD prices are not replaced.",
        "Confirm the completeness of the latest billing month and its suitability as a demand proxy before production use.",
    ]
    if request.path != "point":
        warnings.append("A lower/upper marginal prediction-band path is a deterministic stress input, not a joint scenario probability or guaranteed best/worst case.")
    for g, product in mapped:
        info = engine["grades"][product]
        steps = [month_index(period) - month_index(info["trained_through"]) for period in periods]
        if min(steps) < 1 or max(steps) > service.MAX_HORIZON:
            raise ValueError("%s forecast trained through %s covers %s onward for at most %d months; requested window is %s..%s. Historical fitted values are not substituted." %
                             (g, info["trained_through"], next_month(info["trained_through"]), service.MAX_HORIZON, periods[0], periods[-1]))
        forecast = service.forecast(info, max(steps))
        if max(steps) > service.HORIZON:
            warnings.append("%s: horizons beyond %d months use the forecast service's extrapolated interval widths; reported empirical coverage is not measured for those longer horizons." % (g, service.HORIZON))
        firm = list(r["firm_demand"][g]) if request.firm_orders_mode == "preserve" else [0] * h
        residual, months = [0] * h, []
        for period, step in zip(periods, steps):
            indices = [i for i, d in enumerate(dates) if d.strftime("%Y-%m") == period]
            year, month = map(int, period.split("-"))
            full_dates = [date(year, month, d) for d in range(1, calendar.monthrange(year, month)[1] + 1)]
            partial = len(indices) != len(full_dates)
            if partial and request.partial_month_policy == "reject":
                raise ValueError("%s is a partial planning month. Select explicit proration or use full calendar months." % period)
            full_eligible = [d for d in full_dates if eligible(d)]
            window_eligible = [i for i in indices if eligible(dates[i])]
            if not full_eligible:
                raise ValueError("%s has no eligible allocation days under the selected calendar" % period)
            if forecast["periods"][step - 1] != period:
                raise ValueError("Forecast period alignment failed for " + product)
            values = {key: round(float(forecast[key + "_tons"][step - 1]), 1) for key in ("forecast", "lower", "upper")}
            if any(not math.isfinite(v) or v < 0 for v in values.values()) or not values["lower"] <= values["forecast"] <= values["upper"]:
                raise ValueError("Invalid point or interval returned by the forecast model for " + product)
            selected = values[{"point": "forecast", "lower": "lower", "upper": "upper"}[request.path]]
            unrounded = Decimal(str(selected)) * Decimal(len(window_eligible)) / Decimal(len(full_eligible))
            target = _round_tons(unrounded)
            booked = sum(firm[i] for i in indices)
            remaining = max(0, target - booked)
            if remaining and not window_eligible:
                raise ValueError("No days are available to allocate residual demand in " + period)
            if window_eligible:
                for rank, i in enumerate(window_eligible):
                    residual[i] = remaining // len(window_eligible) + (rank < remaining % len(window_eligible))
            if booked > target:
                warnings.append("%s %s: firm orders exceed the selected window forecast by %d t; firm orders are retained and residual is zero." % (g, period, booked - target))
            months.append({"period": period, "horizon_step": step, "point_tons": values["forecast"], "lower_tons": values["lower"], "upper_tons": values["upper"],
                           "selected_monthly_tons": selected, "eligible_days_in_month": len(full_eligible), "eligible_days_in_window": len(window_eligible),
                           "partial_month": partial, "target_window_tons": target, "firm_window_tons": booked, "residual_window_tons": remaining,
                           "rounding_adjustment_tons": float(Decimal(target) - unrounded)})
        r["firm_demand"][g], r["forecast_residual"][g] = firm, residual
        coverage = float(info["coverage_empirical"])
        grades.append({"grade": g, "product_id": product, "model_name": info["champion"], "trained_through": info["trained_through"],
                       "interval_level_pct": info["interval_level_pct"], "coverage_empirical": coverage if math.isfinite(coverage) else None,
                       "months": months, "firm_used": firm, "residual_allocated": residual})
    manual = sorted(GRADES - {g["grade"] for g in grades})
    if manual:
        warnings.append("No mapped live model for %s: their existing firm/residual inputs are retained, not inferred from another grade." % ", ".join(manual))
    if any(m["partial_month"] for g in grades for m in g["months"]):
        warnings.append("Partial-month targets use the selected calendar-day/working-day share. Earlier actual shipments are not available for month-to-date netting; this is not a remaining-month nowcast.")
    snapshot = {"trained_at": engine["trained_at"], "start_date": start.isoformat(), "horizon_days": h,
                "path": request.path, "allocation": request.allocation, "partial_month_policy": request.partial_month_policy,
                "firm_orders_mode": request.firm_orders_mode, "holidays": sorted(holidays), "grades": grades, "manual_grades": manual}
    snapshot_id = hashlib.sha256(json.dumps(snapshot, sort_keys=True, allow_nan=False).encode()).hexdigest()
    r["demand_source"] = DemandForecastSource(**snapshot, snapshot_id=snapshot_id,
        captured_at=datetime.now(timezone.utc).isoformat(), warnings=warnings).model_dump()
    r["input_note"] = "Billing-based monthly demand forecast applied to mapped grades; daily dates are an allocation assumption. Existing firm orders, unmapped grades, stocks, BOM, BD prices and procurement rules may still be illustrative. No company production approval is implied."
    return IntegratedRequest(**r).model_dump()
