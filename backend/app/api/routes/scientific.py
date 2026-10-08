"""
scientific.py — Generic Scientific Data API Routes

Provides centralized endpoints for all GEOS-FP variables (T2M, TS, PS, WIND, etc.).
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import Settings, get_settings
from app.schemas.scientific import GlobalScientificResponse
from app.services import scientific as sci_svc
from app.services import temperature as temp_svc

router = APIRouter(prefix="/scientific", tags=["scientific"])


def _parse_dt(value: str, param_name: str) -> datetime:
    """Parse an ISO 8601 datetime string and ensure it is UTC-aware."""
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid datetime format for '{param_name}'. Use ISO 8601, e.g. 2026-09-29T00:00:00Z",
        )


@router.get("/global", response_model=GlobalScientificResponse)
async def get_global_grid(
    time: Annotated[str, Query(description="Timestamp (ISO 8601 UTC)")],
    settings: Annotated[Settings, Depends(get_settings)],
    variable: Annotated[str, Query(description="Variable identifier (T2M, TS, PS, U10M, V10M, WIND)")] = "T2M",
):
    """
    Retrieve a downsampled 360×180 global grid for the specified variable and timestamp.
    Supported variables: T2M, TS, PS, U10M, V10M, WIND.
    """
    ts = _parse_dt(time, "time")
    v_clean = variable.strip().upper()
    allowed_vars = {"T2M", "TS", "PS", "U10M", "V10M", "WIND", "TPRECMAX", "TQV"}
    if v_clean not in allowed_vars:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid variable '{variable}'. Allowed variables: {', '.join(sorted(allowed_vars))}",
        )

    try:
        return await sci_svc.get_global_grid(v_clean, ts, settings)
    except temp_svc.NasaDataUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except temp_svc.NoDataInRangeError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"An internal error occurred while retrieving global grid for {variable}.",
        ) from exc
