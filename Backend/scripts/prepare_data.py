"""
Convert the company hand-over Excel files into the local, git-ignored data
files the forecasting engines read. Company data is never committed.

Usage (from the Backend/ folder):

    python scripts/prepare_data.py --billing "<dir>/Sale Billing TSL.xlsx" \
        --bd "<dir>/BD Forecasting/BDsea_price_history_~5y_2026-09-11.xlsx"

Outputs (paths relative to the repo root):
    DemandModel/sale_billing.csv   billing extract in the layout the demand and
                                   price engines expect: one note row, header on
                                   row 2, cp874 encoding, Billing Date as YYYY/MM/DD
    data/bd_price_history.xlsx     the Argus price file, copied as-is
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
DEMAND_DIR = REPO_ROOT / "DemandModel"
DATA_DIR = REPO_ROOT / "data"
DATE_COLS = ["Billing Date", "ETD Date", "ETA Date", "Period"]
ZERO_WIDTH = "​"


def convert_billing(xlsx_path: Path, out_path: Path) -> int:
    """Read the SAP billing workbook (note row + header row) and write the CSV layout."""
    df = pd.read_excel(xlsx_path, header=1)
    df.columns = [str(c).strip() for c in df.columns]

    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].astype(str).where(df[col].notna(), None)
            df[col] = df[col].str.replace(ZERO_WIDTH, "", regex=False)

    for col in DATE_COLS:
        if col in df.columns:
            parsed = pd.to_datetime(df[col], errors="coerce")
            df[col] = parsed.dt.strftime("%Y/%m/%d")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="cp874", errors="replace", newline="") as fh:
        fh.write("SAP billing extract (converted by scripts/prepare_data.py); header is on the next row\n")
    df.to_csv(out_path, mode="a", index=False, encoding="cp874", errors="replace")
    return len(df)


def copy_bd(xlsx_path: Path, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(xlsx_path, out_path)


def main(argv=None) -> int:
    # Windows consoles default to a legacy code page; paths here may contain Thai
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--billing", required=True, help="path to 'Sale Billing TSL.xlsx'")
    parser.add_argument("--bd", required=True, help="path to the Argus BD price history workbook")
    parser.add_argument("--out-billing", default=str(DEMAND_DIR / "sale_billing.csv"))
    parser.add_argument("--out-bd", default=str(DATA_DIR / "bd_price_history.xlsx"))
    args = parser.parse_args(argv)

    rows = convert_billing(Path(args.billing), Path(args.out_billing))
    print(f"billing: {rows:,} rows -> {args.out_billing}")
    copy_bd(Path(args.bd), Path(args.out_bd))
    print(f"bd prices: copied -> {args.out_bd}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
