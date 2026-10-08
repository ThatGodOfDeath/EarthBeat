"""
config.py — Earth Jukebox Backend Configuration

All configurable values are read from environment variables.
Fall back to safe defaults for local development.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # NASA GEOS-FP OPeNDAP endpoints
    nasa_geos_fp_3h_url: str = (
        "https://opendap.nccs.nasa.gov/dods/GEOS-5/"
        "fp/0.25_deg/assim/inst3_2d_asm_Nx"
    )
    nasa_geos_fp_1h_url: str = (
        "https://opendap.nccs.nasa.gov/dods/GEOS-5/"
        "fp/0.25_deg/assim/tavg1_2d_slv_Nx"
    )

    # Active NASA dataset URL (defaults to inst3_2d_asm_Nx for performance & stability)
    nasa_geos_fp_url: str = (
        "https://opendap.nccs.nasa.gov/dods/GEOS-5/"
        "fp/0.25_deg/assim/inst3_2d_asm_Nx"
    )


    # CORS origins allowed to call the backend.
    # Comma-separated list.  Example: "http://localhost:5173,http://localhost:4173"
    cors_origins: str = (
        "http://localhost:5173,"
        "http://localhost:4173,"
        "http://127.0.0.1:5173,"
        "http://127.0.0.1:4173"
    )

    # Backend host / port
    host: str = "127.0.0.1"
    port: int = 8000

    # Maximum number of time-series entries to return in a single request
    max_time_series_points: int = 256

    # Maximum number of global grid timestamps cached in memory
    max_cached_global_grids: int = 32

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the singleton Settings instance (cached after first call)."""
    return Settings()
