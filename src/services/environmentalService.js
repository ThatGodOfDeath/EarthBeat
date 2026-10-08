/**
 * environmentalService.js — Phase 9
 *
 * Unified GEOS-FP environmental data service.
 *
 * Provides ts, tqv, tprecmax, and ps for each active timestamp.
 * t2m and wind (u10m, v10m) continue to be fetched by their own services
 * for backward compatibility with existing temperature/wind sonification.
 *
 * Architecture:
 *   React UI (ExplorePage)
 *     ↓
 *   environmentalService  (this module)
 *     ↓
 *   environmentalApi  → FastAPI /api/environment
 *     ↓
 *   NASA GEOS-FP OPeNDAP (inst3_2d_asm_Nx)
 *
 * Failure isolation:
 *   Individual variables may be null in the response.
 *   A missing ts/tqv/tprecmax/ps does NOT break temperature or wind.
 *   Each variable is independently null-safe.
 *
 * Mock data (for provider === 'mock'):
 *   Generates realistic diurnal patterns for Dhaka-like tropical location:
 *   - ts: t2m + 3–8°C (solar heating effect)
 *   - tqv: 45–55 kg/m² (humid tropical)
 *   - tprecmax: mostly 0, occasional monsoon rain spikes
 *   - ps: ~100000 Pa (sea-level city, slight diurnal variation)
 */

import {
  getEnvironmentalSeries,
  EnvironmentalApiError,
} from '../api/environmentalApi.js'

export class EnvironmentalServiceError extends Error {
  constructor(message, code, details = {}) {
    super(message)
    this.name = 'EnvironmentalServiceError'
    this.code = code
    this.details = details
  }
}

// LRU cache keyed by lat:lng:start:end:timestamps
const _envCache = new Map()
const MAX_CACHE_SIZE = 32

// In-flight request deduplication
const _inFlightRequests = new Map()

function _evictOldestIfNeeded() {
  if (_envCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = _envCache.keys().next().value
    _envCache.delete(oldestKey)
  }
}

// ── Mock data generator ──────────────────────────────────────────────────────

/**
 * Generates synthetic but meteorologically plausible mock environmental data.
 * Based on a tropical near-sea-level location (Dhaka-like).
 */
function getMockEnvironmentalDataset(latitude, longitude, timestamps = []) {
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
    // Hour-of-day cycle for diurnal patterns
    const hourZ = new Date(ts).getUTCHours()
    const dayFrac = hourZ / 24.0                     // 0–1 over a day
    const sunAngle = Math.sin((dayFrac - 0.25) * 2 * Math.PI)   // peaks at noon UTC

    // t2m: near-surface air temperature (°C, roughly Dhaka tropical)
    const t2m = 29 + 4 * sunAngle + 0.5 * (i % 3 - 1)

    // ts: surface skin — warms faster, cools faster than air
    const solarLoading = Math.max(0, sunAngle)        // only positive solar
    const skinTemp = t2m + 3.5 + 6.0 * solarLoading  // 3.5–9.5°C warmer in sun

    // tqv: total precipitable water vapor (kg/m²) — humid tropical
    const tqv = 48 + 6 * sunAngle * 0.3 + 2 * Math.sin(i * 0.7)  // 45–54 kg/m²

    // tprecmax: rain — mostly zero, occasional intense burst (afternoon convection)
    let tprecmax = 0
    if (hourZ >= 13 && hourZ <= 17 && (i % 5 === 2 || i % 7 === 1)) {
      tprecmax = 0.00003 + 0.00005 * Math.random()   // ~108–288 mm/hr
    }

    // ps: surface pressure (Pa) — near sea level, slight diurnal tide (~1 hPa)
    const ps = 100250 + 70 * Math.sin((dayFrac - 0.25) * 4 * Math.PI)

    return {
      timestamp: ts,               // ts here is the outer map param (ISO timestamp string)
      t2m: Math.round(t2m * 100) / 100,
      ts: Math.round(skinTemp * 100) / 100,   // surface skin temp stored as 'ts' field
      tqv: Math.round(tqv * 100) / 100,
      tprecmax: tprecmax > 0 ? Math.round(tprecmax * 1e7) / 1e7 : 0,
      ps: Math.round(ps * 10) / 10,
    }
  })

  return {
    source: 'Mock GEOS-FP Environmental Data',
    dataset: 'mock_inst3_2d_asm_Nx',
    location: {
      requested: { lat: latitude, lng: longitude },
      grid: { lat: latitude, lng: longitude },
    },
    resolution: {
      spatial: '0.25° × 0.3125°',
      temporal: { label: '3-hourly (mock)', interval_hours: 3 },
    },
    data,
  }
}

/**
 * Clear the in-memory environmental cache.
 */
export function clearEnvironmentalCache() {
  _envCache.clear()
  _inFlightRequests.clear()
}

/**
 * Retrieve unified environmental data for a location.
 *
 * Each data point has: { timestamp, ts, tqv, tprecmax, ps }
 * Any variable may be null if unavailable for that timestamp.
 *
 * @param {number|null} latitude
 * @param {number|null} longitude
 * @param {object} [options={}]
 * @param {string} [options.provider='geosfp']
 * @param {string} [options.start]
 * @param {string} [options.end]
 * @param {string[]} [options.timestamps]
 * @returns {Promise<EnvironmentalDataset>}
 */
export async function getEnvironmentalData(latitude, longitude, options = {}) {
  const { provider = 'geosfp', start, end, timestamps } = options

  if (provider === 'mock') {
    return getMockEnvironmentalDataset(latitude, longitude, timestamps)
  }

  const hasCoords =
    typeof latitude === 'number' && !isNaN(latitude) &&
    typeof longitude === 'number' && !isNaN(longitude)

  if (!hasCoords) {
    throw new EnvironmentalServiceError(
      'Valid latitude and longitude are required.',
      'INVALID_COORDINATES',
    )
  }

  const tsKey = timestamps
    ? Array.isArray(timestamps) ? timestamps.join(',') : timestamps
    : ''

  const cacheKey = `${latitude.toFixed(4)}:${longitude.toFixed(4)}:${start || ''}:${end || ''}:${tsKey}`

  if (_envCache.has(cacheKey)) {
    return _envCache.get(cacheKey)
  }

  if (_inFlightRequests.has(cacheKey)) {
    return _inFlightRequests.get(cacheKey)
  }

  const fetchPromise = (async () => {
    try {
      const response = await getEnvironmentalSeries(latitude, longitude, start, end, timestamps)

      const result = {
        source: response.source?.name || 'NASA GEOS-FP',
        dataset: response.source?.dataset || 'GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx',
        location: {
          requested: { lat: latitude, lng: longitude },
          grid: {
            lat: response.location?.grid?.latitude ?? latitude,
            lng: response.location?.grid?.longitude ?? longitude,
          },
        },
        resolution: response.resolution,
        // Normalize each point — null-safe for each variable
        data: (response.data || []).map((pt) => ({
          timestamp:  pt.timestamp,
          t2m:        pt.t2m       ?? null,
          ts:         pt.ts        ?? null,
          tqv:        pt.tqv       ?? null,
          tprecmax:   pt.tprecmax  ?? null,
          ps:         pt.ps        ?? null,
        })),
      }

      _evictOldestIfNeeded()
      _envCache.set(cacheKey, result)
      return result
    } catch (err) {
      if (err instanceof EnvironmentalApiError) {
        throw new EnvironmentalServiceError(err.message, err.code, { status: err.httpStatus })
      }
      throw new EnvironmentalServiceError(
        'Environmental data is temporarily unavailable. Please try again.',
        'NETWORK_ERROR',
      )
    } finally {
      _inFlightRequests.delete(cacheKey)
    }
  })()

  _inFlightRequests.set(cacheKey, fetchPromise)
  return fetchPromise
}
