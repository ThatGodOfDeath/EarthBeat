"""
environmental.py — Application Environmental Data Service

Bridges the /api/environment route and the NASA GEOS-FP service layer.
Handles caching, async execution, error handling, and response schema assembly.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from functools import partial

from app.config import Settings
from app.schemas.environment import (
    EnvironmentalPoint,
    EnvironmentalSeriesResponse,
)
from app.schemas.temperature import (
    LocationCoords,
    LocationInfo,
    SourceInfo,
)
from app.services.nasa import geos_fp as nasa
from app.services.temperature import (
    NasaDataUnavailableError,
    NoDataInRangeError,
    _LRUCache,
    _make_resolution_info,
)

logger = logging.getLogger(__name__)

# LRU Cache for environmental series
_env_series_cache = _LRUCache(capacity=64)
_in_flight_env_tasks: dict[str, asyncio.Task] = {}


def _make_env_source_info() -> SourceInfo:
    return SourceInfo(
        name="NASA GEOS-FP",
        dataset="GEOS5 FP 2d assimilated state (inst3_2d_asm_Nx)",
        variable="environment",
        variableName="GEOS-FP Unified Environmental Systems (t2m, ts, u10m, v10m, tprecmax, tqv, ps)",
        unit="mixed",
    )


async def get_environmental_series(
    lat: float,
    lon: float,
    start: datetime,
    end: datetime,
    settings: Settings,
    target_timestamps: list[datetime] | None = None,
) -> EnvironmentalSeriesResponse:
    """
    Retrieve unified environmental time series observations for a location and time window.
    Deduplicates concurrent in-flight requests for identical cache keys.
    """
    ts_key = (
        ",".join(dt.strftime("%Y-%m-%dT%H:%M:%SZ") for dt in target_timestamps)
        if target_timestamps
        else ""
    )
    cache_key = (
        f"{lat:.4f}:{lon:.4f}:"
        f"{start.strftime('%Y-%m-%dT%H:%M:%SZ')}:"
        f"{end.strftime('%Y-%m-%dT%H:%M:%SZ')}:"
        f"{ts_key}"
    )

    cached = _env_series_cache.get(cache_key)
    if cached is not None:
        logger.debug("Cache HIT for environmental series: %s", cache_key)
        return cached

    if cache_key in _in_flight_env_tasks:
        logger.debug("Joining in-flight task for environmental series: %s", cache_key)
        return await _in_flight_env_tasks[cache_key]

    logger.debug("Cache MISS for environmental series: %s — fetching from NASA", cache_key)

    async def _fetch() -> EnvironmentalSeriesResponse:
        t0 = time.time()
        try:
            loop = asyncio.get_running_loop()
            observations, grid_pt, spatial_res, temporal_res = await loop.run_in_executor(
                None,
                partial(
                    nasa.get_environmental_series,
                    settings.nasa_geos_fp_url,
                    lat,
                    lon,
                    start,
                    end,
                    target_timestamps=target_timestamps,
                ),
            )
        except nasa.GeosFpError as exc:
            raise NasaDataUnavailableError(str(exc)) from exc

        t_fetch = time.time() - t0

        if not observations:
            raise NoDataInRangeError(
                f"No NASA GEOS-FP environmental observations found between {start} and {end}."
            )

        data_points = [
            EnvironmentalPoint(
                timestamp=obs.timestamp,
                t2m=obs.t2m,
                ts=obs.ts,
                u10m=obs.u10m,
                v10m=obs.v10m,
                tprecmax=obs.tprecmax,
                tqv=obs.tqv,
                ps=obs.ps,
            )
            for obs in observations
        ]

        response = EnvironmentalSeriesResponse(
            source=_make_env_source_info(),
            location=LocationInfo(
                requested=LocationCoords(latitude=lat, longitude=lon),
                grid=LocationCoords(latitude=grid_pt.latitude, longitude=grid_pt.longitude),
            ),
            resolution=_make_resolution_info(spatial_res, temporal_res),
            data=data_points,
        )

        logger.info(
            "ENVIRONMENTAL SERIES | coords: (%.4f, %.4f) | NASA fetch: %.2fs | obs: %d",
            lat, lon, t_fetch, len(observations),
        )

        _env_series_cache.set(cache_key, response)
        return response

    task = asyncio.create_task(_fetch())
    _in_flight_env_tasks[cache_key] = task
    try:
        return await task
    finally:
        _in_flight_env_tasks.pop(cache_key, None)


def clear_environmental_cache() -> None:
    """Clear in-memory environmental cache (used in tests)."""
    global _env_series_cache
    _env_series_cache = _LRUCache(capacity=64)
