/**
 * temperatureService.js — Phase 4
 *
 * Application-level temperature data service.
 * Now fetches from the Earth Jukebox backend (FastAPI) instead of
 * hardcoded local JSON files.
 *
 * Architecture:
 *   React UI / Sonification
 *     ↓
 *   temperatureService  (this module)
 *     ↓
 *   temperatureApi
 *     ↓
 *   Earth Jukebox backend
 *     ↓
 *   NASA GEOS-FP OPeNDAP
 */

import {
  getTemperatureSeries as apiGetTemperatureSeries,
  TemperatureApiError,
} from '../api/temperatureApi'

/**
 * Custom error class for temperature service operations.
 */
export class TemperatureServiceError extends Error {
  constructor(message, code, details = {}) {
    super(message)
    this.name = 'TemperatureServiceError'
    this.code = code
    this.details = details
  }
}

/**
 * Default time range: last 2 days relative to local time.
 * Returns ISO 8601 UTC strings.
 */
function getDefaultTimeRange() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 2)
  return {
    start: start.toISOString().replace('.000Z', 'Z'),
    end: end.toISOString().replace('.000Z', 'Z'),
  }
}

/**
 * Retrieves temperature time-series data for a given location.
 *
 * Uses the backend API for the 'geosfp' provider.
 * Returns mock data only when provider === 'mock'.
 *
 * @param {number|null} latitude - User-selected latitude
 * @param {number|null} longitude - User-selected longitude
 * @param {object} [options={}]
 * @returns {Promise<TemperatureDataset>}
 */
export async function getTemperatureData(latitude, longitude, options = {}) {
  const { locationName = '', provider = 'geosfp', start, end, timestamps } = options

  // ── Development mock (isolated, clearly not NASA data) ───────────────────
  if (provider === 'mock') {
    return getMockTemperatureDataset(latitude, longitude, locationName)
  }

  // ── Validate coordinates ─────────────────────────────────────────────────
  const hasCoords =
    typeof latitude === 'number' && !isNaN(latitude) &&
    typeof longitude === 'number' && !isNaN(longitude)

  if (!hasCoords) {
    throw new TemperatureServiceError(
      'Valid latitude and longitude are required.',
      'INVALID_COORDINATES',
    )
  }

  // ── Determine time range ─────────────────────────────────────────────────
  const range = (start && end) ? { start, end } : getDefaultTimeRange()

  // ── Fetch from backend ───────────────────────────────────────────────────
  try {
    const response = await apiGetTemperatureSeries(
      latitude,
      longitude,
      range.start,
      range.end,
      timestamps,
    )

    // Translate backend response to the application-level TemperatureDataset
    // shape that the existing frontend components expect.
    return {
      source:              response.source.name,
      dataset:             response.source.dataset,
      variable:            response.source.variable,
      variableDescription: response.source.variableName,
      unit:                response.source.unit,
      temporalResolution:  response.resolution.temporal.label,
      period:              `${range.start} – ${range.end}`,
      isDevelopmentSubset: false,
      requestedLocation: {
        name:      locationName,
        latitude:  response.location.requested.latitude,
        longitude: response.location.requested.longitude,
      },
      gridLocation: {
        latitude:  response.location.grid.latitude,
        longitude: response.location.grid.longitude,
      },
      resolution: response.resolution,
      // Map backend `temperature` field to frontend `value` field
      data: response.data.map((pt) => ({
        timestamp: pt.timestamp,
        value:     pt.temperature,
      })),
    }
  } catch (err) {
    if (err instanceof TemperatureApiError) {
      throw new TemperatureServiceError(
        err.message,
        err.code || 'API_ERROR',
        { httpStatus: err.httpStatus },
      )
    }
    throw new TemperatureServiceError(
      'An unexpected error occurred while loading temperature data.',
      'UNKNOWN_ERROR',
    )
  }
}

/**
 * Returns a clearly-labelled mock temperature dataset for development testing.
 * This is the ONLY place mock/fake temperature values may appear.
 * The production data path NEVER falls back to this.
 */
export function getMockTemperatureDataset(
  latitude = 0,
  longitude = 0,
  name = 'Mock Location',
) {
  return {
    source:              'Mock Provider',
    dataset:             'synthesized-test-model',
    variable:            'T2M',
    variableDescription: 'Synthetic air temperature for development testing',
    unit:                '°C',
    temporalResolution:  '3-hourly (mock)',
    period:              'Demonstration',
    isDevelopmentSubset: false,
    requestedLocation: {
      name:      name || 'Mock Location',
      latitude:  latitude ?? 0,
      longitude: longitude ?? 0,
    },
    gridLocation: {
      latitude:  latitude ?? 0,
      longitude: longitude ?? 0,
    },
    // Clearly synthetic data — 8 points, 3-hourly
    data: [
      { timestamp: '2026-09-29T00:00:00Z', value: 22.0 },
      { timestamp: '2026-09-29T03:00:00Z', value: 24.5 },
      { timestamp: '2026-09-29T06:00:00Z', value: 28.0 },
      { timestamp: '2026-09-29T09:00:00Z', value: 31.5 },
      { timestamp: '2026-09-29T12:00:00Z', value: 29.0 },
      { timestamp: '2026-09-29T15:00:00Z', value: 26.2 },
      { timestamp: '2026-09-29T18:00:00Z', value: 24.1 },
      { timestamp: '2026-09-29T21:00:00Z', value: 22.8 },
    ],
  }
}
