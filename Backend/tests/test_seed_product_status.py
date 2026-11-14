"""The curated catalog (product_codespec_effective.csv) source of the seed.

A product is a material-market code ('400003-ST') named by its Sale
forecast segment and grouped by the company-confirmed plant group; a
combined spec ('400003-ST,WS') expands to one product per market and a
code repeated on several rows is added once.
"""

import csv

import pandas as pd
import pytest

from datetime import date

from planning_data.engine_forecast import GRADE_PREFIX
from planning_data.seed import billing_products, codespec_products

GROUPS = ["BR150", "BR150B", "BR360B", "VCR412", "VCR617", "BR150L", "BR150LGN"]

ROWS = [
    dict(source_excel_row="2", product_raw="BR150(MN) ST", code_spec="400003-ST,WS",
         effective_product_group="BR150", record_decision="use"),
    dict(source_excel_row="2", product_raw="BR150(MN) ST", code_spec="400003-ST",
         effective_product_group="BR150", record_decision="use"),          # duplicate code
    dict(source_excel_row="4", product_raw="BR150(MN) - ML 41-48 HM", code_spec="400003-HM",
         effective_product_group="BR150", record_decision="use"),
    dict(source_excel_row="8", product_raw="BR150GN (MN) SH", code_spec="401094-SH",
         effective_product_group="BR150", record_decision="use"),          # GN material, BR150 group
    dict(source_excel_row="41", product_raw="BR360B (MN)", code_spec="400752-SS",
         effective_product_group="BR360B", record_decision="use"),         # company-confirmed group
    dict(source_excel_row="69", product_raw="BR150LGN (GPS)-MI", code_spec="401091-MI",
         effective_product_group="BR150LGN", record_decision="use"),
    dict(source_excel_row="70", product_raw="BR150GN (MN) SH", code_spec="401078-SH",
         effective_product_group="BR150LGN", record_decision="hold"),      # not 'use': left out
    dict(source_excel_row="71", product_raw="X-200 (MN)", code_spec="400999-X",
         effective_product_group="X-200", record_decision="use"),          # no such plant group
]


def write_catalog(path):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(ROWS[0].keys()))
        writer.writeheader()
        writer.writerows(ROWS)


def products_of(products):
    return {(p.material_no, p.group_code, p.description) for p in products}


def test_codespec_products(tmp_path):
    catalog = tmp_path / "product_codespec_effective.csv"
    write_catalog(catalog)
    products, skipped = codespec_products(catalog, GROUPS)
    assert products_of(products) == {
        ("400003-ST,WS", "BR150", "BR150(MN) ST"),    # the combined spec is the product...
        ("400003-HM", "BR150", "BR150(MN) - ML 41-48 HM"),
        ("401094-SH", "BR150", "BR150GN (MN) SH"),
        ("400752-SS", "BR360B", "BR360B (MN)"),        # the company's group wins over the raw one
        ("401091-MI", "BR150LGN", "BR150LGN (GPS)-MI"),
        # ...and the single '400003-ST' row is its duplicate: dropped
    }
    assert skipped == {"X-200": 1}


def test_codespec_aliases_fold_the_sap_codes_into_the_combined_product(tmp_path):
    from planning_data.market_aliases import codespec_aliases

    catalog = tmp_path / "product_codespec_effective.csv"
    write_catalog(catalog)
    assert codespec_aliases(catalog) == {"400003-ST": "400003-ST,WS", "400003-WS": "400003-ST,WS"}


def test_codespec_reads_the_real_catalog():
    """The client catalog lives on this machine (CI skips: never in git)."""
    from forecasting.data import DATA_DIR

    catalog = DATA_DIR / "product_codespec_effective.csv"
    if not catalog.exists():
        pytest.skip("the client catalog is not on this machine")
    products, skipped = codespec_products(None, GROUPS)
    assert len(products) >= 60 and all("-" in p.material_no for p in products)
    assert all(p.group_code in GROUPS for p in products)
    assert skipped == {}


def test_billing_products_still_produce_plain_materials():
    frame = pd.DataFrame({
        "Material Number": ["401091", "401091", "400003"],
        "Grade": ["UBEPOL BR150LGN", "UBEPOL BR150LGN", "UBEPOL BR150"],
        "Mat Description": ["UBEPOL AE150LGN", "UBEPOL AE150LGN", "UBEPOL AE150MN"],
        "_date": [pd.Timestamp("2026-01-05"), pd.Timestamp("2026-02-05"), pd.Timestamp("2026-01-09")],
        "_qty": [30.0, 20.0, 100.0],
    })
    products, skipped = billing_products(frame, GROUPS, date(2026, 1, 1))
    assert [(p.material_no, p.group_code) for p in products] == [
        ("400003", "BR150"), ("401091", "BR150LGN")]
    assert skipped == {}
    assert GRADE_PREFIX == "UBEPOL "      # the mapping relies on this prefix
