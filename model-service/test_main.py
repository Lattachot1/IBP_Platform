import unittest

from fastapi import HTTPException

from main import (
    RawMaterialForecastRequest,
    generate_raw_material_forecast,
    health_check,
    load_butadiene_artifact,
)


class RawMaterialForecastTests(unittest.TestCase):
    def setUp(self):
        load_butadiene_artifact.cache_clear()

    def test_artifact_is_loaded_and_healthy(self):
        health = health_check()
        self.assertEqual(health["status"], "healthy")
        self.assertTrue(health["butadiene_artifact"].startswith("loaded:"))

    def test_horizon_limits_response(self):
        result = generate_raw_material_forecast(
            RawMaterialForecastRequest(horizon_months=2)
        )
        self.assertEqual(len(result.forecasts), 2)
        self.assertEqual(result.forecasts[-1].horizon, 2)

    def test_purchase_scenarios_are_ordered(self):
        result = generate_raw_material_forecast(RawMaterialForecastRequest())
        for row in result.forecasts:
            self.assertLessEqual(row.p025, row.p10)
            self.assertLessEqual(row.p10, row.p50)
            self.assertLessEqual(row.p50, row.p90)
            self.assertLessEqual(row.p90, row.p975)

    def test_unknown_symbol_returns_not_found(self):
        with self.assertRaises(HTTPException) as raised:
            generate_raw_material_forecast(
                RawMaterialForecastRequest(symbol="UNKNOWN")
            )
        self.assertEqual(raised.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
