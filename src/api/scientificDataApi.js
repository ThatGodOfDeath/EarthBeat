/**
 * scientificDataApi.js — Frontend API client for global scientific data
 *
 * Centralized client for fetching global downsampled grids across GEOS-FP variables:
 *   - T2M (2 m air temperature)
 *   - TS (surface skin temperature)
 *   - PS (surface pressure)
 *   - WIND (10 m wind speed & vector fields)
 */

const BACKEND_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || 'http://127.0.0.1:8000'

export class ScientificApiError extends Error {
  constructor(message, code, status) {
    super(message)
    this.name = 'ScientificApiError'
    this.code = code
    this.status = status
  }
}

async function apiFetch(path, params = {}, signal = null) {
  const url = new URL(path, BACKEND_URL)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, String(v))
    }
  })

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60_000)

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId)
      throw new DOMException('Aborted', 'AbortError')
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  let response
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
  } catch (networkError) {
    if (signal?.aborted) {
      throw networkError
    }
    if (networkError.name === 'AbortError') {
      throw new ScientificApiError(
        'Request timed out. Server is busy or time range is too large.',
        'TIMEOUT',
        408,
      )
    }
    throw new ScientificApiError(
      'Cannot reach the Earth Jukebox data server. Backend may be offline.',
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
      throw new ScientificApiError(
        'NASA GEOS-FP data is temporarily unavailable.',
        'NASA_UNAVAILABLE',
        response.status,
      )
    }
    if (response.status === 404) {
      throw new ScientificApiError(`No data found: ${detail}`, 'NO_DATA', response.status)
    }
    if (response.status === 422) {
      throw new ScientificApiError(`Invalid request: ${detail}`, 'INVALID_REQUEST', response.status)
    }
    throw new ScientificApiError(`Server error: ${detail}`, 'SERVER_ERROR', response.status)
  }

  return response.json()
}

/**
 * Retrieve a global 360×180 grid for a specific variable and timestamp.
 * Tries /api/scientific/global first; falls back to /api/temperature/global if T2M.
 *
 * @param {string} variable - 'T2M', 'TS', 'PS', or 'WIND'
 * @param {string} time - ISO 8601 UTC timestamp
 * @param {object} [options={}] - Options including optional signal for cancellation
 * @returns {Promise<object>}
 */
export async function getGlobalScientificGrid(variable, time, options = {}) {
  const v = (variable || 'T2M').toUpperCase()
  const signal = options?.signal ?? null
  try {
    return await apiFetch('/api/scientific/global', { variable: v, time }, signal)
  } catch (err) {
    if (signal?.aborted) throw err
    // If /api/scientific/global is not yet mounted on an older server instance,
    // fallback to /api/temperature/global for T2M or with variable parameter
    if (err.status === 404 || err.code === 'NETWORK_ERROR') {
      return apiFetch('/api/temperature/global', { time, variable: v }, signal)
    }
    throw err
  }
}
