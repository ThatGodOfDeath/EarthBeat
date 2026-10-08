/**
 * windApi.js — Wind API Client
 *
 * Dedicated client for NASA GEOS-FP 10-meter wind data.
 * Follows temperatureApi error handling, AbortController timeouts,
 * and response structure.
 */

const BACKEND_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || 'http://127.0.0.1:8000'

export class WindApiError extends Error {
  constructor(message, code, status) {
    super(message)
    this.name = 'WindApiError'
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
      throw new WindApiError(
        'Request timed out. The requested time range may be too large or the server is busy.',
        'TIMEOUT',
        408,
      )
    }
    throw new WindApiError(
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
      throw new WindApiError(
        'NASA wind data is temporarily unavailable. Please try again later.',
        'NASA_UNAVAILABLE',
        response.status,
      )
    }
    if (response.status === 404) {
      throw new WindApiError(
        `No wind data found: ${detail}`,
        'NO_DATA',
        response.status,
      )
    }
    if (response.status === 422) {
      throw new WindApiError(
        `Invalid request: ${detail}`,
        'INVALID_REQUEST',
        response.status,
      )
    }
    throw new WindApiError(
      `Data server error: ${detail}`,
      'SERVER_ERROR',
      response.status,
    )
  }

  return response.json()
}

/**
 * Retrieve a 10-meter wind time series for a location and date range.
 *
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} start - ISO 8601 UTC start datetime
 * @param {string} end - ISO 8601 UTC end datetime
 * @param {string[]|string|null} timestamps - Optional specific timestamps to fetch
 * @returns {Promise<object>}
 */
export async function getWindSeries(lat, lon, start, end, timestamps = null) {
  const params = { lat, lon, start, end }
  if (timestamps) {
    params.timestamps = Array.isArray(timestamps) ? timestamps.join(',') : timestamps
  }
  return apiFetch('/api/wind', params)
}

/**
 * Retrieve wind dataset metadata.
 */
export async function getWindMetadata() {
  return apiFetch('/api/wind/metadata')
}
