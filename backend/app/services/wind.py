"""
wind.py — Application Wind Service

This layer sits between FastAPI routes and the NASA GEOS-FP service.
It handles:
  - In-memory caching for wind series
  - Error translation
  - Response schema assembly
  - Cache key construction

Architecture:
    Route → wind service → geos_fp NASA service → OPeNDAP
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from functools import partial

from app.config import Settings
from app.schemas.temperature import (
    LocationCoords,
    LocationInfo,
    SourceInfo,
)
from app.schemas.wind import (
    WindMetadataResponse,
    WindPoint,
    WindSeriesResponse,
)
from app.services.nasa import geos_fp as nasa
from app.services.temperature import (
    NasaDataUnavailableError,
    NoDataInRangeError,
    _LRUCache,
    _make_resolution_info,
)

logger = logging.getLogger(__name__)

_wind_cache = _LRUCache(capacity=64)
_in_flight_wind_tasks: dict[str, asyncio.Task] = {}

_WIND_SOURCE = SourceInfo(
    name="NASA GEOS-FP",
    dataset="GEOS5 FP 2d assimilated state (inst3_2d_asm_Nx)",
    variable="u10m,v10m",
    variableName="10 m wind vector (eastward & northward)",
    unit="m/s",
)


async def get_wind_series(
    latitude: float,
    longitude: float,
    start: datetime,
    end: datetime,
    settings: Settings,
    target_timestamps: list[datetime] | None = None,
) -> WindSeriesResponse:
    """
    Retrieve and cache a wind time series (u10m, v10m, speed, direction) for lat/lon + date range.
    NASA I/O is run in an executor thread pool to avoid blocking the event loop.
    Deduplicates in-flight requests.
    """
    ts_key = ""
    if target_timestamps:
        ts_key = ":" + ",".join(t.isoformat() for t in target_timestamps)
    cache_key = (
        f"{latitude:.4f}:{longitude:.4f}"
        f":{start.isoformat()}:{end.isoformat()}"
        f"{ts_key}"
    )
    cached = _wind_cache.get(cache_key)
    if cached is not None:
        logger.debug("Cache HIT for wind series key: %s", cache_key)
        return cached

    if cache_key in _in_flight_wind_tasks:
        logger.debug("Joining in-flight task for wind series key: %s", cache_key)
        return await _in_flight_wind_tasks[cache_key]

    logger.debug("Cache MISS for wind series key: %s — fetching from NASA", cache_key)

    async def _fetch() -> WindSeriesResponse:
        try:
            loop = asyncio.get_running_loop()
            obs, grid_pt, spatial_res, temporal_res = await loop.run_in_executor(
                None,
                partial(
                    nasa.get_wind_series,
                    settings.nasa_geos_fp_url,
                    latitude,
                    longitude,
                    start,
                    end,
                    target_timestamps=target_timestamps,
                ),
            )
        except nasa.GeosFpError as exc:
            raise NasaDataUnavailableError(str(exc)) from exc

        if not obs:
            raise NoDataInRangeError(
                f"No wind observations found between {start.isoformat()} and {end.isoformat()} "
                f"for coordinates ({latitude}, {longitude})."
            )

        response = WindSeriesResponse(
            source=_WIND_SOURCE,
            location=LocationInfo(
                requested=LocationCoords(latitude=latitude, longitude=longitude),
                grid=LocationCoords(
                    latitude=grid_pt.latitude,
                    longitude=grid_pt.longitude,
                ),
            ),
            resolution=_make_resolution_info(spatial_res, temporal_res),
            data=[
                WindPoint(
                    timestamp=o.timestamp,
                    u10m=o.u10m,
                    v10m=o.v10m,
                    speed=o.speed,
                    direction=o.direction,
                    cardinal=o.cardinal,
                )
                for o in obs
            ],
        )

        _wind_cache.set(cache_key, response)
        return response

    task = asyncio.create_task(_fetch())
    _in_flight_wind_tasks[cache_key] = task
    try:
        return await task
    finally:
        _in_flight_wind_tasks.pop(cache_key, None)


async def get_wind_metadata(settings: Settings) -> WindMetadataResponse:
    """Return dataset metadata for wind endpoints."""
    try:
        loop = asyncio.get_running_loop()
        spatial_res, temporal_res = await loop.run_in_executor(
            None,
            partial(nasa.get_dataset_metadata, settings.nasa_geos_fp_url),
        )
    except nasa.GeosFpError as exc:
        raise NasaDataUnavailableError(str(exc)) from exc

    return WindMetadataResponse(
        source=_WIND_SOURCE,
        resolution=_make_resolution_info(spatial_res, temporal_res),
    )
