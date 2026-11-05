"""
Database mode selection: no config -> memory, broken config -> startup
error, configured but unreachable -> stays in database mode (503s).
"""

import pytest

import database


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """Fresh module state and no DB variables from the developer's shell."""
    for name in ("DATABASE_URL", "MSSQL_HOST", "MSSQL_USER", "MSSQL_PASSWORD", "MSSQL_PORT", "MSSQL_DB"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(database, "_conn_params", None)
    monkeypatch.setattr(database, "_schema_ready", False)


def test_no_configuration_means_memory_mode():
    database.connect_database()
    assert not database.is_configured()


def test_broken_configuration_fails_the_startup(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlserver://sa:pw@db:not-a-port?database=IBP_DB")
    with pytest.raises(RuntimeError, match="Invalid database configuration"):
        database.connect_database()


def test_unreachable_database_stays_in_database_mode(monkeypatch):
    # Nothing listens on port 1: the connection is refused straight away
    monkeypatch.setenv("DATABASE_URL", "sqlserver://ibp_app:pw@127.0.0.1:1?database=IBP_DB")
    database.connect_database()
    assert database.is_configured()
    with pytest.raises(Exception):
        database.fetch_top_scenarios()


def test_dsn_password_may_contain_at_sign(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlserver://sa:p@ss@mssql:1433?database=IBP_DB")
    params = database._connection_params()
    assert (params["user"], params["password"], params["server"], params["port"]) == ("sa", "p@ss", "mssql", 1433)
    assert params["database"] == "IBP_DB"
