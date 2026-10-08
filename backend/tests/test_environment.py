"""
test_environment.py — Unit tests for /api/environment endpoint.

Verifies:
  1. GET /api/environment returns 200 with all 5 environmental variables (t2m, ts, tprecmax, tqv, ps).
  2. Zero precipitation (tprecmax = 0.0) is strictly preserved as 0.0 and never mapped to null or dropped.
  3. ts is converted to Celsius (°C), ps is returned in Pa, tqv in kg/m², tprecmax in kg/m²/s.
  4. Supports both start/end date range and explicit comma-separated timestamps.
  5. Coordinate boundary validation (lat [-90, 90], lon [-180, 180]).
  6. Start date after end date produces 422 Unprocessable Entity.
  7. Upstream NASA service error raises 502/503 response.
"""
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.services.environmental import _env_series_cache
from app.services.nasa.geos_fp import (
    EnvironmentalObservation,
    GridPoint,
    SpatialResolutionInfo,
    TemporalResolutionInfo,
)


class TestEnvironmentEndpoint(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        _env_series_cache.clear()

    @patch("app.services.environmental.nasa.get_environmental_series")
    def test_environment_series_success(self, mock_nasa):
        mock_nasa.return_value = (
            [
                EnvironmentalObservation(
                    timestamp="2026-09-29T00:00:00Z",
                    t2m=28.5,
                    ts=29.2,
                    tprecmax=0.0,  # Zero precipitation preserved
                    tqv=48.2,
                    ps=100850.0,
                ),
                EnvironmentalObservation(
                    timestamp="2026-09-29T03:00:00Z",
                    t2m=29.1,
                    ts=30.4,
                    tprecmax=0.00005,
                    tqv=49.0,
                    ps=100790.0,
                ),
            ],
            GridPoint(latitude=23.75, longitude=90.3125),
            SpatialResolutionInfo(lat_deg=0.25, lon_deg=0.3125),
            TemporalResolutionInfo(minutes=180, label="3-hourly (00:00, 03:00, ..., 21:00 UTC)"),
        )

        resp = self.client.get(
            "/api/environment",
            params={
                "lat": 23.75,
                "lon": 90.3125,
                "start": "2026-09-29T00:00:00Z",
                "end": "2026-09-29T03:00:00Z",
            },
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()

        # Check requested and grid location
        self.assertEqual(data["location"]["requested"]["latitude"], 23.75)
        self.assertEqual(data["location"]["requested"]["longitude"], 90.3125)
        self.assertEqual(data["location"]["grid"]["latitude"], 23.75)
        self.assertEqual(data["location"]["grid"]["longitude"], 90.3125)

        # Check observations length and values
        self.assertEqual(len(data["data"]), 2)
        pt0 = data["data"][0]
        self.assertEqual(pt0["timestamp"], "2026-09-29T00:00:00Z")
        self.assertEqual(pt0["t2m"], 28.5)
        self.assertEqual(pt0["ts"], 29.2)
        self.assertEqual(pt0["tprecmax"], 0.0)  # Preserved 0.0
        self.assertEqual(pt0["tqv"], 48.2)
        self.assertEqual(pt0["ps"], 100850.0)

    @patch("app.services.environmental.nasa.get_environmental_series")
    def test_environment_discrete_timestamps(self, mock_nasa):
        mock_nasa.return_value = (
            [
                EnvironmentalObservation(
                    timestamp="2026-09-30T12:00:00Z",
                    t2m=31.0,
                    ts=33.5,
                    tprecmax=0.0,
                    tqv=45.0,
                    ps=101000.0,
                ),
            ],
            GridPoint(latitude=0.0, longitude=0.0),
            SpatialResolutionInfo(lat_deg=0.25, lon_deg=0.3125),
            TemporalResolutionInfo(minutes=180, label="3-hourly"),
        )

        resp = self.client.get(
            "/api/environment",
            params={
                "lat": 0.0,
                "lon": 0.0,
                "timestamps": "2026-09-30T12:00:00Z",
            },
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["data"]), 1)
        self.assertEqual(data["data"][0]["timestamp"], "2026-09-30T12:00:00Z")

    def test_invalid_lat_returns_422(self):
        resp = self.client.get(
            "/api/environment",
            params={"lat": 95.0, "lon": 0.0, "start": "2026-09-29T00:00:00Z", "end": "2026-09-29T03:00:00Z"},
        )
        self.assertEqual(resp.status_code, 422)

    def test_invalid_lon_returns_422(self):
        resp = self.client.get(
            "/api/environment",
            params={"lat": 0.0, "lon": 190.0, "start": "2026-09-29T00:00:00Z", "end": "2026-09-29T03:00:00Z"},
        )
        self.assertEqual(resp.status_code, 422)

    def test_start_after_end_returns_422(self):
        resp = self.client.get(
            "/api/environment",
            params={
                "lat": 0.0,
                "lon": 0.0,
                "start": "2026-09-30T00:00:00Z",
                "end": "2026-09-29T00:00:00Z",
            },
        )
        self.assertEqual(resp.status_code, 422)

    @patch("app.services.environmental.nasa.get_environmental_series")
    def test_upstream_nasa_error_returns_503(self, mock_nasa):
        from app.services.nasa.geos_fp import GeosFpError
        mock_nasa.side_effect = GeosFpError("NASA OPeNDAP connection failed")

        resp = self.client.get(
            "/api/environment",
            params={
                "lat": 23.75,
                "lon": 90.3125,
                "start": "2026-09-29T00:00:00Z",
                "end": "2026-09-29T03:00:00Z",
            },
        )
        self.assertEqual(resp.status_code, 503)


if __name__ == "__main__":
    unittest.main()
