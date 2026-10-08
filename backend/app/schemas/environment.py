"""
environment.py — Pydantic response schemas for unified environmental endpoints.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel

from app.schemas.temperature import (
    LocationInfo,
    ResolutionInfo,
    SourceInfo,
)


class EnvironmentalPoint(BaseModel):
    timestamp: str  # ISO 8601 UTC
    t2m: Optional[float] = None       # °C
    ts: Optional[float] = None        # °C
    u10m: Optional[float] = None      # m/s
    v10m: Optional[float] = None      # m/s
    tprecmax: Optional[float] = None  # kg/m²/s (native unit; 0.0 preserved)
    tqv: Optional[float] = None       # kg/m²
    ps: Optional[float] = None        # Pa


class EnvironmentalSeriesResponse(BaseModel):
    source: SourceInfo
    location: LocationInfo
    resolution: ResolutionInfo
    data: list[EnvironmentalPoint]
