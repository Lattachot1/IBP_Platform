"""The Product Status workbook source of the seed script.

The workbook stays out of git (client data), so the tests build a tiny
lookalike of its 'Current stock' sheet: grade blocks in column A (merged,
so the cells below the block name are empty), dashed 'material-market'
codes that are NOT products, and bare SAP materials in the mapping
columns - including the block-end rows that list every material of the
block.
"""

from datetime import date

import openpyxl
import pandas as pd

from planning_data.engine_forecast import GRADE_PREFIX
from planning_data.seed import billing_products, status_workbook_products

GROUPS = ["BR150", "BR150B", "BR360B", "VCR412", "VCR617", "BR150L", "BR150LGN"]


def build_workbook() -> openpyxl.Workbook:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Current stock"
    ws.append(["TSL - Inventory and Sale", None, None, "ZMMR021"])
    ws.append([None, None, None, None])
    # BR150 block: dashed codes must not become products; the block-end
    # mapping row lists the block's bare materials
    ws.append(["BR150", "BR150(MN) ST", "400003-ST", "400003-WS"])
    ws.append([None, None, "400003-ST", "400003-WS"])
    ws.append([None, "BR150(GPS) CT", "400004-CT", "400768-CT"])
    ws.append([None, "400922", "400003", "400768"])
    # BR150LGN block, with no billing history at all
    ws.append(["BR150LGN", "BR150LGN (GPS)-MI", "401091-MI", None])
    ws.append([None, None, "401091", None])
    # BR150GN is still not a plant group: its material must be skipped
    ws.append(["BR150GN", "BR150GN (GPS)-CT", "400982-CT", None])
    ws.append([None, None, "400982", None])
    return wb


def info():
    """All-time billing knowledge: grade + description per material."""
    return {
        "400003": ("UBEPOL BR150", "UBEPOL AE150MN"),
        "400768": ("UBEPOL BR150", "UBEPOL AE150GPS"),
        "400922": ("UBEPOL BR150", "UBEPOL AE150CM2"),
        "401091": ("UBEPOL BR150LGN", "UBEPOL AE150LGN"),
        "400982": ("UBEPOL BR150GN", "UBEPOL AE150GN"),
    }


def products_of(products):
    return {(p.material_no, p.group_code, p.description) for p in products}


def test_dashed_codes_certify_their_material_but_are_not_products():
    products, skipped = status_workbook_products(info(), GROUPS, workbook=build_workbook())
    assert products_of(products) == {
        ("400003", "BR150", "UBEPOL AE150MN"),
        ("400768", "BR150", "UBEPOL AE150GPS"),
        ("400922", "BR150", "UBEPOL AE150CM2"),   # the bare code in the mapping row
        ("400004", "BR150", "400004"),            # dashed only, never billed: code as name
        ("401091", "BR150LGN", "UBEPOL AE150LGN"),
    }
    assert skipped == {"UBEPOL BR150GN": 1}
    assert all("-" not in p.material_no for p in products)


def test_workbook_grade_fills_forward_from_the_merged_block_cell():
    # 400004 sits two rows under the BR150 block header with an empty A cell
    products, _ = status_workbook_products({}, GROUPS, workbook=build_workbook())
    assert {p.material_no: p.group_code for p in products}["400004"] == "BR150"
    assert {p.material_no: p.description for p in products}["401091"] == "401091"


def test_billing_products_now_include_the_new_group():
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
