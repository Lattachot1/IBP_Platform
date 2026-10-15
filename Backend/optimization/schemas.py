"""API models for POST /api/v1/optimize.

The shapes here are the contract between the Next.js /optimize page and
the optimizer. They are stable across phases: the Phase 2 CP-SAT engine
must fill exactly this response.
"""

from typing import Dict, List, Optional

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
