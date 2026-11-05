"""Load the product master into dbo.Products.

    cd Backend
    python -m planning_data.seed --source billing --dry-run
    python -m planning_data.seed --source billing [--since 2025-01-01]
    python -m planning_data.seed --source mock

    # inside Docker (DATABASE_URL and the billing data are already there)
    docker compose exec backend python -m planning_data.seed --source billing

--source billing: every material with net billed tons > 0 since --since
(default: 24 months back) in the client's billing extract (DemandModel/,
never in git), with its most frequent description and grade. The grade
"UBEPOL BR150" becomes group BR150; grades that are not a group of
plant_config.yaml are skipped and listed.
--source mock: the fictitious products of sample_data/mock/products.csv.

Only missing materials are added. An existing product, including the
minimum stock a planner set on it, is never overwritten. New products from
billing start with MinStockTons = 0. Needs DATABASE_URL (or MSSQL_*) like
the backend; --dry-run only prints what would be added.
"""

import argparse
import sys
from collections import Counter
from datetime import date
from typing import List, Tuple

from planning_data.products import (
    ProductCreate,
    ProductExists,
    SqlProductStore,
    StoreUnavailable,
    load_mock_products,
)

GRADE_PREFIX = "UBEPOL "
EDITOR = "seed script"


def _most_common(values, fallback: str) -> str:
    counts = Counter(str(v).strip() for v in values if isinstance(v, str) and v.strip())
    return counts.most_common(1)[0][0] if counts else fallback


def billing_products(df, groups, since: date) -> Tuple[List[ProductCreate], Counter]:
    """Products sold since `since` in a load_billing_frame() frame.

    Returns (products, skipped) where skipped counts materials per grade
    that is not a group of plant_config.yaml.
    """
    import pandas as pd

    from forecasting.data import DESCRIPTION_COL, LEVEL_COL, MATERIAL_COL

    recent = df[(df["_date"] >= pd.Timestamp(since)) & df[MATERIAL_COL].notna()]
    products, skipped = [], Counter()
    for material, rows in recent.groupby(MATERIAL_COL):
        if rows["_qty"].sum() <= 0:          # only returns / voids in the window
            continue
        material = str(material).strip()
        grade = _most_common(rows[LEVEL_COL], "")
        group = grade[len(GRADE_PREFIX):] if grade.startswith(GRADE_PREFIX) else grade
        if group not in groups:
            skipped[grade or "(no grade)"] += 1
            continue
        products.append(ProductCreate(
            material_no=material,
            description=_most_common(rows[DESCRIPTION_COL], material)[:100],
            group_code=group,
            updated_by=EDITOR,
        ))
    return sorted(products, key=lambda p: (p.group_code, p.material_no)), skipped


def mock_products() -> List[ProductCreate]:
    return [ProductCreate(
        material_no=p.material_no,
        description=p.description,
        group_code=p.group_code,
        min_stock_tons=p.min_stock_tons,
        is_active=p.is_active,
        updated_by=EDITOR,
    ) for p in load_mock_products()]


def _months_back(today: date, months: int) -> date:
    index = today.year * 12 + today.month - 1 - months
    return date(index // 12, index % 12 + 1, 1)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Add missing products to dbo.Products.")
    parser.add_argument("--source", choices=["billing", "mock"], required=True)
    parser.add_argument("--since", type=date.fromisoformat, default=None,
                        help="billing only: first billing date to include (default: 24 months back)")
    parser.add_argument("--dry-run", action="store_true", help="print what would be added, write nothing")
    args = parser.parse_args(argv)

    import database
    from optimization.engine import plant_groups

    groups = [g["id"] for g in plant_groups()]
    if args.source == "billing":
        from forecasting.data import load_billing_frame

        since = args.since or _months_back(date.today(), 24)
        candidates, skipped = billing_products(load_billing_frame(), groups, since)
        print("Billing extract since %s: %d products in plant groups" % (since, len(candidates)))
        for grade, count in sorted(skipped.items()):
            print("  skipped %d material(s) of grade %s (not a group in plant_config.yaml)" % (count, grade))
    else:
        candidates = mock_products()
        print("sample_data/mock/products.csv: %d products" % len(candidates))

    per_group = Counter(p.group_code for p in candidates)
    print("  per group: " + ", ".join("%s %d" % (g, per_group[g]) for g in groups))
    if args.dry_run:
        print("Dry run: nothing written.")
        return 0

    database.connect_database()
    if not database.is_configured():
        print("No database configured (DATABASE_URL / MSSQL_*): nothing written. "
              "Without a database the backend loads the mock products by itself.", file=sys.stderr)
        return 1

    store = SqlProductStore()
    added = kept = 0
    try:
        for product in candidates:
            try:
                store.create(product)
                added += 1
            except ProductExists:
                kept += 1
    except StoreUnavailable as exc:
        print("Database error after adding %d product(s): %s" % (added, exc), file=sys.stderr)
        return 2
    print("Added %d product(s); %d already present and left unchanged." % (added, kept))
    return 0


if __name__ == "__main__":
    sys.exit(main())
