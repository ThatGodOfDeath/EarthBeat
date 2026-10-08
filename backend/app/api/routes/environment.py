"""
environment.py — Unified Environmental API Routes

Route:
GET /api/environment | Local unified environmental time series (t2m, ts, u10m, v10m, tprecmax, tqv, ps)
"""
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import Settings, get_settings
from app.schemas.environment import EnvironmentalSeriesResponse
from app.services import environmental as env_svc
from app.services import temperature as temp_svc

router = APIRouter(prefix="/environment", tags=["environment"])


def _parse_dt(value: str, param_name: str) -> datetime:
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


@router.get("", response_model=EnvironmentalSeriesResponse)
async def get_environmental_series(
    lat: Annotated[float, Query(description="Latitude (-90 to 90)")],
    lon: Annotated[float, Query(description="Longitude (-180 to 180)")],
    settings: Annotated[Settings, Depends(get_settings)],
    start: Annotated[str | None, Query(description="Start datetime (ISO 8601 UTC)")] = None,
    end: Annotated[str | None, Query(description="End datetime (ISO 8601 UTC)")] = None,
    timestamps: Annotated[str | None, Query(description="Optional comma-separated timestamps (ISO 8601 UTC) to sample")] = None,
):
    """
    Retrieve unified GEOS-FP environmental time series (t2m, ts, u10m, v10m, tprecmax, tqv, ps)
    for the nearest grid point to requested lat/lon over the date range.
    """
    if not (-90 <= lat <= 90):
        raise HTTPException(status_code=422, detail="'lat' must be between -90 and 90")
    if not (-180 <= lon <= 180):
        raise HTTPException(status_code=422, detail="'lon' must be between -180 and 180")

    target_dts: list[datetime] | None = None
    if timestamps:
        target_dts = []
        for raw in timestamps.split(","):
            raw_clean = raw.strip()
            if raw_clean:
                target_dts.append(_parse_dt(raw_clean, "timestamps"))

    if start is not None and end is not None:
        start_dt = _parse_dt(start, "start")
        end_dt = _parse_dt(end, "end")
        if start_dt >= end_dt:
            raise HTTPException(status_code=422, detail="'start' must be before 'end'")
    elif target_dts:
        start_dt = min(target_dts)
        end_dt = max(target_dts)
        if start_dt == end_dt:
            end_dt = start_dt + timedelta(seconds=1)
    else:
        raise HTTPException(
            status_code=422,
            detail="Either 'start' and 'end' date range or 'timestamps' must be provided",
        )

    try:
        return await env_svc.get_environmental_series(
            lat, lon, start_dt, end_dt, settings, target_timestamps=target_dts
        )
    except temp_svc.NasaDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except temp_svc.NoDataInRangeError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail="An internal error occurred while retrieving environmental data.",
        ) from exc
