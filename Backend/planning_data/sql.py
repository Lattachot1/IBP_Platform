"""Shared MS SQL plumbing for the planning_data stores."""

from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Optional

import database

DUPLICATE_KEY_ERRORS = (2601, 2627)
CONSTRAINT_ERRORS = (547,)          # CHECK or FOREIGN KEY violation


class StoreUnavailable(RuntimeError):
    """The database could not answer (the API turns this into a 503)."""


class WriteRejected(ValueError):
    """The database refused the rows (a constraint): the API answers 422."""


def error_number(exc: Exception) -> Optional[int]:
    """SQL Server error number of a pymssql exception, if any."""
    first = exc.args[0] if exc.args else None
    return first if isinstance(first, int) else None


@contextmanager
def connection(passthrough=()):
    """A database connection that is always closed.

    Exceptions listed in `passthrough` and WriteRejected propagate as they
    are; anything else becomes StoreUnavailable. A connection closed
    without commit() rolls back.
    """
    try:
        conn = database.open_connection()
    except Exception as exc:
        raise StoreUnavailable("database unreachable: %s" % exc) from exc
    try:
        yield conn
    except passthrough:
        raise
    except WriteRejected:
        raise
    except Exception as exc:
        raise StoreUnavailable("database error: %s" % exc) from exc
    finally:
        conn.close()


def utc(value: Optional[datetime]) -> Optional[datetime]:
    """DATETIME2 columns hold SYSUTCDATETIME(); pymssql returns them naive."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value
