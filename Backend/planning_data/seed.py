"""Load the product master into dbo.Products.

    cd Backend
    python -m planning_data.seed --source codespec --dry-run
    python -m planning_data.seed --source codespec
    python -m planning_data.seed --source mock

    # inside Docker (DATABASE_URL and the file are already there)
    docker compose exec backend python -m planning_data.seed --source codespec

A product is a material-market code ('400003-ST'): the identity the
factory's own data speaks everywhere (ZSDR orders, the stock report's
batches, the Sale forecast segments). --source codespec builds the master
from the project's curated catalog DemandModel/product_codespec_effective.csv
(never in git): one row per product with its Sale forecast name, its plant
group and the company's confirmations (record_decision = 'use' rows only).
A combined spec ('400003-ST,WS') becomes one product per market. Active
4-xxx products that the catalog does not list are deactivated, so the
master follows the file; mock 99xxx products are untouched.
--source billing: plain SAP materials billed since --since (24 months);
kept for reference, not the recommended master.
--source mock: the fictitious products of sample_data/mock/products.csv.

Only missing products are added. An existing product, including the
minimum stock a planner set on it, is never overwritten. New products
start with MinStockTons = 0. Needs DATABASE_URL (or MSSQL_*) like the
backend; --dry-run only prints what would be done.
"""

import argparse
import csv
import re
import sys
from collections import Counter
from datetime import date
from typing import List, Tuple

from planning_data.engine_forecast import group_of_grade
from planning_data.products import (
    ProductCreate,
    ProductExists,
    ProductUpdate,
    SqlProductStore,
    StoreUnavailable,
    load_mock_products,
)

EDITOR = "seed script"
_BARE_MATERIAL = re.compile(r"4\d{5}$")
_PRODUCT_LIKE = re.compile(r"^4\d{5}(-[A-Z0-9,]+)?$")
CATALOG_FILE = "product_codespec_effective.csv"


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
        group = group_of_grade(grade, groups)
        if group is None:
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


def codespec_products(path, groups: List[str]) -> Tuple[List[ProductCreate], Counter]:
    """The market-level products of the curated catalog CSV.

    One row per product: code_spec is the material-market code, product_raw
    the Sale forecast name, effective_product_group the plant group, and
    record_decision the company's call ('use' rows only). A combined spec
    ('400003-ST,WS') becomes one product per market; a code repeated on
    several rows is added once, first row wins.
    """
    from forecasting.data import DATA_DIR

    if path is None:
        path = DATA_DIR / CATALOG_FILE
    path = str(path)
    products, skipped, seen = [], Counter(), set()
    with open(path, encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            if (row.get("record_decision") or "").strip() != "use":
                continue
            name = re.sub(r"\s+", " ", (row.get("product_raw") or "").strip())
            group = (row.get("effective_product_group") or "").strip()
            spec = (row.get("code_spec") or "").strip().upper()
            if not name or not group or not spec:
                skipped["(incomplete row)"] += 1
                continue
            if group not in set(groups):
                skipped[group] += 1
                continue
            if "," in spec:
                # '400003-ST,WS': the part before the first comma still carries
                # the material - strip it so every market gets its own code
                base = spec.split("-")[0]
                head, *rest = spec.split(",")
                first = head.split("-", 1)[1]
                codes = ["%s-%s" % (base, m.strip()) for m in [first] + rest if m.strip()]
            else:
                codes = [spec]
            for code in codes:
                if code in seen:
                    continue
                seen.add(code)
                products.append(ProductCreate(
                    material_no=code,
                    description=name[:100],
                    group_code=group,
                    updated_by=EDITOR,
                ))
    return sorted(products, key=lambda p: (p.group_code, p.material_no)), skipped


def _months_back(today: date, months: int) -> date:
    index = today.year * 12 + today.month - 1 - months
    return date(index // 12, index % 12 + 1, 1)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Add missing products to dbo.Products.")
    parser.add_argument("--source", choices=["codespec", "billing", "mock"], required=True)
    parser.add_argument("--since", type=date.fromisoformat, default=None,
                        help="billing only: first billing date to include (default: 24 months back)")
    parser.add_argument("--dry-run", action="store_true", help="print what would be done, write nothing")
    args = parser.parse_args(argv)

    import database
    from optimization.engine import plant_groups

    groups = [g["id"] for g in plant_groups()]
    skipped = Counter()
    if args.source == "mock":
        candidates = mock_products()
        print("sample_data/mock/products.csv: %d products" % len(candidates))
    elif args.source == "codespec":
        candidates, skipped = codespec_products(None, groups)
        print("product_codespec_effective.csv: %d market product(s)" % len(candidates))
    else:
        from forecasting.data import load_billing_frame

        since = args.since or _months_back(date.today(), 24)
        candidates, skipped = billing_products(load_billing_frame(), groups, since)
        print("Billing extract since %s: %d products in plant groups (legacy material-level source)"
              % (since, len(candidates)))
    for grade, count in sorted(skipped.items()):
        print("  skipped %d product(s): %s" % (count, grade))

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
    if args.source == "codespec":
        catalog = {p.material_no for p in candidates}
        retired = 0
        try:
            for existing in store.list():
                # an active 4-xxx product the catalog does not list is out of
                # the company's catalog: deactivate it (mock 99xxx untouched)
                if existing.is_active and _PRODUCT_LIKE.fullmatch(existing.material_no) \
                        and existing.material_no not in catalog:
                    store.update(existing.material_no, ProductUpdate(is_active=False, updated_by=EDITOR))
                    retired += 1
        except StoreUnavailable as exc:
            print("Database error while deactivating retired products: %s" % exc, file=sys.stderr)
            return 2
        if retired:
            print("Deactivated %d product(s) the catalog does not list." % retired)
    return 0


if __name__ == "__main__":
    sys.exit(main())
