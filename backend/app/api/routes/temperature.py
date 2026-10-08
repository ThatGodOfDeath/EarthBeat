"""
temperature.py — Temperature API routes

All temperature endpoints live under /api/temperature.

Route                     | Purpose
--------------------------|---------------------------------------------------
GET /api/temperature      | Local T2M time series for lat/lon + date range
GET /api/temperature/global | Single global T2M grid snapshot at a timestamp
GET /api/temperature/metadata | Dataset metadata (resolution, temporal info, etc.)
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import Settings, get_settings
from app.schemas.temperature import (
    TemperatureSeriesResponse,
    GlobalTemperatureResponse,
    TemperatureMetadataResponse,
)
from app.services import temperature as temp_svc

router = APIRouter(prefix="/temperature", tags=["temperature"])


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


@router.get("", response_model=TemperatureSeriesResponse)
async def get_temperature_series(
    lat: Annotated[float, Query(description="Latitude (-90 to 90)")],
    lon: Annotated[float, Query(description="Longitude (-180 to 180)")],
    start: Annotated[str, Query(description="Start datetime (ISO 8601 UTC)")],
    end: Annotated[str, Query(description="End datetime (ISO 8601 UTC)")],
    settings: Annotated[Settings, Depends(get_settings)],
    timestamps: Annotated[str | None, Query(description="Optional comma-separated timestamps (ISO 8601 UTC) to sample")] = None,
):
    """
    Retrieve a T2M temperature time series for the nearest NASA GEOS-FP
    grid point to the requested lat/lon over the requested time range.

    Example:
        GET /api/temperature?lat=23.8103&lon=90.4125
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
        return await temp_svc.get_temperature_series(
            lat, lon, start_dt, end_dt, settings, target_timestamps=target_dts
        )
    except temp_svc.NasaDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except temp_svc.NoDataInRangeError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        # Do not expose internal Python errors to the browser
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while retrieving temperature data.",
        ) from exc


@router.get("/global", response_model=GlobalTemperatureResponse)
async def get_global_temperature(
    time: Annotated[str, Query(description="Timestamp (ISO 8601 UTC)")],
    settings: Annotated[Settings, Depends(get_settings)],
    variable: Annotated[str, Query(description="Variable identifier (T2M, TS, PS, WIND)")] = "T2M",
):
    """
    Retrieve a downsampled global temperature grid for the nearest
    available NASA GEOS-FP observation to the requested timestamp.

    The response grid is 360×180 (1° per cell) to keep the JSON payload
    to a manageable size for the browser canvas renderer.

    Example:
        GET /api/temperature/global?time=2026-09-30T15:00:00Z
    """
    ts = _parse_dt(time, "time")

    try:
        return await temp_svc.get_global_temperature(ts, settings, variable=variable)
    except temp_svc.NasaDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except temp_svc.NoDataInRangeError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while retrieving global temperature data.",
        ) from exc


@router.get("/metadata", response_model=TemperatureMetadataResponse)
async def get_temperature_metadata(
    settings: Annotated[Settings, Depends(get_settings)],
):
    """
    Return static dataset metadata: source, variable, resolution, units, etc.
    This endpoint does NOT open the OPeNDAP dataset.
    """
    try:
        return await temp_svc.get_metadata(settings)
    except temp_svc.NasaDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while retrieving metadata.",
        ) from exc
