"""Regression tests for find_source_file (forecasting/data.py).

DemandModel/ has grown companion CSVs that are not the billing extract
(fred_*.csv downloads, product_codespec_effective.csv). On Windows the
case-insensitive Path sort puts some of them before 'Sale Billing...', and
the old name-only filter (skip fred_*) picked the codespec file — training
then crashed with KeyError: 'Billing Date'. The picker must instead verify
the header, like load_billing_frame will expect it.
"""

import pytest

from forecasting import data


BILLING_CSV = "Sale Billing TSL(Sheet2).csv"
CODESPEC_CSV = "product_codespec_effective.csv"

BILLING_HEADER = "Billing Date,Billing Type,Material Number,Mat Description,Grade,QTY(ton)"
CODESPEC_HEADER = "code_spec,product_raw,effective_product_group,record_decision"


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(data, "DATA_DIR", tmp_path)
    return tmp_path


def _billing(path):
    # the real extract: a human note row first, header on row 1, cp874
    path.write_text(
        "invoice extract, exported 2026-09-16\n"
        + BILLING_HEADER
        + "\n2025/01/02,ZP01,400003,UBEPOL AE150GPS,UBEPOL BR150,12.5\n",
        encoding="cp874",
    )


def _codespec_decoy(path):
    path.write_text(CODESPEC_HEADER + "\n400003-ST,UBEPOL AE150GPS,BR150,use\n", encoding="utf-8")


def test_picks_the_csv_whose_header_has_billing_date(data_dir):
    # the codespec file sorts first on Windows' case-insensitive sort
    _codespec_decoy(data_dir / CODESPEC_CSV)
    _billing(data_dir / BILLING_CSV)
    (data_dir / "fred_brent.csv").write_text("date,price\n2026-01-01,70\n", encoding="utf-8")

    found = data.find_source_file()

    assert found == data_dir / BILLING_CSV


def test_raises_when_no_csv_has_the_header(data_dir):
    _codespec_decoy(data_dir / CODESPEC_CSV)
    (data_dir / "fred_thbusd.csv").write_text("date,fx\n2026-01-01,33\n", encoding="utf-8")

    with pytest.raises(FileNotFoundError):
        data.find_source_file()


def test_explicit_path_and_env_win(data_dir, monkeypatch):
    _billing(data_dir / BILLING_CSV)
    other = data_dir / "elsewhere.csv"
    _billing(other)

    assert data.find_source_file(other) == other

    monkeypatch.setenv("DEMAND_DATA_PATH", str(other))
    assert data.find_source_file() == other
