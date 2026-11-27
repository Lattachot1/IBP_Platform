"""Planning records shared by the importers, the stores and the API.

Quantities are tons. Status codes match the CHECK constraints of
init-db/03-planning.sql.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, List, Literal, Optional

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, computed_field, model_validator

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
    ship_to: Optional[str] = None    # the ship-to partner code, never a customer name
    updated_at: Optional[datetime] = None

    @computed_field
    @property
    def open_tons(self) -> float:
        """Still to ship: only open items count."""
        return round(self.tons - self.shipped_tons, 3) if self.status == "open" else 0.0


OrderNumber = Annotated[str, Field(min_length=1, max_length=20)]
OrderItem = Annotated[int, Field(gt=0, le=2_147_483_647)]
OrderedTons = Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=3)]
ShippedTons = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=3)]
OrderStatus = Literal["open", "closed", "cancelled"]
ShipTo = Annotated[str, Field(min_length=1, max_length=20)]


class SalesOrderBatchItem(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    order_no: OrderNumber
    item_no: OrderItem
    material_no: str = Field(min_length=1, max_length=40)
    tons: OrderedTons
    shipped_tons: ShippedTons
    due_date: date
    status: OrderStatus
    ship_to: Optional[ShipTo] = None
    source_updated_at: Optional[AwareDatetime] = None

    @model_validator(mode="after")
    def validate_shipment(self):
        if self.shipped_tons > self.tons:
            raise ValueError("shipped_tons cannot exceed tons")
        return self


class SalesOrderBatch(BaseModel):
    orders: List[SalesOrderBatchItem] = Field(min_length=1)


class SalesOrderChange(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    tons: Optional[OrderedTons] = None
    due_date: Optional[date] = None
    status: Optional[OrderStatus] = None
    ship_to: Optional[ShipTo] = None

    @model_validator(mode="after")
    def validate_changes(self):
        if not self.model_fields_set:
            raise ValueError("send at least one field to update")
        for field in self.model_fields_set - {"ship_to"}:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class Forecast(BaseModel):
    group_code: str
    forecast_month: date
    source: str
    tons: float
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None
