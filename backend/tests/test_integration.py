"""
test_integration.py — Integration test: real NASA GEOS-FP request.

This file performs ONE real OPeNDAP request to validate that the backend
produces values consistent with the reference Python extraction logic:

    ds["t2m"].sel(lat=23.8103, lon=90.4125, method="nearest")
    temperature_C = temperature_K - 273.15

Run only when explicitly requested:
    python -m pytest tests/test_integration.py -v -s

Requires network access to:
    https://opendap.nccs.nasa.gov/dods/GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx
"""
import os
import unittest
from datetime import datetime, timezone

SKIP = os.environ.get("NASA_INTEGRATION_TEST", "0") != "1"
SKIP_REASON = "Set NASA_INTEGRATION_TEST=1 to run live NASA integration tests."


@unittest.skipIf(SKIP, SKIP_REASON)
class TestRealNasaRequest(unittest.TestCase):
    """
    Validates the backend against the reference extraction logic.
    """

    NASA_URL = (
        "https://opendap.nccs.nasa.gov/dods/GEOS-5/"
        "fp/0.25_deg/assim/inst3_2d_asm_Nx"
    )
    TARGET_LAT = 23.8103
    TARGET_LON = 90.4125
    START = datetime(2026, 9, 29, 0, 0, 0, tzinfo=timezone.utc)
    END = datetime(2026, 9, 29, 9, 0, 0, tzinfo=timezone.utc)

    def test_values_consistent_with_reference_extraction(self):
        """
        Compare backend output to reference:
            ds["t2m"].sel(lat=23.8103, lon=90.4125, method="nearest")
            temp_C = temp_K - 273.15
        """
        from app.services.nasa.geos_fp import get_temperature_series

        obs, grid_pt, spatial_res, temporal_res = get_temperature_series(
            url=self.NASA_URL,
            latitude=self.TARGET_LAT,
            longitude=self.TARGET_LON,
            start=self.START,
            end=self.END,
        )

        print(f"\nGrid point selected: {grid_pt}")
        print(f"Spatial resolution: {spatial_res}")
        print(f"Temporal resolution: {temporal_res}")
        print(f"Observations returned: {len(obs)}")
        for o in obs:
            print(f"  {o.timestamp}  {o.temperature_c:.4f} °C")

        self.assertGreater(len(obs), 0)

        # Grid point must be near Dhaka
        self.assertAlmostEqual(grid_pt.latitude, 23.75, delta=0.3)
        self.assertAlmostEqual(grid_pt.longitude, 90.3125, delta=0.4)

        # Plausible temperature check
        for o in obs:
            self.assertGreater(o.temperature_c, 15.0, msg=f"Unexpectedly cold: {o}")
            self.assertLess(o.temperature_c, 45.0, msg=f"Unexpectedly hot: {o}")

        # Temporal resolution check
        self.assertIn(temporal_res.label, ["3-hourly", "hourly", "6-hourly"])

        for o in obs:
            self.assertTrue(o.timestamp.endswith("Z"), msg=f"Not UTC: {o.timestamp}")

    def test_temporal_resolution_not_hardcoded_hourly(self):
        """
        The current GEOS-FP dataset exposes 3-hourly data.
        The backend must detect and report this accurately.
        """
        from app.services.nasa.geos_fp import get_temperature_series

        _, _, _, temporal_res = get_temperature_series(
            url=self.NASA_URL,
            latitude=self.TARGET_LAT,
            longitude=self.TARGET_LON,
            start=self.START,
            end=self.END,
        )

        print(f"\nDetected temporal resolution: {temporal_res}")
        self.assertNotEqual(
            temporal_res.label, "hourly",
            msg="Dataset is currently 3-hourly; backend should not report 'hourly'"
        )
        self.assertEqual(temporal_res.minutes, 180)
        self.assertEqual(temporal_res.label, "3-hourly")


if __name__ == "__main__":
    os.environ["NASA_INTEGRATION_TEST"] = "1"
    unittest.main()
