/**
 * pressureSonification.js — Phase 9
 *
 * Mathematical utilities for the Pressure System (ps).
 *
 * ps — Surface Pressure (Pa), NASA GEOS-FP PS variable.
 *
 * This is an EXPERIMENTAL system. No definitive mapping is assumed.
 * This module implements multiple candidate mappings so each can be
 * A/B tested perceptually.
 *
 * Typical surface pressure range:
 *   Sea level:        ~101325 Pa (standard atmosphere)
 *   Mountain station: ~80000 Pa
 *   Low pressure sys: ~95000 Pa (storm)
 *   High pressure sys:~104000 Pa (clear/stable)
 *
 * For near-sea-level locations (like Dhaka at ~4m ASL):
 *   Range is approximately 98000–102000 Pa diurnally,
 *   wider range during weather systems.
 *
 * Candidate Mappings (all implemented for A/B testing):
 *
 *   Candidate A: ps → subtle wind timbre modifier
 *     High pressure → brighter wind character
 *     Low pressure  → more resonant/turbulent wind character
 *
 *   Candidate B: ps + tqv → atmospheric texture modifier
 *     (not implemented in audio directly — tqv handled by moistureSonification)
 *
 *   Candidate C: ps → thermal/atmospheric character
 *     High pressure → slight warmth to temperature layer
 *     Low pressure  → slight coolness/tension
 *
 *   Candidate D (DEFAULT): ps → subtle global filter modifier
 *     Applied as a very gentle spectral tilt across all layers.
 *     High pressure → slightly brighter overall
 *     Low pressure  → slightly darker/more resonant overall
 *
 * CONSTRAINT: ps NEVER controls pitch.
 * CONSTRAINT: ps effect should be barely perceptible at normal settings.
 */

/** Reference pressure range for normalization */
export const PS_REFERENCE_HIGH_PA = 104000.0   // Very high pressure
export const PS_REFERENCE_LOW_PA  =  97000.0   // Storm-level low pressure
export const PS_REFERENCE_MID_PA  = 101325.0   // Standard atmosphere

/** Global EQ filter range controlled by ps (Candidate D) */
export const PS_FILTER_HZ_LOW  = 800     // Low pressure → lower spectral center
export const PS_FILTER_HZ_HIGH = 1600    // High pressure → higher spectral center

/** Gain range for pressure modifier (very subtle) */
export const PS_MAX_GAIN_MODIFIER = 0.04   // Maximum additional gain at extreme pressure

/**
 * Normalize surface pressure to [0, 1].
 * 0 = very low pressure (storm), 1 = very high pressure (clear/stable).
 *
 * @param {number|null} ps - Surface pressure in Pa
 * @returns {number} Normalized value in [0, 1]
 */
export function normalizePressure(ps) {
  if (typeof ps !== 'number' || isNaN(ps) || ps <= 0) return 0.5  // neutral default
  const clamped = Math.max(PS_REFERENCE_LOW_PA, Math.min(PS_REFERENCE_HIGH_PA, ps))
  return (clamped - PS_REFERENCE_LOW_PA) / (PS_REFERENCE_HIGH_PA - PS_REFERENCE_LOW_PA)
}

/**
 * Compute pressure anomaly: deviation from standard atmosphere.
 * Positive = above standard (high pressure)
 * Negative = below standard (low pressure)
 *
 * @param {number|null} ps - Surface pressure in Pa
 * @returns {number} Anomaly in Pa (0 if invalid)
 */
export function computePressureAnomaly(ps) {
  if (typeof ps !== 'number' || isNaN(ps) || ps <= 0) return 0.0
  return ps - PS_REFERENCE_MID_PA
}

// ── Candidate A: Pressure → wind timbre modifier ──────────────────────────

/**
 * Maps pressure normalization to a filter Q modifier for the wind layer.
 * High pressure → cleaner/brighter wind (lower Q)
 * Low pressure  → more turbulent wind (higher Q)
 *
 * @param {number} psNorm - Normalized pressure in [0, 1]
 * @returns {number} Q delta to ADD to wind bandpass Q
 */
export function pressureToWindQModifier(psNorm) {
  if (typeof psNorm !== 'number' || isNaN(psNorm)) return 0.0
  // Range: ±0.3 Q units (subtle)
  return Math.round((0.5 - psNorm) * 0.6 * 100) / 100
}

// ── Candidate D: Pressure → global subtle timbre ──────────────────────────

/**
 * Maps pressure normalization to a global filter cutoff.
 * This filter sits on the master bus conceptually.
 * High pressure → slightly higher cutoff (brighter, cleaner)
 * Low pressure  → slightly lower cutoff (darker, denser)
 *
 * @param {number} psNorm - Normalized pressure in [0, 1]
 * @returns {number} Filter cutoff in Hz
 */
export function pressureToFilterHz(psNorm) {
  if (typeof psNorm !== 'number' || isNaN(psNorm)) return (PS_FILTER_HZ_LOW + PS_FILTER_HZ_HIGH) / 2
  const n = Math.max(0.0, Math.min(1.0, psNorm))
  return Math.round(PS_FILTER_HZ_LOW + (PS_FILTER_HZ_HIGH - PS_FILTER_HZ_LOW) * n)
}

/**
 * Maps pressure to a subtle global gain modifier.
 * The effect should be barely perceptible.
 *
 * @param {number} psNorm - Normalized pressure in [0, 1]
 * @returns {number} Gain modifier in [0, PS_MAX_GAIN_MODIFIER]
 */
export function pressureToGainModifier(psNorm) {
  if (typeof psNorm !== 'number' || isNaN(psNorm)) return PS_MAX_GAIN_MODIFIER / 2
  const n = Math.max(0.0, Math.min(1.0, psNorm))
  return Math.round((PS_MAX_GAIN_MODIFIER * n) * 10000) / 10000
}

/**
 * Calculate complete pressure audio modifier parameters (Candidate D default).
 *
 * @param {number|null} ps - Surface pressure in Pa
 * @returns {{
 *   norm: number,
 *   anomalyPa: number,
 *   filterHz: number,
 *   gainModifier: number,
 *   windQModifier: number,
 *   isHighPressure: boolean,
 *   isLowPressure: boolean,
 * }}
 */
export function calculatePressureAudioParams(ps) {
  const norm = normalizePressure(ps)
  const anomalyPa = computePressureAnomaly(ps)
  const filterHz = pressureToFilterHz(norm)
  const gainModifier = pressureToGainModifier(norm)
  const windQModifier = pressureToWindQModifier(norm)

  return {
    norm,
    anomalyPa,
    filterHz,
    gainModifier,
    windQModifier,
    isHighPressure: norm > 0.65,
    isLowPressure: norm < 0.35,
  }
}

/**
 * Format surface pressure for display.
 * Converts Pa to hPa (hectopascals, same as millibar) for human readability.
 *
 * @param {number|null} ps - Surface pressure in Pa
 * @returns {string} Formatted string like "1013.2 hPa"
 */
export function formatPressureHpa(ps) {
  if (typeof ps !== 'number' || isNaN(ps)) return '—'
  return `${(ps / 100).toFixed(1)} hPa`
}
