"""Serializable demand snapshot; provenance is not a proof of data authenticity."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SourceModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class ForecastMonth(SourceModel):
    period: str
    horizon_step: int = Field(ge=1, le=12)
    point_tons: float = Field(ge=0)
    lower_tons: float = Field(ge=0)
    upper_tons: float = Field(ge=0)
    selected_monthly_tons: float = Field(ge=0)
    eligible_days_in_month: int = Field(ge=1, le=31)
    eligible_days_in_window: int = Field(ge=0, le=31)
    partial_month: bool
    target_window_tons: int = Field(ge=0)
    firm_window_tons: int = Field(ge=0)
    residual_window_tons: int = Field(ge=0)
    rounding_adjustment_tons: float


class ForecastGrade(SourceModel):
    grade: str
    product_id: str
    model_name: str
    trained_through: str
    interval_level_pct: int
    coverage_empirical: float | None
    months: list[ForecastMonth]
    firm_used: list[int]
    residual_allocated: list[int]


class DemandForecastSource(SourceModel):
    origin: Literal["billing_monthly_forecast"] = "billing_monthly_forecast"
    snapshot_id: str = Field(min_length=64, max_length=64)
    trained_at: str
    captured_at: str
    start_date: str
    horizon_days: int = Field(ge=7, le=62)
    path: Literal["point", "lower", "upper"]
    allocation: Literal["calendar_days", "working_days"]
    partial_month_policy: Literal["prorate", "reject"]
    firm_orders_mode: Literal["preserve", "clear"]
    holidays: list[str]
    grades: list[ForecastGrade] = Field(min_length=1, max_length=6)
    manual_grades: list[str]
    warnings: list[str]
    status: Literal["applied", "modified"] = "applied"
    manual_override_acknowledged: bool = False


def source_matches(source, plant, firm, residual):
    """Changing costs/locks must not invalidate an unchanged demand snapshot."""
    if source.start_date != plant.start_date or source.horizon_days != plant.horizon_days:
        return False
    if source.allocation == "working_days" and sorted(source.holidays) != sorted(plant.holidays):
        return False
    return all(firm.get(g.grade) == g.firm_used and residual.get(g.grade) == g.residual_allocated for g in source.grades)
