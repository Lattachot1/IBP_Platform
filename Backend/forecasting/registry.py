"""
Process-wide registry of trained engines.

main.py stores the demand and sale-price engines here at startup and after a
retrain, so API routers in other modules can read them without importing
main (which would create a circular import).
"""

from typing import Any, Optional

ENGINES: dict = {"demand": None, "price": None}


def get(name: str) -> Optional[Any]:
    return ENGINES.get(name)


def set_engine(name: str, engine: Optional[Any]) -> None:
    ENGINES[name] = engine
