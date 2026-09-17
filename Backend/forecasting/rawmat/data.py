"""
Butadiene (BD) market price history for the raw-material forecast.

Reuses the sale-price engine's loader: Argus Butadiene FOB Southeast Asia
mid assessments (symbol PA0033242), weekly, averaged to calendar months,
in-progress month dropped.
"""

from __future__ import annotations

import pandas as pd

from ..price import data as price_data

SYMBOL = price_data.BD_SYMBOL
COMMODITY = "Butadiene"
MARKET = "FOB Southeast Asia"
UNIT = "USD/t"


def find_bd_file(path=None):
    return price_data.find_bd_file(path)


def load_bd_monthly(path=None) -> pd.Series:
    """Monthly mean BD price on a monthly PeriodIndex."""
    return price_data.load_bd_monthly(path)
