"""
eic_sst.py — NASA EIC / SVS Sea Surface Temperature (SST) #5101 API Routes

Endpoints:
  GET /api/eic/sst/metadata  — Returns SVS #5101 visualization metadata
  GET /api/eic/sst/frame     — Returns frame metadata and URL for requested date
  GET /api/eic/sst/sync      — Returns GEOS-FP synchronization metadata for calendar day
  GET /api/eic/sst/preview   — Serves a 1024x512 JPEG preview for web browser display
"""
from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
import io

from app.schemas.eic_sst import (
    SstFrameResponse,
    SstMetadataResponse,
    SstSyncResponse,
)
from app.services.nasa import eic_sst as sst_svc

router = APIRouter(prefix="/eic/sst", tags=["eic-sst"])


def _parse_date(date_str: str) -> date:
    """Parse YYYY-MM-DD string into a datetime.date object."""
    try:
        return date.fromisoformat(date_str.strip())
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid date format '{date_str}'. Expected ISO 8601 YYYY-MM-DD.",
        )


@router.get("/metadata", response_model=SstMetadataResponse)
def get_sst_metadata():
    """
    Retrieve NASA SVS #5101 Sea Surface Temperature visualization metadata.
    Provides authoritative frame count, available date range, and resolution.
    """
    return sst_svc.get_sst_metadata()


@router.get("/frame", response_model=SstFrameResponse)
def get_sst_frame(
    request: Request,
    date: Annotated[str, Query(description="Target date in YYYY-MM-DD format")],
):
    """
    Retrieve NASA SST frame information for a specific calendar date.
    Returns the authoritative NASA SVS asset URL, frame number, and nearest date if out of bounds.
    """
    parsed_date = _parse_date(date)
    base_url = str(request.base_url)
    return sst_svc.get_sst_frame_info(parsed_date, request_base_url=base_url)


@router.get("/sync", response_model=SstSyncResponse)
def get_sst_sync(
    date: Annotated[str, Query(description="Target SST calendar date in YYYY-MM-DD format")],
):
    """
    Retrieve synchronization metadata mapping the SST daily visualization frame
    to the active NASA GEOS-FP atmospheric temperature observations for that calendar day.
    """
    parsed_date = _parse_date(date)
    return sst_svc.get_geos_fp_sync(parsed_date)


@router.get("/preview")
def get_sst_preview(
    date: Annotated[str, Query(description="Target date in YYYY-MM-DD format")],
):
    """
    Return a downsampled (1024x512) JPEG preview of the NASA SVS OpenEXR frame.
    Allows web browsers to visually render the high-resolution HDR frame.
    """
    parsed_date = _parse_date(date)
    try:
        jpeg_bytes = sst_svc.generate_frame_preview(parsed_date)
        return Response(content=jpeg_bytes, media_type="image/jpeg")
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to generate NASA SST preview: {str(exc)}",
        )
