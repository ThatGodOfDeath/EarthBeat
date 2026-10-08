/**
 * globalScientificDataService.js
 *
 * Centralized service layer for global scientific grids across all GEOS-FP variables:
 *   - T2M:  2 m air temperature (°C)
 *   - TS:   Surface skin temperature (°C)
 *   - PS:   Surface pressure (hPa)
 *   - WIND: 10 m wind speed (m/s) + u10m/v10m vector fields
 *
 * Architecture:
 *   React UI (GlobalScientificMap)
 *       ↓
 *   globalScientificDataService (this module)
 *       ↓
 *   scientificDataApi (GET /api/scientific/global)
 *       ↓
 *   FastAPI backend
 *       ↓
 *   NASA GEOS-FP OPeNDAP
 *
 * Features:
 *   - LRU in-memory cache (32 grids per variable, up to 96 total)
 *   - In-flight request deduplication by composite key (variable:timestamp)
 *   - Offline / mock synthetic grid generator for development & resilience
 *   - 360 × 180 Float32Array grid output compatible with Canvas ImageData renderer
 */

import { getGlobalScientificGrid as apiGetGlobalGrid } from '../api/scientificDataApi.js'
import { getVariableConfig } from '../data/scientificVariables.js'

export const GRID_WIDTH = 360
export const GRID_HEIGHT = 180

// ── In-memory LRU Cache ───────────────────────────────────────────────────────
const _gridCache = new Map()
const MAX_CACHE_SIZE = 96 // supports multiple variables across time

function _evictOldestIfNeeded() {
  if (_gridCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = _gridCache.keys().next().value
    _gridCache.delete(oldestKey)
  }
}

// ── In-flight promise map (deduplicates concurrent requests) ─────────────────
const _inFlightPromises = new Map()

export function clearGlobalScientificCache() {
  _gridCache.clear()
  _inFlightPromises.clear()
}

// ── Synthetic / Mock Grid Generator ──────────────────────────────────────────
/**
 * Synthesizes a scientifically plausible 360×180 global field for testing or offline mode.
 */
function generateMockGrid(variable, timestamp) {
  const v = (variable || 'T2M').toUpperCase()
  const cfg = getVariableConfig(v)
  const values = new Float32Array(GRID_WIDTH * GRID_HEIGHT)
  let uValues = null
  let vValues = null

  if (v === 'WIND') {
    uValues = new Float32Array(GRID_WIDTH * GRID_HEIGHT)
    vValues = new Float32Array(GRID_WIDTH * GRID_HEIGHT)
  }

  const dt = timestamp ? new Date(timestamp) : new Date('2026-10-05T12:00:00Z')
  const hour = isNaN(dt.getTime()) ? 12 : dt.getUTCHours()
  const solarLon = (12 - hour) * 15 // Subsolar longitude point

  for (let row = 0; row < GRID_HEIGHT; row++) {
    // Latitude from +90° (row 0) to -90° (row 179)
    const lat = 90 - (row / (GRID_HEIGHT - 1)) * 180
    const latRad = (lat * Math.PI) / 180
    const cosLat = Math.cos(latRad)

    for (let col = 0; col < GRID_WIDTH; col++) {
      // Longitude from -180° (col 0) to +180° (col 359)
      const lon = (col / (GRID_WIDTH - 1)) * 360 - 180
      const lonDist = Math.abs(((lon - solarLon + 540) % 360) - 180)
      const dayFactor = Math.max(0, Math.cos((lonDist * Math.PI) / 180))

      const idx = row * GRID_WIDTH + col

      if (v === 'T2M') {
        // Temperature: Equator warm (+28°C), poles cold (-40°C), diurnal heating
        const base = -35 + 63 * Math.pow(Math.max(0, cosLat), 0.8)
        values[idx] = Math.round((base + 6 * dayFactor * cosLat) * 10) / 10
      } else if (v === 'TS') {
        // Skin temperature: higher diurnal amplitude over continents/daytime
        const base = -38 + 66 * Math.pow(Math.max(0, cosLat), 0.8)
        values[idx] = Math.round((base + 12 * dayFactor * cosLat) * 10) / 10
      } else if (v === 'PS') {
        // Surface pressure: equatorial low (~1008), subtropical high (~1022), subpolar low (~995)
        const latWave = Math.sin(latRad * 4) * 8
        const base = 1012 + latWave + Math.cos(latRad * 2) * 5
        values[idx] = Math.round((base + Math.sin((lon * Math.PI) / 90) * 4) * 10) / 10
      } else if (v === 'WIND') {
        // Wind: trade winds (easterly near equator), westerlies (mid-latitudes)
        let u = 0
        let v_comp = 0
        if (Math.abs(lat) < 30) {
          // Tropical easterlies (trades)
          u = -5 - 3 * cosLat
          v_comp = (lat > 0 ? -2 : 2) * cosLat
        } else if (Math.abs(lat) < 60) {
          // Mid-latitude westerlies
          u = 7 + 6 * cosLat
          v_comp = (lat > 0 ? 3 : -3) * cosLat
        } else {
          // Polar easterlies
          u = -3 * cosLat
          v_comp = (lat > 0 ? -1 : 1) * cosLat
        }
        // Add synoptic eddy variation
        const eddy = Math.sin((lon * 4 * Math.PI) / 180) * 3
        u += eddy
        v_comp += Math.cos((lon * 3 * Math.PI) / 180) * 2

        const speed = Math.hypot(u, v_comp)
        values[idx] = Math.round(speed * 10) / 10
        uValues[idx] = Math.round(u * 10) / 10
        vValues[idx] = Math.round(v_comp * 10) / 10
      } else if (v === 'TPRECMAX') {
        // Precipitation: ITCZ convection belt near equator + mid-latitude storm tracks
        const itcz = Math.exp(-Math.pow((lat - 5) / 11, 2)) * 12
        const stormTrackN = Math.exp(-Math.pow((lat - 48) / 12, 2)) * 8
        const stormTrackS = Math.exp(-Math.pow((lat + 48) / 12, 2)) * 8
        const wave = Math.max(0, Math.sin((lon * 3 * Math.PI) / 180) * Math.cos((lat * 2 * Math.PI) / 180))
        const rain = (itcz + stormTrackN + stormTrackS) * (0.3 + 1.2 * wave)
        values[idx] = rain > 0.4 ? Math.round(rain * 10) / 10 : 0
      } else if (v === 'TQV') {
        // Total precipitable water vapor: ~55 kg/m² tropical equator down to ~4 kg/m² polar
        const base = 4 + 52 * Math.pow(Math.max(0, cosLat), 1.5)
        const wave = Math.sin((lon * 2 * Math.PI) / 180) * 4 * cosLat
        values[idx] = Math.round(Math.max(1, base + wave) * 10) / 10
      }
    }
  }

  return {
    timestamp: timestamp || new Date().toISOString(),
    variable: v,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    values,
    uValues,
    vValues,
    unit: cfg.unit,
  }
}

/**
 * Retrieve a ScientificGrid for a given variable and ISO timestamp.
 *
 * @param {string} variable - 'T2M', 'TS', 'PS', or 'WIND'
 * @param {string} isoTimestamp - ISO 8601 UTC timestamp
 * @param {object} [options={}] - Options (e.g. provider: 'mock' | 'geosfp')
 * @returns {Promise<ScientificGrid>}
 */
export async function getGlobalScientificGrid(variable = 'T2M', isoTimestamp, options = {}) {
  const v = (variable || 'T2M').toUpperCase()
  if (!isoTimestamp) return null

  const cacheKey = `${v}:${isoTimestamp}`
  if (_gridCache.has(cacheKey)) {
    return _gridCache.get(cacheKey)
  }

  if (_inFlightPromises.has(cacheKey)) {
    return _inFlightPromises.get(cacheKey)
  }

  // If explicit mock provider requested, return synthetic grid
  if (options.provider === 'mock') {
    const mockGrid = generateMockGrid(v, isoTimestamp)
    _evictOldestIfNeeded()
    _gridCache.set(cacheKey, mockGrid)
    return mockGrid
  }

  const promise = (async () => {
    try {
      const response = await apiGetGlobalGrid(v, isoTimestamp, options)

      const float32 = new Float32Array(response.values.length)
      for (let i = 0; i < response.values.length; i++) {
        float32[i] = response.values[i] === null ? NaN : response.values[i]
      }

      let uValues = null
      let vValues = null
      if (response.uValues && response.uValues.length > 0) {
        uValues = new Float32Array(response.uValues.length)
        for (let i = 0; i < response.uValues.length; i++) {
          uValues[i] = response.uValues[i] === null ? NaN : response.uValues[i]
        }
      }
      if (response.vValues && response.vValues.length > 0) {
        vValues = new Float32Array(response.vValues.length)
        for (let i = 0; i < response.vValues.length; i++) {
          vValues[i] = response.vValues[i] === null ? NaN : response.vValues[i]
        }
      }

      const grid = {
        timestamp: response.timestamp,
        variable: v,
        width: response.grid?.width || GRID_WIDTH,
        height: response.grid?.height || GRID_HEIGHT,
        values: float32,
        uValues,
        vValues,
        unit: response.source?.unit || getVariableConfig(v).unit,
      }

      _evictOldestIfNeeded()
      _gridCache.set(cacheKey, grid)
      return grid
    } catch (err) {
      if (options?.signal?.aborted || err.name === 'AbortError') {
        throw err
      }
      // Do not silently display mock grids as real data when geosfp provider is active
      console.warn(`[globalScientificDataService] Backend request failed for ${v}:`, err.message)
      throw err
    } finally {
      _inFlightPromises.delete(cacheKey)
    }
  })()

  _inFlightPromises.set(cacheKey, promise)
  return promise
}
