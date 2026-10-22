"""API models for POST /api/v1/optimize.

The shapes here are the contract between the Next.js /optimize page and
the optimizer. They are stable across phases: the Phase 2 CP-SAT engine
must fill exactly this response.
"""

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class InitialState(BaseModel):
    """Plant state on the first day of the plan."""

    grade: str = "BR150"        # grade currently in production
    remain_days: int = Field(default=2, ge=0)   # min-run days still owed
    rx12_age: int = Field(default=54, ge=0)     # RX1-2 age in production days
    rx34_age: int = Field(default=0, ge=0)      # RX3-4 age in production days


class OptimizeRequest(BaseModel):
    horizon_days: int = Field(default=28, ge=7, le=120)
    start_date: str = ""        # ISO date; "" = next Monday
    objective: str = "maximize_fulfilled"
    demand: Optional[Dict[str, float]] = None   # tons per grade; None = defaults
    holidays: List[str] = Field(default_factory=list)   # ISO dates, company holidays
    time_limit_s: int = Field(default=30, ge=5, le=300)
    initial: InitialState = Field(default_factory=InitialState)


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
