/**
 * timestampGenerator.js — Phase 5D Temporal Timestamp Generator
 *
 * Deterministic, pure-function utility that generates ISO 8601 UTC timestamps
 * from a temporal configuration. No network requests. No side effects.
 *
 * GEOS-FP Native Resolution:
 *   The NASA GEOS-FP inst3_2d_asm_Nx dataset provides observations at
 *   3-hour intervals (00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 UTC).
 *   This is the minimum interval for Daily and Weekly modes.
 *
 * Interval Alignment Rule:
 *   All generated timestamps are aligned to GEOS-FP's 3-hourly grid.
 *   For a requested interval of N hours, the nearest multiple of 3 hours
 *   that is ≥ the minimum is used. Timestamps always start at midnight (00:00 UTC)
 *   of the start date and step forward by the interval.
 *
 *   Monthly/Yearly modes snap to midnight (00:00 UTC) on the target calendar date.
 *   This maps to an actual available GEOS-FP observation (midnight = 00:00 observation).
 *
 * Scale Definitions:
 *   Daily:
 *     duration unit: days (0–60)
 *     interval unit: hours (3–24, must be multiple of 3)
 *
 *   Weekly:
 *     duration unit: weeks (0–60)
 *     interval unit: hours (3–168 h = 7 days, must be multiple of 3)
 *
 *   Monthly:
 *     duration unit: months (0–60)
 *     interval unit: days (1–30)
 *     Each generated timestamp maps to 00:00 UTC on the target date.
 *
 *   Yearly:
 *     duration unit: years (0–60)
 *     interval unit: months (1–12)
 *     Each generated timestamp maps to 00:00 UTC on the first day of the target month.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum GEOS-FP interval in hours (3-hourly dataset) */
export const GEOSFP_MIN_INTERVAL_HOURS = 3

/** Maximum practical timestamps before we warn (to avoid huge payloads) */
export const MAX_PRACTICAL_TIMESTAMPS = 2000

/**
 * Scale configuration: defines allowed duration, interval ranges, and units.
 */
export const SCALE_CONFIG = {
  daily: {
    label: 'Daily',
    durationUnit: 'days',
    durationMin: 0,
    durationMax: 60,
    durationDefault: 1,
    intervalUnit: 'hours',
    intervalMin: 3,    // GEOS-FP minimum
    intervalMax: 24,
    intervalDefault: 3,
    intervalStep: 3,   // Must be multiples of 3 hours
  },
  monthly: {
    label: 'Monthly',
    durationUnit: 'months',
    durationMin: 0,
    durationMax: 60,
    durationDefault: 1,
    intervalUnit: 'days',
    intervalMin: 1,
    intervalMax: 30,
    intervalDefault: 1,
    intervalStep: 1,
  },
  yearly: {
    label: 'Yearly',
    durationUnit: 'years',
    durationMin: 0,
    durationMax: 60,
    durationDefault: 1,
    intervalUnit: 'months',
    intervalMin: 1,
    intervalMax: 12,
    intervalDefault: 1,
    intervalStep: 1,
  },
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Format a Date as an ISO 8601 UTC string with 'Z' suffix.
 * Always represents midnight or a GEOS-FP-aligned observation time.
 * @param {Date} d - UTC Date object
 * @returns {string} ISO 8601 UTC string
 */
function toUtcIso(d) {
  const year  = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day   = String(d.getUTCDate()).padStart(2, '0')
  const hh    = String(d.getUTCHours()).padStart(2, '0')
  const mm    = String(d.getUTCMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hh}:${mm}:00Z`
}

/**
 * Clamp a value to [min, max].
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

/**
 * Snap a raw hours interval to the nearest valid multiple of
 * GEOSFP_MIN_INTERVAL_HOURS that is ≥ intervalMin and ≤ intervalMax.
 * @param {number} rawHours
 * @param {number} intervalMin - minimum allowed hours
 * @param {number} intervalMax - maximum allowed hours
 * @returns {number} snapped hours
 */
function snapToGeosFpHours(rawHours, intervalMin, intervalMax) {
  const step = GEOSFP_MIN_INTERVAL_HOURS
  const clamped = clamp(rawHours, intervalMin, intervalMax)
  // Round up to nearest multiple of step
  const snapped = Math.round(clamped / step) * step
  return clamp(snapped, intervalMin, intervalMax)
}

/**
 * Add N months to a UTC Date (day-of-month preserved where possible,
 * clamped to last day of month if overflow, e.g., Jan 31 + 1 month = Feb 28/29).
 * @param {Date} d - source Date
 * @param {number} months - months to add
 * @returns {Date}
 */
function addUtcMonths(d, months) {
  const result = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() + months,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    0,
    0,
  ))
  // If day overflowed (e.g., Jan 31 -> Feb 31 clamped), this is handled
  // automatically by the Date constructor rolling over. Correct back to
  // the last day of the intended month.
  const expectedMonth = ((d.getUTCMonth() + months) % 12 + 12) % 12
  if (result.getUTCMonth() !== expectedMonth) {
    // Overflowed: back up to last day of intended month
    result.setUTCDate(0) // sets to last day of previous month
  }
  return result
}

// ── Main Public API ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} TemporalConfig
 * @property {'daily'|'weekly'|'monthly'|'yearly'} scale
 * @property {Date|string} startDate  - Start date (UTC; for daily/weekly: day used, for monthly: month/year, for yearly: year)
 * @property {number} duration        - Duration in units matching scale (0 = single timestamp)
 * @property {number} interval        - Interval in units matching scale
 */

/**
 * Generate a deterministic, ordered list of ISO 8601 UTC timestamps.
 *
 * @param {TemporalConfig} config
 * @returns {string[]} Ordered array of ISO 8601 UTC timestamps
 */
export function generateTimestamps(config) {
  const { scale, startDate, duration, interval } = config

  if (!scale || !SCALE_CONFIG[scale]) {
    console.warn('[timestampGenerator] Unknown scale:', scale)
    return []
  }

  const cfg = SCALE_CONFIG[scale]
  const clampedDuration = clamp(Math.round(duration ?? 0), cfg.durationMin, cfg.durationMax)
  const clampedInterval = clamp(
    Math.round(interval ?? cfg.intervalDefault),
    cfg.intervalMin,
    cfg.intervalMax,
  )

  // Parse the anchor date as UTC to avoid local-timezone shifts
  const anchor = typeof startDate === 'string'
    ? new Date(startDate)
    : (startDate instanceof Date ? startDate : new Date())

  if (isNaN(anchor.getTime())) {
    console.warn('[timestampGenerator] Invalid startDate:', startDate)
    return []
  }

  // Timestamps are generated in chronological order (Earlier → Latest).
  // The selected date acts as the anchor (latest observation), and duration
  // extends backward into the past (e.g. Oct 7 with 5 days generates Oct 2 → Oct 7).
  switch (scale) {
    case 'daily':
      return _generateHourly(anchor, clampedDuration * 24, clampedInterval, cfg)
    case 'monthly':
      return _generateMonthly(anchor, clampedDuration, clampedInterval)
    case 'yearly':
      return _generateYearly(anchor, clampedDuration, clampedInterval)
    default:
      return []
  }
}

/**
 * Generate hourly-step timestamps for Daily and Weekly modes.
 * Timestamps are aligned to GEOS-FP 3-hour boundaries and ordered chronologically.
 *
 * Alignment Rule:
 *   The anchor date is the latest point in the range (e.g. 00:00 UTC).
 *   The range extends backward into the past by totalHours.
 *   Timestamps step forward from (anchor - totalHours) up to anchor.
 *
 * @param {Date} anchorDate
 * @param {number} totalHours  - Total span in hours (duration * hours-per-unit)
 * @param {number} intervalHours
 * @param {object} cfg - Scale config entry
 * @returns {string[]}
 */
function _generateHourly(anchorDate, totalHours, intervalHours, cfg) {
  // Snap interval to valid GEOS-FP multiple of 3
  const snappedInterval = snapToGeosFpHours(intervalHours, cfg.intervalMin, cfg.intervalMax)

  // Anchor is midnight UTC of the selected date (the latest point in the range)
  const anchorMs = Date.UTC(
    anchorDate.getUTCFullYear(),
    anchorDate.getUTCMonth(),
    anchorDate.getUTCDate(),
    0, 0, 0, 0,
  )

  const results = []

  // Duration = 0 → single observation at anchor
  if (totalHours === 0) {
    results.push(toUtcIso(new Date(anchorMs)))
    return results
  }

  // Range extends backward from anchor by totalHours into the past
  const startMs = anchorMs - totalHours * 60 * 60 * 1000
  const stepMs = snappedInterval * 60 * 60 * 1000

  // Step backward from anchor so the anchor observation is always included
  let currentMs = anchorMs
  while (currentMs >= startMs - 1) { // -1 ms tolerance for float drift
    results.push(toUtcIso(new Date(currentMs)))
    currentMs -= stepMs

    if (results.length >= MAX_PRACTICAL_TIMESTAMPS) {
      console.warn(
        `[timestampGenerator] Reached MAX_PRACTICAL_TIMESTAMPS (${MAX_PRACTICAL_TIMESTAMPS}). ` +
        'Truncating to prevent excessive payload.',
      )
      break
    }
  }

  // Reverse so timestamps are in chronological order (Earlier → Latest, ending at anchor)
  return results.reverse()
}

/**
 * Generate monthly-interval timestamps for Monthly mode.
 * Each timestamp is midnight UTC on the Nth calendar day of each step.
 * Extends backward into the past by durationMonths, ordered chronologically.
 *
 * @param {Date} anchorDate
 * @param {number} durationMonths - Total duration in months
 * @param {number} intervalDays - Step in days
 * @returns {string[]}
 */
function _generateMonthly(anchorDate, durationMonths, intervalDays) {
  // Anchor: midnight UTC on anchorDate
  const anchor = new Date(Date.UTC(
    anchorDate.getUTCFullYear(),
    anchorDate.getUTCMonth(),
    anchorDate.getUTCDate(),
    0, 0, 0, 0,
  ))

  const results = []

  if (durationMonths === 0) {
    results.push(toUtcIso(anchor))
    return results
  }

  // Start date: anchor - durationMonths calendar months (into the past)
  const startDate = addUtcMonths(anchor, -durationMonths)
  const startMs = startDate.getTime()
  const anchorMs = anchor.getTime()
  const stepMs = intervalDays * 24 * 60 * 60 * 1000

  // Step backward from anchor so the anchor observation is always included
  let currentMs = anchorMs
  while (currentMs >= startMs - 1) {
    results.push(toUtcIso(new Date(currentMs)))
    currentMs -= stepMs

    if (results.length >= MAX_PRACTICAL_TIMESTAMPS) {
      console.warn('[timestampGenerator] Reached MAX_PRACTICAL_TIMESTAMPS. Truncating.')
      break
    }
  }

  // Reverse so timestamps are in chronological order (Earlier → Latest, ending at anchor)
  return results.reverse()
}

/**
 * Generate yearly-interval timestamps for Yearly mode.
 * Extends backward into the past by durationYears, ordered chronologically.
 *
 * @param {Date} anchorDate
 * @param {number} durationYears - Total duration in years
 * @param {number} intervalMonths - Step in months
 * @returns {string[]}
 */
function _generateYearly(anchorDate, durationYears, intervalMonths) {
  // Anchor: midnight UTC on the 1st of anchorDate's month
  const anchor = new Date(Date.UTC(
    anchorDate.getUTCFullYear(),
    anchorDate.getUTCMonth(),
    1,
    0, 0, 0, 0,
  ))

  const results = []

  if (durationYears === 0) {
    results.push(toUtcIso(anchor))
    return results
  }

  // Start date: anchor - durationYears calendar years (into the past)
  const startDate = new Date(Date.UTC(
    anchor.getUTCFullYear() - durationYears,
    anchor.getUTCMonth(),
    1,
    0, 0, 0, 0,
  ))
  const startMs = startDate.getTime()

  // Step backward from anchor so the anchor observation is always included
  let current = new Date(anchor.getTime())
  while (current.getTime() >= startMs - 1) {
    results.push(toUtcIso(current))
    current = addUtcMonths(current, -intervalMonths)

    if (results.length >= MAX_PRACTICAL_TIMESTAMPS) {
      console.warn('[timestampGenerator] Reached MAX_PRACTICAL_TIMESTAMPS. Truncating.')
      break
    }
  }

  // Reverse so timestamps are in chronological order (Earlier → Latest, ending at anchor)
  return results.reverse()
}

// ── Config Utilities ──────────────────────────────────────────────────────────

/**
 * Validate a TemporalConfig and return a cleaned, clamped version.
 * Returns null if the config is fundamentally invalid.
 *
 * @param {object} raw - Raw config from UI state
 * @returns {TemporalConfig|null}
 */
export function validateConfig(raw) {
  if (!raw || !SCALE_CONFIG[raw.scale]) return null

  const cfg = SCALE_CONFIG[raw.scale]
  const clampedDuration = clamp(
    Math.round(raw.duration ?? cfg.durationDefault),
    cfg.durationMin,
    cfg.durationMax,
  )
  const clampedInterval = clamp(
    Math.round(raw.interval ?? cfg.intervalDefault),
    cfg.intervalMin,
    cfg.intervalMax,
  )

  return {
    scale: raw.scale,
    startDate: raw.startDate || new Date().toISOString(),
    duration: clampedDuration,
    interval: clampedInterval,
  }
}

/**
 * Build a human-readable summary of the temporal config.
 * e.g., "Daily · 14 days · 3 hour interval"
 *
 * @param {TemporalConfig} config
 * @returns {string}
 */
export function summarizeConfig(config) {
  if (!config || !SCALE_CONFIG[config.scale]) return ''

  const cfg = SCALE_CONFIG[config.scale]
  const scaleLabel = cfg.label
  const durationStr = `${config.duration} ${cfg.durationUnit}`
  const intervalStr = `${config.interval} ${config.interval === 1
    ? cfg.intervalUnit.replace(/s$/, '') // singularize
    : cfg.intervalUnit
  } interval`

  return `${scaleLabel} · ${durationStr} · ${intervalStr}`
}

/**
 * Compute the GEOS-FP time range needed to serve a generated timestamp list.
 * Returns { start, end } ISO strings for use as backend query parameters.
 *
 * If timestamps is empty, returns null.
 *
 * @param {string[]} timestamps
 * @returns {{ start: string, end: string }|null}
 */
export function getDataRange(timestamps) {
  if (!timestamps || timestamps.length === 0) return null
  // Timestamps are in chronological order (index 0 = earliest, last = latest).
  return {
    start: timestamps[0],
    end:   timestamps[timestamps.length - 1],
  }
}

/**
 * Format a scale+duration+interval for display.
 * Used by the UI to show what the slider controls mean.
 *
 * @param {'daily'|'weekly'|'monthly'|'yearly'} scale
 * @param {number} duration
 * @param {number} interval
 * @returns {{ durationLabel: string, intervalLabel: string }}
 */
export function formatLabels(scale, duration, interval) {
  if (!SCALE_CONFIG[scale]) {
    return { durationLabel: '', intervalLabel: '' }
  }

  const cfg = SCALE_CONFIG[scale]

  const dUnit = duration === 1
    ? cfg.durationUnit.replace(/s$/, '')
    : cfg.durationUnit

  const iUnit = interval === 1
    ? cfg.intervalUnit.replace(/s$/, '')
    : cfg.intervalUnit

  return {
    durationLabel: `${duration} ${dUnit}`,
    intervalLabel: `${interval} ${iUnit}`,
  }
}
