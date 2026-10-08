"""
geos_fp.py — NASA GEOS-FP OPeNDAP Service Layer

Responsibilities:
  1. Open the NASA GEOS-FP OPeNDAP dataset (lazy, reused across requests).
  2. Read dataset metadata (grid coordinates, time axis, temporal resolution).
  3. Validate requested coordinates.
  4. Find nearest NASA grid point via xarray nearest-neighbor selection.
  5. Retrieve requested T2M values for a time slice.
  6. Convert Kelvin to Celsius.
  7. Normalize timestamps to ISO 8601 UTC.
  8. Handle missing / fill values.
  9. Return structured data to the application service layer.
  10. Support efficient downsampled global grid retrieval.

DO NOT put any FastAPI route logic here.
"""
from __future__ import annotations

import logging
import math
import re
import requests as _requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry
from datetime import datetime, timedelta, timezone
from typing import NamedTuple, Optional

import numpy as np
import xarray as xr

from app.utils.wind import (
    calculate_wind_direction,
    calculate_wind_speed,
    get_cardinal_direction,
)

logger = logging.getLogger(__name__)

# ── Module-level dataset handle and HTTP session (reused across requests) ────
_dataset: xr.Dataset | None = None
_dataset_url: str | None = None
_session: _requests.Session | None = None

_cached_lat: np.ndarray | None = None
_cached_lon: np.ndarray | None = None
_cached_time: np.ndarray | None = None


def _get_http_session() -> _requests.Session:
    """
    Returns a persistent requests.Session with connection pooling and keep-alive
    to minimize TCP/TLS handshake latency to NASA OPeNDAP servers.
    """
    global _session
    if _session is None:
        s = _requests.Session()
        adapter = HTTPAdapter(
            pool_connections=32,
            pool_maxsize=32,
            max_retries=Retry(
                total=2,
                backoff_factor=0.3,
                status_forcelist=[500, 502, 503, 504],
            ),
        )
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        _session = s
    return _session


def _get_cached_coords(ds: xr.Dataset) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Cache lat, lon, and time coordinate arrays in memory to prevent expensive
    remote OPeNDAP metadata network round-trips on every query.
    """
    global _cached_lat, _cached_lon, _cached_time
    if _cached_lat is None or _cached_lon is None or _cached_time is None:
        _cached_lat = ds["lat"].values
        _cached_lon = ds["lon"].values
        _cached_time = ds["time"].values
    return _cached_lat, _cached_lon, _cached_time


class GeosFpError(Exception):
    """Raised when the NASA OPeNDAP service cannot be reached or returns bad data."""


class GridPoint(NamedTuple):
    latitude: float
    longitude: float


class TemporalResolutionInfo(NamedTuple):
    minutes: int
    label: str


class SpatialResolutionInfo(NamedTuple):
    lat_deg: float
    lon_deg: float


class TemperatureObservation(NamedTuple):
    timestamp: str   # ISO 8601 UTC
    temperature_c: float


class WindObservation(NamedTuple):
    timestamp: str   # ISO 8601 UTC
    u10m: float      # m/s
    v10m: float      # m/s
    speed: float     # m/s
    direction: Optional[float]  # meteorological degrees (0=N, 90=E, 180=S, 270=W) or None
    cardinal: str    # "SW", "NNE", "Calm", etc.


class EnvironmentalObservation(NamedTuple):
    timestamp: str                           # ISO 8601 UTC
    t2m: Optional[float] = None             # °C (2m air temperature)
    ts: Optional[float] = None              # °C (surface skin temperature)
    u10m: Optional[float] = None            # m/s
    v10m: Optional[float] = None            # m/s
    tprecmax: Optional[float] = None        # kg/m²/s (total precipitation flux, preserves 0.0)
    tqv: Optional[float] = None             # kg/m² (total precipitable water vapor)
    ps: Optional[float] = None              # Pa (surface pressure)


class GlobalGridData(NamedTuple):
    actual_timestamp: str       # ISO 8601 UTC (snapped to nearest available obs)
    requested_timestamp: str    # ISO 8601 UTC (what the client asked for)
    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float
    lat_step: float
    lon_step: float
    width: int
    height: int
    values: list  # flat row-major list of floats (NaN → None)
    spatial_res: SpatialResolutionInfo
    temporal_res: TemporalResolutionInfo
    variable: str = "T2M"
    unit: str = "°C"
    u_values: Optional[list] = None
    v_values: Optional[list] = None


def _open_dataset(url: str) -> xr.Dataset:
    """
    Open (or return cached) the NASA GEOS-FP OPeNDAP dataset.
    The dataset is opened with engine='netcdf4', mask_and_scale=True so that
    fill values are automatically converted to NaN.
    We do NOT call .load() — data is fetched lazily on demand.
    """
    global _dataset, _dataset_url

    if _dataset is not None and _dataset_url == url:
        return _dataset

    import time
    last_exc = None
    for attempt in range(1, 4):
        try:
            logger.info("Opening NASA GEOS-FP dataset (attempt %d/3): %s", attempt, url)
            import warnings
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", category=xr.SerializationWarning, message=".*Ambiguous reference date string.*")
                ds = xr.open_dataset(
                    url,
                    engine="netcdf4",
                    mask_and_scale=True,
                )
            _dataset = ds

            _dataset_url = url
            logger.info(
                "Dataset opened. Variables: %s",
                list(ds.data_vars),
            )
            return ds
        except Exception as exc:
            last_exc = exc
            logger.warning("Attempt %d/3 to open NASA dataset failed: %s", attempt, exc)
            if attempt < 3:
                time.sleep(2.0 * attempt)

    logger.error("Failed to open NASA GEOS-FP dataset after 3 attempts: %s", last_exc)
    raise GeosFpError(
        f"Could not connect to NASA GEOS-FP OPeNDAP server: {last_exc}"
    ) from last_exc



def close_dataset() -> None:
    """Close the cached dataset and session (called on application shutdown)."""
    global _dataset, _dataset_url, _cached_lat, _cached_lon, _cached_time, _session
    if _dataset is not None:
        try:
            _dataset.close()
        except Exception:
            pass
        _dataset = None
        _dataset_url = None
    _cached_lat = None
    _cached_lon = None
    _cached_time = None
    if _session is not None:
        try:
            _session.close()
        except Exception:
            pass
        _session = None


def _to_utc_iso(np_datetime64) -> str:
    """
    Convert a numpy datetime64 (or pandas Timestamp / cftime) to an ISO 8601 UTC string
    with 'Z' suffix.
    """
    import pandas as pd
    dt = pd.to_datetime(np_datetime64, utc=True)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")



def _derive_temporal_resolution(ds: xr.Dataset) -> TemporalResolutionInfo:
    """
    Inspect the time axis of the dataset to determine the actual temporal
    resolution. DO NOT assume hourly. Read from the data.
    """
    time_coord = ds["time"]
    if len(time_coord) < 2:
        # Cannot determine from a single point; default to 3-hourly
        return TemporalResolutionInfo(minutes=180, label="3-hourly")

    # Compute median step between consecutive time values (in minutes)
    times_ns = time_coord.values.astype("datetime64[ns]").astype(np.int64)
    diffs_ns = np.diff(times_ns)
    median_ns = float(np.median(diffs_ns))
    minutes = round(median_ns / 60 / 1e9)

    if minutes == 60:
        label = "hourly"
    elif minutes == 180:
        label = "3-hourly"
    elif minutes == 360:
        label = "6-hourly"
    elif minutes == 1440:
        label = "daily"
    else:
        label = f"{minutes}-minute"

    logger.info("Detected temporal resolution: %d minutes (%s)", minutes, label)
    return TemporalResolutionInfo(minutes=minutes, label=label)


def _derive_spatial_resolution(ds: xr.Dataset) -> SpatialResolutionInfo:
    """
    Inspect the lat/lon coordinate axes to determine the actual spatial
    resolution. DO NOT hardcode 0.25 or 0.3125.
    """
    lat = ds["lat"].values
    lon = ds["lon"].values

    if len(lat) >= 2:
        lat_step = abs(float(np.median(np.diff(lat))))
    else:
        lat_step = 0.25  # safe fallback

    if len(lon) >= 2:
        lon_step = abs(float(np.median(np.diff(lon))))
    else:
        lon_step = 0.3125  # safe fallback

    logger.debug("Spatial resolution: lat=%.4f° lon=%.4f°", lat_step, lon_step)
    return SpatialResolutionInfo(lat_deg=round(lat_step, 6), lon_deg=round(lon_step, 6))


def _fetch_points_batched(
    url: str,
    time_indices: list[int],
    lat_idx: int,
    lon_idx: int,
    time_vals,
    timeout: int = 90,
) -> list[TemperatureObservation]:
    """
    Fetch T2M values for a list of time indices efficiently via OPeNDAP DODS ASCII.

    Strategy:
      - If the index span (max - min) is ≤ 120 steps (~15 days at 3-hourly):
          Issue ONE contiguous slice request and filter client-side.
          This is the fastest path — one round-trip, small payload.

      - Otherwise (monthly/yearly — wide sparse span):
          Issue one DODS request PER time index, but run them CONCURRENTLY
          using ThreadPoolExecutor. Instead of N serial round-trips each taking
          ~1s, N concurrent requests complete in ~max(individual_latencies) ≈ 2-5s.
          This is reliable because each individual point request is tiny.

    Args:
        url:          OPeNDAP dataset base URL (without .ascii suffix)
        time_indices: List of integer time indices to fetch
        lat_idx:      Latitude index (0-based)
        lon_idx:      Longitude index (0-based)
        time_vals:    The dataset's time coordinate array (numpy datetime64)
        timeout:      Per-request HTTP timeout in seconds

    Returns:
        list[TemperatureObservation] in chronological order
    """
    if not time_indices:
        return []

    sorted_idxs = sorted(set(time_indices))
    min_idx = sorted_idxs[0]
    max_idx = sorted_idxs[-1]
    span = max_idx - min_idx

    # ── Path A: contiguous slice (fast, one request) ─────────────────────────
    if span <= 120:
        dods_url = (
            f"{url}.ascii?t2m[{min_idx}:1:{max_idx}]"
            f"[{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}]"
        )
        logger.info(
            "DODS contiguous batch: indices %d→%d (%d pts needed), url=%s",
            min_idx, max_idx, len(sorted_idxs), dods_url,
        )
        try:
            resp = _get_http_session().get(dods_url, timeout=timeout)
            resp.raise_for_status()
        except _requests.exceptions.Timeout:
            raise GeosFpError(f"NASA OPeNDAP timed out after {timeout}s")
        except _requests.exceptions.RequestException as exc:
            raise GeosFpError(f"NASA OPeNDAP request failed: {exc}") from exc

        values_k = _parse_dods_ascii(resp.text)
        wanted = set(sorted_idxs)
        observations: list[TemperatureObservation] = []
        for offset, temp_k_raw in enumerate(values_k):
            t_idx = min_idx + offset
            if t_idx not in wanted:
                continue
            if temp_k_raw is None or math.isnan(temp_k_raw):
                continue
            observations.append(TemperatureObservation(
                timestamp=_to_utc_iso(time_vals[t_idx]),
                temperature_c=round(temp_k_raw - 273.15, 4),
            ))
        logger.info("Contiguous batch returned %d/%d observations", len(observations), len(sorted_idxs))
        return sorted(observations, key=lambda o: o.timestamp)

    # ── Path B: concurrent individual-point requests (wide/sparse spans) ──────
    # Each DODS single-point URL is tiny and NASA responds in ~0.5-2s.
    # Running them concurrently brings total time down to max(individual) ≈ 2-5s.
    logger.info(
        "DODS concurrent fetch: %d points, span=%d steps, url base=%s",
        len(sorted_idxs), span, url,
    )

    def _fetch_single(t_idx: int) -> tuple[int, float | None]:
        point_url = (
            f"{url}.ascii?t2m[{t_idx}:{t_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}]"
        )
        try:
            r = _get_http_session().get(point_url, timeout=timeout)
            r.raise_for_status()
            vals = _parse_dods_ascii(r.text)
            return t_idx, vals[0] if vals else None
        except Exception as exc:
            logger.warning("Single-point DODS fetch failed for t_idx=%d: %s", t_idx, exc)
            return t_idx, None

    from concurrent.futures import ThreadPoolExecutor, as_completed
    max_workers = min(len(sorted_idxs), 16)
    results: dict[int, float | None] = {}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_fetch_single, t_idx): t_idx for t_idx in sorted_idxs}
        for future in as_completed(futures):
            t_idx, val = future.result()
            results[t_idx] = val

    observations = []
    for t_idx in sorted_idxs:
        val = results.get(t_idx)
        if val is None or math.isnan(val):
            continue
        observations.append(TemperatureObservation(
            timestamp=_to_utc_iso(time_vals[t_idx]),
            temperature_c=round(val - 273.15, 4),
        ))

    logger.info("Concurrent batch returned %d/%d observations", len(observations), len(sorted_idxs))
    return sorted(observations, key=lambda o: o.timestamp)


def _parse_dods_ascii_var(text: str, var_name: str) -> list[float | None]:
    """
    Parse a DODS ASCII response body and extract values for a given variable.
    """
    values: list[float | None] = []
    in_var = False
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if re.match(rf"^{var_name},\s*\[", line):
            in_var = True
            continue
        # Stop reading when next array section starts
        if in_var and re.match(r"^(time|lat|lon|[a-zA-Z0-9_]+),\s*\[", line):
            break
        if in_var:
            m = re.search(r"[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$", line)
            if m:
                try:
                    values.append(float(m.group()))
                except ValueError:
                    values.append(None)
    return values


def _parse_dods_ascii(text: str) -> list[float | None]:
    """Parse t2m values from DODS ASCII response."""
    return _parse_dods_ascii_var(text, "t2m")


def _fetch_wind_points_batched(
    url: str,
    time_indices: list[int],
    lat_idx: int,
    lon_idx: int,
    time_vals,
    timeout: int = 90,
) -> list[WindObservation]:
    """
    Fetch u10m and v10m values for a list of time indices via OPeNDAP DODS ASCII,
    deriving wind speed and meteorological direction.
    """
    if not time_indices:
        return []

    sorted_idxs = sorted(set(time_indices))
    min_idx = sorted_idxs[0]
    max_idx = sorted_idxs[-1]
    span = max_idx - min_idx

    # ── Path A: contiguous slice (fast, one request) ─────────────────────────
    if span <= 120:
        dods_url = (
            f"{url}.ascii?u10m[{min_idx}:1:{max_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}],"
            f"v10m[{min_idx}:1:{max_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}]"
        )
        logger.info(
            "DODS contiguous wind batch: indices %d→%d (%d pts needed), url=%s",
            min_idx, max_idx, len(sorted_idxs), dods_url,
        )
        try:
            resp = _get_http_session().get(dods_url, timeout=timeout)
            resp.raise_for_status()
        except _requests.exceptions.Timeout:
            raise GeosFpError(f"NASA OPeNDAP timed out after {timeout}s")
        except _requests.exceptions.RequestException as exc:
            raise GeosFpError(f"NASA OPeNDAP request failed: {exc}") from exc

        u_raw = _parse_dods_ascii_var(resp.text, "u10m")
        v_raw = _parse_dods_ascii_var(resp.text, "v10m")
        wanted = set(sorted_idxs)
        observations: list[WindObservation] = []

        total_pts = min(len(u_raw), len(v_raw))
        for offset in range(total_pts):
            t_idx = min_idx + offset
            if t_idx not in wanted:
                continue
            u_val = u_raw[offset]
            v_val = v_raw[offset]
            if u_val is None or v_val is None or math.isnan(u_val) or math.isnan(v_val):
                continue
            speed = calculate_wind_speed(u_val, v_val)
            direction = calculate_wind_direction(u_val, v_val)
            cardinal = get_cardinal_direction(direction)
            observations.append(WindObservation(
                timestamp=_to_utc_iso(time_vals[t_idx]),
                u10m=round(u_val, 2),
                v10m=round(v_val, 2),
                speed=speed,
                direction=direction,
                cardinal=cardinal,
            ))
        logger.info("Contiguous wind batch returned %d/%d observations", len(observations), len(sorted_idxs))
        return sorted(observations, key=lambda o: o.timestamp)

    # ── Path B: concurrent individual-point requests (wide/sparse spans) ──────
    logger.info(
        "DODS concurrent wind fetch: %d points, span=%d steps, url base=%s",
        len(sorted_idxs), span, url,
    )

    def _fetch_single_wind(t_idx: int) -> tuple[int, float | None, float | None]:
        point_url = (
            f"{url}.ascii?u10m[{t_idx}:{t_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}],"
            f"v10m[{t_idx}:{t_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}]"
        )
        try:
            r = _get_http_session().get(point_url, timeout=timeout)
            r.raise_for_status()
            u_vals = _parse_dods_ascii_var(r.text, "u10m")
            v_vals = _parse_dods_ascii_var(r.text, "v10m")
            u = u_vals[0] if u_vals else None
            v = v_vals[0] if v_vals else None
            return t_idx, u, v
        except Exception as exc:
            logger.warning("Single-point DODS wind fetch failed for t_idx=%d: %s", t_idx, exc)
            return t_idx, None, None

    from concurrent.futures import ThreadPoolExecutor, as_completed
    max_workers = min(len(sorted_idxs), 16)
    results: dict[int, tuple[float | None, float | None]] = {}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_fetch_single_wind, t_idx): t_idx for t_idx in sorted_idxs}
        for future in as_completed(futures):
            t_idx, u, v = future.result()
            results[t_idx] = (u, v)

    observations = []
    for t_idx in sorted_idxs:
        u_val, v_val = results.get(t_idx, (None, None))
        if u_val is None or v_val is None or math.isnan(u_val) or math.isnan(v_val):
            continue
        speed = calculate_wind_speed(u_val, v_val)
        direction = calculate_wind_direction(u_val, v_val)
        cardinal = get_cardinal_direction(direction)
        observations.append(WindObservation(
            timestamp=_to_utc_iso(time_vals[t_idx]),
            u10m=round(u_val, 2),
            v10m=round(v_val, 2),
            speed=speed,
            direction=direction,
            cardinal=cardinal,
        ))

    logger.info("Concurrent wind batch returned %d/%d observations", len(observations), len(sorted_idxs))
    return sorted(observations, key=lambda o: o.timestamp)


def _fetch_environmental_points_batched(
    url: str,
    time_indices: list[int],
    lat_idx: int,
    lon_idx: int,
    time_vals,
    timeout: int = 90,
) -> list[EnvironmentalObservation]:
    """
    Fetch t2m, ts, u10m, v10m, tprecmax, tqv, and ps values for a list of time indices
    via OPeNDAP DODS ASCII.
    """
    if not time_indices:
        return []

    sorted_idxs = sorted(set(time_indices))
    min_idx = sorted_idxs[0]
    max_idx = sorted_idxs[-1]
    span = max_idx - min_idx

    # ── Path A: contiguous slice (span <= 120) ──────────────────────────────
    if span <= 120:
        dods_url = (
            f"{url}.ascii?t2m[{min_idx}:1:{max_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}],"
            f"ts[{min_idx}:1:{max_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}],"
            f"u10m[{min_idx}:1:{max_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}],"
            f"v10m[{min_idx}:1:{max_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}],"
            f"tprecmax[{min_idx}:1:{max_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}],"
            f"tqv[{min_idx}:1:{max_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}],"
            f"ps[{min_idx}:1:{max_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}]"
        )
        logger.info(
            "DODS contiguous environmental batch: indices %d→%d (%d pts needed), url=%s",
            min_idx, max_idx, len(sorted_idxs), dods_url,
        )
        try:
            resp = _get_http_session().get(dods_url, timeout=timeout)
            resp.raise_for_status()
        except _requests.exceptions.Timeout:
            raise GeosFpError(f"NASA OPeNDAP timed out after {timeout}s")
        except _requests.exceptions.RequestException as exc:
            raise GeosFpError(f"NASA OPeNDAP request failed: {exc}") from exc

        t2m_raw = _parse_dods_ascii_var(resp.text, "t2m")
        ts_raw = _parse_dods_ascii_var(resp.text, "ts")
        u_raw = _parse_dods_ascii_var(resp.text, "u10m")
        v_raw = _parse_dods_ascii_var(resp.text, "v10m")
        tprecmax_raw = _parse_dods_ascii_var(resp.text, "tprecmax")
        tqv_raw = _parse_dods_ascii_var(resp.text, "tqv")
        ps_raw = _parse_dods_ascii_var(resp.text, "ps")

        wanted = set(sorted_idxs)
        observations: list[EnvironmentalObservation] = []
        total_pts = max(
            len(t2m_raw), len(ts_raw), len(u_raw), len(v_raw),
            len(tprecmax_raw), len(tqv_raw), len(ps_raw),
        )

        for offset in range(total_pts):
            t_idx = min_idx + offset
            if t_idx not in wanted:
                continue

            t2m_val = t2m_raw[offset] if offset < len(t2m_raw) else None
            ts_val = ts_raw[offset] if offset < len(ts_raw) else None
            u_val = u_raw[offset] if offset < len(u_raw) else None
            v_val = v_raw[offset] if offset < len(v_raw) else None
            tprec_val = tprecmax_raw[offset] if offset < len(tprecmax_raw) else None
            tqv_val = tqv_raw[offset] if offset < len(tqv_raw) else None
            ps_val = ps_raw[offset] if offset < len(ps_raw) else None

            # Conversions
            t2m_c = round(t2m_val - 273.15, 2) if (t2m_val is not None and not math.isnan(t2m_val)) else None
            ts_c = round(ts_val - 273.15, 2) if (ts_val is not None and not math.isnan(ts_val)) else None
            u10m_out = round(u_val, 2) if (u_val is not None and not math.isnan(u_val)) else None
            v10m_out = round(v_val, 2) if (v_val is not None and not math.isnan(v_val)) else None
            # Preserve valid 0.0 for precipitation
            tprec_out = round(tprec_val, 7) if (tprec_val is not None and not math.isnan(tprec_val)) else None
            tqv_out = round(tqv_val, 2) if (tqv_val is not None and not math.isnan(tqv_val)) else None
            ps_out = round(ps_val, 1) if (ps_val is not None and not math.isnan(ps_val)) else None

            observations.append(EnvironmentalObservation(
                timestamp=_to_utc_iso(time_vals[t_idx]),
                t2m=t2m_c,
                ts=ts_c,
                u10m=u10m_out,
                v10m=v10m_out,
                tprecmax=tprec_out,
                tqv=tqv_out,
                ps=ps_out,
            ))

        logger.info("Contiguous environmental batch returned %d/%d observations", len(observations), len(sorted_idxs))
        return sorted(observations, key=lambda o: o.timestamp)

    # ── Path B: Concurrent fetch for sparse / wide time spans ───────────────
    from concurrent.futures import ThreadPoolExecutor, as_completed
    logger.info("DODS concurrent environmental fetch: %d points, span=%d steps", len(sorted_idxs), span)

    def _fetch_single_env(t_idx: int) -> tuple[int, dict[str, float | None]]:
        point_url = (
            f"{url}.ascii?t2m[{t_idx}:{t_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}],"
            f"ts[{t_idx}:{t_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}],"
            f"u10m[{t_idx}:{t_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}],"
            f"v10m[{t_idx}:{t_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}],"
            f"tprecmax[{t_idx}:{t_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}],"
            f"tqv[{t_idx}:{t_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}],"
            f"ps[{t_idx}:{t_idx}][{lat_idx}:{lat_idx}][{lon_idx}:{lon_idx}]"
        )
        try:
            r = _get_http_session().get(point_url, timeout=timeout)
            r.raise_for_status()
            res: dict[str, float | None] = {}
            for v_name in ("t2m", "ts", "u10m", "v10m", "tprecmax", "tqv", "ps"):
                vals = _parse_dods_ascii_var(r.text, v_name)
                res[v_name] = vals[0] if vals else None
            return t_idx, res
        except Exception as exc:
            logger.warning("Single-point env fetch failed for index %d: %s", t_idx, exc)
            return t_idx, {}

    results: dict[int, dict[str, float | None]] = {}
    with ThreadPoolExecutor(max_workers=min(16, len(sorted_idxs))) as pool:
        futures = {pool.submit(_fetch_single_env, idx): idx for idx in sorted_idxs}
        for fut in as_completed(futures):
            t_idx, res = fut.result()
            results[t_idx] = res

    observations = []
    for t_idx in sorted_idxs:
        res = results.get(t_idx, {})
        t2m_val = res.get("t2m")
        ts_val = res.get("ts")
        u_val = res.get("u10m")
        v_val = res.get("v10m")
        tprec_val = res.get("tprecmax")
        tqv_val = res.get("tqv")
        ps_val = res.get("ps")

        t2m_c = round(t2m_val - 273.15, 2) if (t2m_val is not None and not math.isnan(t2m_val)) else None
        ts_c = round(ts_val - 273.15, 2) if (ts_val is not None and not math.isnan(ts_val)) else None
        u10m_out = round(u_val, 2) if (u_val is not None and not math.isnan(u_val)) else None
        v10m_out = round(v_val, 2) if (v_val is not None and not math.isnan(v_val)) else None
        tprec_out = round(tprec_val, 7) if (tprec_val is not None and not math.isnan(tprec_val)) else None
        tqv_out = round(tqv_val, 2) if (tqv_val is not None and not math.isnan(tqv_val)) else None
        ps_out = round(ps_val, 1) if (ps_val is not None and not math.isnan(ps_val)) else None

        observations.append(EnvironmentalObservation(
            timestamp=_to_utc_iso(time_vals[t_idx]),
            t2m=t2m_c,
            ts=ts_c,
            u10m=u10m_out,
            v10m=v10m_out,
            tprecmax=tprec_out,
            tqv=tqv_out,
            ps=ps_out,
        ))

    return sorted(observations, key=lambda o: o.timestamp)




def get_temperature_series(
    url: str,
    latitude: float,
    longitude: float,
    start: datetime,
    end: datetime,
    target_timestamps: list[datetime] | None = None,
) -> tuple[list[TemperatureObservation], GridPoint, SpatialResolutionInfo, TemporalResolutionInfo]:
    """
    Retrieve a T2M temperature time series from NASA GEOS-FP.

    Args:
        url:               OPeNDAP dataset URL.
        latitude:          Requested latitude (-90 to 90).
        longitude:         Requested longitude (-180 to 180).
        start:             Time range start (UTC-aware datetime).
        end:               Time range end (UTC-aware datetime).
        target_timestamps: Optional specific observation datetimes to fetch.

    Returns:
        Tuple of:
          - list[TemperatureObservation]: timestamps + temperatures in °C
          - GridPoint: actual NASA grid lat/lon selected (nearest neighbor)
          - SpatialResolutionInfo
          - TemporalResolutionInfo

    Raises:
        GeosFpError: if the dataset cannot be opened or the query fails.
    """
    ds = _open_dataset(url)

    spatial_res = _derive_spatial_resolution(ds)
    temporal_res = _derive_temporal_resolution(ds)

    t2m = ds["t2m"]

    # Pre-calculate nearest lat/lon indices once
    lat_arr, lon_arr, time_vals = _get_cached_coords(ds)
    lat_idx = int(np.abs(lat_arr - latitude).argmin())
    lon_idx = int(np.abs(lon_arr - longitude).argmin())
    actual_lat = float(lat_arr[lat_idx])
    actual_lon = float(lon_arr[lon_idx])
    grid_point = GridPoint(latitude=actual_lat, longitude=actual_lon)

    import pandas as pd

    observations: list[TemperatureObservation] = []

    # If explicit target_timestamps are provided (Monthly / Yearly views),
    # use a SINGLE batched OPeNDAP DODS ASCII request instead of N separate isel calls.
    if target_timestamps:
        selected_dts = target_timestamps
        if len(target_timestamps) > 60:
            # Hard cap at 60 points to keep the request size sane
            indices = np.linspace(0, len(target_timestamps) - 1, 60, dtype=int)
            selected_dts = [target_timestamps[i] for i in indices]

        # Map each requested datetime → nearest dataset time index
        time_indices: list[int] = []
        dt_map: dict[int, str] = {}  # time_idx → ISO string of original requested dt
        for dt in selected_dts:
            dt64 = pd.to_datetime(dt).to_datetime64()
            t_idx = int(np.abs(time_vals - dt64).argmin())
            if t_idx not in dt_map:
                time_indices.append(t_idx)
                dt_map[t_idx] = pd.to_datetime(dt).strftime("%Y-%m-%dT%H:%M:%SZ")

        observations = _fetch_points_batched(
            url, time_indices, lat_idx, lon_idx, time_vals,
        )

        logger.info(
            "Batched %d T2M observations for (%.4f, %.4f) [%.4f, %.4f]",
            len(observations), latitude, longitude, actual_lat, actual_lon,
        )
        return observations, grid_point, spatial_res, temporal_res

    # When no explicit target_timestamps are given:
    total_steps = int((end - start).total_seconds() / 10800)

    start_str = start.strftime("%Y-%m-%dT%H:%M:%S")
    end_str = end.strftime("%Y-%m-%dT%H:%M:%S")

    if total_steps <= 36:
        # Short range (≤ ~4.5 days) — use efficient single contiguous slice
        try:
            series = t2m.sel(
                lat=latitude,
                lon=longitude,
                method="nearest",
            ).sel(
                time=slice(start_str, end_str)
            )
        except Exception as exc:
            raise GeosFpError(
                f"Failed to select data from GEOS-FP dataset: {exc}"
            ) from exc

        try:
            values_k = series.values  # shape: (time,)
        except Exception as exc:
            raise GeosFpError(
                f"Failed to retrieve temperature values from GEOS-FP: {exc}"
            ) from exc

        for t, temp_k in zip(series["time"].values, values_k):
            if temp_k is None or (isinstance(temp_k, float) and math.isnan(temp_k)):
                continue
            temp_k_f = float(temp_k)
            if math.isnan(temp_k_f):
                continue
            temp_c = round(temp_k_f - 273.15, 4)
            observations.append(TemperatureObservation(
                timestamp=_to_utc_iso(t),
                temperature_c=temp_c,
            ))
    else:
        # Large continuous range (> 36 steps) without explicit target timestamps:
        # Sample ~32 evenly spaced time indices and fetch in one batch.
        step_seconds = (end - start).total_seconds() / 31
        sample_dts = [start + timedelta(seconds=i * step_seconds) for i in range(32)]
        time_indices = []
        seen: set[int] = set()
        for dt in sample_dts:
            dt64 = pd.to_datetime(dt).to_datetime64()
            t_idx = int(np.abs(time_vals - dt64).argmin())
            if t_idx not in seen:
                seen.add(t_idx)
                time_indices.append(t_idx)

        observations = _fetch_points_batched(url, time_indices, lat_idx, lon_idx, time_vals)

    logger.info(
        "Retrieved %d T2M observations for (%.4f, %.4f) [%.4f, %.4f] %s..%s",
        len(observations), latitude, longitude, actual_lat, actual_lon,
        start_str, end_str,
    )

    return observations, grid_point, spatial_res, temporal_res


def get_wind_series(
    url: str,
    latitude: float,
    longitude: float,
    start: datetime,
    end: datetime,
    target_timestamps: list[datetime] | None = None,
) -> tuple[list[WindObservation], GridPoint, SpatialResolutionInfo, TemporalResolutionInfo]:
    """
    Retrieve u10m and v10m wind components from NASA GEOS-FP and derive wind speed and direction.

    Args:
        url:               OPeNDAP dataset URL.
        latitude:          Requested latitude (-90 to 90).
        longitude:         Requested longitude (-180 to 180).
        start:             Time range start (UTC-aware datetime).
        end:               Time range end (UTC-aware datetime).
        target_timestamps: Optional specific observation datetimes to fetch.

    Returns:
        Tuple of:
          - list[WindObservation]: timestamp, u10m, v10m, speed, direction, cardinal
          - GridPoint: actual NASA grid lat/lon selected (nearest neighbor)
          - SpatialResolutionInfo
          - TemporalResolutionInfo
    """
    ds = _open_dataset(url)

    spatial_res = _derive_spatial_resolution(ds)
    temporal_res = _derive_temporal_resolution(ds)

    lat_arr, lon_arr, time_vals = _get_cached_coords(ds)
    lat_idx = int(np.abs(lat_arr - latitude).argmin())
    lon_idx = int(np.abs(lon_arr - longitude).argmin())
    actual_lat = float(lat_arr[lat_idx])
    actual_lon = float(lon_arr[lon_idx])
    grid_point = GridPoint(latitude=actual_lat, longitude=actual_lon)

    import pandas as pd

    observations: list[WindObservation] = []

    # If explicit target_timestamps are provided (Monthly / Yearly / Active subset),
    # fetch observations for those exact timestamps via batched DODS.
    if target_timestamps:
        selected_dts = target_timestamps
        if len(target_timestamps) > 60:
            indices = np.linspace(0, len(target_timestamps) - 1, 60, dtype=int)
            selected_dts = [target_timestamps[i] for i in indices]

        time_indices: list[int] = []
        dt_map: dict[int, str] = {}
        for dt in selected_dts:
            dt64 = pd.to_datetime(dt).to_datetime64()
            t_idx = int(np.abs(time_vals - dt64).argmin())
            if t_idx not in dt_map:
                time_indices.append(t_idx)
                dt_map[t_idx] = pd.to_datetime(dt).strftime("%Y-%m-%dT%H:%M:%SZ")

        observations = _fetch_wind_points_batched(
            url, time_indices, lat_idx, lon_idx, time_vals,
        )

        logger.info(
            "Batched %d Wind observations for (%.4f, %.4f) [%.4f, %.4f]",
            len(observations), latitude, longitude, actual_lat, actual_lon,
        )
        return observations, grid_point, spatial_res, temporal_res

    # When no explicit target_timestamps are given:
    total_steps = int((end - start).total_seconds() / 10800)
    start_str = start.strftime("%Y-%m-%dT%H:%M:%S")
    end_str = end.strftime("%Y-%m-%dT%H:%M:%S")

    if total_steps <= 36:
        try:
            series_u = ds["u10m"].sel(
                lat=latitude,
                lon=longitude,
                method="nearest",
            ).sel(
                time=slice(start_str, end_str)
            )
            series_v = ds["v10m"].sel(
                lat=latitude,
                lon=longitude,
                method="nearest",
            ).sel(
                time=slice(start_str, end_str)
            )
        except Exception as exc:
            raise GeosFpError(
                f"Failed to select wind data from GEOS-FP dataset: {exc}"
            ) from exc

        try:
            u_vals = series_u.values
            v_vals = series_v.values
        except Exception as exc:
            raise GeosFpError(
                f"Failed to retrieve wind values from GEOS-FP: {exc}"
            ) from exc

        for t, u_val, v_val in zip(series_u["time"].values, u_vals, v_vals):
            if u_val is None or v_val is None:
                continue
            u_f = float(u_val)
            v_f = float(v_val)
            if math.isnan(u_f) or math.isnan(v_f):
                continue
            speed = calculate_wind_speed(u_f, v_f)
            direction = calculate_wind_direction(u_f, v_f)
            cardinal = get_cardinal_direction(direction)
            observations.append(WindObservation(
                timestamp=_to_utc_iso(t),
                u10m=round(u_f, 2),
                v10m=round(v_f, 2),
                speed=speed,
                direction=direction,
                cardinal=cardinal,
            ))
    else:
        step_seconds = (end - start).total_seconds() / 31
        sample_dts = [start + timedelta(seconds=i * step_seconds) for i in range(32)]
        time_indices = []
        seen: set[int] = set()
        for dt in sample_dts:
            dt64 = pd.to_datetime(dt).to_datetime64()
            t_idx = int(np.abs(time_vals - dt64).argmin())
            if t_idx not in seen:
                seen.add(t_idx)
                time_indices.append(t_idx)

        observations = _fetch_wind_points_batched(url, time_indices, lat_idx, lon_idx, time_vals)

    logger.info(
        "Retrieved %d Wind observations for (%.4f, %.4f) [%.4f, %.4f] %s..%s",
        len(observations), latitude, longitude, actual_lat, actual_lon,
        start_str, end_str,
    )

    return observations, grid_point, spatial_res, temporal_res


def get_environmental_series(
    url: str,
    latitude: float,
    longitude: float,
    start: datetime,
    end: datetime,
    target_timestamps: list[datetime] | None = None,
) -> tuple[list[EnvironmentalObservation], GridPoint, SpatialResolutionInfo, TemporalResolutionInfo]:
    """
    Retrieve unified GEOS-FP environmental time series (t2m, ts, u10m, v10m, tprecmax, tqv, ps).
    """
    ds = _open_dataset(url)

    spatial_res = _derive_spatial_resolution(ds)
    temporal_res = _derive_temporal_resolution(ds)

    lat_arr, lon_arr, time_vals = _get_cached_coords(ds)
    lat_idx = int(np.abs(lat_arr - latitude).argmin())
    lon_idx = int(np.abs(lon_arr - longitude).argmin())
    actual_lat = float(lat_arr[lat_idx])
    actual_lon = float(lon_arr[lon_idx])
    grid_point = GridPoint(latitude=actual_lat, longitude=actual_lon)

    import pandas as pd

    if target_timestamps:
        selected_dts = target_timestamps
        if len(target_timestamps) > 60:
            indices = np.linspace(0, len(target_timestamps) - 1, 60, dtype=int)
            selected_dts = [target_timestamps[i] for i in indices]

        time_indices: list[int] = []
        for dt in selected_dts:
            dt64 = pd.to_datetime(dt).to_datetime64()
            t_idx = int(np.abs(time_vals - dt64).argmin())
            if t_idx not in time_indices:
                time_indices.append(t_idx)

        observations = _fetch_environmental_points_batched(
            url, time_indices, lat_idx, lon_idx, time_vals,
        )
        return observations, grid_point, spatial_res, temporal_res

    # When no explicit target_timestamps are given, sample the time range
    start_dt64 = pd.to_datetime(start).to_datetime64()
    end_dt64 = pd.to_datetime(end).to_datetime64()
    mask = (time_vals >= start_dt64) & (time_vals <= end_dt64)
    matching_indices = np.where(mask)[0].tolist()

    if not matching_indices:
        return [], grid_point, spatial_res, temporal_res

    if len(matching_indices) > 60:
        step = len(matching_indices) / 60
        matching_indices = [matching_indices[int(i * step)] for i in range(60)]

    observations = _fetch_environmental_points_batched(
        url, matching_indices, lat_idx, lon_idx, time_vals,
    )
    return observations, grid_point, spatial_res, temporal_res


def get_global_grid(
    url: str,
    timestamp: datetime,
    variable: str = "T2M",
    out_width: int = 360,
    out_height: int = 180,
) -> GlobalGridData:
    """
    Retrieve a downsampled global grid for the specified timestamp and variable.

    Supports:
        - T2M:  2-metre air temperature (Kelvin → °C)
        - TS:   Surface skin temperature (Kelvin → °C)
        - PS:   Surface pressure (Pa → hPa)
        - U10M: Eastward wind component (m/s)
        - V10M: Northward wind component (m/s)
        - WIND: 10 m wind speed (m/s, sqrt(u² + v²)) + u/v vector fields

    The output is an (out_width × out_height) equirectangular grid at
    1° per cell, matching the frontend canvas renderer's existing
    CANVAS_W=360 / CANVAS_H=180 convention.
    """
    ds = _open_dataset(url)

    spatial_res = _derive_spatial_resolution(ds)
    temporal_res = _derive_temporal_resolution(ds)

    var_key = variable.strip().lower()
    allowed_vars = ("t2m", "ts", "ps", "u10m", "v10m", "wind", "tprecmax", "tqv")
    if var_key not in allowed_vars:
        raise GeosFpError(
            f"Unsupported variable '{variable}'. Allowed: {', '.join(v.upper() for v in allowed_vars)}"
        )

    # Snap to nearest available timestamp using index
    import pandas as pd
    lat_coord, _, time_arr = _get_cached_coords(ds)
    try:
        target = pd.to_datetime(timestamp.strftime("%Y-%m-%dT%H:%M:%S"))
        diffs = np.abs(pd.to_datetime(time_arr) - target)
        best_time_idx = int(np.argmin(diffs))
    except Exception as exc:
        raise GeosFpError(
            f"Failed to select global grid for {variable} at {timestamp}: {exc}"
        ) from exc

    # Record actual timestamp from the dataset
    actual_ts = _to_utc_iso(time_arr[best_time_idx])
    requested_ts = timestamp.strftime("%Y-%m-%dT%H:%M:%SZ")

    # SPATIAL REDUCTION SERVER-SIDE:
    # Native grid: 721 lat x 1152 lon (~830,000 cells)
    # Using remote strided slicing (lat step 4, lon step 4) retrieves 180 x 288 points (~51,840 cells)
    stride_lat = 4
    stride_lon = 4
    flip_lat = len(lat_coord) >= 2 and float(lat_coord[-1]) > float(lat_coord[0])

    def _extract_and_resample(var_name: str) -> np.ndarray:
        try:
            arr = ds[var_name].isel(
                time=best_time_idx,
                lat=slice(0, 720, stride_lat),
                lon=slice(0, 1152, stride_lon),
            ).values
        except Exception as exc:
            raise GeosFpError(f"Failed to load global field for '{var_name}' at {actual_ts}: {exc}") from exc

        data = arr.astype(np.float64)
        if flip_lat:
            data = data[::-1, :]
        cols_idx = (np.linspace(0, data.shape[1] - 1, out_width) + 0.5).astype(int)
        return data[:, cols_idx]

    u_flat = None
    v_flat = None

    if var_key == "wind":
        u_grid = _extract_and_resample("u10m")
        v_grid = _extract_and_resample("v10m")
        speed_grid = np.sqrt(u_grid**2 + v_grid**2)
        unit = "m/s"
        out_grid = speed_grid
        u_flat = [None if math.isnan(val) else round(float(val), 2) for val in u_grid.flat]
        v_flat = [None if math.isnan(val) else round(float(val), 2) for val in v_grid.flat]
    elif var_key in ("t2m", "ts"):
        raw = _extract_and_resample(var_key)
        out_grid = raw - 273.15  # Kelvin → Celsius
        unit = "°C"
    elif var_key == "ps":
        raw = _extract_and_resample("ps")
        out_grid = raw / 100.0   # Pa → hPa
        unit = "hPa"
    elif var_key in ("u10m", "v10m"):
        out_grid = _extract_and_resample(var_key)
        unit = "m/s"
    elif var_key == "tprecmax":
        raw = _extract_and_resample("tprecmax")
        # NASA unit kg m-2 s-1 -> application unit mm/h (1 kg/m²/s = 3,600,000 mm/h)
        out_grid = np.clip(raw * 3600000.0, 0, None)
        unit = "mm/h"
    elif var_key == "tqv":
        raw = _extract_and_resample("tqv")
        # NASA unit kg m-2 (equivalent to mm liquid depth)
        out_grid = np.clip(raw, 0, None)
        unit = "kg/m²"
    else:
        raise GeosFpError(f"Unsupported variable '{var_key}'")

    flat_values = [None if math.isnan(val) else round(float(val), 2) for val in out_grid.flat]

    return GlobalGridData(
        actual_timestamp=actual_ts,
        requested_timestamp=requested_ts,
        lat_min=-90.0,
        lat_max=90.0,
        lon_min=-180.0,
        lon_max=180.0,
        lat_step=180.0 / out_height,
        lon_step=360.0 / out_width,
        width=out_width,
        height=out_height,
        values=flat_values,
        spatial_res=spatial_res,
        temporal_res=temporal_res,
        variable=variable.upper(),
        unit=unit,
        u_values=u_flat,
        v_values=v_flat,
    )



def get_dataset_metadata(
    url: str,
) -> tuple[SpatialResolutionInfo, TemporalResolutionInfo]:
    """
    Open the dataset and return metadata without loading any data values.
    """
    ds = _open_dataset(url)
    return _derive_spatial_resolution(ds), _derive_temporal_resolution(ds)
