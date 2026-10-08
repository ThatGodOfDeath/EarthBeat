/**
 * windUtils.js — Wind physics and meteorological direction utilities.
 *
 * Physics & Formulations:
 *   - u: eastward wind component in m/s (positive = wind blowing toward East)
 *   - v: northward wind component in m/s (positive = wind blowing toward North)
 *   - speed: sqrt(u² + v²) in m/s
 *
 * Meteorological Wind Direction:
 *   - Direction FROM which the wind blows.
 *   - 0° = North, 90° = East, 180° = South, 270° = West.
 *   - Formulation: (atan2(-u, -v) * 180 / π + 360) % 360
 *   - Zero wind (u=0, v=0): Direction is null ("Calm").
 */

export const COMPASS_16 = [
  { label: 'N',   min: 348.75, max: 360.0 },
  { label: 'N',   min: 0.0,    max: 11.25 },
  { label: 'NNE', min: 11.25,  max: 33.75 },
  { label: 'NE',  min: 33.75,  max: 56.25 },
  { label: 'ENE', min: 56.25,  max: 78.75 },
  { label: 'E',   min: 78.75,  max: 101.25 },
  { label: 'ESE', min: 101.25, max: 123.75 },
  { label: 'SE',  min: 123.75, max: 146.25 },
  { label: 'SSE', min: 146.25, max: 168.75 },
  { label: 'S',   min: 168.75, max: 191.25 },
  { label: 'SSW', min: 191.25, max: 213.75 },
  { label: 'SW',  min: 213.75, max: 236.25 },
  { label: 'WSW', min: 236.25, max: 258.75 },
  { label: 'W',   min: 258.75, max: 281.25 },
  { label: 'WNW', min: 281.25, max: 303.75 },
  { label: 'NW',  min: 303.75, max: 326.25 },
  { label: 'NNW', min: 326.25, max: 348.75 },
]

/**
 * Calculate 10-meter wind speed from eastward (u) and northward (v) components.
 *
 * @param {number|null} u - Eastward component (m/s)
 * @param {number|null} v - Northward component (m/s)
 * @returns {number} Speed in m/s rounded to 1 decimal place (or 0 if invalid).
 */
export function calculateWindSpeed(u, v) {
  if (u == null || v == null || isNaN(u) || isNaN(v)) {
    return 0
  }
  const speed = Math.hypot(u, v)
  return Math.round(speed * 10) / 10
}

/**
 * Calculate meteorological wind direction in degrees [0, 360).
 *
 * @param {number|null} u - Eastward component (m/s)
 * @param {number|null} v - Northward component (m/s)
 * @returns {number|null} Direction in degrees (rounded to 1 decimal place), or null if calm.
 */
export function calculateWindDirection(u, v) {
  if (u == null || v == null || isNaN(u) || isNaN(v)) {
    return null
  }
  // Zero wind check
  if (Math.abs(u) < 1e-6 && Math.abs(v) < 1e-6) {
    return null
  }
  const rad = Math.atan2(-u, -v)
  let deg = (rad * 180) / Math.PI
  deg = (deg + 360) % 360
  return Math.round(deg * 10) / 10
}

/**
 * Convert degree direction into 16-point cardinal compass point.
 *
 * @param {number|null} deg - Degrees [0, 360)
 * @returns {string} Compass point e.g. "SW", "N", or "Calm"
 */
export function getCardinalDirection(deg) {
  if (deg == null || isNaN(deg)) {
    return 'Calm'
  }
  const norm = ((deg % 360) + 360) % 360
  for (const item of COMPASS_16) {
    if (norm >= item.min && norm < item.max) {
      return item.label
    }
    if (item.max === 360 && norm === 360) {
      return item.label
    }
  }
  return 'N'
}

/**
 * Format wind speed with unit for display.
 */
export function formatWindSpeed(speed) {
  if (speed == null || isNaN(speed)) return '— m/s'
  return `${Number(speed).toFixed(1)} m/s`
}

/**
 * Format wind direction for display (e.g. "237° SW" or "Calm").
 */
export function formatWindDirection(deg) {
  if (deg == null || isNaN(deg)) return 'Calm'
  const cardinal = getCardinalDirection(deg)
  return `${Math.round(deg)}° ${cardinal}`
}
