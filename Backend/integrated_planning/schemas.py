from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

import optimization
from plant_scheduling.schemas import GRADES, OptimizeRequest
from .forecast_source import DemandForecastSource, source_matches

ACTIVE_WEIGHTS = {"raw_material", "production", "setup", "finished_goods_holding", "raw_material_holding", "shortage"}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)


class Receipt(StrictModel):
    day: int = Field(ge=0, le=61)
    tons: int = Field(ge=0, le=50000)


class Release(Receipt):
    grade: str


class DayLock(StrictModel):
    day: int = Field(ge=0, le=61)
    grade: str
    production: dict[str, int] | None = None
    rx12: Literal["prod", "clean", "idle"] | None = None
    rx34: Literal["prod", "clean", "idle"] | None = None


class IntegratedRequest(StrictModel):
    plant: OptimizeRequest = Field(default_factory=OptimizeRequest)
    policy: Literal["weighted_cost", "delivery_first"] = "weighted_cost"
    release_lag_days: int = Field(default=3, ge=0, le=14)
    purchase_lead_days: int = Field(default=5, ge=0, le=28)
    opening_fg: dict[str, int] = Field(default_factory=dict)
    opening_raw_tons: int = Field(default=1100, ge=0, le=50000)
    raw_storage_tons: int = Field(default=5000, ge=1, le=50000)
    purchase_limit_tons_per_day: int = Field(default=700, ge=0, le=10000)
    bom_kg_per_ton: dict[str, int] = Field(default_factory=lambda: {p.code: round(p.bom * 1000) for p in optimization.PRODUCTS})
    firm_demand: dict[str, list[int]]
    forecast_residual: dict[str, list[int]]
    raw_prices: list[float]
    holding_costs: dict = Field(default_factory=optimization.default_holding_costs)
    weights: dict[str, float] = Field(default_factory=lambda: {key: 1.0 for key in sorted(ACTIVE_WEIGHTS)})
    raw_pipeline: list[Receipt] = Field(default_factory=list)
    fg_pipeline: list[Release] = Field(default_factory=list)
    day_locks: list[DayLock] = Field(default_factory=list)
    purchase_locks: list[Receipt] = Field(default_factory=list)
    input_note: str = Field(default="Illustrative daily orders and residual forecast; not live company data.", max_length=1000)
    demand_source: DemandForecastSource | None = None

    @model_validator(mode="after")
    def consistent(self):
        h = self.plant.horizon_days
        if h > 62 or not self.plant.start_date:
            raise ValueError("Integrated pilot requires an explicit start date and 7-62 days")
        date.fromisoformat(self.plant.start_date) + timedelta(days=h - 1)
        if len(self.raw_prices) != h or any(p < 0 or p > 10000 for p in self.raw_prices):
            raise ValueError("Provide one finite raw price between 0 and 10000 USD/t per day")
        if set(self.opening_fg) - GRADES or any(v < 0 or v > 50000 for v in self.opening_fg.values()):
            raise ValueError("Invalid opening FG")
        self.opening_fg = {g: self.opening_fg.get(g, 0) for g in sorted(GRADES)}
        if set(self.bom_kg_per_ton) != GRADES or any(v < 500 or v > 2000 for v in self.bom_kg_per_ton.values()):
            raise ValueError("Provide all six BOM factors between 500 and 2000 kg/t")
        for values in (self.firm_demand, self.forecast_residual):
            if set(values) - GRADES or any(len(v) != h or any(x < 0 or x > 10000 for x in v) for v in values.values()):
                raise ValueError("Demand must be nonnegative integer tons, with one value per day for known grades")
            for g in GRADES:
                values.setdefault(g, [0] * h)
        if sum(sum(v) for values in (self.firm_demand, self.forecast_residual) for v in values.values()) > 100000:
            raise ValueError("Pilot total demand is limited to 100000 tons")
        if self.opening_raw_tons > self.raw_storage_tons:
            raise ValueError("Opening raw stock exceeds storage capacity")
        self.holding_costs = optimization.normalize_holding_costs(self.holding_costs)
        if set(self.weights) - ACTIVE_WEIGHTS or any(v < 0 or v > 20 for v in self.weights.values()):
            raise ValueError("Unknown or invalid integrated objective weight")
        self.weights = {k: self.weights.get(k, 1.0) for k in sorted(ACTIVE_WEIGHTS)}
        if not any(self.weights.values()):
            raise ValueError("At least one active cost weight must be positive")
        for entries in (self.day_locks, self.purchase_locks):
            if len({v.day for v in entries}) != len(entries):
                raise ValueError("Use at most one lock of each type per day")
        for entry in [*self.raw_pipeline, *self.fg_pipeline, *self.day_locks, *self.purchase_locks]:
            if entry.day >= h:
                raise ValueError("Receipt, release or lock lies outside the planning horizon")
            if hasattr(entry, "grade") and entry.grade not in GRADES:
                raise ValueError("Unknown locked/released grade")
        for entry in self.purchase_locks:
            if entry.tons > self.purchase_limit_tons_per_day or entry.tons and entry.day + self.purchase_lead_days >= h:
                raise ValueError("Locked purchase exceeds daily limit or arrives outside the horizon")
        for entry in self.day_locks:
            if entry.production is not None and (set(entry.production) - GRADES or any(v < 0 or v > 239 for v in entry.production.values())):
                raise ValueError("Invalid locked production quantities")
        if self.demand_source:
            source = self.demand_source
            if len({g.grade for g in source.grades}) != len(source.grades) or any(g.grade not in GRADES for g in source.grades):
                raise ValueError("Demand source must describe distinct known product groups")
            if any(len(g.firm_used) != source.horizon_days or len(g.residual_allocated) != source.horizon_days or any(x < 0 for x in g.firm_used + g.residual_allocated) for g in source.grades):
                raise ValueError("Invalid demand snapshot arrays")
            source.status = "applied" if source_matches(source, self.plant, self.firm_demand, self.forecast_residual) else "modified"
        return self
