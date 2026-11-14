"""Load the product master into dbo.Products.

    cd Backend
    python -m planning_data.seed --source product-status --dry-run
    python -m planning_data.seed --source billing --dry-run
    python -m planning_data.seed --source billing [--since 2025-01-01]
    python -m planning_data.seed --source mock

    # inside Docker (DATABASE_URL and the billing data are already there)
    docker compose exec backend python -m planning_data.seed --source product-status

Products are SAP materials (6-digit 400xxx codes). --source product-status
is the recommended one: the client's Product Status workbook
(DemandModel/Product Status*.xlsx, never in git) certifies which materials
are sellable - its 'Current stock' sheet maps every product to the bare
material, the dashed '400003-ST' codes are material x market and are
deliberately NOT products. These materials are unioned with everything
billed since --since, so a material the client still lists but has not
billed recently (or ever) still enters the master. Grade and description
come from the billing extract; grades that are not a group of
plant_config.yaml are skipped and listed.
--source billing: only the materials billed since --since (24 months).
--source mock: the fictitious products of sample_data/mock/products.csv.

Only missing materials are added. An existing product, including the
minimum stock a planner set on it, is never overwritten. New products
start with MinStockTons = 0. Needs DATABASE_URL (or MSSQL_*) like the
backend; --dry-run only prints what would be added.
"""

import argparse
import re
import sys
from collections import Counter
from datetime import date
from typing import List, Optional, Tuple

from planning_data.engine_forecast import group_of_grade
from planning_data.products import (
    ProductCreate,
    ProductExists,
    SqlProductStore,
    StoreUnavailable,
    load_mock_products,
)

EDITOR = "seed script"
_BARE_MATERIAL = re.compile(r"4\d{5}$")


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


def billing_material_info(df) -> dict:
    """material -> (grade, description) over the WHOLE billing extract.

    Used to describe workbook materials that have no sales in the seed
    window: what the client billed them as historically is the honest
    name and the grade the plant groups come from.
    """
    from forecasting.data import DESCRIPTION_COL, LEVEL_COL, MATERIAL_COL

    info = {}
    for material, rows in df[df[MATERIAL_COL].notna()].groupby(MATERIAL_COL):
        material = str(material).strip()
        info[material] = (_most_common(rows[LEVEL_COL], ""), _most_common(rows[DESCRIPTION_COL], material))
    return info


def status_workbook_products(info: dict, groups: List[str], workbook=None):
    """Products certified by the Product Status workbook.

    `workbook` may be an open openpyxl workbook (tests); otherwise the
    first DemandModel/Product Status*.xlsx is used. Returns
    (products, skipped) like billing_products.
    """
    from forecasting.data import DATA_DIR

    if workbook is None:
        workbooks = sorted(DATA_DIR.glob("Product Status*.xlsx"))
        if not workbooks:
            raise FileNotFoundError(
                "no DemandModel/Product Status*.xlsx found - put the client's workbook there "
                "or use --source billing")
        import openpyxl
        workbook = openpyxl.load_workbook(workbooks[0], read_only=True)
    sheet = workbook["Current stock"]

    keep = {}                      # material -> the workbook's grade block name
    block_grade = None
    for row in sheet.iter_rows(min_row=3, max_col=4, values_only=True):
        if row[0]:
            block_grade = str(row[0]).strip()
        for cell in row[1:4]:      # the mapping columns carry bare materials
            code = str(cell).strip() if cell is not None else ""
            bare = code.split("-")[0]
            if _BARE_MATERIAL.fullmatch(bare):   # dashed '400004-CT' certifies 400004 too
                keep.setdefault(bare, block_grade or "")

    products, skipped = [], Counter()
    for material in sorted(keep):
        grade, description = info.get(material, (keep[material], material))
        group = group_of_grade(grade, groups) or group_of_grade(keep[material], groups)
        if group is None:
            skipped[grade or keep[material] or "(no grade)"] += 1
            continue
        products.append(ProductCreate(
            material_no=material,
            description=description[:100],
            group_code=group,
            updated_by=EDITOR,
        ))
    return sorted(products, key=lambda p: (p.group_code, p.material_no)), skipped


def _months_back(today: date, months: int) -> date:
    index = today.year * 12 + today.month - 1 - months
    return date(index // 12, index % 12 + 1, 1)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Add missing products to dbo.Products.")
    parser.add_argument("--source", choices=["product-status", "billing", "mock"], required=True)
    parser.add_argument("--since", type=date.fromisoformat, default=None,
                        help="first billing date to include (default: 24 months back)")
    parser.add_argument("--dry-run", action="store_true", help="print what would be added, write nothing")
    args = parser.parse_args(argv)

    import database
    from optimization.engine import plant_groups

    groups = [g["id"] for g in plant_groups()]
    skipped = Counter()
    if args.source == "mock":
        candidates = mock_products()
        print("sample_data/mock/products.csv: %d products" % len(candidates))
    else:
        from forecasting.data import load_billing_frame

        frame = load_billing_frame()
        since = args.since or _months_back(date.today(), 24)
        candidates, skipped = billing_products(frame, groups, since)
        print("Billing extract since %s: %d products in plant groups" % (since, len(candidates)))
        if args.source == "product-status":
            known = {p.material_no for p in candidates}
            extra, workbook_skipped = status_workbook_products(billing_material_info(frame), groups)
            skipped += workbook_skipped
            new = [p for p in extra if p.material_no not in known]
            candidates += new
            candidates.sort(key=lambda p: (p.group_code, p.material_no))
            print("Product Status workbook: %d certified material(s), %d not in the billing window"
                  % (len(extra), len(new)))
    for grade, count in sorted(skipped.items()):
        print("  skipped %d material(s) of grade %s (not a group in plant_config.yaml)" % (count, grade))

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
