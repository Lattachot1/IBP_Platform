"""Demand per product on the /optimize page (request field product_demand).

The planner may break a group's demand into its products (material ->
tons). The solver and the hand-edit evaluator keep working on the group:
demand[group] becomes the sum of its products and every plant rule stays
on the group. This demand has no dates and every product counts the same,
so the best schedule does not depend on how a group's demand is split.
Afterwards each day's output of a group is shared over its products in
proportion to their demand, so all products of a group reach the same
fulfillment %.

(Planning with stock, QC lots and dated orders is the other mode,
use_planning_data, in optimization/planning.py.)
"""

from dataclasses import dataclass
from typing import Dict, List, Optional


class ProductDemandError(ValueError):
    """product_demand names a material the plan cannot use (API: 422)."""


@dataclass
class DemandItem:
    material_no: str
    description: str
    tons: float


@dataclass
class ProductDemand:
    by_group: Dict[str, List[DemandItem]]


def prepare(req: dict, products, groups: List[str]) -> Optional[ProductDemand]:
    """Check req['product_demand'] against the product master and replace the
    demand of every group it covers by the sum of its products (in place).

    Returns None when the request has no product demand (or plans from the
    planning data, which ignores it). Raises ProductDemandError.
    """
    raw = req.get("product_demand") or {}
    if not raw or req.get("use_planning_data"):
        return None
    index = {p.material_no: p for p in products}
    by_group: Dict[str, List[DemandItem]] = {}
    problems = []
    for material, tons in raw.items():
        key = str(material).strip().upper()
        product = index.get(key)
        if product is None:
            problems.append("%s is not in the product master" % key)
        elif not product.is_active:
            problems.append("%s is inactive" % key)
        elif product.group_code not in groups:
            problems.append("%s belongs to %s, which is not a group in plant_config.yaml" % (key, product.group_code))
        elif tons is None or float(tons) < 0:
            problems.append("%s: demand must be 0 or more" % key)
        else:
            by_group.setdefault(product.group_code, []).append(DemandItem(key, product.description, float(tons)))
    if problems:
        raise ProductDemandError("product_demand: " + "; ".join(problems))

    demand = dict(req.get("demand") or {})
    for group, items in by_group.items():
        items.sort(key=lambda i: i.material_no)
        demand[group] = sum(i.tons for i in items)
    req["demand"] = demand
    return ProductDemand(by_group)


def load_and_prepare(req: dict) -> Optional[ProductDemand]:
    """prepare() with the product master and groups read from their stores.

    Raises planning_data.sql.StoreUnavailable when the database is down.
    """
    if not req.get("product_demand") or req.get("use_planning_data"):
        return None
    from optimization.engine import plant_groups
    from planning_data import products

    return prepare(req, products.get_store().list(), [g["id"] for g in plant_groups()])


def split(total: float, weights: List[float]) -> List[float]:
    """Share `total` in proportion to `weights`, keeping the exact sum.

    Whole tons when the total is whole (largest remainder), else 0.1 t.
    Equal shares when every weight is 0.
    """
    if not weights:
        return []
    step = 1 if float(total).is_integer() else 0.1
    units = int(round(total / step))
    weight_sum = sum(weights)
    raw = [units * (w / weight_sum if weight_sum > 0 else 1 / len(weights)) for w in weights]
    shares = [int(r) for r in raw]
    order = sorted(range(len(raw)), key=lambda i: raw[i] - shares[i], reverse=True)
    for i in order[: units - sum(shares)]:
        shares[i] += 1
    return [s if step == 1 else round(s * step, 1) for s in shares]


def apply(result: dict, demand: ProductDemand) -> None:
    """Add days[].products, product_fulfillment and a check line to a plan (in place)."""
    produced: Dict[str, float] = {}
    for day in result.get("days") or []:
        rows = []
        for part in day.get("parts") or []:
            items = demand.by_group.get(part["grade"])
            if not items:
                continue
            for item, tons in zip(items, split(part["tons"], [i.tons for i in items])):
                produced[item.material_no] = produced.get(item.material_no, 0) + tons
                if tons:
                    rows.append({"material_no": item.material_no, "tons": tons})
        day["products"] = rows

    slot = {g["id"]: g.get("slot", 99) for g in result.get("grades") or []}
    fulfillment = []
    for group in sorted(demand.by_group, key=lambda g: (slot.get(g, 99), g)):
        for item in demand.by_group[group]:
            made = round(produced.get(item.material_no, 0), 1)
            fulfillment.append({
                "material_no": item.material_no,
                "description": item.description,
                "group": group,
                "demand": round(item.tons, 1),
                "produced": made,
                "shortage": round(max(0.0, item.tons - made), 1),
            })
    result["product_fulfillment"] = fulfillment
    n_products = sum(len(items) for items in demand.by_group.values())
    result.setdefault("checks", []).append({
        "level": "ok",
        "text": "Demand of %d product(s) in %s: each group's daily output is shared in proportion to its products' demand"
                % (n_products, ", ".join(sorted(demand.by_group))),
    })
