"""
Ingest the real billing extract (DemandModel/*.csv) into monthly demand
series, one per product grade.

Data rules (decided from the quality report on 2026-09-16):
- Time basis: Billing Date - the only date present for BOTH domestic
  (ZP01/ZP02, mostly DstC=TH, no ETD) and export (ZP03) invoices.
- Demand measure: QTY(ton), never revenue (revenue mixes price + FX).
- Billing types: keep ZP01/ZP02/ZP03/ZP06 (invoices) and ZR01 (returns,
  so the series is NET demand); drop ZV01/ZV02 (void docs, zero tonnage).
- The in-progress current month is dropped from training: it looks like a
  demand collapse only because the month has not finished posting.
- History: Billing Date spans 2019-04..2026-09; the four pilot grades
  have complete 89-month series (2019-04..2026-08 once the in-progress
  month is dropped).
"""

from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "DemandModel"

DATE_COL = "Billing Date"
QTY_COL = "QTY(ton)"
TYPE_COL = "Billing Type"
LEVEL_COL = "Grade"
EXCLUDED_TYPES = {"ZV01", "ZV02"}

# Grades with complete history (89 months after dropping the in-progress
# month) - the pilot products
PILOT_GRADES = [
    "UBEPOL BR150",
    "UBEPOL BR150L",
    "UBEPOL VCR617",
    "UBEPOL VCR412",
]


def find_source_file(path=None) -> Path:
    """Locate the billing extract (first CSV in DemandModel/, or explicit path)."""
    if path:
        return Path(path)
    candidates = sorted(DATA_DIR.glob("*.csv"))
    if not candidates:
        raise FileNotFoundError(
            f"No billing CSV found in {DATA_DIR}. Put the extract there or "
            "set DEMAND_DATA_PATH."
        )
    return candidates[0]


def load_billing_frame(path=None) -> pd.DataFrame:
    """Load and clean the billing extract into a frame keyed by Grade x month."""
    source = find_source_file(path)
    # cp874 = Thai Excel ANSI; row 0 is a human note row, header is row 1
    df = pd.read_csv(source, header=1, encoding="cp874", low_memory=False)
    df.columns = [c.strip() for c in df.columns]

    df["_date"] = pd.to_datetime(df[DATE_COL], format="%Y/%m/%d", errors="coerce")
    df["_qty"] = pd.to_numeric(df[QTY_COL], errors="coerce").fillna(0.0)
    df["_month"] = df["_date"].dt.to_period("M")

    df = df[~df[TYPE_COL].isin(EXCLUDED_TYPES)]
    df = df.dropna(subset=["_month"])

    # Drop the in-progress current month from any training signal
    current_month = pd.Timestamp.today().to_period("M")
    df = df[df["_month"] < current_month]
    return df


def demand_series(df: pd.DataFrame = None, level: str = LEVEL_COL) -> dict:
    """Aggregate to one monthly tonnage series per grade (gaps filled with 0)."""
    if df is None:
        df = load_billing_frame()
    grouped = df.groupby([level, "_month"])["_qty"].sum()
    series_by_key = {}
    for key, group in grouped.groupby(level=0):
        months = group.index.get_level_values("_month")
        idx = pd.period_range(months.min(), months.max(), freq="M")
        series_by_key[str(key)] = (
            group.droplevel(0).reindex(idx, fill_value=0.0).astype(float)
        )
    return series_by_key


def pilot_series(df: pd.DataFrame = None) -> dict:
    """The four pilot grades with complete history (89 months)."""
    all_series = demand_series(df)
    return {name: all_series[name] for name in PILOT_GRADES if name in all_series}
