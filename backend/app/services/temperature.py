"""
temperature.py — Application Temperature Service

This layer sits between the FastAPI routes and the NASA GEOS-FP service.
It handles:
  - In-memory caching (local series + global grids)
  - Error translation
  - Response schema assembly
  - Cache key construction

Architecture:
    Route → temperature service → geos_fp NASA service → OPeNDAP
"""
from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict
from datetime import datetime
from functools import partial
from typing import Any

from app.config import Settings
from app.schemas.temperature import (
    GlobalGridMeta,
    GlobalTemperatureResponse,
    LocationCoords,
    LocationInfo,
    ResolutionInfo,
    SpatialResolution,
    SourceInfo,
    TemperatureMetadataResponse,
    TemperaturePoint,
    TemperatureSeriesResponse,
    TemporalResolution,
)
from app.services.nasa import geos_fp as nasa

logger = logging.getLogger(__name__)

# ── Custom application-level errors ─────────────────────────────────────────

class NasaDataUnavailableError(Exception):
    """NASA OPeNDAP is unreachable or returned an error."""


class NoDataInRangeError(Exception):
    """No observations exist for the requested time range."""


# ── In-memory LRU caches ─────────────────────────────────────────────────────

class _LRUCache:
    def __init__(self, capacity: int) -> None:
        self._capacity = capacity
        self._store: OrderedDict[str, Any] = OrderedDict()

    def get(self, key: str) -> Any:
        if key not in self._store:
            return None
        self._store.move_to_end(key)
        return self._store[key]

    def set(self, key: str, value: Any) -> None:
        if key in self._store:
            self._store.move_to_end(key)
        self._store[key] = value
        if len(self._store) > self._capacity:
            self._store.popitem(last=False)

    def clear(self) -> None:
        self._store.clear()

    def __len__(self) -> int:
        return len(self._store)


_series_cache = _LRUCache(capacity=64)
_global_cache = _LRUCache(capacity=32)
_in_flight_temp_tasks: dict[str, asyncio.Task] = {}


# ── Shared source metadata ────────────────────────────────────────────────────

_SOURCE = SourceInfo(
    name="NASA GEOS-FP",
    dataset="GEOS5 FP 2d assimilated state (inst3_2d_asm_Nx)",
    variable="t2m",
    variableName="2 m air temperature",
    unit="°C",
)


def _make_resolution_info(
    spatial: nasa.SpatialResolutionInfo,
    temporal: nasa.TemporalResolutionInfo,
) -> ResolutionInfo:
    return ResolutionInfo(
        spatial=SpatialResolution(latitude=spatial.lat_deg, longitude=spatial.lon_deg),
        temporal=TemporalResolution(minutes=temporal.minutes, label=temporal.label),
    )


# ── Local time-series ─────────────────────────────────────────────────────────

async def get_temperature_series(
    latitude: float,
    longitude: float,
    start: datetime,
    end: datetime,
    settings: Settings,
    target_timestamps: list[datetime] | None = None,
) -> TemperatureSeriesResponse:
    """
    Retrieve and cache a T2M time series for lat/lon + date range.
    NASA I/O is delegated to geos_fp and run in a thread pool to avoid
    blocking the async event loop.
    """
    ts_key = ""
    if target_timestamps:
        ts_key = ":" + ",".join(t.isoformat() for t in target_timestamps)
    cache_key = (
        f"{latitude:.4f}:{longitude:.4f}"
        f":{start.isoformat()}:{end.isoformat()}"
        f"{ts_key}"
    )
    cached = _series_cache.get(cache_key)
    if cached is not None:
        logger.debug("Cache HIT for series key: %s", cache_key)
        return cached

    if cache_key in _in_flight_temp_tasks:
        logger.debug("Joining in-flight task for series key: %s", cache_key)
        return await _in_flight_temp_tasks[cache_key]

    logger.debug("Cache MISS for series key: %s — fetching from NASA", cache_key)

    async def _fetch() -> TemperatureSeriesResponse:
        try:
            loop = asyncio.get_running_loop()
            obs, grid_pt, spatial_res, temporal_res = await loop.run_in_executor(
                None,
                partial(
                    nasa.get_temperature_series,
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
                f"No T2M observations found between {start.isoformat()} and {end.isoformat()} "
                f"for coordinates ({latitude}, {longitude})."
            )

        response = TemperatureSeriesResponse(
            source=_SOURCE,
            location=LocationInfo(
                requested=LocationCoords(latitude=latitude, longitude=longitude),
                grid=LocationCoords(
                    latitude=grid_pt.latitude,
                    longitude=grid_pt.longitude,
                ),
            ),
            resolution=_make_resolution_info(spatial_res, temporal_res),
            data=[
                TemperaturePoint(timestamp=o.timestamp, temperature=o.temperature_c)
                for o in obs
            ],
        )

        _series_cache.set(cache_key, response)
        return response

    task = asyncio.create_task(_fetch())
    _in_flight_temp_tasks[cache_key] = task
    try:
        return await task
    finally:
        _in_flight_temp_tasks.pop(cache_key, None)


# ── Global grid ───────────────────────────────────────────────────────────────

async def get_global_temperature(
    timestamp: datetime,
    settings: Settings,
    variable: str = "T2M",
) -> GlobalTemperatureResponse:
    """
    Retrieve and cache a downsampled global grid for the given timestamp.
    Defaults to T2M for backward compatibility.
    """
    from app.services import scientific as scientific_svc
    sci_res = await scientific_svc.get_global_grid(variable, timestamp, settings)
    return GlobalTemperatureResponse(
        timestamp=sci_res.timestamp,
        requestedTimestamp=sci_res.requestedTimestamp,
        source=sci_res.source,
        resolution=sci_res.resolution,
        grid=sci_res.grid,
        values=sci_res.values,
    )



# ── Metadata ──────────────────────────────────────────────────────────────────

async def get_metadata(
    settings: Settings,
) -> TemperatureMetadataResponse:
    """
    Return dataset metadata. Opens the dataset to read actual resolution;
    cached after first call.
    """
    cache_key = "__metadata__"
    cached = _series_cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        loop = asyncio.get_running_loop()
        spatial_res, temporal_res = await loop.run_in_executor(
            None,
            partial(nasa.get_dataset_metadata, settings.nasa_geos_fp_url),
        )
    except nasa.GeosFpError as exc:
        raise NasaDataUnavailableError(str(exc)) from exc

    response = TemperatureMetadataResponse(
        source=_SOURCE,
        resolution=_make_resolution_info(spatial_res, temporal_res),
        availableRange=None,
    )
    _series_cache.set(cache_key, response)
    return response
