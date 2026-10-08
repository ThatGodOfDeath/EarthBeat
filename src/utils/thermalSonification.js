/**
 * thermalSonification.js — Phase 9
 *
 * Mathematical utilities for the Temperature System (t2m + ts).
 *
 * Architecture:
 *   t2m → pitch (frozen — handled by sonification.js → temperatureToFrequency())
 *   ts  → timbral character modifier (this module)
 *
 * Key derived quantity:
 *   surface_air_diff = ts - t2m   (surface skin − near-surface air, Kelvin/°C equivalent)
 *
 *   > 0  → surface warmer than air (high solar loading, dry conditions)
 *          → brighter/warmer timbral character
 *   ≈ 0  → surface and air at equilibrium
 *          → neutral timbral character
 *   < 0  → surface cooler than air (rain evaporation, night-time, snow)
 *          → cooler/muted timbral character
 *
 * Audio implementation:
 *   A peaking EQ filter is placed after the temperature oscillator gain node.
 *   The filter peak/cut in dB tracks surface_air_diff.
 *   This preserves pitch while subtly shifting timbral brightness.
 *
 * CONSTRAINT: ts NEVER controls oscillator frequency.
 * CONSTRAINT: temperatureToFrequency() is never modified by this module.
 */

/**
 * Reference for normalization: typical ts-t2m range.
 * Desert daytime can reach +20 K; rain-cooled surface can reach -10 K.
 * We normalize relative to these realistic extremes.
 */
export const THERMAL_DIFF_MAX_K  =  20.0   // +20 K: hot dry surface
export const THERMAL_DIFF_MIN_K  = -10.0   // −10 K: rain-cooled or snow surface

/** Maximum peaking EQ gain in dB (applied when surface is very hot relative to air) */
export const THERMAL_MAX_PEAK_DB  =  4.0

/** Minimum peaking EQ gain in dB (applied when surface is cool relative to air) */
export const THERMAL_MIN_PEAK_DB  = -2.5

/** Center frequency of the peaking EQ filter (mid-range presence) */
export const THERMAL_FILTER_HZ    = 1200

/** Q factor of the thermal EQ filter (fairly wide, so subtle) */
export const THERMAL_FILTER_Q     = 0.8

/**
 * Converts a ts value (surface skin temperature, K or °C) and t2m value to the
 * surface-to-air temperature difference.
 *
 * Both values must be in the same unit (both Kelvin or both Celsius).
 *
 * @param {number|null} ts  - Surface skin temperature
 * @param {number|null} t2m - 2-metre air temperature (same unit)
 * @returns {number} Difference (ts - t2m), 0 if either is null/invalid
 */
export function computeSurfaceAirDiff(ts, t2m) {
  if (typeof ts !== 'number' || isNaN(ts)) return 0.0
  if (typeof t2m !== 'number' || isNaN(t2m)) return 0.0
  const tsK = ts < 150 ? ts + 273.15 : ts
  const t2mK = t2m < 150 ? t2m + 273.15 : t2m
  return Math.round((tsK - t2mK) * 100) / 100
}

/**
 * Normalizes the surface-to-air temperature difference to [−1, +1].
 *
 * @param {number} diffK - surface-air difference in K (or °C)
 * @returns {number} Normalized value in [−1, +1]
 */
export function normalizeThermalDiff(diffK) {
  if (typeof diffK !== 'number' || isNaN(diffK)) return 0.0
  if (diffK >= 0) {
    return Math.max(-1.0, Math.min(1.0, diffK / THERMAL_DIFF_MAX_K))
  }
  return Math.max(-1.0, Math.min(0.0, diffK / Math.abs(THERMAL_DIFF_MIN_K)))
}

/**
 * Maps the normalized thermal difference to a peaking EQ gain in dB.
 *
 * +1.0 (hot surface) → THERMAL_MAX_PEAK_DB dB (brighter timbre)
 *  0.0 (equilibrium) → 0 dB (neutral)
 * -1.0 (cool surface) → THERMAL_MIN_PEAK_DB dB (muted timbre)
 *
 * @param {number} norm - Normalized thermal diff in [−1, +1]
 * @returns {number} EQ peak gain in dB
 */
export function thermalNormToFilterGainDb(norm) {
  if (typeof norm !== 'number' || isNaN(norm)) return 0.0
  if (norm >= 0) {
    return Math.round(norm * THERMAL_MAX_PEAK_DB * 100) / 100
  }
  return Math.round(norm * Math.abs(THERMAL_MIN_PEAK_DB) * 100) / 100
}

/**
 * Calculates the complete thermal audio modifier parameters.
 *
 * @param {number|null} ts  - Surface skin temperature (same unit as t2m)
 * @param {number|null} t2m - 2-metre air temperature
 * @returns {{
 *   diff: number,
 *   norm: number,
 *   filterGainDb: number,
 *   filterHz: number,
 *   filterQ: number,
 * }}
 */
export function calculateThermalAudioParams(ts, t2m) {
  const diff = computeSurfaceAirDiff(ts, t2m)
  const norm = normalizeThermalDiff(diff)
  const filterGainDb = thermalNormToFilterGainDb(norm)

  return {
    diff,
    norm,
    filterGainDb,
    filterHz: THERMAL_FILTER_HZ,
    filterQ: THERMAL_FILTER_Q,
  }
}
