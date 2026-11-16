"""SAP market codes that fold into their combined product.

A combined spec ('400003-ST,WS') is ONE product in the master: SAP still
tracks the individual codes separately (stock batches, order lines), so
codespec_aliases() reads the catalog and returns {SAP code -> the
combined product it belongs to}; every import resolves an incoming code
through it before matching the product master. The combined code itself
is the master key and needs no mapping.
"""

import csv
import re

CATALOG_FILE = "product_codespec_effective.csv"


def codespec_aliases(path=None) -> dict:
    """{individual SAP code -> the combined product code it folds into}."""
    from forecasting.data import DATA_DIR

    if path is None:
        path = DATA_DIR / CATALOG_FILE
    aliases: dict = {}
    try:
        with open(path, encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                if (row.get("record_decision") or "").strip() != "use":
                    continue
                spec = re.sub(r"\s+", "", (row.get("code_spec") or "").strip().upper())
                if "," not in spec or "-" not in spec:
                    continue
                base, tail = spec.split("-", 1)
                for market in tail.split(","):
                    if market:
                        aliases.setdefault("%s-%s" % (base, market), combined_key(spec))
    except FileNotFoundError:
        pass                                   # no catalog on this machine: no aliases
    return aliases


def combined_key(spec: str) -> str:
    """The master key of a combined spec: spaces collapsed ('400003-ST,WS')."""
    return re.sub(r"\s+", "", spec.upper())
