/**
 * vegetationService.js — Phase 8
 *
 * Application-level vegetation (LAI) data service.
 * Fetches real NASA GEOS-FP LAI data from the backend.
 * Mirrors the architecture of windService.js.
 *
 * Architecture:
 *   React UI (ExplorePage)
 *     ↓
 *   vegetationService  (this module)
 *     ↓
 *   vegetationApi
 *     ↓
 *   FastAPI backend (/api/vegetation)
 *     ↓
 *   NASA GEOS-FP OPeNDAP (LAI variable, inst1_2d_lfo_Nx)
 */

import { getVegetationSeries as apiGetVegetationSeries, VegetationApiError } from '../api/vegetationApi.js'

export class VegetationServiceError extends Error {
  constructor(message, code, details = {}) {
    super(message)
    this.name = 'VegetationServiceError'
    this.code = code
    this.details = details
  }
}

// In-memory cache for vegetation datasets
const _vegCache = new Map()
const MAX_CACHE_SIZE = 32

// In-flight promise map for request deduplication
const _inFlightRequests = new Map()

function _evictOldestIfNeeded() {
  if (_vegCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = _vegCache.keys().next().value
    _vegCache.delete(oldestKey)
  }
}

/**
 * Generate synthetic mock vegetation (LAI) data for offline / fallback testing.
 * Simulates a tropical location with moderate-to-high vegetation.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {string[]} timestamps
 * @returns {object} Mock vegetation dataset
 */
function getMockVegetationDataset(latitude, longitude, timestamps = []) {
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

  // Vegetation (LAI) changes very slowly — nearly constant over a day.
  // Dhaka, Bangladesh: tropical vegetation, moderate LAI ~2.5–3.5
  const baseLai = 2.8
  const data = tsList.map((ts, i) => ({
    timestamp: ts,
    lai: baseLai + Math.sin(i * 0.3) * 0.2,  // Very small diurnal variation
  }))

  return {
    source: 'Mock GEOS-FP Vegetation Data',
    dataset: 'mock_inst1_2d_lfo_Nx',
    variable: 'LAI',
    unit: 'm²/m²',
    location: {
      requested: { lat: latitude, lng: longitude },
      grid: { lat: latitude, lng: longitude },
    },
    resolution: {
      spatial: '0.5° x 0.625°',
      temporal: { label: '1-hourly', interval_hours: 1 },
    },
    data,
  }
}

/**
 * Clear the in-memory vegetation cache.
 */
export function clearVegetationCache() {
  _vegCache.clear()
  _inFlightRequests.clear()
}

/**
 * Retrieves vegetation (LAI) time-series data for a given location.
 * Fails independently — errors here do not affect any other layer.
 *
 * @param {number|null} latitude - User-selected latitude
 * @param {number|null} longitude - User-selected longitude
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export async function getVegetationData(latitude, longitude, options = {}) {
  const { provider = 'geosfp', start, end, timestamps } = options

  if (provider === 'mock') {
    return getMockVegetationDataset(latitude, longitude, timestamps)
  }

  const hasCoords =
    typeof latitude === 'number' && !isNaN(latitude) &&
    typeof longitude === 'number' && !isNaN(longitude)

  if (!hasCoords) {
    throw new VegetationServiceError(
      'Valid latitude and longitude are required.',
      'INVALID_COORDINATES',
    )
  }

  const tsKey = timestamps
    ? Array.isArray(timestamps) ? timestamps.join(',') : timestamps
    : ''

  const cacheKey = `${latitude.toFixed(4)}:${longitude.toFixed(4)}:${start || ''}:${end || ''}:${tsKey}`

  if (_vegCache.has(cacheKey)) {
    return _vegCache.get(cacheKey)
  }

  if (_inFlightRequests.has(cacheKey)) {
    return _inFlightRequests.get(cacheKey)
  }

  const fetchPromise = (async () => {
    try {
      const response = await apiGetVegetationSeries(
        latitude,
        longitude,
        start,
        end,
        timestamps,
      )

      const result = {
        source: response.source?.name || 'NASA GEOS-FP',
        dataset: response.source?.dataset || 'GEOS-5/fp/0.5_deg/assim/inst1_2d_lfo_Nx',
        variable: 'LAI',
        unit: 'm²/m²',
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
          lai: pt.lai ?? pt.leaf_area_index ?? null,
        })),
      }

      _evictOldestIfNeeded()
      _vegCache.set(cacheKey, result)
      return result
    } catch (err) {
      if (err instanceof VegetationApiError) {
        throw new VegetationServiceError(err.message, err.code, { status: err.status })
      }
      throw new VegetationServiceError(
        'Vegetation data is temporarily unavailable. Please try again.',
        'NETWORK_ERROR',
      )
    } finally {
      _inFlightRequests.delete(cacheKey)
    }
  })()

  _inFlightRequests.set(cacheKey, fetchPromise)
  return fetchPromise
}
