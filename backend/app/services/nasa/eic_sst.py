"""
eic_sst.py — NASA Earth Information Center / SVS Sea Surface Temperature (SST) Service

Visualization ID: 5101
Title: Sea Surface Temperature (SST) - Near Real Time
Authoritative NASA source: https://svs.gsfc.nasa.gov/5101/

Responsibilities:
  - Discover / represent NASA SST frame metadata
  - Map calendar dates to authoritative NASA frame URLs and 1-based frame numbers
  - Validate requested dates and apply clear nearest-date policies for out-of-range dates
  - Synchronize SST daily calendar frames with corresponding NASA GEOS-FP hourly/3-hourly observations
  - Provide lightweight on-demand preview generation (downsampled 1024x512 JPEG)
  - Maintain an in-memory LRU cache (no database, no full-dataset downloading)
"""
from __future__ import annotations

import io
import logging
import os
from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Tuple
import urllib.request

# Enable OpenCV OpenEXR codec for reading SVS EXR frames
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"

try:
    import cv2
    import numpy as np
    CV2_AVAILABLE = True
except ImportError:  # pragma: no cover
    CV2_AVAILABLE = False

from app.schemas.eic_sst import (
    GeosFpSyncInfo,
    SstFrameMedia,
    SstFrameResponse,
    SstMetadataResponse,
    SstSourceInfo,
    SstSyncResponse,
    SstSyncVisualizationInfo,
)

logger = logging.getLogger(__name__)

# ── NASA SVS 5101 Authoritative Constants ─────────────────────────────────────
SVS_VISUALIZATION_ID = 5101
SVS_VISUALIZATION_TITLE = "Sea Surface Temperature (SST) - Near Real Time"
SVS_SOURCE_NAME = "NASA Scientific Visualization Studio"
SVS_DATASET_NAME = "MUR SST"
SVS_DATASET_DESCRIPTION = (
    "Jet Propulsion Laboratory (JPL) Multi-scale Ultra-high Resolution (MUR) "
    "Sea Surface Temperature Analysis"
)
SVS_PROJECTION = "equirectangular"
SVS_TEMPORAL_RESOLUTION = "daily"
SVS_FRAME_WIDTH = 4096
SVS_FRAME_HEIGHT = 2048
SVS_FRAME_FORMAT = "OpenEXR"

SVS_FRAME_BASE_URL = (
    "https://svs.gsfc.nasa.gov/vis/a000000/a005100/a005101/frames/4096x2048_2x1_30p/sst_mur/"
)

# Empirically verified frame boundaries from NASA SVS directory listing (zero gaps)
SVS_EARLIEST_DATE = date(2024, 4, 18)
SVS_LATEST_DATE = date(2026, 10, 5)


# ── Lightweight In-Memory LRU Cache (No Database) ────────────────────────────
class _SimpleLRU:
    def __init__(self, capacity: int = 16):
        self.capacity = capacity
        self.cache: OrderedDict[str, any] = OrderedDict()

    def get(self, key: str):
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        return None

    def set(self, key: str, value: any):
        if key in self.cache:
            self.cache.move_to_end(key)
        self.cache[key] = value
        if len(self.cache) > self.capacity:
            self.cache.popitem(last=False)


_frame_meta_cache = _SimpleLRU(capacity=64)
_preview_cache = _SimpleLRU(capacity=8)


# ── Date & URL Mapping Helpers ────────────────────────────────────────────────
def format_date_str(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def build_frame_filename(d: date) -> str:
    """Format: sst_mur_YYYYMMDD.exr"""
    return f"sst_mur_{d.strftime('%Y%m%d')}.exr"


def build_frame_url(filename: str) -> str:
    return f"{SVS_FRAME_BASE_URL}{filename}"


def date_to_frame_number(d: date, earliest: date = SVS_EARLIEST_DATE) -> int:
    """Chronological 1-based frame index."""
    return (d - earliest).days + 1


def frame_number_to_date(frame_num: int, earliest: date = SVS_EARLIEST_DATE) -> date:
    return earliest + timedelta(days=frame_num - 1)


# ── Metadata Retrieval ────────────────────────────────────────────────────────
def get_sst_metadata() -> SstMetadataResponse:
    """Return authoritative NASA SVS 5101 SST visualization metadata."""
    total_frames = (SVS_LATEST_DATE - SVS_EARLIEST_DATE).days + 1
    return SstMetadataResponse(
        visualizationId=SVS_VISUALIZATION_ID,
        name=SVS_VISUALIZATION_TITLE,
        source=SVS_SOURCE_NAME,
        dataset=SVS_DATASET_NAME,
        projection=SVS_PROJECTION,
        temporalResolution=SVS_TEMPORAL_RESOLUTION,
        frameCount=total_frames,
        availableFrom=format_date_str(SVS_EARLIEST_DATE),
        availableTo=format_date_str(SVS_LATEST_DATE),
        width=SVS_FRAME_WIDTH,
        height=SVS_FRAME_HEIGHT,
    )


# ── Frame Resolution & Validation ─────────────────────────────────────────────
def resolve_frame_date(req_date: date) -> Tuple[date, bool, Optional[str]]:
    """
    Validate requested date against available range.
    Documented rule for missing/out-of-bounds dates:
      - If requested date < SVS_EARLIEST_DATE: return earliest available date with warning.
      - If requested date > SVS_LATEST_DATE: return latest available date with warning.
      - Otherwise: return exact requested date (100% available with zero gaps).
    """
    if req_date < SVS_EARLIEST_DATE:
        msg = (
            f"Requested date {format_date_str(req_date)} precedes the earliest available frame "
            f"({format_date_str(SVS_EARLIEST_DATE)}). Returning earliest frame."
        )
        return SVS_EARLIEST_DATE, False, msg
    elif req_date > SVS_LATEST_DATE:
        msg = (
            f"Requested date {format_date_str(req_date)} exceeds the latest available frame "
            f"({format_date_str(SVS_LATEST_DATE)}). Returning latest frame."
        )
        return SVS_LATEST_DATE, False, msg
    else:
        return req_date, True, None


def get_sst_frame_info(requested_date: date, request_base_url: str = "") -> SstFrameResponse:
    """
    Return full frame metadata for a requested date.
    Utilizes in-memory LRU caching to eliminate redundant lookups.
    """
    date_key = format_date_str(requested_date)
    cached = _frame_meta_cache.get(date_key)
    if cached is not None:
        return cached

    actual_date, is_available, note = resolve_frame_date(requested_date)
    frame_filename = build_frame_filename(actual_date)
    frame_url = build_frame_url(frame_filename)
    frame_num = date_to_frame_number(actual_date)

    preview_rel = f"/api/eic/sst/preview?date={format_date_str(actual_date)}"
    preview_url = f"{request_base_url.rstrip('/')}{preview_rel}" if request_base_url else preview_rel

    resp = SstFrameResponse(
        visualizationId=SVS_VISUALIZATION_ID,
        requestedDate=date_key,
        actualDate=format_date_str(actual_date),
        frameNumber=frame_num,
        isAvailable=is_available,
        frame=SstFrameMedia(
            url=frame_url,
            previewUrl=preview_url,
            filename=frame_filename,
            format=SVS_FRAME_FORMAT,
            width=SVS_FRAME_WIDTH,
            height=SVS_FRAME_HEIGHT,
        ),
        source=SstSourceInfo(
            name=SVS_SOURCE_NAME,
            dataset=SVS_DATASET_NAME,
            description=SVS_DATASET_DESCRIPTION,
        ),
        note=note,
    )

    _frame_meta_cache.set(date_key, resp)
    return resp


# ── GEOS-FP Synchronization ───────────────────────────────────────────────────
def get_geos_fp_sync(visual_date: date) -> SstSyncResponse:
    """
    Map an SST daily visual date to the corresponding calendar day observations
    in NASA GEOS-FP.
    
    GEOS-FP inst3_2d_asm_Nx runs at 3-hourly intervals (00:00, 03:00, ... 21:00 UTC).
    Respects active temporal resolution without forcing SST into hourly interpolation.
    """
    # Build the 3-hourly timestamps for this calendar day
    times = []
    for hour in (0, 3, 6, 9, 12, 15, 18, 21):
        dt = datetime(visual_date.year, visual_date.month, visual_date.day, hour, 0, 0, tzinfo=timezone.utc)
        times.append(dt.strftime("%Y-%m-%dT%H:%M:%SZ"))

    sync_resp = SstSyncResponse(
        visualDate=format_date_str(visual_date),
        temperature=GeosFpSyncInfo(
            dataset="NASA GEOS-FP",
            variable="T2M (2-meter atmospheric air temperature)",
            availableStart=times[0],
            availableEnd=times[-1],
            temporalResolution="3-hourly",
            timestamps=times,
        ),
        visualization=SstSyncVisualizationInfo(
            dataset=SVS_DATASET_NAME,
            variable="Sea Surface Temperature (ocean skin/water temperature)",
            date=format_date_str(visual_date),
            temporalResolution=SVS_TEMPORAL_RESOLUTION,
        ),
    )
    return sync_resp


# ── On-Demand Frame Preview Generation ────────────────────────────────────────
def generate_frame_preview(target_date: date) -> bytes:
    """
    Fetch a single representative NASA SVS frame, decode the OpenEXR image,
    downsample to a 1024x512 preview, and encode as JPEG bytes.
    
    Results are cached in an in-memory LRU cache (max 8 frames) to prevent
    redundant network operations and maintain tight memory limits.
    """
    date_key = format_date_str(target_date)
    cached = _preview_cache.get(date_key)
    if cached is not None:
        return cached

    actual_date, _, _ = resolve_frame_date(target_date)
    frame_filename = build_frame_filename(actual_date)
    frame_url = build_frame_url(frame_filename)

    logger.info("Fetching NASA SVS SST frame for preview: %s", frame_url)

    req = urllib.request.Request(
        frame_url,
        headers={"User-Agent": "Earth-Jukebox/5.0 (NASA EIC SST Prototype; https://earthjukebox.internal)"},
    )

    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            exr_bytes = resp.read()
    except Exception as exc:
        logger.error("Failed to fetch SVS frame %s: %s", frame_url, exc)
        raise RuntimeError(f"Unable to download NASA frame {frame_filename}: {exc}") from exc

    if not CV2_AVAILABLE:
        raise RuntimeError("OpenCV is not available for EXR decoding")

    # Decode from memory buffer
    np_arr = np.frombuffer(exr_bytes, dtype=np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_ANYCOLOR | cv2.IMREAD_ANYDEPTH)

    if img is None:
        logger.error("cv2.imdecode failed on EXR stream (%d bytes)", len(exr_bytes))
        raise RuntimeError(f"Failed to decode OpenEXR image for {frame_filename}")

    # Normalize float32 HDR (0..1) to uint8 (0..255)
    if img.dtype == np.float32:
        clipped = np.clip(img, 0.0, 1.0)
        uint8_img = (clipped * 255.0).astype(np.uint8)
    else:
        uint8_img = img.astype(np.uint8)

    # Downsample to 1024x512 preview
    preview_img = cv2.resize(uint8_img, (1024, 512), interpolation=cv2.INTER_AREA)

    # Encode to JPEG
    success, encoded_jpg = cv2.imencode(".jpg", preview_img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not success:
        raise RuntimeError("Failed to encode preview image as JPEG")

    jpg_bytes = encoded_jpg.tobytes()
    _preview_cache.set(date_key, jpg_bytes)
    return jpg_bytes
