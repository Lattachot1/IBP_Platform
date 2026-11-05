"""Product master: list, create and edit products (never delete them).

A product that is no longer sold is deactivated with
PATCH {"is_active": false}, so orders and saved plans that name it keep
working. There is deliberately no DELETE.

No login yet (roadmap step 5): anyone who can reach the backend can edit
the product master.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException

from planning_data.products import (
    Product,
    ProductCreate,
    ProductExists,
    ProductNotFound,
    ProductUpdate,
    StoreUnavailable,
    UnknownGroup,
    get_store,
    require_group,
)

log = logging.getLogger("ibp.api.products")

router = APIRouter(tags=["products"])


def _unavailable(action: str) -> HTTPException:
    log.exception("[Database] Products: %s", action)
    return HTTPException(status_code=503, detail="Database unavailable: %s" % action)


def _check_group(code: str) -> None:
    try:
        require_group(code)
    except UnknownGroup as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/api/v1/products", response_model=List[Product])
def handle_list_products(active: Optional[bool] = None) -> List[Product]:
    """All products, by group then material; ?active=true|false filters."""
    try:
        return get_store().list(active)
    except StoreUnavailable:
        raise _unavailable("could not load products")


@router.get("/api/v1/products/{material_no}", response_model=Product)
def handle_get_product(material_no: str) -> Product:
    try:
        return get_store().get(material_no.strip().upper())
    except ProductNotFound:
        raise HTTPException(status_code=404, detail="Product %s not found" % material_no)
    except StoreUnavailable:
        raise _unavailable("could not load the product")


@router.post("/api/v1/products", response_model=Product, status_code=201)
def handle_create_product(req: ProductCreate) -> Product:
    _check_group(req.group_code)
    try:
        return get_store().create(req)
    except ProductExists:
        raise HTTPException(status_code=409,
                            detail="Product %s already exists - change it with PATCH" % req.material_no)
    except StoreUnavailable:
        raise _unavailable("product NOT saved")


@router.patch("/api/v1/products/{material_no}", response_model=Product)
def handle_update_product(material_no: str, req: ProductUpdate) -> Product:
    """Change only the fields sent; {"is_active": false} retires a product."""
    if req.group_code is not None:
        _check_group(req.group_code)
    try:
        return get_store().update(material_no.strip().upper(), req)
    except ProductNotFound:
        raise HTTPException(status_code=404, detail="Product %s not found" % material_no)
    except StoreUnavailable:
        raise _unavailable("product NOT changed")
