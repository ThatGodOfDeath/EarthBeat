/**
 * globalTemperatureService.js — Phase 4
 *
 * Service layer for the global NASA GEOS-FP T2M field.
 *
 * Phase 4 Architecture:
 *   React UI → globalTemperatureService → temperatureApi → backend → NASA
 *
 * Key changes from Phase 3:
 *   - Global grids now fetched from backend (NOT synthesised locally)
 *   - AVAILABLE_TIMESTAMPS driven by backend data (NOT hardcoded JSON)
 *   - In-memory cache preserved (now caches backend responses)
 *   - Grid format compatible with existing GlobalTemperatureMap canvas renderer
 */

// ── Grid dimensions (match GlobalTemperatureMap CANVAS_W/CANVAS_H) ───────────
export const GRID_WIDTH  = 360   // longitude cells (1° per cell)
export const GRID_HEIGHT = 180   // latitude cells  (1° per cell)

// ── Scientific metadata ───────────────────────────────────────────────────────
// Static values used by the tooltip before backend metadata is fetched.
// temporalResolution is intentionally left as the actual value (3-hourly).
export const GLOBAL_GRID_META = {
  source:            'NASA GEOS-FP',
  dataset:           'GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx',
  variable:          'T2M',
  variableLabel:     '2 m air temperature',
  unit:              '°C',
  spatialResolution: '~0.25° × ~0.3125° (source); 1° × 1° (visualization grid)',
  temporalResolution: '3-hourly',   // matches actual current GEOS-FP dataset
  provider:          'NASA Global Modeling and Assimilation Office (GMAO)',
  isDevelopmentSubset: false,
}

// ── Runtime metadata (updated when backend responds) ─────────────────────────
let _runtimeMeta = null

export function updateRuntimeMeta(metaFromBackend) {
  if (metaFromBackend?.resolution?.temporal?.label) {
    _runtimeMeta = metaFromBackend
    // Update the exported meta object for tooltip consumption
    GLOBAL_GRID_META.temporalResolution = metaFromBackend.resolution.temporal.label
  }
}

// ── Dynamic timestamps (set by ExplorePage after fetching local series) ───────
// The Phase 4 approach: timestamps come from the backend-fetched local series.
let _availableTimestamps = []

/**
 * Set the available timestamps from the local temperature series.
 * Called by ExplorePage after getTemperatureData() resolves.
 */
export function setAvailableTimestamps(timestamps) {
  _availableTimestamps = Array.isArray(timestamps) ? timestamps : []
}

/**
 * Get the current available timestamps.
 * The UI uses this to drive the timeline slider.
 */
export function getAvailableTimestamps() {
  return _availableTimestamps
}

// ── In-memory LRU grid cache ──────────────────────────────────────────────────
const _gridCache = new Map()
const MAX_CACHE_SIZE = 32

function _evictOldestIfNeeded() {
  if (_gridCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = _gridCache.keys().next().value
    _gridCache.delete(oldestKey)
  }
}

/**
 * Clear the entire in-memory grid cache and any in-flight promises.
 * Call this before a user-initiated "fetch fresh data" action so that
 * new requests bypass stale cached responses.
 */
export function clearGridCache() {
  _gridCache.clear()
  _inFlightPromises.clear()
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TemperatureGrid
 * @property {string}       timestamp  ISO 8601 UTC timestamp (actual obs time)
 * @property {number}       width      Longitude grid cells (360)
 * @property {number}       height     Latitude grid cells (180)
 * @property {Float32Array} values     Row-major temperature values in °C (NaN = missing)
 */

// ── In-flight promise map (prevents duplicate simultaneous requests for same timestamp)
const _inFlightPromises = new Map()

import { getGlobalScientificGrid } from './globalScientificDataService.js'

/**
 * Fetches the TemperatureGrid for the specified timestamp.
 * Delegates to getGlobalScientificGrid('T2M', isoTimestamp) while preserving
 * the existing TemperatureGrid contract.
 *
 * @param {string} isoTimestamp - ISO 8601 UTC timestamp
 * @returns {Promise<TemperatureGrid>}
 */
export async function getGlobalTemperatureGrid(isoTimestamp) {
  return getGlobalScientificGrid('T2M', isoTimestamp)
}


/**
 * Returns the latest available timestamp.
 *
 * @returns {string}
 */
export function getLatestTimestamp() {
  return _availableTimestamps[_availableTimestamps.length - 1] ?? ''
}

/**
 * Returns the timestamp at a given index.
 *
 * @param {number} index
 * @returns {string}
 */
export function getTimestampAtIndex(index) {
  const i = Math.max(0, Math.min(_availableTimestamps.length - 1, index))
  return _availableTimestamps[i] ?? ''
}

/**
 * Pre-warm the grid cache for all currently available timestamps.
 * Fires-and-forgets; failures are logged but do not throw.
 *
 * @returns {Promise<void>}
 */
export async function prewarmCache() {
  // In Phase 4, we do NOT pre-warm all global grids at startup because
  // each requires a backend request. Instead, we warm only on demand.
  // This function is kept for API compatibility with ExplorePage.
  return Promise.resolve()
}
