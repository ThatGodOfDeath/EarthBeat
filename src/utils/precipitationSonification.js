/**
 * precipitationSonification.js — Phase 8
 *
 * Mathematical utilities for mapping precipitation data to audio parameters.
 * Precipitation → Rain Texture (timbre), NOT pitch.
 *
 * Design Principles:
 *   - Precipitation does NOT control pitch/frequency under any circumstances.
 *   - Temperature remains the sole pitch controller.
 *   - Zero precipitation → complete silence (no rain layer).
 *   - Increasing precipitation → denser, higher-energy rain texture.
 *   - The rain sound must be perceptually distinguishable from the wind layer.
 *
 * NASA GEOS-FP Variable Used: PRECTOT (Total Surface Precipitation, kg/m²/s)
 *   Typical range: 0 (dry) to ~0.001 kg/m²/s (heavy rain)
 *   Converted to mm/hr for perceptual mapping: multiply by 3600000.
 *
 * Perceptual Mapping:
 *   0 mm/hr          → silence
 *   0–1 mm/hr        → very sparse droplets (trace / very light)
 *   1–5 mm/hr        → light rain
 *   5–20 mm/hr       → moderate rain
 *   20–50 mm/hr      → heavy rain
 *   50+ mm/hr        → very heavy / torrential (clamped to max)
 */

/** Maximum reference rain rate for normalization (mm/hr) */
export const RAIN_REFERENCE_MM_HR = 50.0

/** Threshold below which rain layer is considered absent */
export const RAIN_SILENCE_THRESHOLD_MM_HR = 0.05

/** Minimum non-silent rain gain (just-audible droplets) */
export const MIN_RAIN_GAIN = 0.01

/** Maximum rain layer gain */
export const MAX_RAIN_GAIN = 0.35

/**
 * Convert precipitation from kg/m²/s (NASA PRECTOT) to mm/hr.
 *
 * @param {number|null} kgM2S - Precipitation rate in kg/m²/s
 * @returns {number} Equivalent rain rate in mm/hr (≥ 0)
 */
export function precipitationToMmHr(kgM2S) {
  if (typeof kgM2S !== 'number' || isNaN(kgM2S) || kgM2S <= 0) return 0.0
  return kgM2S * 3_600_000.0
}

/**
 * Normalize a mm/hr precipitation value to [0, 1] using a logarithmic scale
 * so that light rain is clearly distinguishable from moderate rain.
 *
 * @param {number} mmHr - Precipitation in mm/hr
 * @returns {number} Normalized value in [0, 1]
 */
export function normalizePrecipitation(mmHr) {
  if (typeof mmHr !== 'number' || isNaN(mmHr) || mmHr <= RAIN_SILENCE_THRESHOLD_MM_HR) {
    return 0.0
  }
  // Logarithmic scaling gives perceptually even spacing across rain intensities
  const clamped = Math.min(mmHr, RAIN_REFERENCE_MM_HR)
  // log1p gives nice 0..1 spread from 0 to RAIN_REFERENCE_MM_HR
  const norm = Math.log1p(clamped) / Math.log1p(RAIN_REFERENCE_MM_HR)
  return Math.max(0.0, Math.min(1.0, norm))
}

/**
 * Maps normalized precipitation [0, 1] to a rain layer gain value.
 * Zero precipitation → exactly 0 gain (silence).
 *
 * @param {number} mmHr - Precipitation in mm/hr
 * @returns {number} Gain in [0, MAX_RAIN_GAIN]
 */
export function precipitationToRainGain(mmHr) {
  const norm = normalizePrecipitation(mmHr)
  if (norm === 0.0) return 0.0
  // Square root curve: perceptually brighter onset for moderate rain
  const scaled = Math.sqrt(norm)
  return Math.round((MIN_RAIN_GAIN + (MAX_RAIN_GAIN - MIN_RAIN_GAIN) * scaled) * 10000) / 10000
}

/**
 * Maps precipitation to a droplet/burst density factor in [0, 1].
 * Controls how often discrete rain impulses fire in sparse mode.
 * At heavy rain, density approaches 1 (continuous texture).
 *
 * @param {number} mmHr - Precipitation in mm/hr
 * @returns {number} Density in [0, 1]
 */
export function precipitationToRainDensity(mmHr) {
  const norm = normalizePrecipitation(mmHr)
  // Linear mapping: density grows proportionally to normalized rain
  return Math.round(norm * 1000) / 1000
}

/**
 * Maps precipitation to a highpass filter frequency for the rain noise band.
 * Light rain → higher cutoff (bright, sparse drips)
 * Heavy rain → lower cutoff (fuller, more resonant roar)
 *
 * @param {number} mmHr - Precipitation in mm/hr
 * @returns {number} Highpass filter cutoff frequency in Hz
 */
export function precipitationToFilterCutoff(mmHr) {
  const norm = normalizePrecipitation(mmHr)
  if (norm === 0.0) return 4000
  // From 4000 Hz (sparse) down to 800 Hz (torrential)
  const cutoff = 4000 - (4000 - 800) * norm
  return Math.round(cutoff)
}

/**
 * Calculate the complete set of audio parameters for a given precipitation value.
 *
 * @param {number|null} precipKgM2S - Raw precipitation in kg/m²/s (NASA PRECTOT)
 * @returns {{ mmHr: number, norm: number, gain: number, density: number, filterCutoff: number, isSilent: boolean }}
 */
export function calculateRainAudioParams(precipKgM2S) {
  const mmHr = precipitationToMmHr(precipKgM2S)
  const norm = normalizePrecipitation(mmHr)
  const isSilent = norm === 0.0

  return {
    mmHr,
    norm,
    gain: precipitationToRainGain(mmHr),
    density: precipitationToRainDensity(mmHr),
    filterCutoff: precipitationToFilterCutoff(mmHr),
    isSilent,
  }
}
