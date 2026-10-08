"""
main.py — Earth Jukebox FastAPI Application

Phase 4 backend that serves real NASA GEOS-FP temperature data to the
Earth Jukebox React frontend.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api.routes import temperature, eic_sst, wind, scientific, environment


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup / shutdown hooks."""
    # Nothing to pre-warm on startup; datasets are opened lazily.
    yield
    # Shutdown: close any cached OPeNDAP dataset connections.
    from app.services.nasa.geos_fp import close_dataset
    close_dataset()


app = FastAPI(
    title="Earth Jukebox API",
    description=(
        "Backend data pipeline serving real NASA GEOS-FP 2 m air temperature "
        "(T2M) data to the Earth Jukebox frontend."
    ),
    version="4.0.0",
    lifespan=lifespan,
)

# ── CORS ────────────────────────────────────────────────────────────────────
settings = get_settings()
allowed_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ── Routers ─────────────────────────────────────────────────────────────────
app.include_router(temperature.router, prefix="/api")
app.include_router(scientific.router, prefix="/api")
app.include_router(eic_sst.router, prefix="/api")
app.include_router(wind.router, prefix="/api")
app.include_router(environment.router, prefix="/api")


@app.get("/health", tags=["health"])
def health_check():
    """Simple health-check endpoint."""
    return {"status": "ok", "service": "earth-jukebox-api"}
