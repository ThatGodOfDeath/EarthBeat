/**
 * windSonification.js — Phase 7
 *
 * Mathematical and parameter mapping utilities for wind sonification.
 *
 * Core Principles:
 *   - Temperature is the ONLY variable controlling pitch/frequency.
 *   - Wind controls amplitude (loudness), spectral density (filter cutoff/Q),
 *     and stereo spatial positioning. Wind NEVER introduces an independent pitch.
 *   - Wind speed → amplitude/intensity (non-linear curve)
 *   - Wind speed → spectral character (bandpass filter cutoff & Q)
 *   - Wind direction → stereo pan (continuous sinusoidal interpolation)
 *   - Calm wind (speed = 0 or direction = null) → near silence (gain → 0)
 */

export const SPEED_REFERENCE_MS = 25.0  // Reference speed for normalization (~90 km/h)
export const MIN_WIND_GAIN = 0.0001      // Floor for Web Audio ramps (silence)
export const MAX_WIND_GAIN = 0.20        // Safe ceiling balanced against temperature (0.18)
export const WIND_GAIN_GAMMA = 1.5       // Non-linear power curve for natural dynamics

export const MIN_FILTER_CUTOFF_HZ = 280  // Low breeze cutoff
export const MAX_FILTER_CUTOFF_HZ = 2400 // Gale/storm bright cutoff
export const MIN_FILTER_Q = 0.7          // Wide gentle filter
export const MAX_FILTER_Q = 2.2          // More resonant airy filter at higher speeds

/**
 * Normalizes wind speed against SPEED_REFERENCE_MS to [0, 1].
 *
 * @param {number|null} speed - Wind speed in m/s
 * @param {number} [refSpeed=SPEED_REFERENCE_MS] - Reference max speed
 * @returns {number} Normalized value in [0, 1]
 */
export function normalizeWindSpeed(speed, refSpeed = SPEED_REFERENCE_MS) {
  if (typeof speed !== 'number' || isNaN(speed) || speed <= 0) return 0.0
  const ref = refSpeed > 0 ? refSpeed : SPEED_REFERENCE_MS
  return Math.max(0.0, Math.min(1.0, speed / ref))
}

/**
 * Maps wind speed to a non-linear gain value.
 * Calm/zero wind returns 0.
 *
 * @param {number|null} speed - Wind speed in m/s
 * @returns {number} Audio gain between 0 and MAX_WIND_GAIN
 */
export function windSpeedToGain(speed) {
  if (typeof speed !== 'number' || isNaN(speed) || speed <= 0) {
    return 0.0
  }
  const norm = normalizeWindSpeed(speed)
  // Non-linear curve: speed^gamma gives gentle low winds and intense high winds
  const scaled = Math.pow(norm, WIND_GAIN_GAMMA)
  const gain = MIN_WIND_GAIN + (MAX_WIND_GAIN - MIN_WIND_GAIN) * scaled
  return Math.round(gain * 10000) / 10000
}

/**
 * Maps wind speed to noise filter parameters (BiquadFilter bandpass).
 *
 * @param {number|null} speed - Wind speed in m/s
 * @returns {{ cutoffHz: number, q: number }}
 */
export function windSpeedToFilterParams(speed) {
  if (typeof speed !== 'number' || isNaN(speed) || speed <= 0) {
    return {
      cutoffHz: MIN_FILTER_CUTOFF_HZ,
      q: MIN_FILTER_Q,
    }
  }
  const norm = normalizeWindSpeed(speed)
  const cutoffHz = Math.round(
    MIN_FILTER_CUTOFF_HZ + (MAX_FILTER_CUTOFF_HZ - MIN_FILTER_CUTOFF_HZ) * Math.sqrt(norm)
  )
  const q = Math.round((MIN_FILTER_Q + (MAX_FILTER_Q - MIN_FILTER_Q) * norm) * 100) / 100

  return { cutoffHz, q }
}

/**
 * Maps meteorological wind direction (0° N, 90° E, 180° S, 270° W)
 * to stereo panning position in [-1, +1].
 *
 * Uses sinusoidal projection:
 *   - East (90°)  → +1.0 (Full Right)
 *   - West (270°) → -1.0 (Full Left)
 *   - North (0°)  →  0.0 (Center)
 *   - South (180°)→  0.0 (Center)
 *   - Smooth continuous transitions across all intermediate angles.
 *
 * @param {number|null} directionDeg - Meteorological direction in degrees [0, 360)
 * @returns {number} Pan value in [-1.0, +1.0]
 */
export function windDirectionToPan(directionDeg) {
  if (typeof directionDeg !== 'number' || isNaN(directionDeg)) {
    return 0.0
  }
  const rad = (directionDeg * Math.PI) / 180.0
  const pan = Math.sin(rad)
  const clamped = Math.max(-1.0, Math.min(1.0, pan))
  const rounded = Math.round(clamped * 1000) / 1000
  return Object.is(rounded, -0) || Math.abs(rounded) < 1e-6 ? 0 : rounded
}

/**
 * Calculates complete wind sonification parameters from a wind point.
 *
 * @param {object|null} windPoint - { speed: number, direction: number|null, ... }
 * @returns {{
 *   gain: number,
 *   cutoffHz: number,
 *   q: number,
 *   pan: number,
 *   isCalm: boolean
 * }}
 */
export function calculateWindAudioParams(windPoint) {
  if (!windPoint || typeof windPoint.speed !== 'number' || windPoint.speed <= 0) {
    return {
      gain: 0.0,
      cutoffHz: MIN_FILTER_CUTOFF_HZ,
      q: MIN_FILTER_Q,
      pan: 0.0,
      isCalm: true,
    }
  }

  const isCalm = windPoint.speed < 0.1 || windPoint.direction == null

  if (isCalm) {
    return {
      gain: 0.0,
      cutoffHz: MIN_FILTER_CUTOFF_HZ,
      q: MIN_FILTER_Q,
      pan: 0.0,
      isCalm: true,
    }
  }

  const gain = windSpeedToGain(windPoint.speed)
  const { cutoffHz, q } = windSpeedToFilterParams(windPoint.speed)
  const pan = windDirectionToPan(windPoint.direction)

  return {
    gain,
    cutoffHz,
    q,
    pan,
    isCalm: false,
  }
}
