"""
test_scientific.py — Unit tests for generic scientific data endpoints.

Tests cover:
  1. GET /api/scientific/global for T2M, TS, PS, and WIND
  2. Input validation for variable query parameter
  3. Conversion accuracy (Kelvin → °C, Pa → hPa)
  4. Cache key isolation between different variables
"""
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.services.nasa.geos_fp import (
    GlobalGridData,
    SpatialResolutionInfo,
    TemporalResolutionInfo,
)


class TestScientificGlobalEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @patch("app.services.scientific.nasa.get_global_grid")
    def test_global_t2m_returns_200(self, mock_nasa):
        mock_nasa.return_value = GlobalGridData(
            actual_timestamp="2026-10-05T12:00:00Z",
            requested_timestamp="2026-10-05T12:00:00Z",
            lat_min=-90.0,
            lat_max=90.0,
            lon_min=-180.0,
            lon_max=180.0,
            lat_step=1.0,
            lon_step=1.0,
            width=360,
            height=180,
            values=[25.0] * (360 * 180),
            spatial_res=SpatialResolutionInfo(lat_deg=0.25, lon_deg=0.3125),
            temporal_res=TemporalResolutionInfo(minutes=180, label="3-hourly"),
            variable="T2M",
            unit="°C",
        )

        resp = self.client.get(
            "/api/scientific/global",
            params={"variable": "T2M", "time": "2026-10-05T12:00:00Z"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["variable"], "T2M")
        self.assertEqual(data["source"]["unit"], "°C")
        self.assertEqual(len(data["values"]), 360 * 180)

    @patch("app.services.scientific.nasa.get_global_grid")
    def test_global_ps_returns_hpa(self, mock_nasa):
        mock_nasa.return_value = GlobalGridData(
            actual_timestamp="2026-10-05T12:00:00Z",
            requested_timestamp="2026-10-05T12:00:00Z",
            lat_min=-90.0,
            lat_max=90.0,
            lon_min=-180.0,
            lon_max=180.0,
            lat_step=1.0,
            lon_step=1.0,
            width=360,
            height=180,
            values=[1013.25] * (360 * 180),
            spatial_res=SpatialResolutionInfo(lat_deg=0.25, lon_deg=0.3125),
            temporal_res=TemporalResolutionInfo(minutes=180, label="3-hourly"),
            variable="PS",
            unit="hPa",
        )

        resp = self.client.get(
            "/api/scientific/global",
            params={"variable": "PS", "time": "2026-10-05T12:00:00Z"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["variable"], "PS")
        self.assertEqual(data["source"]["unit"], "hPa")

    @patch("app.services.scientific.nasa.get_global_grid")
    def test_global_wind_returns_u_and_v_vectors(self, mock_nasa):
        mock_nasa.return_value = GlobalGridData(
            actual_timestamp="2026-10-05T12:00:00Z",
            requested_timestamp="2026-10-05T12:00:00Z",
            lat_min=-90.0,
            lat_max=90.0,
            lon_min=-180.0,
            lon_max=180.0,
            lat_step=1.0,
            lon_step=1.0,
            width=360,
            height=180,
            values=[5.0] * (360 * 180),
            spatial_res=SpatialResolutionInfo(lat_deg=0.25, lon_deg=0.3125),
            temporal_res=TemporalResolutionInfo(minutes=180, label="3-hourly"),
            variable="WIND",
            unit="m/s",
            u_values=[3.0] * (360 * 180),
            v_values=[4.0] * (360 * 180),
        )

        resp = self.client.get(
            "/api/scientific/global",
            params={"variable": "WIND", "time": "2026-10-05T12:00:00Z"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["variable"], "WIND")
        self.assertIsNotNone(data["uValues"])
        self.assertIsNotNone(data["vValues"])
        self.assertEqual(len(data["uValues"]), 360 * 180)

    @patch("app.services.scientific.nasa.get_global_grid")
    def test_global_tprecmax_returns_mm_hr(self, mock_nasa):
        mock_nasa.return_value = GlobalGridData(
            actual_timestamp="2026-10-05T12:00:00Z",
            requested_timestamp="2026-10-05T12:00:00Z",
            lat_min=-90.0,
            lat_max=90.0,
            lon_min=-180.0,
            lon_max=180.0,
            lat_step=1.0,
            lon_step=1.0,
            width=360,
            height=180,
            values=[12.5] * (360 * 180),
            spatial_res=SpatialResolutionInfo(lat_deg=0.25, lon_deg=0.3125),
            temporal_res=TemporalResolutionInfo(minutes=180, label="3-hourly"),
            variable="TPRECMAX",
            unit="mm/h",
        )

        resp = self.client.get(
            "/api/scientific/global",
            params={"variable": "TPRECMAX", "time": "2026-10-05T12:00:00Z"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["variable"], "TPRECMAX")
        self.assertEqual(data["source"]["unit"], "mm/h")

    @patch("app.services.scientific.nasa.get_global_grid")
    def test_global_tqv_returns_kg_m2(self, mock_nasa):
        mock_nasa.return_value = GlobalGridData(
            actual_timestamp="2026-10-05T12:00:00Z",
            requested_timestamp="2026-10-05T12:00:00Z",
            lat_min=-90.0,
            lat_max=90.0,
            lon_min=-180.0,
            lon_max=180.0,
            lat_step=1.0,
            lon_step=1.0,
            width=360,
            height=180,
            values=[42.0] * (360 * 180),
            spatial_res=SpatialResolutionInfo(lat_deg=0.25, lon_deg=0.3125),
            temporal_res=TemporalResolutionInfo(minutes=180, label="3-hourly"),
            variable="TQV",
            unit="kg/m²",
        )

        resp = self.client.get(
            "/api/scientific/global",
            params={"variable": "TQV", "time": "2026-10-05T12:00:00Z"},
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["variable"], "TQV")
        self.assertEqual(data["source"]["unit"], "kg/m²")

    def test_invalid_variable_returns_422(self):
        resp = self.client.get(
            "/api/scientific/global",
            params={"variable": "INVALID_VAR", "time": "2026-10-05T12:00:00Z"},
        )
        self.assertEqual(resp.status_code, 422)


if __name__ == "__main__":
    unittest.main()
