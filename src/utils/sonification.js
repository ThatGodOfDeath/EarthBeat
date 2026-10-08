/**
 * sonification.js
 *
 * Mathematical utilities for scientific temperature sonification.
 * Base frequency: 500 Hz assigned to the series minimum temperature.
 * Scaling: +10 Hz for each 0.1°C increase above minimum (100 Hz per 1°C).
 */

export const BASE_MIN_FREQUENCY_HZ = 500
export const HZ_PER_TENTH_DEGREE = 10 // 10 Hz for every 0.1°C = 100 Hz per 1°C

// Kept for backward compatibility
export const MIN_FREQUENCY_HZ = BASE_MIN_FREQUENCY_HZ
export const MAX_FREQUENCY_HZ = 2000

/**
 * Dynamically normalizes a value within a [min, max] range to [0, 1].
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number} Normalized value between 0 and 1
 */
export function normalizeValue(value, min, max) {
  if (typeof value !== 'number' || isNaN(value)) return 0.5
  if (max === min) return 0.5
  const clamped = Math.max(min, Math.min(max, value))
  return (clamped - min) / (max - min)
}

/**
 * Maps a temperature in °C to an audible frequency relative to series minimum.
 * Assigns 500 Hz to the minimum temperature, and for each 0.1°C increase,
 * adds 10 Hz (100 Hz/°C).
 *
 * @param {number} value - Temperature value in °C
 * @param {number} [minTemp] - Minimum temperature in current series
 * @returns {number} Frequency in Hz
 */
export function temperatureToFrequency(value, minTemp = 0) {
  if (typeof value !== 'number' || isNaN(value)) return BASE_MIN_FREQUENCY_HZ
  const baseMin = typeof minTemp === 'number' && !isNaN(minTemp) ? minTemp : value
  const diff = Math.max(0, value - baseMin)
  return Math.round(BASE_MIN_FREQUENCY_HZ + (diff / 0.1) * HZ_PER_TENTH_DEGREE)
}

/**
 * Computes series statistics (min, max, count).
 *
 * @param {Array<{ value: number }>} data
 * @returns {{ min: number, max: number, count: number }}
 */
export function computeSeriesStats(data = []) {
  if (!data || data.length === 0) {
    return { min: 0, max: 0, count: 0 }
  }
  const values = data.map((d) => d.value).filter((v) => typeof v === 'number' && !isNaN(v))
  if (values.length === 0) {
    return { min: 0, max: 0, count: 0 }
  }
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    count: values.length,
  }
}
