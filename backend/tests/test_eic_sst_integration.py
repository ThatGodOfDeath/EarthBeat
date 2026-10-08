"""
test_eic_sst_integration.py — Integration and regression tests for Phase 5B.

Tests cover:
  1. SST metadata and preview loading
  2. Frame resolution for changing calendar days vs same calendar day
  3. Playback crossing midnight (frame update trigger)
  4. Non-regression of existing GEOS-FP endpoints
  5. Scientific distinction between MUR SST and GEOS-FP T2M
"""
from datetime import date
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.nasa import eic_sst as sst_svc

client = TestClient(app)


def test_sst_metadata_loads():
    """Verify SST metadata loads correctly from the API."""
    res = client.get("/api/eic/sst/metadata")
    assert res.status_code == 200
    data = res.json()
    assert data["visualizationId"] == 5101
    assert data["dataset"] == "MUR SST"
    assert data["temporalResolution"] == "daily"
    assert data["width"] == 4096
    assert data["height"] == 2048


def test_sst_same_calendar_day_mapping():
    """
    Verify that multiple GEOS-FP 3-hourly observation timestamps belonging to the
    SAME calendar day all map to the exact same SST frame.
    Moving within the same day must NOT request or resolve different frames.
    """
    day = "2026-10-01"
    # Observations across the day
    timestamps = [
        f"{day}T00:00:00Z",
        f"{day}T03:00:00Z",
        f"{day}T06:00:00Z",
        f"{day}T09:00:00Z",
        f"{day}T12:00:00Z",
        f"{day}T15:00:00Z",
        f"{day}T18:00:00Z",
        f"{day}T21:00:00Z",
    ]

    calendar_days = [ts[:10] for ts in timestamps]
    # All calendar days must be identical
    assert len(set(calendar_days)) == 1
    assert calendar_days[0] == day

    # Frame resolved for this date
    res = client.get(f"/api/eic/sst/frame?date={day}")
    assert res.status_code == 200
    frame_info = res.json()
    assert frame_info["actualDate"] == day
    assert frame_info["frameNumber"] == 897  # (date(2026,10,1) - date(2024,4,18)).days + 1
    assert frame_info["frame"]["filename"] == "sst_mur_20261001.exr"


def test_playback_crossing_midnight_updates_frame():
    """
    Verify that when playback advances from 23:00 / 21:00 on Day 1 to 00:00 on Day 2,
    the calendar day changes and the SST frame correctly increments.
    """
    day1_ts = "2026-10-01T21:00:00Z"
    day2_ts = "2026-10-02T00:00:00Z"

    calendar_day1 = day1_ts[:10]
    calendar_day2 = day2_ts[:10]

    assert calendar_day1 != calendar_day2

    res1 = client.get(f"/api/eic/sst/frame?date={calendar_day1}")
    res2 = client.get(f"/api/eic/sst/frame?date={calendar_day2}")

    assert res1.status_code == 200
    assert res2.status_code == 200

    frame1 = res1.json()
    frame2 = res2.json()

    assert frame1["actualDate"] == "2026-10-01"
    assert frame2["actualDate"] == "2026-10-02"
    assert frame2["frameNumber"] == frame1["frameNumber"] + 1
    assert frame1["frame"]["filename"] == "sst_mur_20261001.exr"
    assert frame2["frame"]["filename"] == "sst_mur_20261002.exr"


def test_sst_preview_endpoint_cached_or_generated():
    """Verify GET /api/eic/sst/preview returns JPEG preview image."""
    # Pre-populate preview cache for test date with valid JPEG
    from app.services.nasa import eic_sst as sst_svc
    dummy_jpeg = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xdb\x00C\x00\xff\xd9"
    sst_svc._preview_cache.set("2024-04-18", dummy_jpeg)

    res = client.get("/api/eic/sst/preview?date=2024-04-18")
    assert res.status_code == 200
    assert "image/jpeg" in res.headers["content-type"]
    assert len(res.content) > 0


def test_sst_sync_endpoint_contract():
    """Verify GET /api/eic/sst/sync returns synchronization contract and distinction."""
    res = client.get("/api/eic/sst/sync?date=2026-10-01")
    assert res.status_code == 200
    data = res.json()
    assert data["visualDate"] == "2026-10-01"
    assert data["visualization"]["dataset"] == "MUR SST"
    assert data["temperature"]["dataset"] == "NASA GEOS-FP"
    assert "scientificDistinction" in data
    assert "atmospheric" in data["scientificDistinction"].lower()
    assert "ocean" in data["scientificDistinction"].lower()


def test_existing_geos_fp_endpoints_unchanged():
    """Regression test: verify GEOS-FP endpoints remain fully intact."""
    # Health
    res_health = client.get("/health")
    assert res_health.status_code == 200
    assert res_health.json()["status"] == "ok"

    # Temperature metadata
    res_meta = client.get("/api/temperature/metadata")
    assert res_meta.status_code == 200
    data = res_meta.json()
    assert "source" in data
    assert "NASA GEOS-FP" in data["source"]["name"]


def test_playback_backward_crossing_midnight():
    """Verify reverse playback crossing midnight (00:00 -> 21:00 previous day) decrements frame."""
    day2_ts = "2026-10-02T00:00:00Z"
    day1_ts = "2026-10-01T21:00:00Z"

    calendar_day2 = day2_ts[:10]
    calendar_day1 = day1_ts[:10]

    res2 = client.get(f"/api/eic/sst/frame?date={calendar_day2}")
    res1 = client.get(f"/api/eic/sst/frame?date={calendar_day1}")

    assert res2.status_code == 200
    assert res1.status_code == 200

    frame2 = res2.json()
    frame1 = res1.json()

    assert frame2["actualDate"] == "2026-10-02"
    assert frame1["actualDate"] == "2026-10-01"
    assert frame1["frameNumber"] == frame2["frameNumber"] - 1


def test_out_of_bounds_date_handling():
    """Verify that requests outside SST range (2024-04-18 to 2026-10-05) return clamped frame with note without failing."""
    # Pre-dataset date
    res_early = client.get("/api/eic/sst/frame?date=2023-01-01")
    assert res_early.status_code == 200
    early_data = res_early.json()
    assert early_data["isAvailable"] is False
    assert early_data["actualDate"] == "2024-04-18"
    assert "note" in early_data
    assert early_data["note"] is not None

    # Post-dataset date
    res_future = client.get("/api/eic/sst/frame?date=2027-01-01")
    assert res_future.status_code == 200
    future_data = res_future.json()
    assert future_data["isAvailable"] is False
    assert future_data["actualDate"] == "2026-10-05"
    assert "note" in future_data
    assert future_data["note"] is not None
