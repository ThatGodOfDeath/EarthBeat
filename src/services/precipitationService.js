/**
 * precipitationService.js — Phase 8
 *
 * Application-level precipitation data service.
 * Fetches real NASA GEOS-FP PRECTOT data from the backend.
 * Mirrors the architecture of windService.js.
 *
 * Architecture:
 *   React UI (ExplorePage)
 *     ↓
 *   precipitationService  (this module)
 *     ↓
 *   precipitationApi
 *     ↓
 *   FastAPI backend (/api/precipitation)
 *     ↓
 *   NASA GEOS-FP OPeNDAP (PRECTOT variable, inst3_2d_asm_Nx)
 */

import { getPrecipitationSeries as apiGetPrecipitationSeries, PrecipitationApiError } from '../api/precipitationApi.js'

export class PrecipitationServiceError extends Error {
  constructor(message, code, details = {}) {
    super(message)
    this.name = 'PrecipitationServiceError'
    this.code = code
    this.details = details
  }
}

// In-memory cache for precipitation datasets
const _precipCache = new Map()
const MAX_CACHE_SIZE = 32

// In-flight promise map for request deduplication
const _inFlightRequests = new Map()

function _evictOldestIfNeeded() {
  if (_precipCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = _precipCache.keys().next().value
    _precipCache.delete(oldestKey)
  }
}

/**
 * Generate synthetic mock precipitation data for offline / fallback testing.
 * Simulates a range from dry → light → moderate rain over a day.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {string[]} timestamps
 * @returns {object} Mock precipitation dataset
 */
function getMockPrecipitationDataset(latitude, longitude, timestamps = []) {
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

  // Simulate diurnal precipitation pattern: dry in morning, rain in afternoon
  // Values in kg/m²/s: 0 (dry) → ~0.0005 (moderate rain)
  const precipPatterns = [0, 0, 0.00002, 0.0001, 0.0003, 0.0005, 0.00025, 0.0001]

  const data = tsList.map((ts, i) => ({
    timestamp: ts,
    prectot: precipPatterns[i % precipPatterns.length],
  }))

  return {
    source: 'Mock GEOS-FP Precipitation Data',
    dataset: 'mock_inst3_2d_asm_Nx',
    variable: 'PRECTOT',
    unit: 'kg/m²/s',
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
 * Clear the in-memory precipitation cache.
 */
export function clearPrecipitationCache() {
  _precipCache.clear()
  _inFlightRequests.clear()
}

/**
 * Retrieves precipitation time-series data for a given location.
 * Fails independently — errors here do not affect temperature, wind, or vegetation.
 *
 * @param {number|null} latitude - User-selected latitude
 * @param {number|null} longitude - User-selected longitude
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export async function getPrecipitationData(latitude, longitude, options = {}) {
  const { provider = 'geosfp', start, end, timestamps } = options

  if (provider === 'mock') {
    return getMockPrecipitationDataset(latitude, longitude, timestamps)
  }

  const hasCoords =
    typeof latitude === 'number' && !isNaN(latitude) &&
    typeof longitude === 'number' && !isNaN(longitude)

  if (!hasCoords) {
    throw new PrecipitationServiceError(
      'Valid latitude and longitude are required.',
      'INVALID_COORDINATES',
    )
  }

  const tsKey = timestamps
    ? Array.isArray(timestamps) ? timestamps.join(',') : timestamps
    : ''

  const cacheKey = `${latitude.toFixed(4)}:${longitude.toFixed(4)}:${start || ''}:${end || ''}:${tsKey}`

  if (_precipCache.has(cacheKey)) {
    return _precipCache.get(cacheKey)
  }

  if (_inFlightRequests.has(cacheKey)) {
    return _inFlightRequests.get(cacheKey)
  }

  const fetchPromise = (async () => {
    try {
      const response = await apiGetPrecipitationSeries(
        latitude,
        longitude,
        start,
        end,
        timestamps,
      )

      const result = {
        source: response.source?.name || 'NASA GEOS-FP',
        dataset: response.source?.dataset || 'GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx',
        variable: 'PRECTOT',
        unit: 'kg/m²/s',
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
          prectot: pt.prectot ?? pt.precipitation ?? null,
        })),
      }

      _evictOldestIfNeeded()
      _precipCache.set(cacheKey, result)
      return result
    } catch (err) {
      if (err instanceof PrecipitationApiError) {
        throw new PrecipitationServiceError(err.message, err.code, { status: err.status })
      }
      throw new PrecipitationServiceError(
        'Precipitation data is temporarily unavailable. Please try again.',
        'NETWORK_ERROR',
      )
    } finally {
      _inFlightRequests.delete(cacheKey)
    }
  })()

  _inFlightRequests.set(cacheKey, fetchPromise)
  return fetchPromise
}
