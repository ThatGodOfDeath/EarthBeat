/**
 * windService.js — Phase 6
 *
 * Application-level wind data service.
 * Fetches real NASA GEOS-FP 10-meter wind data from the backend.
 *
 * Architecture:
 *   React UI (ExplorePage)
 *     ↓
 *   windService  (this module)
 *     ↓
 *   windApi
 *     ↓
 *   FastAPI backend (/api/wind)
 *     ↓
 *   NASA GEOS-FP OPeNDAP (u10m, v10m)
 */

import { getWindSeries as apiGetWindSeries, WindApiError } from '../api/windApi.js'
import {
  calculateWindSpeed,
  calculateWindDirection,
  getCardinalDirection,
} from '../utils/windUtils.js'

export class WindServiceError extends Error {
  constructor(message, code, details = {}) {
    super(message)
    this.name = 'WindServiceError'
    this.code = code
    this.details = details
  }
}

// In-memory cache for wind datasets (keyed by lat:lng:start:end:timestamps)
const _windCache = new Map()
const MAX_CACHE_SIZE = 32

// In-flight promise map for request deduplication
const _inFlightRequests = new Map()

function _evictOldestIfNeeded() {
  if (_windCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = _windCache.keys().next().value
    _windCache.delete(oldestKey)
  }
}

/**
 * Generate synthetic mock wind data for offline / fallback testing.
 */
function getMockWindDataset(latitude, longitude, timestamps = []) {
  const tsList = Array.isArray(timestamps) && timestamps.length > 0
    ? timestamps
    : [
        '2026-10-05T00:00:00Z',
        '2026-10-05T03:00:00Z',
        '2026-10-05T06:00:00Z',
        '2026-10-05T09:00:00Z',
        '2026-10-05T12:00:00Z',
        '2026-10-05T15:00:00Z',
        '2026-10-05T18:00:00Z',
        '2026-10-05T21:00:00Z',
      ]

  const data = tsList.map((ts, i) => {
    // Generate realistic diurnal wind fluctuations
    const angle = (i * Math.PI) / 4
    const u = Math.round((3.2 * Math.cos(angle) + 1.5) * 10) / 10
    const v = Math.round((2.8 * Math.sin(angle) - 0.5) * 10) / 10
    const speed = calculateWindSpeed(u, v)
    const direction = calculateWindDirection(u, v)
    const cardinal = getCardinalDirection(direction)

    return {
      timestamp: ts,
      u10m: u,
      v10m: v,
      speed,
      direction,
      cardinal,
    }
  })

  return {
    source: 'Mock GEOS-FP Wind Data',
    dataset: 'mock_inst3_2d_asm_Nx',
    variable: 'u10m, v10m',
    unit: 'm/s',
    location: {
      requested: { lat: latitude, lng: longitude },
      grid: { lat: latitude, lng: longitude },
    },
    resolution: {
      spatial: '0.25° x 0.3125°',
      temporal: { label: '3-hourly', interval_hours: 3 },
    },
    data,
  }
}

/**
 * Clear the in-memory wind cache.
 */
export function clearWindCache() {
  _windCache.clear()
  _inFlightRequests.clear()
}

/**
 * Retrieves wind time-series data for a given location.
 *
 * @param {number|null} latitude - User-selected latitude
 * @param {number|null} longitude - User-selected longitude
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export async function getWindData(latitude, longitude, options = {}) {
  const { provider = 'geosfp', start, end, timestamps } = options

  if (provider === 'mock') {
    return getMockWindDataset(latitude, longitude, timestamps)
  }

  const hasCoords =
    typeof latitude === 'number' && !isNaN(latitude) &&
    typeof longitude === 'number' && !isNaN(longitude)

  if (!hasCoords) {
    throw new WindServiceError(
      'Valid latitude and longitude are required.',
      'INVALID_COORDINATES',
    )
  }

  const tsKey = timestamps
    ? Array.isArray(timestamps) ? timestamps.join(',') : timestamps
    : ''

  const cacheKey = `${latitude.toFixed(4)}:${longitude.toFixed(4)}:${start || ''}:${end || ''}:${tsKey}`

  if (_windCache.has(cacheKey)) {
    return _windCache.get(cacheKey)
  }

  if (_inFlightRequests.has(cacheKey)) {
    return _inFlightRequests.get(cacheKey)
  }

  const fetchPromise = (async () => {
    try {
      const response = await apiGetWindSeries(
        latitude,
        longitude,
        start,
        end,
        timestamps,
      )

      const result = {
        source: response.source?.name || 'NASA GEOS-FP',
        dataset: response.source?.dataset || 'GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx',
        variable: 'u10m, v10m',
        unit: 'm/s',
        location: {
          requested: { lat: latitude, lng: longitude },
          grid: {
            lat: response.location?.grid?.latitude ?? latitude,
            lng: response.location?.grid?.longitude ?? longitude,
          },
        },
        resolution: response.resolution,
        data: (response.data || []).map((pt) => ({
          timestamp: pt.timestamp,
          u10m: pt.u10m,
          v10m: pt.v10m,
          speed: pt.speed,
          direction: pt.direction,
          cardinal: pt.cardinal,
        })),
      }

      _evictOldestIfNeeded()
      _windCache.set(cacheKey, result)
      return result
    } catch (err) {
      if (err instanceof WindApiError) {
        throw new WindServiceError(err.message, err.code, { status: err.status })
      }
      throw new WindServiceError(
        'Wind data is temporarily unavailable. Please try again.',
        'NETWORK_ERROR',
      )
    } finally {
      _inFlightRequests.delete(cacheKey)
    }
  })()

  _inFlightRequests.set(cacheKey, fetchPromise)
  return fetchPromise
}
