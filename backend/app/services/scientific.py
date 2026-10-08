"""
scientific.py — Application Scientific Data Service

Handles global grids and local time series for all scientific variables:
  - T2M:  2-metre air temperature (°C)
  - TS:   Surface skin temperature (°C)
  - PS:   Surface pressure (hPa)
  - WIND: 10 m wind speed (m/s) + u10m/v10m vector fields
  - U10M: Eastward wind component (m/s)
  - V10M: Northward wind component (m/s)
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from functools import partial
import time

from app.config import Settings
from app.schemas.scientific import (
    GlobalScientificResponse,
    ScientificPoint,
    ScientificSeriesResponse,
)
from app.schemas.temperature import (
    GlobalGridMeta,
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

# LRU Cache: 32 grids per variable (keyed by VARIABLE:TIMESTAMP)
_global_scientific_cache = _LRUCache(capacity=96)
_series_scientific_cache = _LRUCache(capacity=64)
_in_flight_grid_tasks: dict[str, asyncio.Task] = {}

VAR_DEFINITIONS: dict[str, tuple[str, str, str]] = {
    "T2M": ("t2m", "2 m air temperature", "°C"),
    "TS": ("ts", "surface skin temperature", "°C"),
    "PS": ("ps", "surface pressure", "hPa"),
    "WIND": ("wind", "10 m surface wind speed", "m/s"),
    "U10M": ("u10m", "10 m eastward wind", "m/s"),
    "V10M": ("v10m", "10 m northward wind", "m/s"),
    "TPRECMAX": ("tprecmax", "total precipitation", "mm/h"),
    "TQV": ("tqv", "total precipitable water vapor", "kg/m²"),
}


def _get_source_info(variable: str) -> SourceInfo:
    v_upper = variable.upper()
    v_var, v_name, v_unit = VAR_DEFINITIONS.get(v_upper, (variable.lower(), variable, ""))
    return SourceInfo(
        name="NASA GEOS-FP",
        dataset="GEOS5 FP 2d assimilated state (inst3_2d_asm_Nx)",
        variable=v_var,
        variableName=v_name,
        unit=v_unit,
    )


async def get_global_grid(
    variable: str,
    timestamp: datetime,
    settings: Settings,
) -> GlobalScientificResponse:
    """
    Retrieve and cache a downsampled global grid for the specified variable and timestamp.
    Deduplicates concurrent in-flight requests to avoid redundant NASA OPeNDAP traffic.
    """
    v_upper = variable.upper()
    cache_key = f"{v_upper}:{timestamp.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    cached = _global_scientific_cache.get(cache_key)
    if cached is not None:
        logger.debug("Cache HIT for global scientific grid: %s", cache_key)
        return cached

    if cache_key in _in_flight_grid_tasks:
        logger.debug("Joining in-flight task for global scientific grid: %s", cache_key)
        return await _in_flight_grid_tasks[cache_key]

    logger.debug("Cache MISS for global scientific grid: %s — fetching from NASA", cache_key)

    async def _fetch() -> GlobalScientificResponse:
        t0 = time.time()
        try:
            loop = asyncio.get_running_loop()
            grid_data = await loop.run_in_executor(
                None,
                partial(
                    nasa.get_global_grid,
                    settings.nasa_geos_fp_url,
                    timestamp,
                    variable=v_upper,
                ),
            )
        except nasa.GeosFpError as exc:
            raise NasaDataUnavailableError(str(exc)) from exc

        t_fetch = time.time() - t0

        response = GlobalScientificResponse(
            timestamp=grid_data.actual_timestamp,
            requestedTimestamp=grid_data.requested_timestamp,
            variable=v_upper,
            source=_get_source_info(v_upper),
            resolution=_make_resolution_info(grid_data.spatial_res, grid_data.temporal_res),
            grid=GlobalGridMeta(
                width=grid_data.width,
                height=grid_data.height,
                latMin=grid_data.lat_min,
                latMax=grid_data.lat_max,
                lonMin=grid_data.lon_min,
                lonMax=grid_data.lon_max,
                latStep=grid_data.lat_step,
                lonStep=grid_data.lon_step,
                missingValue=None,
            ),
            values=grid_data.values,
            uValues=grid_data.u_values,
            vValues=grid_data.v_values,
        )

        logger.info(
            "GLOBAL SCIENTIFIC | var: %s | ts: %s | NASA fetch: %.2fs | points: %d",
            v_upper, cache_key, t_fetch, len(grid_data.values),
        )

        _global_scientific_cache.set(cache_key, response)
        return response

    task = asyncio.create_task(_fetch())
    _in_flight_grid_tasks[cache_key] = task
    try:
        return await task
    finally:
        _in_flight_grid_tasks.pop(cache_key, None)
