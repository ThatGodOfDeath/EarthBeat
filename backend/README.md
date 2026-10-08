# Earth Jukebox Backend — Phase 4.1

The Earth Jukebox backend is a **FastAPI** Python service acting as the data pipeline between the React frontend and the **NASA GEOS-FP** OPeNDAP dataset.

## Architecture

```
NASA GEOS-FP OPeNDAP
        │
        │ (xarray / netCDF4 with remote strided slicing)
        ▼
┌──────────────────────────────────────────────┐
│  BACKEND (FastAPI / Python)                  │
│                                              │
│  geos_fp.py (NASA service)                   │
│  ├── Open dataset (reused handle with retry) │
│  ├── Nearest-neighbor sel.                   │
│  ├── K → °C conversion                       │
│  ├── Temporal res. detection (3-hourly)      │
│  └── Remote strided reduction (~94% payload) │
│                                              │
│  temperature.py (app svc)                    │
│  ├── In-memory LRU cache (series & global)   │
│  └── Performance timing logging              │
│                                              │
│  routes/temperature.py                       │
│  ├── GET /api/temperature                    │
│  ├── GET /api/temperature/global             │
│  └── GET /api/temperature/metadata           │
└──────────────────────┬───────────────────────┘
                       │ JSON
                       ▼
             React Frontend (Vite)
             ├── Deduped in-flight request map
             ├── Local memory cache
             ├── Progressive single-frame prefetch
             └── Separated local / global loading
```

## NASA Dataset & Evaluation

| Property | Active Dataset: `inst3_2d_asm_Nx` | Evaluated Hourly: `tavg1_2d_slv_Nx` |
|---|---|---|
| Source | NASA GEOS-FP Assimilated State | NASA GEOS-FP 1-Hour Average Surface |
| Variable | `t2m` (2 m air temperature) | `t2m` (2 m air temperature) |
| Native Spatial Grid | 721 × 1152 (~0.25° × ~0.3125°) | 721 × 1152 (~0.25° × ~0.3125°) |
| Temporal Resolution | **3-hourly** (180 minutes) | **1-hourly** (60 minutes) |
| Remote Open Latency | ~7.5s | ~35.2s (77,553 time slices) |
| Frame Fetch Latency | ~4.9s | ~10.6s |
| Decision | **Retained for Production** | Evaluated (deferred due to 4x latency) |


> ⚠️ **Important:** The current GEOS-FP dataset exposes **3-hourly** observations.
> The backend inspects and derives this dynamically from the dataset's time coordinate.
> It does **not** fabricate or interpolate hourly data.

## Installation

### Prerequisites

- Python 3.10+
- `pip`

### Steps

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
copy .env.example .env
```

## Running the Backend

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

The API will be available at: `http://127.0.0.1:8000`

## Running Frontend + Backend Together

**Terminal 1 — Backend:**
```bash
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2 — Frontend:**
```bash
npm run dev
```

The frontend Vite dev server runs at `http://localhost:5173`. CORS is preconfigured for this origin.

## API Endpoints

### 1. Health Check
`GET /health`
```json
{"status": "ok", "service": "earth-jukebox-api"}
```

### 2. Local Temperature Time Series
`GET /api/temperature?lat=23.8103&lon=90.4125&start=2026-09-29T00:00:00Z&end=2026-09-30T21:00:00Z`

Response format:
```json
{
  "source": {
    "name": "NASA GEOS-FP",
    "dataset": "GEOS5 FP 2d assimilated state (inst3_2d_asm_Nx)",
    "variable": "t2m",
    "variableName": "2 m air temperature",
    "unit": "°C"
  },
  "location": {
    "requested": { "latitude": 23.8103, "longitude": 90.4125 },
    "grid": { "latitude": 23.75, "longitude": 90.3125 }
  },
  "resolution": {
    "spatial": { "latitude": 0.25, "longitude": 0.3125 },
    "temporal": { "minutes": 180, "label": "3-hourly" }
  },
  "data": [
    { "timestamp": "2026-09-29T00:00:00Z", "temperature": 25.11 },
    { "timestamp": "2026-09-29T03:00:00Z", "temperature": 29.76 }
  ]
}
```

### 3. Global Temperature Grid
`GET /api/temperature/global?time=2026-09-30T15:00:00Z`

Returns a downsampled 360×180 (1° per cell) global raster grid matching the frontend canvas renderer.
Values are row-major (°C), with row 0 = 90°N.

### 4. Dataset Metadata
`GET /api/temperature/metadata`

Returns dataset metadata, spatial and temporal resolutions.

## Caching

- **Local Time Series:** In-memory LRU cache keyed by `lat:lon:start:end` (capacity: 64 entries).
- **Global Grid:** In-memory LRU cache keyed by observation `timestamp` (capacity: 32 entries).
- **Dataset Connection:** Reused across requests, closed on application shutdown.

## Unit Conversion

```
temperature_C = temperature_K - 273.15
```

## Running Tests

### Unit tests (offline / mocked):
```bash
cd backend
python -m unittest tests/test_unit.py
```

### Integration tests (live NASA OPeNDAP):
```bash
cd backend
python -m unittest tests/test_integration.py
```
