"""API models for POST /api/v1/optimize.

The shapes here are the contract between the Next.js /optimize page and
the optimizer. They are stable across phases: the Phase 2 CP-SAT engine
must fill exactly this response.
"""

from datetime import date
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

GRADES = {"BR150", "BR150L", "BR150B", "BR360B", "VCR412", "VCR617"}


class InitialState(BaseModel):
    """Plant state on the first day of the plan."""

    model_config = ConfigDict(extra="forbid")
    grade: str = "BR150"
    remain_days: int = Field(default=2, ge=0, le=120)
    rx12_age: int = Field(default=54, ge=0, le=60)
    rx34_age: int = Field(default=0, ge=0, le=60)
    vcr_elapsed_days: int = Field(default=0, ge=0, le=120)

    @field_validator("grade")
    @classmethod
    def valid_grade(cls, value):
        if value not in GRADES:
            raise ValueError("Unknown product group")
        return value


class OptimizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    horizon_days: int = Field(default=28, ge=7, le=120)
    start_date: str = ""        # ISO date; "" = next Monday
    objective: Literal["maximize_fulfilled", "balance", "minimize_changeover"] = "maximize_fulfilled"
    full_rate: bool = True
    demand: Optional[Dict[str, float]] = None   # tons per grade; None = defaults
    holidays: List[str] = Field(default_factory=list)   # ISO dates, company holidays
    time_limit_s: int = Field(default=30, ge=5, le=300)
    initial: InitialState = Field(default_factory=InitialState)

    @field_validator("demand")
    @classmethod
    def valid_demand(cls, values):
        if values is not None and (set(values) - GRADES or any(v < 0 or v > 1_000_000 for v in values.values())):
            raise ValueError("Demand must use known grades and nonnegative finite tons <= 1000000")
        return values

    @field_validator("start_date")
    @classmethod
    def valid_start(cls, value):
        if value:
            date.fromisoformat(value)
        return value

    @field_validator("holidays")
    @classmethod
    def valid_holidays(cls, values):
        for value in values:
            date.fromisoformat(value)
        return values

    @model_validator(mode="after")
    def initial_fits(self):
        if self.initial.remain_days > self.horizon_days:
            raise ValueError("Initial remaining run exceeds horizon")
        return self


# ---- hand-edited plan (editable Gantt) → POST /api/v1/optimize/evaluate ----

Pair = Literal["RX1-2", "RX3-4"]


class ManualCampaign(BaseModel):
    grade: str
    days: int = Field(ge=1, le=120)


class ManualCleaning(BaseModel):
    pair: Pair
    start: int = Field(ge=0, le=119)   # day index within the horizon


class PairSegment(BaseModel):
    """From day `offset` of campaign `campaign` on, BR grades run on `pair`
    (until the next segment). Anchored to campaigns so the assignment
    follows them through edits. A pair that is cleaning, or that would
    exceed its age limit, hands over to the other pair automatically."""

    campaign: int = Field(ge=0, le=119)
    offset: int = Field(default=0, ge=0, le=119)
    pair: Pair


class EvaluateRequest(OptimizeRequest):
    """Same scope as OptimizeRequest plus the draft to check. The campaigns
    must fill the horizon exactly (sum of days == horizon_days)."""

    campaigns: List[ManualCampaign]
    cleanings: List[ManualCleaning] = Field(default_factory=list)
    pair_plan: List[PairSegment] = Field(default_factory=list)
