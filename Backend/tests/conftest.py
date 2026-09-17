"""
Shared fixtures: a synthetic billing extract and BD price workbook that follow
the real files' layout (note row + header, cp874, YYYY/MM/DD billing dates;
weekly BD rows with H/L/M price types) without containing any company data.

The synthetic selling price is built as 500 (+200 per grade) + 1.0 x BD of the
previous month + noise, so the pass-through model has a signal to find.
"""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pytest  # noqa: E402

GRADES = ["UBEPOL BR150", "UBEPOL BR150L"]
N_MONTHS = 60


def _months(n: int) -> pd.PeriodIndex:
    last = pd.Timestamp.today().to_period("M") - 1  # last complete month
    return pd.period_range(last - (n - 1), last, freq="M")


def make_bd(months: pd.PeriodIndex, seed: int = 1) -> pd.Series:
    rng = np.random.default_rng(seed)
    level = 1000 + np.cumsum(rng.normal(0, 60, len(months)))
    return pd.Series(np.clip(level, 400, None), index=months)


def write_bd_xlsx(path: Path, bd: pd.Series) -> None:
    rows = []
    for period, value in bd.items():
        for day in (5, 12, 19, 26):
            base = {
                "date": pd.Timestamp(period.year, period.month, day),
                "symbol_code": "PA0033242",
                "commodity": "BUTADIENE",
                "market": "Seaborne SE Asia",
                "frequency": "weekly",
                "uom": "USD/t",
            }
            rows.append({**base, "price_type": "M", "value": float(value)})
            rows.append({**base, "price_type": "H", "value": float(value) * 1.05})  # must be ignored
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        pd.DataFrame({"field": ["date"], "meaning": ["date of the price"]}).to_excel(
            writer, sheet_name="price_history_dic", index=False
        )
        pd.DataFrame(rows).to_excel(writer, sheet_name="price_history", index=False)


def write_billing_csv(path: Path, months: pd.PeriodIndex, bd: pd.Series, seed: int = 2) -> None:
    rng = np.random.default_rng(seed)
    rows = []
    for gi, grade in enumerate(GRADES):
        adder = 500 + 200 * gi
        for i, period in enumerate(months):
            bd_lag = float(bd.iloc[i - 1]) if i > 0 else float(bd.iloc[0])
            price = adder + 1.0 * bd_lag + rng.normal(0, 20)
            tons_total = 1000 + 100 * gi + rng.normal(0, 80)
            for j, curr in enumerate(["USD", "THB", "EUR"]):
                tons = tons_total / 3
                fob_usd = price * tons
                net_usd = fob_usd * 1.03  # freight + insurance on top of FOB
                if curr == "USD":
                    fob_doc, net_doc = fob_usd, net_usd
                elif curr == "THB":
                    fob_doc, net_doc = fob_usd * 33.0, net_usd * 33.0
                else:  # EUR document: only the FOB/Net ratio is usable
                    fob_doc, net_doc = fob_usd * 0.9, net_usd * 0.9
                rows.append({
                    "Billing Date": pd.Timestamp(period.year, period.month, 10 + j).strftime("%Y/%m/%d"),
                    "Billing Type": "ZP03",
                    "Grade": grade,
                    "QTY(ton)": round(tons, 3),
                    "Curr.": curr,
                    "Rate": 33.0,
                    "FOB Amount adj": round(fob_doc, 2),
                    "Net Amount adj": round(net_doc, 2),
                    "NetAmtUSD": round(net_usd, 2),
                })
    last = months[-1]
    # a void document and an unposted row: both must be ignored everywhere
    rows.append({
        "Billing Date": pd.Timestamp(last.year, last.month, 20).strftime("%Y/%m/%d"),
        "Billing Type": "ZV01", "Grade": GRADES[0], "QTY(ton)": 999.0, "Curr.": "USD", "Rate": 33.0,
        "FOB Amount adj": 1.0, "Net Amount adj": 1.0, "NetAmtUSD": 1.0,
    })
    rows.append({
        "Billing Date": pd.Timestamp(last.year, last.month, 21).strftime("%Y/%m/%d"),
        "Billing Type": "ZP03", "Grade": GRADES[0], "QTY(ton)": 50.0, "Curr.": "USD", "Rate": 33.0,
        "FOB Amount adj": 1e9, "Net Amount adj": 1e9, "NetAmtUSD": 0.0,
    })
    with open(path, "w", encoding="cp874", newline="") as fh:
        fh.write("synthetic billing extract; header is on the next row\n")
    pd.DataFrame(rows).to_csv(path, mode="a", index=False, encoding="cp874")


@pytest.fixture(scope="session")
def synthetic_data(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("data")
    months = _months(N_MONTHS)
    bd = make_bd(months)
    bd_path = tmp / "bd_price_history.xlsx"
    write_bd_xlsx(bd_path, bd)
    billing_path = tmp / "sale_billing.csv"
    write_billing_csv(billing_path, months, bd)
    return {"billing": billing_path, "bd": bd_path, "months": months, "bd_series": bd}
