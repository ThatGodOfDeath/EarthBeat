/**
 * vegetationSonification.js — Phase 8
 *
 * Mathematical utilities for mapping vegetation data to audio parameters.
 * Vegetation → Timbral Background Character, NOT pitch.
 *
 * Design Principles:
 *   - Vegetation does NOT control pitch/frequency.
 *   - Vegetation does NOT behave like rain.
 *   - Vegetation changes slowly → influences the overall background character.
 *   - Low vegetation → sparse/dry timbral character (brighter, thinner).
 *   - High vegetation → fuller/richer/softer organic character.
 *
 * NASA Data Source: MODIS NDVI or GEOS-FP LAI (Leaf Area Index).
 * Preferred: GEOS-FP LAI (variable: LAI) from inst1_2d_lfo_Nx.
 *   LAI range: 0.0 (bare soil/water) to ~8.0 (dense tropical canopy)
 *
 * Alternatively, NDVI from NASA MODIS:
 *   NDVI range: -1.0 to 1.0. Vegetation: ~0.1 to 0.9.
 *
 * We use GEOS-FP LAI as it shares the same OPeNDAP architecture.
 *
 * Timbral Effect Architecture:
 *   Low LAI  → narrow bandpass noise (dry/rattling/sparse)
 *   High LAI → wider/softer bandpass noise with gentle chorus/reverb character
 *
 * Implementation:
 *   A dedicated vegetation timbral bed uses filtered noise through a BiquadFilter
 *   with a LowShelf boost at low frequencies for richness.
 *   Filter Q and gain change with vegetation to create perceivable timbral shift.
 */

/** Maximum reference LAI for normalization (dense tropical canopy) */
export const VEGETATION_LAI_MAX = 7.0

/** Minimum LAI treated as "no vegetation" */
export const VEGETATION_LAI_MIN = 0.0

/** NDVI range for normalization (used if NDVI is chosen instead of LAI) */
export const VEGETATION_NDVI_MIN = 0.0
export const VEGETATION_NDVI_MAX = 0.9

/** Gain of the vegetation timbral bed layer */
export const MIN_VEGETATION_GAIN = 0.0
export const MAX_VEGETATION_GAIN = 0.06  // Very subtle — timbral, not melodic

/** BiquadFilter (lowshelf) parameters */
export const VEGETATION_FILTER_LOW_FREQ_HZ = 300   // Low-shelf boost frequency
export const VEGETATION_FILTER_HIGH_FREQ_HZ = 1800  // Bandpass center

/**
 * Normalize a LAI value to [0, 1].
 *
 * @param {number|null} lai - Leaf Area Index (0 = bare, ~7 = dense canopy)
 * @returns {number} Normalized value in [0, 1]
 */
export function normalizeLai(lai) {
  if (typeof lai !== 'number' || isNaN(lai)) return 0.0
  const clamped = Math.max(VEGETATION_LAI_MIN, Math.min(VEGETATION_LAI_MAX, lai))
  if (VEGETATION_LAI_MAX === VEGETATION_LAI_MIN) return 0.0
  return (clamped - VEGETATION_LAI_MIN) / (VEGETATION_LAI_MAX - VEGETATION_LAI_MIN)
}

/**
 * Normalize an NDVI value to [0, 1].
 * Used as a fallback if LAI is not available.
 *
 * @param {number|null} ndvi - NDVI value (-1 to 1)
 * @returns {number} Normalized value in [0, 1]
 */
export function normalizeNdvi(ndvi) {
  if (typeof ndvi !== 'number' || isNaN(ndvi)) return 0.0
  const clamped = Math.max(VEGETATION_NDVI_MIN, Math.min(VEGETATION_NDVI_MAX, ndvi))
  return (clamped - VEGETATION_NDVI_MIN) / (VEGETATION_NDVI_MAX - VEGETATION_NDVI_MIN)
}

/**
 * Maps normalized vegetation [0, 1] to a timbral bed gain.
 * Low → essentially silent background.
 * High → subtle but audible organic texture.
 *
 * @param {number} norm - Normalized vegetation [0, 1]
 * @returns {number} Gain value in [MIN_VEGETATION_GAIN, MAX_VEGETATION_GAIN]
 */
export function vegetationNormToGain(norm) {
  if (typeof norm !== 'number' || isNaN(norm) || norm <= 0) return 0.0
  const clamped = Math.max(0.0, Math.min(1.0, norm))
  // Power curve: ensures low vegetation is truly sparse/silent
  const scaled = Math.pow(clamped, 1.5)
  return Math.round((MIN_VEGETATION_GAIN + (MAX_VEGETATION_GAIN - MIN_VEGETATION_GAIN) * scaled) * 100000) / 100000
}

/**
 * Maps normalized vegetation [0, 1] to a lowshelf filter gain (dB).
 * Higher vegetation → warmer low-frequency boost (richer, softer character).
 * Lower vegetation → no boost (thin, sparse character).
 *
 * @param {number} norm - Normalized vegetation [0, 1]
 * @returns {number} LowShelf boost in dB, range [0, +9]
 */
export function vegetationNormToLowShelfGainDb(norm) {
  if (typeof norm !== 'number' || isNaN(norm)) return 0.0
  const clamped = Math.max(0.0, Math.min(1.0, norm))
  // Linear mapping: 0 dB at barren, +9 dB at full canopy
  return Math.round(clamped * 9.0 * 100) / 100
}

/**
 * Maps normalized vegetation [0, 1] to bandpass filter Q factor.
 * Low vegetation → high Q (narrow band, sparse/raspy character)
 * High vegetation → low Q (wide band, soft/full character)
 *
 * @param {number} norm - Normalized vegetation [0, 1]
 * @returns {number} Q factor
 */
export function vegetationNormToFilterQ(norm) {
  if (typeof norm !== 'number' || isNaN(norm)) return 4.0
  const clamped = Math.max(0.0, Math.min(1.0, norm))
  // Q ranges from 4.0 (sparse, narrow) down to 0.8 (lush, wide)
  const q = 4.0 - (4.0 - 0.8) * clamped
  return Math.round(q * 100) / 100
}

/**
 * Maps normalized vegetation [0, 1] to bandpass filter center frequency.
 * Low vegetation → higher center frequency (bright, dry)
 * High vegetation → lower center frequency (warm, full)
 *
 * @param {number} norm - Normalized vegetation [0, 1]
 * @returns {number} Bandpass center frequency in Hz
 */
export function vegetationNormToFilterFreq(norm) {
  if (typeof norm !== 'number' || isNaN(norm)) return 1800
  const clamped = Math.max(0.0, Math.min(1.0, norm))
  // From 1800 Hz (bare) to 600 Hz (dense canopy)
  const freq = 1800 - (1800 - 600) * clamped
  return Math.round(freq)
}

/**
 * Calculate complete vegetation timbral audio parameters from a LAI value.
 *
 * @param {number|null} lai - Leaf Area Index from NASA GEOS-FP
 * @returns {{ norm: number, gain: number, lowShelfGainDb: number, filterQ: number, filterFreqHz: number }}
 */
export function calculateVegetationAudioParams(lai) {
  const norm = normalizeLai(lai)
  return {
    norm,
    gain: vegetationNormToGain(norm),
    lowShelfGainDb: vegetationNormToLowShelfGainDb(norm),
    filterQ: vegetationNormToFilterQ(norm),
    filterFreqHz: vegetationNormToFilterFreq(norm),
  }
}
