"""
wind.py — Wind API routes

All wind endpoints live under /api/wind.

Route                | Purpose
---------------------|---------------------------------------------------
GET /api/wind        | Local 10 m wind time series (u10m, v10m, speed, direction)
GET /api/wind/metadata | Dataset metadata for wind variables
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import Settings, get_settings
from app.schemas.wind import (
    WindMetadataResponse,
    WindSeriesResponse,
)
from app.services import temperature as temp_svc
from app.services import wind as wind_svc

router = APIRouter(prefix="/wind", tags=["wind"])


def _parse_dt(value: str, param_name: str) -> datetime:
    """Parse an ISO 8601 datetime string and ensure it is UTC-aware."""
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid datetime format for '{param_name}'. Use ISO 8601, e.g. 2026-09-29T00:00:00Z",
        )


@router.get("", response_model=WindSeriesResponse)
async def get_wind_series(
    lat: Annotated[float, Query(description="Latitude (-90 to 90)")],
    lon: Annotated[float, Query(description="Longitude (-180 to 180)")],
    start: Annotated[str, Query(description="Start datetime (ISO 8601 UTC)")],
    end: Annotated[str, Query(description="End datetime (ISO 8601 UTC)")],
    settings: Annotated[Settings, Depends(get_settings)],
    timestamps: Annotated[str | None, Query(description="Optional comma-separated timestamps (ISO 8601 UTC) to sample")] = None,
):
    """
    Retrieve a 10-meter wind time series (u10m, v10m, speed, meteorological direction)
    for the nearest NASA GEOS-FP grid point to requested lat/lon over the date range.

    Example:
        GET /api/wind?lat=23.8103&lon=90.4125
            &start=2026-09-29T00:00:00Z&end=2026-09-30T21:00:00Z
    """
    if not (-90 <= lat <= 90):
        raise HTTPException(status_code=422, detail="'lat' must be between -90 and 90")
    if not (-180 <= lon <= 180):
        raise HTTPException(status_code=422, detail="'lon' must be between -180 and 180")

    start_dt = _parse_dt(start, "start")
    end_dt = _parse_dt(end, "end")

    if start_dt >= end_dt:
        raise HTTPException(status_code=422, detail="'start' must be before 'end'")

    target_dts: list[datetime] | None = None
    if timestamps:
        target_dts = []
        for raw in timestamps.split(","):
            raw_clean = raw.strip()
            if raw_clean:
                target_dts.append(_parse_dt(raw_clean, "timestamps"))

    try:
        return await wind_svc.get_wind_series(
            lat, lon, start_dt, end_dt, settings, target_timestamps=target_dts
        )
    except temp_svc.NasaDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except temp_svc.NoDataInRangeError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while retrieving wind data.",
        ) from exc


@router.get("/metadata", response_model=WindMetadataResponse)
async def get_wind_metadata(
    settings: Annotated[Settings, Depends(get_settings)],
):
    """Return dataset metadata for wind endpoints."""
    try:
        return await wind_svc.get_wind_metadata(settings)
    except temp_svc.NasaDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while retrieving wind metadata.",
        ) from exc
