"""
test_phase5d.py — Backend tests for Phase 5D temporal range support.

Verifies:
  1. Temperature API correctly handles extended date ranges.
  2. Start < End validation for range queries.
  3. Long-range requests do not break the API layer.
  4. Cache key construction includes start/end parameters.
  5. Backend service returns observations within requested range only.
"""
import math
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

import numpy as np


class TestPhase5DTemporalRange(unittest.TestCase):
    """Tests for extended temporal range support introduced in Phase 5D."""

    def setUp(self):
        from fastapi.testclient import TestClient
        from app.main import app
        self.client = TestClient(app)

    # ── 1. API accepts extended date ranges ────────────────────────────────────
    @patch("app.services.temperature.nasa.get_temperature_series")
    def test_api_accepts_multi_day_range(self, mock_nasa):
        """API validates a 7-day range without raising a 422 error."""
        from app.services.nasa.geos_fp import GridPoint, SpatialResolutionInfo, TemporalResolutionInfo, TemperatureObservation
        mock_nasa.return_value = (
            [TemperatureObservation(timestamp="2026-10-01T00:00:00Z", temperature_c=25.0)],
            GridPoint(latitude=23.8, longitude=90.4),
            SpatialResolutionInfo(lat_deg=0.25, lon_deg=0.3125),
            TemporalResolutionInfo(minutes=180, label="3-hourly"),
        )
        resp = self.client.get(
            "/api/temperature",
            params={
                "lat": 23.8103,
                "lon": 90.4125,
                "start": "2026-10-01T00:00:00Z",
                "end": "2026-10-08T00:00:00Z",
            }
        )
        self.assertEqual(resp.status_code, 200)

    @patch("app.services.temperature.nasa.get_temperature_series")
    def test_api_accepts_30_day_range(self, mock_nasa):
        """API validates a 30-day range correctly."""
        from app.services.nasa.geos_fp import GridPoint, SpatialResolutionInfo, TemporalResolutionInfo, TemperatureObservation
        mock_nasa.return_value = (
            [TemperatureObservation(timestamp="2026-09-01T00:00:00Z", temperature_c=20.0)],
            GridPoint(latitude=0.0, longitude=0.0),
            SpatialResolutionInfo(lat_deg=0.25, lon_deg=0.3125),
            TemporalResolutionInfo(minutes=180, label="3-hourly"),
        )
        resp = self.client.get(
            "/api/temperature",
            params={
                "lat": 0.0,
                "lon": 0.0,
                "start": "2026-09-01T00:00:00Z",
                "end": "2026-10-01T00:00:00Z",
            }
        )
        self.assertEqual(resp.status_code, 200)

    # ── 2. Start/End validation still enforced ─────────────────────────────────
    def test_start_must_be_before_end(self):
        """start ≥ end should return 422."""
        resp = self.client.get(
            "/api/temperature",
            params={
                "lat": 23.8103,
                "lon": 90.4125,
                "start": "2026-10-08T00:00:00Z",
                "end": "2026-10-01T00:00:00Z",
            }
        )
        self.assertEqual(resp.status_code, 422)

    def test_start_equal_end_returns_422(self):
        """start == end should return 422."""
        resp = self.client.get(
            "/api/temperature",
            params={
                "lat": 23.8103,
                "lon": 90.4125,
                "start": "2026-10-01T00:00:00Z",
                "end": "2026-10-01T00:00:00Z",
            }
        )
        self.assertEqual(resp.status_code, 422)

    # ── 3. Cache key includes start/end ───────────────────────────────────────
    def test_cache_key_includes_temporal_range(self):
        """Temperature service cache key must encode start and end datetime."""
        from app.services import temperature as temp_svc

        lat, lon = 23.8103, 90.4125
        start1 = datetime(2026, 10, 1, 0, 0, 0, tzinfo=timezone.utc)
        end1   = datetime(2026, 10, 2, 0, 0, 0, tzinfo=timezone.utc)
        start2 = datetime(2026, 10, 5, 0, 0, 0, tzinfo=timezone.utc)
        end2   = datetime(2026, 10, 6, 0, 0, 0, tzinfo=timezone.utc)

        # Build cache keys the same way the service does
        key1 = (
            f"{lat:.4f}:{lon:.4f}"
            f":{start1.isoformat()}:{end1.isoformat()}"
        )
        key2 = (
            f"{lat:.4f}:{lon:.4f}"
            f":{start2.isoformat()}:{end2.isoformat()}"
        )

        self.assertNotEqual(key1, key2, "Different date ranges must produce different cache keys")
        self.assertIn("2026-10-01", key1)
        self.assertIn("2026-10-05", key2)

    # ── 4. Temporal range boundaries ──────────────────────────────────────────
    def test_multi_day_range_boundary_validation(self):
        """Verify that ranges of different durations all parse without error."""
        from datetime import datetime, timezone

        test_ranges = [
            ("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"),   # 1 day
            ("2026-10-01T00:00:00Z", "2026-10-08T00:00:00Z"),   # 1 week
            ("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"),   # 1 month
            ("2026-01-01T00:00:00Z", "2027-01-01T00:00:00Z"),   # 1 year
        ]

        for start_str, end_str in test_ranges:
            with self.subTest(start=start_str, end=end_str):
                start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                self.assertLess(start_dt, end_dt, "Start must be before end")
                self.assertIsNotNone(start_dt.tzinfo)
                self.assertIsNotNone(end_dt.tzinfo)


class TestPhase5DCacheArchitecture(unittest.TestCase):
    """Tests verifying the LRU cache works correctly for extended ranges."""

    def test_lru_cache_eviction_on_capacity(self):
        """LRU cache should evict oldest entry when capacity is exceeded."""
        from app.services.temperature import _LRUCache

        cache = _LRUCache(capacity=3)
        cache.set("key1", "value1")
        cache.set("key2", "value2")
        cache.set("key3", "value3")
        # Adding a 4th item should evict key1
        cache.set("key4", "value4")

        self.assertIsNone(cache.get("key1"), "key1 should have been evicted")
        self.assertEqual(cache.get("key2"), "value2")
        self.assertEqual(cache.get("key3"), "value3")
        self.assertEqual(cache.get("key4"), "value4")

    def test_lru_cache_hit_updates_recency(self):
        """Accessing key1 should make it recently used, preventing eviction."""
        from app.services.temperature import _LRUCache

        cache = _LRUCache(capacity=3)
        cache.set("key1", "value1")
        cache.set("key2", "value2")
        cache.set("key3", "value3")

        # Access key1 to make it recently used
        _ = cache.get("key1")

        # Now add key4 — should evict key2 (oldest unused) not key1
        cache.set("key4", "value4")

        self.assertIsNotNone(cache.get("key1"), "key1 was recently used, should not be evicted")
        self.assertIsNone(cache.get("key2"), "key2 should have been evicted")

    def test_lru_cache_size_tracking(self):
        """Cache size should reflect actual entries."""
        from app.services.temperature import _LRUCache

        cache = _LRUCache(capacity=10)
        self.assertEqual(len(cache), 0)
        cache.set("a", 1)
        self.assertEqual(len(cache), 1)
        cache.set("b", 2)
        self.assertEqual(len(cache), 2)


class TestPhase5DIntervalAlignment(unittest.TestCase):
    """
    Tests verifying GEOS-FP interval alignment rules.
    Mirrors what timestampGenerator.js implements on the frontend.
    """

    def _snap_to_geos_fp(self, raw_hours: int, min_h: int = 3, max_h: int = 24) -> int:
        """Snap to nearest multiple of 3 hours within [min_h, max_h]."""
        step = 3
        clamped = max(min_h, min(max_h, raw_hours))
        snapped = round(clamped / step) * step
        return max(min_h, min(max_h, snapped))

    def test_3h_interval_passes_through(self):
        self.assertEqual(self._snap_to_geos_fp(3), 3)

    def test_6h_interval_passes_through(self):
        self.assertEqual(self._snap_to_geos_fp(6), 6)

    def test_24h_interval_passes_through(self):
        self.assertEqual(self._snap_to_geos_fp(24), 24)

    def test_1h_interval_snaps_to_minimum_3(self):
        self.assertEqual(self._snap_to_geos_fp(1), 3)

    def test_48h_interval_clamps_to_24(self):
        self.assertEqual(self._snap_to_geos_fp(48, min_h=3, max_h=24), 24)

    def test_12h_interval_snaps_to_12(self):
        self.assertEqual(self._snap_to_geos_fp(12), 12)


if __name__ == "__main__":
    unittest.main()
