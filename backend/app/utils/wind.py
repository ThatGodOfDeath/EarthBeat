"""
wind.py — NASA GEOS-FP 10-meter wind physics calculations.

Conventions & Formulations:
  - u10m: Eastward 10-meter wind component in m/s (positive = wind blowing toward East)
  - v10m: Northward 10-meter wind component in m/s (positive = wind blowing toward North)
  - Wind speed: sqrt(u² + v²) in m/s

Meteorological Wind Direction:
  - Direction FROM which the wind originates.
  - 0° = North, 90° = East, 180° = South, 270° = West.
  - Calculated as: (atan2(-u, -v) * 180 / π) mod 360
  - Zero wind (u=0, v=0): Direction is undefined (None / "Calm").
"""
from __future__ import annotations

import math
from typing import Optional


COMPASS_16 = [
    ("N", 348.75, 360.0),
    ("N", 0.0, 11.25),
    ("NNE", 11.25, 33.75),
    ("NE", 33.75, 56.25),
    ("ENE", 56.25, 78.75),
    ("E", 78.75, 101.25),
    ("ESE", 101.25, 123.75),
    ("SE", 123.75, 146.25),
    ("SSE", 146.25, 168.75),
    ("S", 168.75, 191.25),
    ("SSW", 191.25, 213.75),
    ("SW", 213.75, 236.25),
    ("WSW", 236.25, 258.75),
    ("W", 258.75, 281.25),
    ("WNW", 281.25, 303.75),
    ("NW", 303.75, 326.25),
    ("NNW", 326.25, 348.75),
]


def calculate_wind_speed(u: float, v: float) -> float:
    """
    Calculate 10-meter wind speed from eastward (u) and northward (v) components.

    Formula: speed = sqrt(u² + v²)

    Args:
        u: Eastward wind component in m/s
        v: Northward wind component in m/s

    Returns:
        Wind speed in m/s rounded to 2 decimal places.
        Returns 0.0 if both u and v are NaN or zero.
    """
    if u is None or v is None or math.isnan(u) or math.isnan(v):
        return 0.0
    speed = math.hypot(u, v)
    return round(speed, 2)


def calculate_wind_direction(u: float, v: float) -> Optional[float]:
    """
    Calculate meteorological wind direction (direction FROM which the wind blows) in degrees.

    Convention:
        - 0° = North (wind blowing from North toward South)
        - 90° = East (wind blowing from East toward West)
        - 180° = South (wind blowing from South toward North)
        - 270° = West (wind blowing from West toward East)
        - Calm (speed == 0): None

    Mathematical formulation:
        Since u is eastward (blowing TO east) and v is northward (blowing TO north),
        the vector pointing FROM where the wind came is (-u, -v).
        Direction in degrees clockwise from North:
            (atan2(-u, -v) * 180 / π) % 360

    Returns:
        Direction in degrees [0, 360) rounded to 1 decimal place, or None if speed is 0 or NaN.
    """
    if u is None or v is None or math.isnan(u) or math.isnan(v):
        return None

    # Zero wind (calm) check
    if abs(u) < 1e-6 and abs(v) < 1e-6:
        return None

    deg = math.degrees(math.atan2(-u, -v)) % 360.0
    return round(deg, 1)


def get_cardinal_direction(deg: Optional[float]) -> str:
    """
    Convert meteorological wind direction in degrees to a 16-point cardinal string.
    Returns "Calm" if deg is None.
    """
    if deg is None or math.isnan(deg):
        return "Calm"

    deg_norm = deg % 360.0
    for label, low, high in COMPASS_16:
        if low <= deg_norm < high or (high == 360.0 and deg_norm == 360.0):
            return label
    return "N"
