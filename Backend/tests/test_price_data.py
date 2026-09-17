import numpy as np
import pandas as pd

from conftest import GRADES, N_MONTHS
from forecasting import data as billing_data
from forecasting.price import data as price_data


def test_bd_monthly_uses_mid_price_and_drops_current_month(synthetic_data):
    bd = price_data.load_bd_monthly(synthetic_data["bd"])
    assert isinstance(bd.index, pd.PeriodIndex)
    assert len(bd) == N_MONTHS
    assert np.allclose(bd.values, synthetic_data["bd_series"].values)  # H rows ignored
    assert bd.index[-1] < pd.Timestamp.today().to_period("M")


def test_price_series_applies_row_and_currency_rules(synthetic_data):
    frame = billing_data.load_billing_frame(synthetic_data["billing"])
    prices = price_data.price_series(frame)
    assert set(prices) == set(GRADES)

    p = prices[GRADES[0]]
    assert len(p) == N_MONTHS
    assert list(p.columns) == ["qty", "docs", "fob_price", "net_price"]

    # the 999-ton void document and the 50-ton unposted row are not counted
    assert p["qty"].iloc[-1] < 1500
    assert p["docs"].iloc[-1] == 3

    # USD, THB and EUR documents all reconstruct the generating FOB price
    # (500 + BD lag 1 + N(0, 20) noise, whose mean absolute value is about 16)
    expected = 500 + synthetic_data["bd_series"].shift(1).bfill()
    assert (p["fob_price"] - expected.values).abs().mean() < 25

    # net price carries the 3% freight/insurance on top of FOB
    ratio = (p["net_price"] / p["fob_price"]).mean()
    assert 1.02 < ratio < 1.04


def test_aligned_frame_builds_lags(synthetic_data):
    bd = price_data.load_bd_monthly(synthetic_data["bd"])
    prices = price_data.price_series(path=synthetic_data["billing"])
    frame = price_data.aligned_frame(prices[GRADES[0]], bd)
    assert list(frame.columns) == ["p", "bd0", "bd1", "bd2", "p1"]
    assert len(frame) == N_MONTHS - 2
    assert frame["bd1"].iloc[1] == frame["bd0"].iloc[0]
    assert frame["p1"].iloc[1] == frame["p"].iloc[0]
