"""
Raw-material (butadiene) price forecasting package.

Ported from the model-service on feature/butadiene-price-forecast into the
unified Python backend. The artifact schema and the
/api/v1/raw-material-price/forecast contract are kept unchanged; training,
backtesting and per-horizon metrics are new.

- data.py     monthly BD FOB SE Asia history (shared loader with the price engine)
- models.py   candidates: random walk, drift, ETS (log), mean reversion, seasonal ETS
- service.py  backtest, champion, quantile bands, artifact I/O, scenario paths
- train.py    CLI: python -m forecasting.rawmat.train
- api.py      FastAPI router
- samples/    the 2026-09-13 artifact from the original branch (test fixture + fallback)
"""
