"""
eic_sst.py — Pydantic schemas for NASA EIC/SVS Sea Surface Temperature (SST) #5101 API.
"""
from typing import Optional, List
from pydantic import BaseModel, Field


class SstMetadataResponse(BaseModel):
    visualizationId: int = Field(5101, description="NASA SVS Visualization ID")
    name: str = Field(..., description="Visualization Title")
    source: str = Field(..., description="Authoritative Source Studio / Mission")
    dataset: str = Field(..., description="Underlying Earth Science Dataset")
    projection: str = Field("equirectangular", description="Projection type")
    temporalResolution: str = Field("daily", description="Temporal frequency of frames")
    frameCount: int = Field(..., description="Total number of frames available")
    availableFrom: str = Field(..., description="Earliest available date (YYYY-MM-DD)")
    availableTo: str = Field(..., description="Latest available date (YYYY-MM-DD)")
    width: int = Field(4096, description="Frame width in pixels")
    height: int = Field(2048, description="Frame height in pixels")


class SstFrameMedia(BaseModel):
    url: str = Field(..., description="Full URL to the NASA SVS frame asset")
    previewUrl: Optional[str] = Field(None, description="Backend proxy preview URL for web browsers")
    filename: str = Field(..., description="NASA SVS asset filename")
    format: str = Field("OpenEXR", description="Image file format")
    width: int = Field(4096, description="Image width in pixels")
    height: int = Field(2048, description="Image height in pixels")


class SstSourceInfo(BaseModel):
    name: str = Field("NASA Scientific Visualization Studio", description="Provider name")
    dataset: str = Field("MUR SST", description="Scientific dataset name")
    description: str = Field(
        "Multi-scale Ultra-high Resolution Sea Surface Temperature Analysis",
        description="Dataset description"
    )


class SstFrameResponse(BaseModel):
    visualizationId: int = Field(5101, description="NASA SVS Visualization ID")
    requestedDate: str = Field(..., description="Date requested by client (YYYY-MM-DD)")
    actualDate: str = Field(..., description="Actual frame date returned (YYYY-MM-DD)")
    frameNumber: int = Field(..., description="1-based chronological frame index")
    isAvailable: bool = Field(True, description="Whether the requested date matched an exact frame")
    frame: SstFrameMedia
    source: SstSourceInfo
    note: Optional[str] = Field(None, description="Discrepancy explanation if nearest date was used")


class GeosFpSyncInfo(BaseModel):
    dataset: str = Field("NASA GEOS-FP", description="Atmospheric temperature dataset")
    variable: str = Field("T2M (2-meter air temperature)", description="Physical variable")
    availableStart: str = Field(..., description="First observation timestamp on this calendar day (ISO UTC)")
    availableEnd: str = Field(..., description="Last observation timestamp on this calendar day (ISO UTC)")
    temporalResolution: str = Field("3-hourly", description="Temporal step of observations")
    timestamps: List[str] = Field(..., description="Chronological timestamps for the calendar day")


class SstSyncVisualizationInfo(BaseModel):
    dataset: str = Field("MUR SST", description="Visual storytelling dataset")
    variable: str = Field("Sea Surface Temperature", description="Physical variable")
    date: str = Field(..., description="Calendar date of frame (YYYY-MM-DD)")
    temporalResolution: str = Field("daily", description="Temporal frequency")


class SstSyncResponse(BaseModel):
    visualDate: str = Field(..., description="SST visual calendar date (YYYY-MM-DD)")
    temperature: GeosFpSyncInfo
    visualization: SstSyncVisualizationInfo
    scientificDistinction: str = Field(
        "MUR SST represents ocean surface water temperature (skin/bulk). "
        "GEOS-FP T2M represents atmospheric near-surface air temperature. "
        "Both are NASA Earth-science datasets but measure different Earth-system domains.",
        description="Scientific distinction statement"
    )
