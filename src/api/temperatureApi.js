/**
 * temperatureApi.js — Earth Jukebox Frontend API Service
 *
 * Centralised data-access layer for temperature data.
 * All HTTP requests to the backend go through this module.
 *
 * Architecture:
 *   React component/hook
 *     ↓
 *   temperatureApi (this module)
 *     ↓
 *   Earth Jukebox backend (FastAPI)
 *     ↓
 *   NASA GEOS-FP OPeNDAP
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'

/**
 * Custom error class for frontend API errors.
 */
export class TemperatureApiError extends Error {
  constructor(message, code, status) {
    super(message)
    this.name = 'TemperatureApiError'
    this.code = code
    this.httpStatus = status
  }
}

/**
 * Low-level fetch wrapper with error handling.
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
      throw new TemperatureApiError(
        'Request timed out. The requested time range may be too large or the server is busy.',
        'TIMEOUT',
        408,
      )
    }
    throw new TemperatureApiError(
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
      throw new TemperatureApiError(
        'NASA data is temporarily unavailable. Please try again later.',
        'NASA_UNAVAILABLE',
        response.status,
      )
    }
    if (response.status === 404) {
      throw new TemperatureApiError(
        `No temperature data found: ${detail}`,
        'NO_DATA',
        response.status,
      )
    }
    if (response.status === 422) {
      throw new TemperatureApiError(
        `Invalid request: ${detail}`,
        'INVALID_REQUEST',
        response.status,
      )
    }
    throw new TemperatureApiError(
      `Data server error: ${detail}`,
      'SERVER_ERROR',
      response.status,
    )
  }

  return response.json()
}

/**
 * Retrieve a T2M temperature time series for a location and date range.
 *
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} start - ISO 8601 UTC start datetime
 * @param {string} end - ISO 8601 UTC end datetime
 * @param {string[]|string|null} timestamps - Optional specific timestamps to fetch
 * @returns {Promise<TemperatureSeriesResponse>}
 */
export async function getTemperatureSeries(lat, lon, start, end, timestamps = null) {
  const params = { lat, lon, start, end }
  if (timestamps) {
    params.timestamps = Array.isArray(timestamps) ? timestamps.join(',') : timestamps
  }
  return apiFetch('/api/temperature', params)
}

/**
 * Retrieve a downsampled global T2M grid for a specific timestamp.
 *
 * @param {string} time - ISO 8601 UTC timestamp
 * @returns {Promise<GlobalTemperatureResponse>}
 */
export async function getGlobalTemperature(time) {
  return apiFetch('/api/temperature/global', { time })
}

/**
 * Retrieve dataset metadata (source, resolution, temporal info).
 *
 * @returns {Promise<TemperatureMetadataResponse>}
 */
export async function getTemperatureMetadata() {
  return apiFetch('/api/temperature/metadata')
}

/**
 * Check whether the backend is reachable.
 * Returns true if healthy, false otherwise.
 *
 * @returns {Promise<boolean>}
 */
export async function checkBackendHealth() {
  try {
    const data = await apiFetch('/health')
    return data?.status === 'ok'
  } catch {
    return false
  }
}
