/**
 * vegetationSonification.test.js — Phase 8
 *
 * Unit tests for vegetation (LAI) → timbral background mapping utilities.
 *
 * Verifies:
 *   1. LAI normalization (boundary values, clamping, out-of-range)
 *   2. NDVI normalization (boundary, clamping)
 *   3. Gain mapping (minimum/maximum LAI, monotonicity)
 *   4. LowShelf gain in dB mapping
 *   5. Filter Q mapping
 *   6. Filter frequency mapping
 *   7. Complete parameter calculation
 *   8. Hard constraint: vegetation NEVER controls pitch
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  VEGETATION_LAI_MAX,
  VEGETATION_LAI_MIN,
  MIN_VEGETATION_GAIN,
  MAX_VEGETATION_GAIN,
  normalizeLai,
  normalizeNdvi,
  vegetationNormToGain,
  vegetationNormToLowShelfGainDb,
  vegetationNormToFilterQ,
  vegetationNormToFilterFreq,
  calculateVegetationAudioParams,
} from '../src/utils/vegetationSonification.js'

import { temperatureToFrequency } from '../src/utils/sonification.js'

describe('Phase 8: Vegetation Sonification Utilities', () => {

  // ── 1. LAI Normalization ─────────────────────────────────────────────────
  describe('normalizeLai()', () => {
    test('minimum LAI → 0', () => {
      assert.strictEqual(normalizeLai(VEGETATION_LAI_MIN), 0.0)
      assert.strictEqual(normalizeLai(0), 0.0)
    })

    test('maximum LAI → 1', () => {
      assert.strictEqual(normalizeLai(VEGETATION_LAI_MAX), 1.0)
    })

    test('clamps values below minimum to 0', () => {
      assert.strictEqual(normalizeLai(-1.0), 0.0)
      assert.strictEqual(normalizeLai(-999), 0.0)
    })

    test('clamps values above maximum to 1', () => {
      assert.strictEqual(normalizeLai(VEGETATION_LAI_MAX * 2), 1.0)
    })

    test('null and NaN return 0', () => {
      assert.strictEqual(normalizeLai(null), 0.0)
      assert.strictEqual(normalizeLai(NaN), 0.0)
    })

    test('midpoint LAI normalizes to ~0.5', () => {
      const mid = (VEGETATION_LAI_MAX + VEGETATION_LAI_MIN) / 2
      const norm = normalizeLai(mid)
      assert.ok(Math.abs(norm - 0.5) < 0.01, `Mid LAI (${mid}) normalizes near 0.5, got ${norm}`)
    })

    test('normalization is monotonically increasing', () => {
      const n1 = normalizeLai(1.0)
      const n3 = normalizeLai(3.0)
      const n5 = normalizeLai(5.0)
      assert.ok(n1 < n3, 'higher LAI → higher norm')
      assert.ok(n3 < n5, 'higher LAI → higher norm')
    })
  })

  // ── 2. NDVI Normalization ────────────────────────────────────────────────
  describe('normalizeNdvi()', () => {
    test('minimum NDVI → 0', () => {
      assert.strictEqual(normalizeNdvi(0), 0.0)
    })

    test('maximum NDVI → 1', () => {
      assert.strictEqual(normalizeNdvi(0.9), 1.0)
    })

    test('negative NDVI (water/snow) → 0', () => {
      assert.strictEqual(normalizeNdvi(-0.5), 0.0)
    })

    test('null and NaN → 0', () => {
      assert.strictEqual(normalizeNdvi(null), 0.0)
      assert.strictEqual(normalizeNdvi(NaN), 0.0)
    })
  })

  // ── 3. Vegetation Gain Mapping ───────────────────────────────────────────
  describe('vegetationNormToGain()', () => {
    test('zero norm → exactly 0 gain (bare/no vegetation)', () => {
      assert.strictEqual(vegetationNormToGain(0), 0.0)
    })

    test('maximum norm → near MAX_VEGETATION_GAIN', () => {
      const gain = vegetationNormToGain(1.0)
      assert.ok(Math.abs(gain - MAX_VEGETATION_GAIN) < 0.001, 'Full norm → MAX_VEGETATION_GAIN')
    })

    test('gain is monotonically increasing with vegetation', () => {
      const g25 = vegetationNormToGain(0.25)
      const g50 = vegetationNormToGain(0.5)
      const g75 = vegetationNormToGain(0.75)
      assert.ok(g25 < g50, 'gain increases monotonically')
      assert.ok(g50 < g75, 'gain increases monotonically')
    })

    test('gain stays within valid range for all norm inputs', () => {
      const norms = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0]
      for (const n of norms) {
        const gain = vegetationNormToGain(n)
        assert.ok(gain >= MIN_VEGETATION_GAIN || gain === 0, `gain >= 0 for norm ${n}`)
        assert.ok(gain <= MAX_VEGETATION_GAIN + 0.0001, `gain <= MAX_VEGETATION_GAIN for norm ${n}`)
      }
    })

    test('invalid inputs return 0', () => {
      assert.strictEqual(vegetationNormToGain(null), 0.0)
      assert.strictEqual(vegetationNormToGain(NaN), 0.0)
      assert.strictEqual(vegetationNormToGain(-1), 0.0)
    })

    test('vegetation gain is very subtle (max stays at or below 0.1)', () => {
      assert.ok(MAX_VEGETATION_GAIN <= 0.1, 'Vegetation is a timbral bed, not a dominant sound')
    })
  })

  // ── 4. LowShelf Gain in dB ───────────────────────────────────────────────
  describe('vegetationNormToLowShelfGainDb()', () => {
    test('zero norm → 0 dB boost (no warmth)', () => {
      assert.strictEqual(vegetationNormToLowShelfGainDb(0), 0.0)
    })

    test('maximum norm → 9 dB boost (warm dense canopy)', () => {
      assert.strictEqual(vegetationNormToLowShelfGainDb(1.0), 9.0)
    })

    test('midpoint → approximately 4.5 dB', () => {
      const db = vegetationNormToLowShelfGainDb(0.5)
      assert.ok(Math.abs(db - 4.5) < 0.1, `Mid norm → ~4.5 dB, got ${db}`)
    })

    test('invalid inputs return 0', () => {
      assert.strictEqual(vegetationNormToLowShelfGainDb(null), 0.0)
      assert.strictEqual(vegetationNormToLowShelfGainDb(NaN), 0.0)
    })
  })

  // ── 5. Filter Q Mapping ──────────────────────────────────────────────────
  describe('vegetationNormToFilterQ()', () => {
    test('zero norm → high Q (sparse, narrow band)', () => {
      const q = vegetationNormToFilterQ(0)
      assert.ok(q >= 3.5, `Low vegetation has high Q (sparse character): ${q}`)
    })

    test('maximum norm → low Q (lush, wide band)', () => {
      const q = vegetationNormToFilterQ(1.0)
      assert.ok(q <= 1.0, `Dense canopy has low Q (full character): ${q}`)
    })

    test('Q decreases with increasing vegetation', () => {
      const q0 = vegetationNormToFilterQ(0)
      const q05 = vegetationNormToFilterQ(0.5)
      const q1 = vegetationNormToFilterQ(1.0)
      assert.ok(q0 > q05, 'Q decreases as vegetation increases')
      assert.ok(q05 > q1, 'Q continues to decrease')
    })
  })

  // ── 6. Filter Frequency Mapping ──────────────────────────────────────────
  describe('vegetationNormToFilterFreq()', () => {
    test('zero norm → high frequency (bare, bright)', () => {
      assert.strictEqual(vegetationNormToFilterFreq(0), 1800)
    })

    test('maximum norm → low frequency (dense, warm)', () => {
      assert.strictEqual(vegetationNormToFilterFreq(1.0), 600)
    })

    test('frequency decreases with increasing vegetation', () => {
      const f0 = vegetationNormToFilterFreq(0)
      const f05 = vegetationNormToFilterFreq(0.5)
      const f1 = vegetationNormToFilterFreq(1.0)
      assert.ok(f0 > f05, 'frequency shifts lower with vegetation')
      assert.ok(f05 > f1, 'frequency continues to shift lower')
    })
  })

  // ── 7. Complete Parameter Calculation ───────────────────────────────────
  describe('calculateVegetationAudioParams()', () => {
    test('null LAI → minimal params (no vegetation)', () => {
      const params = calculateVegetationAudioParams(null)
      assert.strictEqual(params.norm, 0.0)
      assert.strictEqual(params.gain, 0.0)
      assert.strictEqual(params.lowShelfGainDb, 0.0)
    })

    test('zero LAI → bare ground params', () => {
      const params = calculateVegetationAudioParams(0)
      assert.strictEqual(params.norm, 0.0)
      assert.strictEqual(params.gain, 0.0)
    })

    test('moderate LAI (2.5) → medium timbral character', () => {
      const params = calculateVegetationAudioParams(2.5)
      assert.ok(params.norm > 0, 'norm > 0')
      assert.ok(params.norm < 1, 'norm < 1')
      assert.ok(params.gain > 0, 'audible gain')
      assert.ok(params.lowShelfGainDb > 0, 'some warmth')
    })

    test('maximum LAI → richest timbral params', () => {
      const params = calculateVegetationAudioParams(VEGETATION_LAI_MAX)
      assert.strictEqual(params.norm, 1.0)
      assert.ok(Math.abs(params.gain - MAX_VEGETATION_GAIN) < 0.001)
      assert.strictEqual(params.lowShelfGainDb, 9.0)
    })

    test('params contain no pitch/frequency parameter', () => {
      const params = calculateVegetationAudioParams(3.5)
      assert.strictEqual('pitch' in params, false)
      assert.strictEqual('oscillatorFreq' in params, false)
      assert.strictEqual('hz' in params, false)
    })
  })

  // ── 8. Hard Constraint: No Pitch Control ────────────────────────────────
  describe('Hard Constraint: Vegetation never controls pitch', () => {
    test('temperature frequency is unaffected by vegetation value', () => {
      const freq = temperatureToFrequency(28.0, 20.0)

      // Simulate dense tropical vegetation
      calculateVegetationAudioParams(5.0)
      // Simulate barren desert
      calculateVegetationAudioParams(0.1)

      // Temperature frequency must remain deterministic
      const freqAfter = temperatureToFrequency(28.0, 20.0)
      assert.strictEqual(freq, freqAfter, 'Vegetation does not mutate temperature frequency')
    })

    test('vegetation params do not have a frequency property', () => {
      const params = calculateVegetationAudioParams(4.0)
      assert.strictEqual('frequency' in params, false, 'No pitch frequency in vegetation params')
    })
  })
})
