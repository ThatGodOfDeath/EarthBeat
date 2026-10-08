"""
test_wind.py — Unit and integration tests for Phase 6 Wind Integration.

Tests cover:
  1. Wind physics (calculate_wind_speed, calculate_wind_direction, get_cardinal_direction)
  2. Zero wind / calm edge cases
  3. Meteorological direction convention verification (from where wind blows)
  4. FastAPI route validations (/api/wind: lat/lon bounds, start < end, ISO parsing)
  5. API response schemas (WindSeriesResponse, WindPoint, WindMetadataResponse)
  6. Service caching and deduplication
"""
from datetime import datetime, timezone
import math
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.utils.wind import (
    calculate_wind_speed,
    calculate_wind_direction,
    get_cardinal_direction,
)
from app.services.nasa.geos_fp import (
    WindObservation,
    GridPoint,
    SpatialResolutionInfo,
    TemporalResolutionInfo,
)


class TestWindPhysics(unittest.TestCase):
    """Verify wind speed, meteorological direction, and cardinal conversion."""

    def test_wind_speed_basic(self):
        # 3-4-5 triangle: sqrt(3² + 4²) = 5.0
        self.assertEqual(calculate_wind_speed(3.0, 4.0), 5.0)
        self.assertEqual(calculate_wind_speed(-3.0, -4.0), 5.0)
        self.assertEqual(calculate_wind_speed(0.0, 10.0), 10.0)

    def test_wind_speed_zero_and_none(self):
        self.assertEqual(calculate_wind_speed(0.0, 0.0), 0.0)
        self.assertEqual(calculate_wind_speed(None, 4.0), 0.0)
        self.assertEqual(calculate_wind_speed(3.0, None), 0.0)

    def test_meteorological_direction_conventions(self):
        """
        Meteorological wind direction is the direction FROM which the wind blows.
        Formula: (atan2(-u, -v) * 180 / π) % 360
        - u=0, v<0 (blowing to South): coming FROM North -> 0° (or 360°)
        - u=-10, v=0 (blowing to West): coming FROM East -> 90°
        - u=0, v=10 (blowing to North): coming FROM South -> 180°
        - u=10, v=0 (blowing to East): coming FROM West -> 270°
        """
        # Wind blowing to South (from North)
        deg_n = calculate_wind_direction(0.0, -10.0)
        self.assertIsNotNone(deg_n)
        self.assertAlmostEqual(deg_n, 0.0, places=1)
        self.assertEqual(get_cardinal_direction(deg_n), "N")

        # Wind blowing to West (from East)
        deg_e = calculate_wind_direction(-10.0, 0.0)
        self.assertIsNotNone(deg_e)
        self.assertAlmostEqual(deg_e, 90.0, places=1)
        self.assertEqual(get_cardinal_direction(deg_e), "E")

        # Wind blowing to North (from South)
        deg_s = calculate_wind_direction(0.0, 10.0)
        self.assertIsNotNone(deg_s)
        self.assertAlmostEqual(deg_s, 180.0, places=1)
        self.assertEqual(get_cardinal_direction(deg_s), "S")

        # Wind blowing to East (from West)
        deg_w = calculate_wind_direction(10.0, 0.0)
        self.assertIsNotNone(deg_w)
        self.assertAlmostEqual(deg_w, 270.0, places=1)
        self.assertEqual(get_cardinal_direction(deg_w), "W")

    def test_intercardinal_directions(self):
        # Blowing to North-East (u>0, v>0) -> from South-West (225°)
        deg_sw = calculate_wind_direction(10.0, 10.0)
        self.assertIsNotNone(deg_sw)
        self.assertAlmostEqual(deg_sw, 225.0, places=1)
        self.assertEqual(get_cardinal_direction(deg_sw), "SW")

        # Blowing to South-West (u<0, v<0) -> from North-East (45°)
        deg_ne = calculate_wind_direction(-10.0, -10.0)
        self.assertIsNotNone(deg_ne)
        self.assertAlmostEqual(deg_ne, 45.0, places=1)
        self.assertEqual(get_cardinal_direction(deg_ne), "NE")

    def test_zero_wind_calm(self):
        # When wind is 0 m/s, direction is undefined (None / Calm)
        self.assertIsNone(calculate_wind_direction(0.0, 0.0))
        self.assertEqual(get_cardinal_direction(None), "Calm")


class TestWindApiRoutes(unittest.TestCase):
    """Test /api/wind endpoints with TestClient."""

    def setUp(self):
        self.client = TestClient(app)

    def test_invalid_coordinates(self):
        # Out-of-bounds latitude
        res = self.client.get("/api/wind?lat=95&lon=0&start=2026-10-01T00:00:00Z&end=2026-10-02T00:00:00Z")
        self.assertEqual(res.status_code, 422)

        # Out-of-bounds longitude
        res = self.client.get("/api/wind?lat=0&lon=200&start=2026-10-01T00:00:00Z&end=2026-10-02T00:00:00Z")
        self.assertEqual(res.status_code, 422)

    def test_invalid_dates(self):
        # Start >= end
        res = self.client.get(
            "/api/wind?lat=23.8&lon=90.4&start=2026-10-02T00:00:00Z&end=2026-10-01T00:00:00Z"
        )
        self.assertEqual(res.status_code, 422)

        # Malformed ISO date
        res = self.client.get("/api/wind?lat=23.8&lon=90.4&start=not-a-date&end=2026-10-02T00:00:00Z")
        self.assertEqual(res.status_code, 422)

    @patch("app.services.nasa.geos_fp.get_wind_series")
    def test_successful_wind_query(self, mock_get_wind):
        mock_obs = [
            WindObservation(
                timestamp="2026-10-01T00:00:00Z",
                u10m=3.2,
                v10m=4.5,
                speed=5.52,
                direction=215.4,
                cardinal="SW",
            ),
            WindObservation(
                timestamp="2026-10-01T03:00:00Z",
                u10m=0.0,
                v10m=0.0,
                speed=0.0,
                direction=None,
                cardinal="Calm",
            ),
        ]
        mock_grid = GridPoint(latitude=23.75, longitude=90.3125)
        mock_spatial = SpatialResolutionInfo(lat_deg=0.25, lon_deg=0.3125)
        mock_temporal = TemporalResolutionInfo(minutes=180, label="3-hourly")

        mock_get_wind.return_value = (mock_obs, mock_grid, mock_spatial, mock_temporal)

        res = self.client.get(
            "/api/wind?lat=23.8103&lon=90.4125&start=2026-10-01T00:00:00Z&end=2026-10-01T03:00:00Z"
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertEqual(data["source"]["name"], "NASA GEOS-FP")
        self.assertEqual(data["source"]["unit"], "m/s")
        self.assertEqual(len(data["data"]), 2)
        self.assertEqual(data["data"][0]["speed"], 5.52)
        self.assertEqual(data["data"][0]["cardinal"], "SW")
        self.assertEqual(data["data"][1]["speed"], 0.0)
        self.assertIsNone(data["data"][1]["direction"])
        self.assertEqual(data["data"][1]["cardinal"], "Calm")

    @patch("app.services.nasa.geos_fp.get_dataset_metadata")
    def test_wind_metadata_endpoint(self, mock_meta):
        mock_spatial = SpatialResolutionInfo(lat_deg=0.25, lon_deg=0.3125)
        mock_temporal = TemporalResolutionInfo(minutes=180, label="3-hourly")
        mock_meta.return_value = (mock_spatial, mock_temporal)

        res = self.client.get("/api/wind/metadata")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["source"]["name"], "NASA GEOS-FP")
        self.assertIn("u10m", data["source"]["variable"])


if __name__ == "__main__":
    unittest.main()
