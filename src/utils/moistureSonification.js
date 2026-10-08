/**
 * moistureSonification.js — Phase 9
 *
 * Mathematical utilities for the Moisture/Precipitation System (tqv + tprecmax).
 *
 * Architecture:
 *   tprecmax → rain event density + intensity  (builds on precipitationSonification)
 *   tqv      → atmospheric moisture character   (this module adds tqv modulation)
 *
 * Variables:
 *   tprecmax — Total precipitation maximum (kg/m²/s), NASA GEOS-FP TPRECMAX
 *              Same physical meaning as PRECTOT but peak-value variant.
 *              Use precipitationSonification.js functions for rain mapping.
 *
 *   tqv — Total Precipitable Water Vapor (kg/m²), NASA GEOS-FP TQV
 *         Represents the total column water vapor above the surface.
 *         Typical global range: 0 (polar/dry) to 70 (tropical/saturated).
 *
 * Perceptual behavior:
 *
 *   Low tqv  + no rain  → dry, open, sparse atmospheric character
 *   High tqv + no rain  → humid, heavy, dense atmospheric ambience
 *   Low tqv  + rain     → light shower, relatively dry air
 *   High tqv + rain     → saturated, intense downpour environment
 *
 * Audio mapping:
 *   tprecmax → rain layer (gain + density + filter) via precipitationSonification
 *   tqv      → modifies the FILTER CHARACTER of the moisture/rain layer:
 *                High tqv → lower bandpass cutoff (fuller, denser texture)
 *                Low tqv  → higher bandpass cutoff (brighter, sparser texture)
 *              Also adds a very subtle background "atmospheric breath" gain
 *              that is non-zero even without precipitation.
 *
 * Constraint: tqv NEVER controls pitch.
 * Constraint: tprecmax NEVER controls pitch.
 */

/** Maximum reference TQV for normalization (kg/m²) — tropical saturated air */
export const TQV_REFERENCE_KGM2 = 70.0

/** Minimum TQV below which atmosphere is considered very dry */
export const TQV_DRY_THRESHOLD_KGM2 = 2.0

/** Bandpass filter cutoff range controlled by tqv */
export const TQV_FILTER_HZ_DRY  = 2000   // Dry air → bright band
export const TQV_FILTER_HZ_WET  = 600    // Saturated air → full, rich band

/** Q range for moisture bandpass filter */
export const TQV_FILTER_Q_DRY   = 2.0
export const TQV_FILTER_Q_WET   = 0.8

/**
 * Background atmospheric "breath" gain added by tqv even with no precipitation.
 * This is extremely subtle — just enough to give humid air a different feel.
 */
export const TQV_MAX_AMBIENT_GAIN = 0.012   // Much less than rain gain

/**
 * Normalize Total Precipitable Water Vapor to [0, 1].
 *
 * @param {number|null} tqv - Precipitable water vapor in kg/m²
 * @returns {number} Normalized value in [0, 1]
 */
export function normalizeTqv(tqv) {
  if (typeof tqv !== 'number' || isNaN(tqv) || tqv <= TQV_DRY_THRESHOLD_KGM2) return 0.0
  const clamped = Math.min(tqv, TQV_REFERENCE_KGM2)
  return Math.max(0.0, Math.min(1.0, (clamped - TQV_DRY_THRESHOLD_KGM2) / (TQV_REFERENCE_KGM2 - TQV_DRY_THRESHOLD_KGM2)))
}

/**
 * Maps tqv normalization to the bandpass filter cutoff frequency.
 * High moisture → lower cutoff (richer, fuller texture).
 *
 * @param {number} tqvNorm - Normalized tqv in [0, 1]
 * @returns {number} Filter cutoff in Hz
 */
export function tqvNormToFilterHz(tqvNorm) {
  if (typeof tqvNorm !== 'number' || isNaN(tqvNorm)) return TQV_FILTER_HZ_DRY
  const n = Math.max(0.0, Math.min(1.0, tqvNorm))
  return Math.round(TQV_FILTER_HZ_DRY - (TQV_FILTER_HZ_DRY - TQV_FILTER_HZ_WET) * n)
}

/**
 * Maps tqv normalization to the bandpass filter Q.
 * High moisture → lower Q (wider band, more immersive).
 *
 * @param {number} tqvNorm - Normalized tqv in [0, 1]
 * @returns {number} Filter Q
 */
export function tqvNormToFilterQ(tqvNorm) {
  if (typeof tqvNorm !== 'number' || isNaN(tqvNorm)) return TQV_FILTER_Q_DRY
  const n = Math.max(0.0, Math.min(1.0, tqvNorm))
  return Math.round((TQV_FILTER_Q_DRY - (TQV_FILTER_Q_DRY - TQV_FILTER_Q_WET) * n) * 100) / 100
}

/**
 * Maps tqv to a very subtle ambient atmospheric background gain.
 * This is present even without precipitation — just humid air ambience.
 * It is extremely quiet and does not overpower rain.
 *
 * @param {number} tqvNorm - Normalized tqv in [0, 1]
 * @returns {number} Ambient gain in [0, TQV_MAX_AMBIENT_GAIN]
 */
export function tqvNormToAmbientGain(tqvNorm) {
  if (typeof tqvNorm !== 'number' || isNaN(tqvNorm) || tqvNorm <= 0) return 0.0
  return Math.round(TQV_MAX_AMBIENT_GAIN * Math.pow(tqvNorm, 1.5) * 10000) / 10000
}

/**
 * Calculate complete moisture audio parameters from both tqv and tprecmax.
 *
 * @param {number|null} tqv     - Total precipitable water in kg/m²
 * @param {number|null} tprecmax - Total precipitation in kg/m²/s
 * @returns {{
 *   tqvNorm: number,
 *   filterHz: number,
 *   filterQ: number,
 *   ambientGain: number,
 *   isDry: boolean,
 * }}
 */
export function calculateMoistureAudioParams(tqv, tprecmax) {
  const tqvNorm = normalizeTqv(tqv)
  const filterHz = tqvNormToFilterHz(tqvNorm)
  const filterQ = tqvNormToFilterQ(tqvNorm)
  const ambientGain = tqvNormToAmbientGain(tqvNorm)

  // Is the atmosphere genuinely dry (low tqv AND no rain)?
  const hasPrecip = typeof tprecmax === 'number' && !isNaN(tprecmax) && tprecmax > 0
  const isDry = tqvNorm < 0.05 && !hasPrecip

  return {
    tqvNorm,
    filterHz,
    filterQ,
    ambientGain,
    isDry,
  }
}
