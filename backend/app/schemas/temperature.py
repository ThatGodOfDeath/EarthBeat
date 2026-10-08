"""
temperature.py — Pydantic response schemas for temperature endpoints.

These schemas define the exact JSON shape returned to the frontend.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel


# ── Shared sub-schemas ──────────────────────────────────────────────────────

class SourceInfo(BaseModel):
    name: str
    dataset: str
    variable: str
    variableName: str
    unit: str


class LocationCoords(BaseModel):
    latitude: float
    longitude: float


class LocationInfo(BaseModel):
    requested: LocationCoords
    grid: LocationCoords


class SpatialResolution(BaseModel):
    latitude: float   # degrees
    longitude: float  # degrees


class TemporalResolution(BaseModel):
    minutes: int
    label: str        # e.g. "3-hourly"


class ResolutionInfo(BaseModel):
    spatial: SpatialResolution
    temporal: TemporalResolution


# ── Local time-series response ──────────────────────────────────────────────

class TemperaturePoint(BaseModel):
    timestamp: str   # ISO 8601 UTC, e.g. "2026-09-29T00:00:00Z"
    temperature: float  # °C


class TemperatureSeriesResponse(BaseModel):
    source: SourceInfo
    location: LocationInfo
    resolution: ResolutionInfo
    data: list[TemperaturePoint]


# ── Global grid response ────────────────────────────────────────────────────

class GlobalGridMeta(BaseModel):
    width: int         # longitude cells
    height: int        # latitude cells
    latMin: float
    latMax: float
    lonMin: float
    lonMax: float
    latStep: float
    lonStep: float
    missingValue: Optional[float]  # sentinel if used; null if NaN


class GlobalTemperatureResponse(BaseModel):
    timestamp: str          # ISO 8601 UTC (actual NASA obs time)
    requestedTimestamp: str # ISO 8601 UTC (client-requested time)
    source: SourceInfo
    resolution: ResolutionInfo
    grid: GlobalGridMeta
    # Row-major flat array of °C values, NaN represented as null in JSON
    values: list[Optional[float]]


# ── Metadata response ───────────────────────────────────────────────────────

class TemperatureMetadataResponse(BaseModel):
    source: SourceInfo
    resolution: ResolutionInfo
    availableRange: Optional[dict]   # {"start": ..., "end": ...} if known
