"""
Train the butadiene forecast and write the artifact.

Run from the Backend/ folder:

    python -m forecasting.rawmat.train              # data/*.xlsx or BD_PRICE_PATH
    python -m forecasting.rawmat.train --bd X --out artifacts/butadiene_forecast.json
    python -m forecasting.rawmat.train --no-save    # backtest report only
"""

from __future__ import annotations

import argparse
import sys

from .models import MODEL_NAMES
from . import service


def _num(value, digits=0) -> str:
    return "-" if value is None else f"{value:,.{digits}f}"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Train the butadiene price forecast")
    parser.add_argument("--bd", default=None, help="BD price workbook (default: first file in data/ or BD_PRICE_PATH)")
    parser.add_argument("--out", default=str(service.DEFAULT_ARTIFACT_PATH))
    parser.add_argument("--no-save", action="store_true")
    args = parser.parse_args(argv)

    engine = service.train_all(args.bd)
    print(f"Butadiene backtest: {engine['protocol']['backtest']}")
    print(f"{engine['months']} months through {engine['last_month']}, last = {engine['last_value']:,.0f} {engine['unit']}\n")
    print(f"{'model':<32}{'MAE all':>9}{'select':>9}{'hold-out':>10}{'h1':>8}{'h2':>8}{'h3':>8}{'h4':>8}")
    for name in MODEL_NAMES:
        row = engine["leaderboard"][name]
        mh = row["mae_h"]
        print(f"{name:<32}{_num(row['mae']):>9}{_num(row['mae_select']):>9}{_num(row['mae_holdout']):>10}"
              f"{_num(mh.get('1')):>8}{_num(mh.get('2')):>8}{_num(mh.get('3')):>8}{_num(mh.get('4')):>8}")
    cov = engine["interval"]["coverage_p10_p90_holdout"]
    print(f"\n-> champion: {engine['champion']} | P10-P90 hold-out coverage: {'-' if cov is None else f'{cov * 100:.0f}%'}")
    print("\nforecast (USD/t):")
    print(f"{'month':<12}{'point':>8}{'p10':>8}{'p50':>8}{'p90':>8}")
    for row in engine["forecasts"]:
        print(f"{row['target_month']:<12}{row['point']:>8,.0f}{row['p10']:>8,.0f}{row['p50']:>8,.0f}{row['p90']:>8,.0f}")

    if args.no_save:
        return 0
    path = service.save_artifact(engine, args.out)
    print(f"\nartifact written: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
