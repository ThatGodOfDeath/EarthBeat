"""
wind.py — Pydantic response schemas for wind endpoints.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel

from app.schemas.temperature import (
    LocationInfo,
    ResolutionInfo,
    SourceInfo,
)


class WindPoint(BaseModel):
    timestamp: str              # ISO 8601 UTC, e.g. "2026-09-29T00:00:00Z"
    u10m: float                 # Eastward wind component in m/s
    v10m: float                 # Northward wind component in m/s
    speed: float                # Wind speed in m/s (sqrt(u² + v²))
    direction: Optional[float]  # Meteorological wind direction in degrees (0=N, 90=E, 180=S, 270=W); None if calm
    cardinal: str               # 16-point compass label e.g. "SW", "NNE", or "Calm"


class WindSeriesResponse(BaseModel):
    source: SourceInfo
    location: LocationInfo
    resolution: ResolutionInfo
    data: list[WindPoint]


class WindMetadataResponse(BaseModel):
    source: SourceInfo
    resolution: ResolutionInfo
    availableRange: Optional[dict] = None
