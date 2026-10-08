/**
 * vegetationApi.js — Phase 8
 *
 * Frontend API client for NASA GEOS-FP vegetation (LAI) data.
 * Follows the same pattern as windApi.js and temperatureApi.js.
 *
 * Backend endpoint: GET /api/vegetation
 * Variable: LAI (Leaf Area Index, m²/m²)
 * Dataset: NASA GEOS-FP inst1_2d_lfo_Nx (land surface variables)
 *   LAI is a land surface output variable available at 1-hourly temporal resolution.
 *   Range: 0.0 (bare soil/water) to ~8.0 (dense tropical canopy).
 */

const BACKEND_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || 'http://127.0.0.1:8000'

export class VegetationApiError extends Error {
  constructor(message, code, status) {
    super(message)
    this.name = 'VegetationApiError'
    this.code = code
    this.status = status
  }
}

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
      throw new VegetationApiError(
        'Request timed out. The requested time range may be too large or the server is busy.',
        'TIMEOUT',
        408,
      )
    }
    throw new VegetationApiError(
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
    } catch { /* ignore parse error */ }

    if (response.status === 503) {
      throw new VegetationApiError(
        'NASA vegetation data is temporarily unavailable. Please try again later.',
        'NASA_UNAVAILABLE',
        response.status,
      )
    }
    if (response.status === 404) {
      throw new VegetationApiError(
        `No vegetation data found: ${detail}`,
        'NO_DATA',
        response.status,
      )
    }
    if (response.status === 422) {
      throw new VegetationApiError(
        `Invalid request: ${detail}`,
        'INVALID_REQUEST',
        response.status,
      )
    }
    throw new VegetationApiError(
      `Data server error: ${detail}`,
      'SERVER_ERROR',
      response.status,
    )
  }

  return response.json()
}

/**
 * Retrieve a LAI (Leaf Area Index) time series for a location and date range.
 *
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} start - ISO 8601 UTC start datetime
 * @param {string} end - ISO 8601 UTC end datetime
 * @param {string[]|string|null} timestamps - Optional specific timestamps to fetch
 * @returns {Promise<object>}
 */
export async function getVegetationSeries(lat, lon, start, end, timestamps = null) {
  const params = { lat, lon, start, end }
  if (timestamps) {
    params.timestamps = Array.isArray(timestamps) ? timestamps.join(',') : timestamps
  }
  return apiFetch('/api/vegetation', params)
}
