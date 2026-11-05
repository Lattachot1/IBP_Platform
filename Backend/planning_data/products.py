"""Product master (SAP materials): dbo.Products, or memory without a database.

Every product belongs to one product group of plant_config.yaml, and all
plant rules stay on the group. Products are never deleted, only
deactivated, so orders and saved plans that name an old material still
resolve.

Store selection follows the scenario store:
- no database configured -> in memory, pre-loaded with the fictitious
  products of sample_data/mock/products.csv (lost on restart)
- a configured database is the only store; any failure there raises
  StoreUnavailable and the API answers 503
"""

import csv
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

import database
from optimization.engine import plant_groups

MOCK_PRODUCTS = Path(__file__).resolve().parents[1] / "sample_data" / "mock" / "products.csv"
DEFAULT_EDITOR = "Planner (Interactive)"

# dbo.Products in table order (a test compares this with init-db/03-planning.sql)
COLUMNS = ("MaterialNo", "Description", "GroupCode", "MinStockTons", "IsActive", "UpdatedAt", "UpdatedBy")
# API field -> column for the fields a PATCH may change
EDITABLE = {
    "description": "Description",
    "group_code": "GroupCode",
    "min_stock_tons": "MinStockTons",
    "is_active": "IsActive",
}
MAX_TONS = 1_000_000


class ProductNotFound(LookupError):
    pass


class ProductExists(ValueError):
    pass


class UnknownGroup(ValueError):
    pass


class StoreUnavailable(RuntimeError):
    pass


def _upper(value: Optional[str]) -> Optional[str]:
    # SQL Server compares keys case-insensitively; the memory store must agree
    return value.upper() if isinstance(value, str) else value


class ProductCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    material_no: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9._-]+$")
    description: str = Field(min_length=1, max_length=100)
    group_code: str = Field(min_length=1, max_length=20)
    min_stock_tons: float = Field(default=0.0, ge=0, le=MAX_TONS, allow_inf_nan=False)
    is_active: bool = True
    updated_by: str = Field(default=DEFAULT_EDITOR, min_length=1, max_length=50)

    upper_codes = field_validator("material_no", "group_code")(_upper)


class ProductUpdate(BaseModel):
    """PATCH body: only the fields that are sent change."""

    model_config = ConfigDict(str_strip_whitespace=True)

    description: Optional[str] = Field(default=None, min_length=1, max_length=100)
    group_code: Optional[str] = Field(default=None, min_length=1, max_length=20)
    min_stock_tons: Optional[float] = Field(default=None, ge=0, le=MAX_TONS, allow_inf_nan=False)
    is_active: Optional[bool] = None
    updated_by: str = Field(default=DEFAULT_EDITOR, min_length=1, max_length=50)

    upper_codes = field_validator("group_code")(_upper)

    @model_validator(mode="after")
    def _has_changes(self):
        if not self.changes():
            raise ValueError("nothing to update: send at least one of " + ", ".join(EDITABLE))
        return self

    def changes(self) -> dict:
        return {key: value for key, value in self.model_dump().items()
                if key in EDITABLE and value is not None}


class Product(BaseModel):
    material_no: str
    description: str
    group_code: str
    min_stock_tons: float
    is_active: bool
    updated_at: datetime
    updated_by: str


def require_group(code: str) -> None:
    """Raise UnknownGroup unless `code` is a group of plant_config.yaml."""
    codes = [g["id"] for g in plant_groups()]
    if code not in codes:
        raise UnknownGroup("Unknown product group '%s'. Groups in plant_config.yaml: %s"
                           % (code, ", ".join(codes)))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _sorted(rows) -> List[Product]:
    return sorted(rows, key=lambda p: (p.group_code, p.material_no))


# ----------------------------------------------------------------------------
# In-memory store (no database configured)
# ----------------------------------------------------------------------------
class MemoryProductStore:
    def __init__(self, products=()):
        self._lock = threading.Lock()
        self._rows = {p.material_no: p for p in products}

    def list(self, active: Optional[bool] = None) -> List[Product]:
        with self._lock:
            rows = list(self._rows.values())
        return _sorted(p for p in rows if active is None or p.is_active == active)

    def get(self, material_no: str) -> Product:
        with self._lock:
            product = self._rows.get(_upper(material_no))
        if product is None:
            raise ProductNotFound(material_no)
        return product

    def create(self, new: ProductCreate) -> Product:
        product = Product(**new.model_dump(), updated_at=_now())
        product.min_stock_tons = round(product.min_stock_tons, 3)
        with self._lock:
            if product.material_no in self._rows:
                raise ProductExists(product.material_no)
            self._rows[product.material_no] = product
        return product

    def update(self, material_no: str, change: ProductUpdate) -> Product:
        values = change.changes()
        if "min_stock_tons" in values:
            values["min_stock_tons"] = round(values["min_stock_tons"], 3)
        key = _upper(material_no)
        with self._lock:
            current = self._rows.get(key)
            if current is None:
                raise ProductNotFound(material_no)
            product = current.model_copy(update={**values, "updated_by": change.updated_by, "updated_at": _now()})
            self._rows[key] = product
        return product


def load_mock_products(path: Path = MOCK_PRODUCTS) -> List[Product]:
    """The fictitious product master of sample_data/mock/products.csv."""
    with open(path, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))
    now = _now()
    return [Product(
        material_no=row["MaterialNo"],
        description=row["Description"],
        group_code=row["GroupCode"],
        min_stock_tons=float(row["MinStockTons"]),
        is_active=row["IsActive"] == "1",
        updated_at=now,
        updated_by="sample data",
    ) for row in rows]


# ----------------------------------------------------------------------------
# MS SQL store (dbo.Products)
# ----------------------------------------------------------------------------
_OUTPUT = ", ".join("INSERTED." + c for c in COLUMNS)
_SELECT_SQL = "SELECT %s FROM dbo.Products" % ", ".join(COLUMNS)
_INSERT_SQL = (
    "INSERT INTO dbo.Products (MaterialNo, Description, GroupCode, MinStockTons, IsActive, UpdatedBy) "
    "OUTPUT %s VALUES (%%s, %%s, %%s, %%s, %%s, %%s);" % _OUTPUT
)
_DUPLICATE_KEY_ERRORS = (2601, 2627)


@contextmanager
def _connection():
    try:
        conn = database.open_connection()
    except Exception as exc:
        raise StoreUnavailable("database unreachable: %s" % exc) from exc
    try:
        yield conn
    except (ProductNotFound, ProductExists):
        raise
    except Exception as exc:
        raise StoreUnavailable("database error: %s" % exc) from exc
    finally:
        conn.close()


def _from_row(row: dict) -> Product:
    updated_at = row["UpdatedAt"]
    if updated_at is not None and updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)   # DATETIME2 holds SYSUTCDATETIME()
    return Product(
        material_no=row["MaterialNo"],
        description=row["Description"],
        group_code=row["GroupCode"],
        min_stock_tons=float(row["MinStockTons"]),
        is_active=bool(row["IsActive"]),
        updated_at=updated_at,
        updated_by=row["UpdatedBy"],
    )


class SqlProductStore:
    def list(self, active: Optional[bool] = None) -> List[Product]:
        sql, params = _SELECT_SQL, None
        if active is not None:
            sql, params = sql + " WHERE IsActive = %s", (1 if active else 0,)
        with _connection() as conn, conn.cursor(as_dict=True) as cursor:
            cursor.execute(sql + " ORDER BY GroupCode, MaterialNo;", params)
            return [_from_row(row) for row in cursor.fetchall()]

    def get(self, material_no: str) -> Product:
        with _connection() as conn, conn.cursor(as_dict=True) as cursor:
            cursor.execute(_SELECT_SQL + " WHERE MaterialNo = %s;", (material_no,))
            row = cursor.fetchone()
        if row is None:
            raise ProductNotFound(material_no)
        return _from_row(row)

    def create(self, new: ProductCreate) -> Product:
        with _connection() as conn, conn.cursor(as_dict=True) as cursor:
            try:
                cursor.execute(_INSERT_SQL, (
                    new.material_no, new.description, new.group_code,
                    round(new.min_stock_tons, 3), 1 if new.is_active else 0, new.updated_by,
                ))
            except Exception as exc:
                if exc.args and exc.args[0] in _DUPLICATE_KEY_ERRORS:
                    raise ProductExists(new.material_no) from exc
                raise
            row = cursor.fetchone()
            conn.commit()
        return _from_row(row)

    def update(self, material_no: str, change: ProductUpdate) -> Product:
        values = change.changes()
        if "min_stock_tons" in values:
            values["min_stock_tons"] = round(values["min_stock_tons"], 3)
        if "is_active" in values:
            values["is_active"] = 1 if values["is_active"] else 0
        # column names come from EDITABLE only, never from the request
        assignments = ", ".join("%s = %%s" % EDITABLE[key] for key in values)
        sql = ("UPDATE dbo.Products SET %s, UpdatedAt = SYSUTCDATETIME(), UpdatedBy = %%s "
               "OUTPUT %s WHERE MaterialNo = %%s;" % (assignments, _OUTPUT))
        with _connection() as conn, conn.cursor(as_dict=True) as cursor:
            cursor.execute(sql, tuple(values.values()) + (change.updated_by, material_no))
            row = cursor.fetchone()
            conn.commit()
        if row is None:
            raise ProductNotFound(material_no)
        return _from_row(row)


# ----------------------------------------------------------------------------
# Store selection
# ----------------------------------------------------------------------------
_sql_store = SqlProductStore()
_memory_store: Optional[MemoryProductStore] = None
_memory_lock = threading.Lock()


def memory_store() -> MemoryProductStore:
    global _memory_store
    with _memory_lock:
        if _memory_store is None:
            _memory_store = MemoryProductStore(load_mock_products())
        return _memory_store


def get_store():
    """dbo.Products when a database is configured, otherwise the memory store."""
    return _sql_store if database.is_configured() else memory_store()
