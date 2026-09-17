"""
Sale-price forecasting package (monthly realized selling price per grade).

Layout mirrors the demand package:
- data.py     billing -> monthly FOB/net price per grade, plus the BD driver
- models.py   candidate models (naive, ETS, BD pass-through, ensemble)
- service.py  backtest, champion selection, intervals, artifact I/O, forecast
- train.py    CLI: train everything and write the artifact
- api.py      FastAPI router (/api/v1/price/*, /api/v1/revenue/outlook)
"""
