/**
 * environmentalApi.js — Phase 9
 *
 * Unified environmental data API client.
 *
 * Retrieves all GEOS-FP environmental variables for a location and time range:
 *   t2m       — 2-metre air temperature (K)
 *   ts        — Surface skin temperature (K)
 *   u10m      — 10-metre eastward wind (m/s)
 *   v10m      — 10-metre northward wind (m/s)
 *   tprecmax  — Total precipitation maximum (kg/m²/s)
 *   tqv       — Total precipitable water vapor (kg/m²)
 *   ps        — Surface pressure (Pa)
 *
 * Backend endpoint: GET /api/environment
 *
 * Architecture:
 *   React (ExplorePage)
 *     ↓
 *   environmentalService.js
 *     ↓
 *   environmentalApi.js  (this file)
 *     ↓
 *   FastAPI backend (/api/environment)
 *     ↓
 *   NASA GEOS-FP OPeNDAP (inst3_2d_asm_Nx)
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'

/**
 * Custom error class for environmental API errors.
 */
export class EnvironmentalApiError extends Error {
  constructor(message, code, status) {
    super(message)
    this.name = 'EnvironmentalApiError'
    this.code = code
    this.httpStatus = status
  }
}

/**
 * Low-level fetch wrapper with error handling and timeout.
 */
async function apiFetch(path, params = {}) {
  const url = new URL(path, BACKEND_URL)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v))
    }
  })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120_000)

  let response
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
  } catch (networkError) {
    if (networkError.name === 'AbortError') {
      throw new EnvironmentalApiError(
        'Request timed out. The requested time range may be too large or the server is busy.',
        'TIMEOUT',
        408,
      )
    }
    throw new EnvironmentalApiError(
      'Cannot reach the Earth Jukebox data server. Please ensure the backend is running.',
      'NETWORK_ERROR',
      0,
    )
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = await response.json()
      detail = body.detail || detail
    } catch { /* ignore parse errors */ }

    if (response.status === 503) {
      throw new EnvironmentalApiError(
        'NASA GEOS-FP data is temporarily unavailable. Please try again later.',
        'NASA_UNAVAILABLE',
        response.status,
      )
    }
    if (response.status === 404) {
      throw new EnvironmentalApiError(
        `No environmental data found: ${detail}`,
        'NO_DATA',
        response.status,
      )
    }
    if (response.status === 422) {
      throw new EnvironmentalApiError(
        `Invalid request: ${detail}`,
        'INVALID_REQUEST',
        response.status,
      )
    }
    throw new EnvironmentalApiError(
      `Data server error: ${detail}`,
      'SERVER_ERROR',
      response.status,
    )
  }

  return response.json()
}

/**
 * Retrieve unified environmental data for a location and date range.
 *
 * Returns all GEOS-FP variables (ts, tqv, tprecmax, ps, u10m, v10m, t2m)
 * aligned to the same timestamps.
 *
 * Expected response shape:
 * {
 *   latitude: number,
 *   longitude: number,
 *   source: { name: string, dataset: string },
 *   resolution: { temporal: { label: string, interval_hours: number } },
 *   location: { requested: {...}, grid: {...} },
 *   data: [
 *     {
 *       timestamp: string (ISO 8601),
 *       t2m: number|null,
 *       ts: number|null,
 *       u10m: number|null,
 *       v10m: number|null,
 *       tprecmax: number|null,
 *       tqv: number|null,
 *       ps: number|null,
 *     }, ...
 *   ]
 * }
 *
 * @param {number} lat      - Latitude
 * @param {number} lon      - Longitude
 * @param {string} start    - ISO 8601 UTC start datetime
 * @param {string} end      - ISO 8601 UTC end datetime
 * @param {string[]|string|null} timestamps - Optional specific timestamps
 * @returns {Promise<EnvironmentalSeriesResponse>}
 */
export async function getEnvironmentalSeries(lat, lon, start, end, timestamps = null) {
  const params = { lat, lon, start, end }
  if (timestamps) {
    params.timestamps = Array.isArray(timestamps) ? timestamps.join(',') : timestamps
  }
  return apiFetch('/api/environment', params)
}
