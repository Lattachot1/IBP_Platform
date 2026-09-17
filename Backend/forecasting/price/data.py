"""
Monthly realized selling price per product grade, built from the same billing
extract the demand engine uses, plus the butadiene (BD) market price that
drives it.

Rules (decided from the 2026-09-17 exploration of the real extract):
- Price basis: FOB amount in USD per ton, tonnage-weighted per month. FOB
  strips freight and insurance, so the series links cleanly to BD; the
  delivered (net) price is kept alongside for reference.
- Rows: invoices only (the demand loader already drops ZV void documents),
  positive tonnage, and posted rows only (NetAmtUSD > 0 - unposted rows have
  no FX rate yet, which is why the current month always looks empty).
- Currency: USD documents as-is, THB documents divided by the FI monthly
  rate used for NetAmtUSD, other currencies via NetAmtUSD * FOB / Net.
- BD driver: Argus Butadiene FOB Southeast Asia mid (PA0033242), weekly
  assessments averaged to calendar months.
- The in-progress current month is dropped on both sides.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pandas as pd

from .. import data as billing_data

REPO_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = REPO_ROOT / "data"

GRADE_COL = "Grade"
CURRENCY_COL = "Curr."
NET_USD_COL = "NetAmtUSD"
FOB_COL = "FOB Amount adj"
NET_COL = "Net Amount adj"
RATE_COL = "Rate"
NUMERIC_COLS = [NET_USD_COL, FOB_COL, NET_COL, RATE_COL]

TARGET_GRADES = [
    "UBEPOL BR150",
    "UBEPOL BR150L",
    "UBEPOL BR150B",
    "UBEPOL VCR412",
    "UBEPOL VCR617",
    "UBEPOL BR360B",
]

BD_SYMBOL = "PA0033242"
BD_PRICE_TYPE = "M"
MAX_GAP_FILL = 2  # interpolate price gaps of up to this many months


def find_bd_file(path=None) -> Path:
    """Locate the BD price workbook (explicit path, BD_PRICE_PATH, or first file in data/)."""
    if path:
        return Path(path)
    env = os.getenv("BD_PRICE_PATH", "").strip()
    if env:
        return Path(env)
    candidates = sorted(list(DATA_DIR.glob("*.xlsx")) + list(DATA_DIR.glob("*.csv")))
    if not candidates:
        raise FileNotFoundError(
            f"No BD price file found in {DATA_DIR}. Run scripts/prepare_data.py or set BD_PRICE_PATH."
        )
    return candidates[0]


def load_bd_monthly(path=None) -> pd.Series:
    """Monthly mean of the weekly BD mid assessment, indexed by month Period."""
    source = find_bd_file(path)
    if source.suffix.lower() == ".csv":
        raw = pd.read_csv(source)
    else:
        book = pd.ExcelFile(source)
        sheet = next((s for s in book.sheet_names if not s.endswith("_dic")), book.sheet_names[0])
        raw = pd.read_excel(book, sheet)
    raw.columns = [str(c).strip() for c in raw.columns]

    mask = (raw["symbol_code"].astype(str) == BD_SYMBOL) & (raw["price_type"].astype(str) == BD_PRICE_TYPE)
    sel = raw.loc[mask, ["date", "value"]].copy()
    if sel.empty:
        raise ValueError(f"No rows for {BD_SYMBOL}/{BD_PRICE_TYPE} in {source}")
    sel["date"] = pd.to_datetime(sel["date"], errors="coerce")
    sel["value"] = pd.to_numeric(sel["value"], errors="coerce")
    sel = sel.dropna()

    monthly = sel.groupby(sel["date"].dt.to_period("M"))["value"].mean().astype(float)
    idx = pd.period_range(monthly.index.min(), monthly.index.max(), freq="M")
    monthly = monthly.reindex(idx).interpolate(limit=MAX_GAP_FILL)
    monthly.index.name = "_month"
    current = pd.Timestamp.today().to_period("M")
    return monthly[monthly.index < current]


def _fob_usd(df: pd.DataFrame) -> pd.Series:
    """FOB amount of each billing line in USD."""
    curr = df[CURRENCY_COL].astype(str).str.upper().str.strip()
    fob, net, rate, net_usd = df[FOB_COL], df[NET_COL], df[RATE_COL], df[NET_USD_COL]
    out = pd.Series(np.nan, index=df.index, dtype=float)

    is_usd = curr == "USD"
    out[is_usd] = fob[is_usd]
    is_thb = (curr == "THB") & (rate > 0)
    out[is_thb] = fob[is_thb] / rate[is_thb]
    other = out.isna() & (net > 0)
    out[other] = net_usd[other] * fob[other] / net[other]
    return out


def price_series(df: pd.DataFrame = None, path=None, grades=None) -> dict:
    """{grade: DataFrame[qty, docs, fob_price, net_price]} on a monthly PeriodIndex."""
    if df is None:
        df = billing_data.load_billing_frame(path)
    df = df.copy()
    for col in NUMERIC_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    usable = df[(df["_qty"] > 0) & (df[NET_USD_COL] > 0)].copy()
    usable["_fob_usd"] = _fob_usd(usable)
    usable = usable.dropna(subset=["_fob_usd"])

    out = {}
    for grade in grades or TARGET_GRADES:
        rows = usable[usable[GRADE_COL].astype(str) == grade]
        if rows.empty:
            continue
        agg = rows.groupby("_month").agg(
            qty=("_qty", "sum"),
            net_usd=(NET_USD_COL, "sum"),
            fob_usd=("_fob_usd", "sum"),
            docs=("_qty", "size"),
        )
        idx = pd.period_range(agg.index.min(), agg.index.max(), freq="M")
        agg = agg.reindex(idx)
        frame = pd.DataFrame({
            "qty": agg["qty"].fillna(0.0),
            "docs": agg["docs"].fillna(0).astype(int),
            "fob_price": (agg["fob_usd"] / agg["qty"]).interpolate(limit=MAX_GAP_FILL),
            "net_price": (agg["net_usd"] / agg["qty"]).interpolate(limit=MAX_GAP_FILL),
        })
        frame.index.name = "_month"
        out[grade] = frame
    return out


def aligned_frame(price_frame: pd.DataFrame, bd: pd.Series) -> pd.DataFrame:
    """Rows usable by the pass-through model: price, same-month BD, BD lags 1-2, price lag 1."""
    frame = pd.DataFrame({
        "p": price_frame["fob_price"],
        "bd0": bd,
        "bd1": bd.shift(1),
        "bd2": bd.shift(2),
    })
    frame["p1"] = frame["p"].shift(1)
    return frame.dropna()
