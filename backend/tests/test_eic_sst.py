"""
test_eic_sst.py — Unit and integration tests for NASA EIC/SVS SST #5101 service and API.
"""
from datetime import date
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.nasa import eic_sst as sst_svc

client = TestClient(app)


def test_sst_metadata_service():
    """Verify service metadata matches authoritative NASA SVS #5101 specifications."""
    meta = sst_svc.get_sst_metadata()
    assert meta.visualizationId == 5101
    assert meta.name == "Sea Surface Temperature (SST) - Near Real Time"
    assert meta.dataset == "MUR SST"
    assert meta.projection == "equirectangular"
    assert meta.temporalResolution == "daily"
    assert meta.width == 4096
    assert meta.height == 2048
    assert meta.availableFrom == "2024-04-18"
    assert meta.availableTo == "2026-10-05"
    assert meta.frameCount == 901


def test_sst_metadata_api():
    """Verify GET /api/eic/sst/metadata endpoint."""
    response = client.get("/api/eic/sst/metadata")
    assert response.status_code == 200
    data = response.json()
    assert data["visualizationId"] == 5101
    assert data["dataset"] == "MUR SST"
    assert data["frameCount"] == 901
    assert data["availableFrom"] == "2024-04-18"
    assert data["availableTo"] == "2026-10-05"


def test_sst_frame_earliest_date():
    """Test retrieval for earliest available date (2024-04-18)."""
    response = client.get("/api/eic/sst/frame?date=2024-04-18")
    assert response.status_code == 200
    data = response.json()
    assert data["requestedDate"] == "2024-04-18"
    assert data["actualDate"] == "2024-04-18"
    assert data["frameNumber"] == 1
    assert data["isAvailable"] is True
    assert data["frame"]["filename"] == "sst_mur_20240418.exr"
    assert data["frame"]["width"] == 4096
    assert data["frame"]["height"] == 2048
    assert data["frame"]["format"] == "OpenEXR"
    assert "https://svs.gsfc.nasa.gov" in data["frame"]["url"]
    assert data["note"] is None


def test_sst_frame_latest_date():
    """Test retrieval for latest available date (2026-10-05)."""
    response = client.get("/api/eic/sst/frame?date=2026-10-05")
    assert response.status_code == 200
    data = response.json()
    assert data["requestedDate"] == "2026-10-05"
    assert data["actualDate"] == "2026-10-05"
    assert data["frameNumber"] == 901
    assert data["isAvailable"] is True
    assert data["frame"]["filename"] == "sst_mur_20261005.exr"


def test_sst_frame_middle_date():
    """Test retrieval for a middle date (2025-06-15)."""
    response = client.get("/api/eic/sst/frame?date=2025-06-15")
    assert response.status_code == 200
    data = response.json()
    assert data["requestedDate"] == "2025-06-15"
    assert data["actualDate"] == "2025-06-15"
    assert data["isAvailable"] is True
    # (date(2025, 6, 15) - date(2024, 4, 18)).days + 1 = 424
    assert data["frameNumber"] == 424
    assert data["frame"]["filename"] == "sst_mur_20250615.exr"


def test_sst_frame_unavailable_past_date():
    """Test out-of-range past date: should clamp to earliest frame with clear note."""
    response = client.get("/api/eic/sst/frame?date=2023-12-31")
    assert response.status_code == 200
    data = response.json()
    assert data["requestedDate"] == "2023-12-31"
    assert data["actualDate"] == "2024-04-18"
    assert data["frameNumber"] == 1
    assert data["isAvailable"] is False
    assert data["note"] is not None
    assert "precedes the earliest available frame" in data["note"]


def test_sst_frame_unavailable_future_date():
    """Test out-of-range future date: should clamp to latest frame with clear note."""
    response = client.get("/api/eic/sst/frame?date=2027-01-01")
    assert response.status_code == 200
    data = response.json()
    assert data["requestedDate"] == "2027-01-01"
    assert data["actualDate"] == "2026-10-05"
    assert data["frameNumber"] == 901
    assert data["isAvailable"] is False
    assert data["note"] is not None
    assert "exceeds the latest available frame" in data["note"]


def test_sst_frame_invalid_date_format():
    """Test validation of malformed date string."""
    response = client.get("/api/eic/sst/frame?date=not-a-date")
    assert response.status_code == 422


def test_sst_geos_fp_synchronization():
    """Test GEOS-FP synchronization endpoint for a calendar day."""
    response = client.get("/api/eic/sst/sync?date=2026-10-01")
    assert response.status_code == 200
    data = response.json()
    assert data["visualDate"] == "2026-10-01"
    
    # GEOS-FP atmospheric temperature side
    temp = data["temperature"]
    assert temp["dataset"] == "NASA GEOS-FP"
    assert temp["temporalResolution"] == "3-hourly"
    assert len(temp["timestamps"]) == 8
    assert temp["availableStart"] == "2026-10-01T00:00:00Z"
    assert temp["availableEnd"] == "2026-10-01T21:00:00Z"
    
    # Visual storytelling SST side
    vis = data["visualization"]
    assert vis["dataset"] == "MUR SST"
    assert vis["temporalResolution"] == "daily"
    assert vis["date"] == "2026-10-01"
    
    # Scientific distinction
    assert "MUR SST" in data["scientificDistinction"]
    assert "GEOS-FP T2M" in data["scientificDistinction"]
