"""
Train the sale-price engine from the billing and BD data and write the artifact.

Run from the Backend/ folder:

    python -m forecasting.price.train                 # uses DemandModel/*.csv and data/*.xlsx
    python -m forecasting.price.train --billing X --bd Y --out artifacts/sale_price_forecast.json
    python -m forecasting.price.train --no-save       # backtest report only
"""

from __future__ import annotations

import argparse
import sys

from .models import MODEL_NAMES
from . import service


def _pct(value) -> str:
    return "-" if value is None else f"{value * 100:5.1f}%"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Train the sale-price forecast engine")
    parser.add_argument("--billing", default=None, help="billing CSV (default: first CSV in DemandModel/)")
    parser.add_argument("--bd", default=None, help="BD price workbook (default: first file in data/ or BD_PRICE_PATH)")
    parser.add_argument("--out", default=str(service.DEFAULT_ARTIFACT_PATH), help="artifact path")
    parser.add_argument("--no-save", action="store_true", help="print the report without writing the artifact")
    args = parser.parse_args(argv)

    engine = service.train_all(args.billing, args.bd)

    print(f"Sale-price backtest: {engine['protocol']['backtest']}")
    print(f"BD driver {engine['bd_symbol']} last month {engine['bd_last_month']} = {engine['bd_last']:.0f} USD/t\n")
    for grade, info in engine["grades"].items():
        print(f"=== {grade}: {info['months']} aligned months through {info['trained_through']}, "
              f"avg {info['avg_price']:,.0f} USD/t, last {info['last_price']:,.0f} ===")
        print(f"{'model':<32}{'MAPE all':>10}{'select':>9}{'hold-out':>10}{'h1':>8}{'h2':>8}{'h3':>8}")
        for name in MODEL_NAMES:
            row = info["leaderboard"][name]
            print(f"{name:<32}{_pct(row['mape']):>10}{_pct(row['mape_select']):>9}{_pct(row['mape_holdout']):>10}"
                  f"{_pct(row['mape_h'].get('1')):>8}{_pct(row['mape_h'].get('2')):>8}{_pct(row['mape_h'].get('3')):>8}")
        cov = info.get("coverage_empirical")
        print(f"-> champion: {info['champion']} | {info['interval_level_pct']}% band hold-out coverage: "
              f"{'-' if cov is None else f'{cov * 100:.0f}%'} | coef a={info['coef'][0]:.1f} "
              f"b1={info['coef'][1]:.3f} b2={info['coef'][2]:.3f} c={info['coef'][3]:.3f}\n")

    if args.no_save:
        return 0
    path = service.save_artifact(engine, args.out)
    print(f"artifact written: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
