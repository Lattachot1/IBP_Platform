"""
AI-Driven Integrated Business Planning (IBP) Platform
MS SQL Server access layer (pymssql)

Prepared for UBE Chemicals (Asia) PCL

- Reads DATABASE_URL (sqlserver://user:pass@host:port?database=DB) or
  individual MSSQL_* environment variables.
- No configuration -> the app runs in in-memory mode (local development).
- A configured database is the only store: if it is down, the calls below
  raise and the API answers 503 - nothing is silently kept in memory.
  Every call opens a fresh connection, so service resumes on its own once
  the database is back.
- A broken configuration (bad DSN, pymssql missing) fails the startup.
- Ensures dbo.Scenarios exists (idempotent T-SQL guard) on the first
  successful connection.
"""

import logging
import os
import threading
from datetime import timezone
from typing import Any, Optional

log = logging.getLogger("ibp.database")

# Idempotent schema guard, byte-equivalent to the legacy Go runtime DDL
SCHEMA_SQL = """
IF OBJECT_ID(N'dbo.Scenarios', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Scenarios (
        ScenarioID INT IDENTITY(1,1) PRIMARY KEY,
        ScenarioName NVARCHAR(100) NOT NULL,
        BaseDemand FLOAT NOT NULL,
        DemandChangePct FLOAT NOT NULL,
        ForecastDemand FLOAT NOT NULL,
        CapacityLimit FLOAT NOT NULL,
        EnableOT BIT NOT NULL DEFAULT 0,
        ActualProduce FLOAT NOT NULL,
        ShortageQty FLOAT NOT NULL,
        ServiceLevelPct FLOAT NOT NULL,
        RevenueTHB FLOAT NOT NULL,
        ExtraCostTHB FLOAT NOT NULL DEFAULT 0,
        ConstraintStatus NVARCHAR(255) NOT NULL,
        CreatedBy NVARCHAR(50) NOT NULL,
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE()
    );
END;
"""

_INSERT_SQL = """
INSERT INTO dbo.Scenarios (
    ScenarioName, BaseDemand, DemandChangePct, ForecastDemand, CapacityLimit,
    EnableOT, ActualProduce, ShortageQty, ServiceLevelPct, RevenueTHB,
    ExtraCostTHB, ConstraintStatus, CreatedBy, CreatedAt
)
OUTPUT INSERTED.ScenarioID, INSERTED.CreatedAt
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
"""

_SELECT_TOP_SQL = """
SELECT TOP 10
    ScenarioID, ScenarioName, BaseDemand, DemandChangePct, ForecastDemand, CapacityLimit,
    EnableOT, ActualProduce, ShortageQty, ServiceLevelPct, RevenueTHB, ExtraCostTHB,
    ConstraintStatus, CreatedBy, CreatedAt
FROM dbo.Scenarios
ORDER BY CreatedAt DESC;
"""

_state_lock = threading.Lock()
_conn_params: Optional[dict] = None   # set when a database is configured
_schema_ready: bool = False


def _connection_params() -> Optional[dict]:
    """Resolve MS SQL connection settings from the environment.

    Supports the same sqlserver:// DSN the Go backend used, plus plain
    MSSQL_* variables. Returns None when the app should stay in-memory.
    """
    url = os.getenv("DATABASE_URL", "").strip()
    if url.lower().startswith("sqlserver://"):
        rest = url[len("sqlserver://"):]
        query: dict = {}
        if "?" in rest:
            rest, qs = rest.split("?", 1)
            for part in qs.split("&"):
                if "=" in part:
                    key, value = part.split("=", 1)
                    query[key] = value
        # The userinfo/host separator is the LAST '@' so passwords that
        # contain '@' (like the compose default) keep working, matching
        # the go-mssqldb DSN parser.
        userinfo, _, hostport = rest.rpartition("@")
        if userinfo:
            user, _, password = userinfo.partition(":")
        else:
            user, password = "sa", ""
        host, _, port = hostport.partition(":")
        return {
            "server": host,
            "user": user,
            "password": password,
            "port": int(port) if port else 1433,
            "database": query.get("database", "master"),
            "login_timeout": 3,
            "timeout": 3,
        }

    server = os.getenv("MSSQL_HOST", "").strip()
    if server:
        return {
            "server": server,
            "user": os.getenv("MSSQL_USER", "sa"),
            "password": os.getenv("MSSQL_PASSWORD", ""),
            "port": int(os.getenv("MSSQL_PORT", "1433")),
            "database": os.getenv("MSSQL_DB", "IBP_DB"),
            "login_timeout": 3,
            "timeout": 3,
        }

    return None


def connect_database() -> None:
    """Configure the database from the environment and try it once.

    Raises RuntimeError on a broken configuration. An unreachable database
    is only logged: the app stays in database mode and answers 503 until
    the database comes up (e.g. a container still starting).
    """
    global _conn_params

    with _state_lock:
        try:
            params = _connection_params()
        except Exception as exc:
            raise RuntimeError("Invalid database configuration (DATABASE_URL / MSSQL_*): %s" % exc) from exc
        if params is None:
            log.warning("[Database] DATABASE_URL is not set. Operating in IN-MEMORY mode "
                        "(saved scenarios are lost on restart).")
            return

        try:
            import pymssql  # noqa: F401 - optional dependency; in-memory mode works without it
        except ImportError as exc:
            raise RuntimeError("A database is configured but pymssql is not installed") from exc

        _conn_params = params

    log.info("[Database] Connecting to MS SQL Server at %s:%s ...", params["server"], params["port"])
    try:
        conn = _new_connection()
        try:
            _ensure_schema(conn)
        finally:
            conn.close()
        log.info("[Database] MS SQL Server connected and dbo.Scenarios table verified successfully.")
    except Exception as exc:
        log.warning("[Database WARNING] %s:%s is not answering yet (%s). Staying in database mode: "
                    "scenario requests return 503 until it is reachable.", params["server"], params["port"], exc)


def _ensure_schema(conn) -> None:
    """Create dbo.Scenarios if missing - once per process."""
    global _schema_ready
    if _schema_ready:
        return
    with conn.cursor() as cursor:
        cursor.execute(SCHEMA_SQL)
    conn.commit()
    _schema_ready = True


def _new_connection():
    import pymssql  # noqa: F401 - caller has checked availability

    return pymssql.connect(
        server=_conn_params["server"],
        user=_conn_params["user"],
        password=_conn_params["password"],
        port=_conn_params["port"],
        database=_conn_params["database"],
        login_timeout=_conn_params["login_timeout"],
        timeout=_conn_params["timeout"],
    )


def open_connection():
    """A fresh connection for the stores in planning_data; the caller closes it.

    Raises when no database is configured or it cannot be reached.
    """
    if _conn_params is None:
        raise RuntimeError("Database not configured (in-memory mode)")
    return _new_connection()


def is_configured() -> bool:
    """True when a database is configured (database mode), reachable or not."""
    return _conn_params is not None


def ping() -> None:
    """Raise if the database cannot answer a trivial query right now."""
    if _conn_params is None:
        raise RuntimeError("Database not configured (in-memory mode)")
    conn = _new_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    finally:
        conn.close()


def insert_scenario(values: dict) -> tuple:
    """Insert one scenario row; returns (scenario_id, created_at).

    Raises on any database error (the API turns it into a 503).
    """
    conn = _new_connection()
    try:
        _ensure_schema(conn)
        with conn.cursor() as cursor:
            cursor.execute(_INSERT_SQL, (
                values["scenario_name"], values["base_demand"], values["demand_change_pct"],
                values["forecast_demand"], values["capacity_limit"], values["enable_ot"],
                values["actual_produce"], values["shortage_qty"], values["service_level_pct"],
                values["revenue_thb"], values["extra_cost_thb"], values["constraint_status"],
                values["created_by"], values["created_at"],
            ))
            scenario_id, created_at = cursor.fetchone()
        conn.commit()
        if created_at is not None and getattr(created_at, "tzinfo", None) is None:
            # pymssql returns naive DATETIME values; mark them UTC so the
            # frontend renders the same instant the Go backend used to emit.
            created_at = created_at.replace(tzinfo=timezone.utc)
        return int(scenario_id), created_at
    finally:
        conn.close()


def fetch_top_scenarios(limit: int = 10) -> list:
    """Fetch the most recent scenarios; returns a list of row dicts.

    Raises on any database error (the API turns it into a 503).
    """
    conn = _new_connection()
    try:
        _ensure_schema(conn)
        rows: list = []
        with conn.cursor(as_dict=True) as cursor:
            cursor.execute(_SELECT_TOP_SQL)
            for row in cursor.fetchall()[:limit]:
                created_at = row["CreatedAt"]
                if created_at is not None and getattr(created_at, "tzinfo", None) is None:
                    created_at = created_at.replace(tzinfo=timezone.utc)
                rows.append({
                    "scenario_id": int(row["ScenarioID"]),
                    "scenario_name": row["ScenarioName"],
                    "base_demand": float(row["BaseDemand"]),
                    "demand_change_pct": float(row["DemandChangePct"]),
                    "forecast_demand": float(row["ForecastDemand"]),
                    "capacity_limit": float(row["CapacityLimit"]),
                    "enable_ot": bool(row["EnableOT"]),
                    "actual_produce": float(row["ActualProduce"]),
                    "shortage_qty": float(row["ShortageQty"]),
                    "service_level_pct": float(row["ServiceLevelPct"]),
                    "revenue_thb": float(row["RevenueTHB"]),
                    "extra_cost_thb": float(row["ExtraCostTHB"]),
                    "constraint_status": row["ConstraintStatus"],
                    "created_by": row["CreatedBy"],
                    "created_at": created_at,
                })
        return rows
    finally:
        conn.close()
