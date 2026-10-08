"""
scientific.py — Pydantic response schemas for generic scientific data endpoints.

Supports global grids and time series for T2M, TS, PS, U10M, V10M, and WIND.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel

from app.schemas.temperature import (
    GlobalGridMeta,
    LocationInfo,
    ResolutionInfo,
    SourceInfo,
)


class ScientificPoint(BaseModel):
    timestamp: str  # ISO 8601 UTC
    value: Optional[float] = None
    u10m: Optional[float] = None
    v10m: Optional[float] = None
    direction: Optional[float] = None
    cardinal: Optional[str] = None


class ScientificSeriesResponse(BaseModel):
    variable: str
    source: SourceInfo
    location: LocationInfo
    resolution: ResolutionInfo
    data: list[ScientificPoint]


class GlobalScientificResponse(BaseModel):
    timestamp: str          # ISO 8601 UTC (actual observation time)
    requestedTimestamp: str # ISO 8601 UTC (client requested time)
    variable: str           # e.g. "T2M", "TS", "PS", "WIND"
    source: SourceInfo
    resolution: ResolutionInfo
    grid: GlobalGridMeta
    values: list[Optional[float]]
    uValues: Optional[list[Optional[float]]] = None
    vValues: Optional[list[Optional[float]]] = None
