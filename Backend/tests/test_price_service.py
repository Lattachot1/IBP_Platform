import pandas as pd
import pytest

from forecasting.price import models, service


@pytest.fixture(scope="module")
def engine(synthetic_data):
    return service.train_all(synthetic_data["billing"], synthetic_data["bd"])


def test_pass_through_is_champion_and_beats_naive(engine):
    assert len(engine["grades"]) == 2
    for info in engine["grades"].values():
        assert info["champion"] in (models.PASS_THROUGH, models.ENSEMBLE)
        assert info["mape"] < info["naive_mape"]
        assert info["folds"] == service.FOLD_MONTHS
        assert info["holdout_folds"] == service.HOLDOUT_FOLDS
        assert info["select_folds"] == service.FOLD_MONTHS - service.HOLDOUT_FOLDS
        assert set(info["leaderboard"]) == set(models.MODEL_NAMES)
        # the synthetic price is 500/700 + 1.0 x BD(t-1): the fit should find b1 = 1.
        # p(t-1) is itself 500/700 + BD(t-2) here, so b2 and c are only identified
        # through their sum, which must be about 0.
        assert 0.7 < info["coef"][1] < 1.3
        assert abs(info["coef"][2] + info["coef"][3]) < 0.3


def test_forecast_shape_bands_and_periods(engine):
    info = next(iter(engine["grades"].values()))
    out = service.forecast(info, 6, 0.0)
    assert len(out["periods"]) == 6 and len(out["forecast"]) == 6 and len(out["bd_path"]) == 6
    assert all(lo <= f <= hi for lo, f, hi in zip(out["lower"], out["forecast"], out["upper"]))
    # the band is relative to the point forecast and never narrows with distance
    rel_widths = [(hi - lo) / f for lo, f, hi in zip(out["lower"], out["forecast"], out["upper"])]
    assert all(later >= earlier - 1e-6 for earlier, later in zip(rel_widths, rel_widths[1:]))
    assert info["interval_basis"] == "relative"
    last = pd.Period(info["trained_through"], freq="M")
    assert out["periods"][0] == str(last + 1)
    assert out["model_name"] == info["champion"]


def test_horizon_is_clamped(engine):
    info = next(iter(engine["grades"].values()))
    assert len(service.forecast(info, 99, 0.0)["forecast"]) == service.MAX_HORIZON
    assert len(service.forecast(info, 0, 0.0)["forecast"]) == 1


def test_bd_scenario_applies_from_month_two(engine):
    info = next(iter(engine["grades"].values()))
    base = service.forecast(info, 4, 0.0)
    high = service.forecast(info, 4, 20.0)
    assert high["bd_path"][0] == pytest.approx(info["bd_last"] * 1.2, rel=1e-6)
    assert high["forecast"][0] == pytest.approx(base["forecast"][0])  # month 1 uses the known BD
    assert high["forecast"][1] > base["forecast"][1]
    assert high["forecast"][3] > base["forecast"][3]


def test_explicit_bd_path_is_padded(engine):
    info = next(iter(engine["grades"].values()))
    out = service.forecast(info, 4, 0.0, bd_values=[1500.0, 1600.0])
    assert out["bd_path"] == [1500.0, 1600.0, 1600.0, 1600.0]


def test_artifact_round_trip(engine, tmp_path):
    path = service.save_artifact(engine, tmp_path / "artifact.json")
    loaded = service.load_artifact(path)
    assert loaded["artifact_version"] == service.ARTIFACT_VERSION
    assert loaded["grades"].keys() == engine["grades"].keys()
    original = next(iter(engine["grades"].values()))
    reloaded = loaded["grades"][original["grade"]]
    assert service.forecast(original, 3, 5.0) == service.forecast(reloaded, 3, 5.0)


def test_load_or_train_prefers_existing_artifact(engine, tmp_path):
    path = tmp_path / "artifact.json"
    service.save_artifact(engine, path)
    loaded, source = service.load_or_train(path)
    assert source == "artifact"
    assert loaded["trained_at"] == engine["trained_at"]


def test_load_artifact_rejects_incomplete_file(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text('{"artifact_version": "x", "trained_at": "y", "bd_last": 1, "grades": {"g": {"champion": "n"}}}', encoding="utf-8")
    with pytest.raises(ValueError):
        service.load_artifact(bad)


def test_leaderboard_rows_are_json_friendly(engine):
    rows = service.leaderboard_rows(engine)
    assert len(rows) == 2
    for row in rows:
        assert row["mape"] is not None and 0 <= row["mape"] < 1
        assert row["coverage_empirical"] is None or 0 <= row["coverage_empirical"] <= 1
