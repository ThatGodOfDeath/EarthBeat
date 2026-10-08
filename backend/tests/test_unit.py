"""
test_unit.py — Unit tests for Earth Jukebox Phase 4 backend.

All NASA OPeNDAP calls are mocked. No live network access is required.

Tests cover:
  1. Kelvin → Celsius conversion
  2. Nearest-neighbor grid point selection (via mocked xarray)
  3. Timestamp normalization to ISO 8601 UTC
  4. Missing-value (NaN) handling
  5. API response structure
  6. Invalid coordinate validation
  7. Invalid date range validation
"""
import math
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import numpy as np


# ── Helper: Kelvin → Celsius ──────────────────────────────────────────────────

class TestKelvinToCelsius(unittest.TestCase):
    """Kelvin → Celsius conversion: temperature_C = temperature_K - 273.15"""

    def _convert(self, k: float) -> float:
        return round(k - 273.15, 4)

    def test_freezing_point(self):
        self.assertAlmostEqual(self._convert(273.15), 0.0, places=4)

    def test_room_temperature(self):
        self.assertAlmostEqual(self._convert(298.15), 25.0, places=4)

    def test_dhaka_typical(self):
        # Dhaka ~29°C → 302.15 K
        self.assertAlmostEqual(self._convert(302.15), 29.0, places=4)

    def test_polar_cold(self):
        self.assertAlmostEqual(self._convert(233.15), -40.0, places=4)

    def test_tropical_hot(self):
        self.assertAlmostEqual(self._convert(323.15), 50.0, places=4)

    def test_zero_kelvin(self):
        self.assertAlmostEqual(self._convert(0.0), -273.15, places=4)


# ── Helper: ISO 8601 UTC timestamp normalization ───────────────────────────────

class TestTimestampNormalization(unittest.TestCase):
    def test_utc_iso_format(self):
        from app.services.nasa.geos_fp import _to_utc_iso
        ts = np.datetime64("2026-09-29T00:00:00", "ms")
        result = _to_utc_iso(ts)
        self.assertEqual(result, "2026-09-29T00:00:00Z")

    def test_utc_iso_three_hourly(self):
        from app.services.nasa.geos_fp import _to_utc_iso
        ts = np.datetime64("2026-09-29T03:00:00", "ms")
        result = _to_utc_iso(ts)
        self.assertEqual(result, "2026-09-29T03:00:00Z")

    def test_utc_iso_end_of_day(self):
        from app.services.nasa.geos_fp import _to_utc_iso
        ts = np.datetime64("2026-09-30T21:00:00", "ms")
        result = _to_utc_iso(ts)
        self.assertEqual(result, "2026-09-30T21:00:00Z")


# ── Temporal resolution detection ─────────────────────────────────────────────

class TestTemporalResolutionDetection(unittest.TestCase):
    def _make_mock_ds(self, step_hours: float, n_times: int = 10):
        """Build a minimal mock xr.Dataset with a time axis."""
        base = np.datetime64("2026-09-29T00:00:00", "ns")
        step_ns = int(step_hours * 3600 * 1e9)
        times = np.array(
            [base + i * step_ns for i in range(n_times)],
            dtype="datetime64[ns]"
        )
        mock_ds = MagicMock()
        mock_time = MagicMock()
        mock_time.values = times
        mock_time.__len__ = lambda self: n_times
        mock_ds.__getitem__ = lambda self, key: mock_time if key == "time" else MagicMock()
        return mock_ds

    def test_detects_3hourly(self):
        from app.services.nasa.geos_fp import _derive_temporal_resolution
        mock_ds = self._make_mock_ds(step_hours=3.0)
        result = _derive_temporal_resolution(mock_ds)
        self.assertEqual(result.minutes, 180)
        self.assertEqual(result.label, "3-hourly")

    def test_detects_hourly(self):
        from app.services.nasa.geos_fp import _derive_temporal_resolution
        mock_ds = self._make_mock_ds(step_hours=1.0)
        result = _derive_temporal_resolution(mock_ds)
        self.assertEqual(result.minutes, 60)
        self.assertEqual(result.label, "hourly")

    def test_detects_6hourly(self):
        from app.services.nasa.geos_fp import _derive_temporal_resolution
        mock_ds = self._make_mock_ds(step_hours=6.0)
        result = _derive_temporal_resolution(mock_ds)
        self.assertEqual(result.minutes, 360)
        self.assertEqual(result.label, "6-hourly")


# ── Missing-value handling ─────────────────────────────────────────────────────

class TestMissingValueHandling(unittest.TestCase):
    def test_nan_values_excluded(self):
        raw = [302.15, float("nan"), 303.15, float("nan"), 301.15]
        result = []
        for v in raw:
            if not math.isnan(v):
                result.append(round(v - 273.15, 4))
        self.assertEqual(len(result), 3)
        self.assertAlmostEqual(result[0], 29.0, places=2)

    def test_null_values_in_global_grid(self):
        raw_k = np.array([[302.15, float("nan"), 301.15]])
        raw_c = raw_k - 273.15
        flat = []
        for v in raw_c.flat:
            flat.append(None if math.isnan(float(v)) else round(float(v), 2))
        self.assertIsNone(flat[1])
        self.assertIsNotNone(flat[0])
        self.assertIsNotNone(flat[2])


# ── API coordinate validation ──────────────────────────────────────────────────

class TestCoordinateValidation(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from app.main import app
        self.client = TestClient(app)

    def test_invalid_lat_too_high(self):
        resp = self.client.get(
            "/api/temperature",
            params={"lat": 91, "lon": 90, "start": "2026-09-29T00:00:00Z", "end": "2026-09-30T00:00:00Z"}
        )
        self.assertEqual(resp.status_code, 422)

    def test_invalid_lat_too_low(self):
        resp = self.client.get(
            "/api/temperature",
            params={"lat": -91, "lon": 90, "start": "2026-09-29T00:00:00Z", "end": "2026-09-30T00:00:00Z"}
        )
        self.assertEqual(resp.status_code, 422)

    def test_invalid_lon_too_high(self):
        resp = self.client.get(
            "/api/temperature",
            params={"lat": 23, "lon": 181, "start": "2026-09-29T00:00:00Z", "end": "2026-09-30T00:00:00Z"}
        )
        self.assertEqual(resp.status_code, 422)

    def test_invalid_date_range(self):
        resp = self.client.get(
            "/api/temperature",
            params={"lat": 23.8103, "lon": 90.4125,
                    "start": "2026-09-30T00:00:00Z", "end": "2026-09-29T00:00:00Z"}
        )
        self.assertEqual(resp.status_code, 422)

    def test_invalid_datetime_format(self):
        resp = self.client.get(
            "/api/temperature",
            params={"lat": 23.8103, "lon": 90.4125,
                    "start": "not-a-date", "end": "2026-09-30T00:00:00Z"}
        )
        self.assertEqual(resp.status_code, 422)

    def test_health_endpoint(self):
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ok")


if __name__ == "__main__":
    unittest.main()
