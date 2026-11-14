"""Planning records shared by the importers, the stores and the API.

Quantities are tons. Status codes match the CHECK constraints of
init-db/03-planning.sql.
"""

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, computed_field

QC_STATUSES = ("in_qc", "released", "rejected")
ORDER_STATUSES = ("open", "closed", "cancelled")
FORECAST_SOURCES = ("engine", "manual")


class StockRow(BaseModel):
    material_no: str
    on_hand_tons: float


class StockAdjustment(BaseModel):
    """A hand-entered on-hand figure: takes precedence over the imported
    snapshot value and exists even when no snapshot has been imported."""

    material_no: str
    adjust_tons: float
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None


class StockSnapshot(BaseModel):
    """Released (QC-passed) stock of one export date, plus every hand-entered
    adjustment (they are not dated, so they always come along)."""

    snapshot_date: Optional[date] = None
    loaded_at: Optional[datetime] = None
    loaded_by: Optional[str] = None
    rows: List[StockRow] = []
    adjustments: List[StockAdjustment] = []


class QcLot(BaseModel):
    lot_no: str
    material_no: str
    tons: float
    produced_date: date
    release_date: date
    status: str
    updated_at: Optional[datetime] = None


class SalesOrder(BaseModel):
    order_no: str
    item_no: int
    material_no: str
    tons: float
    shipped_tons: float
    due_date: date
    status: str
    updated_at: Optional[datetime] = None

    @computed_field
    @property
    def open_tons(self) -> float:
        """Still to ship: only open items count."""
        return round(self.tons - self.shipped_tons, 3) if self.status == "open" else 0.0


class Forecast(BaseModel):
    group_code: str
    forecast_month: date
    source: str
    tons: float
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None
