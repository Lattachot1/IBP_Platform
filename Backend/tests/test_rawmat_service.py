import pytest

from forecasting.rawmat import models, service


@pytest.fixture(scope="module")
def engine(synthetic_data):
    return service.train_all(synthetic_data["bd"])


def test_artifact_keeps_the_original_contract(engine):
    service.validate_artifact(engine)
    assert engine["symbol"] == "PA0033242"
    assert engine["unit"] == "USD/t"
    assert engine["champion"] in models.MODEL_NAMES
    assert engine["model_name"] == engine["champion"]
    assert len(engine["forecasts"]) == service.MAX_HORIZON
    for row in engine["forecasts"]:
        assert row["p025"] <= row["p10"] <= row["p50"] <= row["p90"] <= row["p975"]
        assert row["best_purchase_case"] == row["p10"]
        assert row["base_case"] == row["p50"]
        assert row["worst_purchase_case"] == row["p90"]
    assert engine["forecast_origin"][-2:] in {"28", "29", "30", "31"}


def test_backtest_protocol_and_leaderboard(engine):
    assert engine["folds"] == service.FOLD_MONTHS
    assert engine["holdout_folds"] == service.HOLDOUT_FOLDS
    assert engine["select_folds"] == service.FOLD_MONTHS - service.HOLDOUT_FOLDS
    assert set(engine["leaderboard"]) == set(models.MODEL_NAMES)
    champ = engine["leaderboard"][engine["champion"]]
    assert champ["mae_select"] == min(v["mae_select"] for v in engine["leaderboard"].values())
    assert set(engine["validation_mae_by_horizon"]) == {"1", "2", "3", "4"}
    assert engine["validation_mae"] == champ["mae"]
    cov = engine["interval"]["coverage_p10_p90_holdout"]
    assert cov is None or 0.0 <= cov <= 1.0


def test_bands_never_narrow_with_horizon(engine):
    rel = [(r["p90"] - r["p10"]) / r["point"] for r in engine["forecasts"]]
    assert all(later >= earlier - 1e-9 for earlier, later in zip(rel, rel[1:]))


def test_scenario_paths(engine):
    low = service.scenario_path(engine, "low", 6)
    base = service.scenario_path(engine, "base", 6)
    high = service.scenario_path(engine, "high", 6)
    assert len(low) == len(base) == len(high) == 6
    assert all(lo <= mid <= hi for lo, mid, hi in zip(low, base, high))
    assert high[:2] == [engine["forecasts"][0]["p90"], engine["forecasts"][1]["p90"]]
    assert service.scenario_path(engine, "flat", 3) == []
    with pytest.raises(ValueError):
        service.scenario_path(engine, "nope", 3)


def test_sample_artifact_from_the_original_branch_still_serves():
    # ported from model-service/test_main.py
    sample = service.load_artifact(service.SAMPLE_ARTIFACT_PATH)
    assert sample["artifact_version"].startswith("2026-09-13")
    response = service.forecast_response(sample, 2)
    assert len(response["forecasts"]) == 2
    assert response["forecasts"][-1]["horizon"] == 2
    for row in sample["forecasts"]:
        assert row["p025"] <= row["p10"] <= row["p50"] <= row["p90"] <= row["p975"]


def test_validate_rejects_broken_artifacts():
    bad = {key: "x" for key in service.REQUIRED_KEYS}
    bad["forecasts"] = [{"horizon": 1, "p025": 5, "p10": 4, "p50": 3, "p90": 2, "p975": 1}]
    with pytest.raises(ValueError):
        service.validate_artifact(bad)
    bad["forecasts"] = [{"horizon": 2, "p025": 1, "p10": 2, "p50": 3, "p90": 4, "p975": 5}]
    with pytest.raises(ValueError):
        service.validate_artifact(bad)
    with pytest.raises(ValueError):
        service.validate_artifact({"artifact_version": "x"})


def test_artifact_round_trip_and_sample_fallback(engine, tmp_path):
    path = service.save_artifact(engine, tmp_path / "bd.json")
    loaded, source = service.load_or_train(path)
    assert source == "artifact"
    assert loaded["forecasts"] == engine["forecasts"]
    assert "engine_source" not in service.load_artifact(path)

    fallback, source = service.load_or_train(tmp_path / "missing.json", bd_file=tmp_path / "no-data.xlsx")
    assert source == "sample"
    assert fallback["engine_source"] == "sample"
    assert not (tmp_path / "missing.json").exists()
