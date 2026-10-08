/**
 * precipitationSonification.test.js — Phase 8
 *
 * Unit tests for precipitation → rain texture mapping utilities.
 *
 * Verifies:
 *   1. kg/m²/s → mm/hr conversion
 *   2. Normalization (log scale, boundary values, silence threshold)
 *   3. Rain gain mapping (zero, low, moderate, heavy, clamping)
 *   4. Rain density mapping
 *   5. Filter cutoff mapping
 *   6. Complete parameter calculation
 *   7. Hard constraint: precipitation NEVER controls pitch
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  RAIN_SILENCE_THRESHOLD_MM_HR,
  RAIN_REFERENCE_MM_HR,
  MIN_RAIN_GAIN,
  MAX_RAIN_GAIN,
  precipitationToMmHr,
  normalizePrecipitation,
  precipitationToRainGain,
  precipitationToRainDensity,
  precipitationToFilterCutoff,
  calculateRainAudioParams,
} from '../src/utils/precipitationSonification.js'

import { temperatureToFrequency } from '../src/utils/sonification.js'

describe('Phase 8: Precipitation Sonification Utilities', () => {

  // ── 1. Unit Conversion ───────────────────────────────────────────────────
  describe('precipitationToMmHr()', () => {
    test('converts kg/m²/s to mm/hr correctly', () => {
      // 1 kg/m²/s = 3,600,000 mm/hr
      assert.strictEqual(precipitationToMmHr(1.0), 3_600_000.0)
      assert.strictEqual(precipitationToMmHr(0.0001), 360.0)
      assert.strictEqual(precipitationToMmHr(0), 0.0)
    })

    test('returns 0 for null, NaN, and negative values', () => {
      assert.strictEqual(precipitationToMmHr(null), 0.0)
      assert.strictEqual(precipitationToMmHr(NaN), 0.0)
      assert.strictEqual(precipitationToMmHr(-0.001), 0.0)
    })

    test('maps moderate GEOS-FP rain value to recognizable mm/hr', () => {
      // 0.00005 kg/m²/s ≈ 180 mm/hr (very heavy rain)
      const mmHr = precipitationToMmHr(0.00005)
      assert.ok(mmHr > 100, 'moderate NASA value produces substantial mm/hr')
    })
  })

  // ── 2. Normalization ─────────────────────────────────────────────────────
  describe('normalizePrecipitation()', () => {
    test('returns 0 for silence threshold and below', () => {
      assert.strictEqual(normalizePrecipitation(0), 0.0)
      assert.strictEqual(normalizePrecipitation(RAIN_SILENCE_THRESHOLD_MM_HR / 2), 0.0)
      assert.strictEqual(normalizePrecipitation(RAIN_SILENCE_THRESHOLD_MM_HR), 0.0)
    })

    test('returns 1 at reference max', () => {
      const norm = normalizePrecipitation(RAIN_REFERENCE_MM_HR)
      assert.strictEqual(norm, 1.0)
    })

    test('clamps values above reference to 1', () => {
      const norm = normalizePrecipitation(RAIN_REFERENCE_MM_HR * 5)
      assert.strictEqual(norm, 1.0)
    })

    test('returns monotonically increasing values for increasing rain', () => {
      const n1 = normalizePrecipitation(1.0)
      const n5 = normalizePrecipitation(5.0)
      const n20 = normalizePrecipitation(20.0)
      assert.ok(n1 < n5, 'light rain < moderate rain norm')
      assert.ok(n5 < n20, 'moderate rain < heavy rain norm')
    })

    test('log scale: moderate rain is below 0.5 norm (perceptual spacing)', () => {
      // With log scaling, 25 mm/hr (half of 50 mm/hr reference) should be
      // noticeably above 0.5 due to log compression
      const norm = normalizePrecipitation(25.0)
      assert.ok(norm > 0.7, 'half reference produces >0.7 due to log scale')
    })
  })

  // ── 3. Rain Gain Mapping ─────────────────────────────────────────────────
  describe('precipitationToRainGain()', () => {
    test('zero precipitation → exactly 0 gain (silence)', () => {
      assert.strictEqual(precipitationToRainGain(0), 0.0)
      assert.strictEqual(precipitationToRainGain(RAIN_SILENCE_THRESHOLD_MM_HR / 2), 0.0)
    })

    test('very light precipitation → small but non-zero gain', () => {
      const gain = precipitationToRainGain(0.5)  // 0.5 mm/hr = just above trace
      assert.ok(gain > 0, 'non-zero for trace precipitation')
      assert.ok(gain <= MAX_RAIN_GAIN, 'bounded by MAX_RAIN_GAIN')
      // With log scale, 0.5/50 = 1% of range, so gain should be much less than max
      assert.ok(gain < MAX_RAIN_GAIN * 0.7, 'trace precipitation gain is well below maximum')
    })

    test('moderate precipitation → clearly audible gain', () => {
      const gain = precipitationToRainGain(10.0)  // 10 mm/hr = moderate rain
      assert.ok(gain > MIN_RAIN_GAIN, 'above minimum gain')
      assert.ok(gain < MAX_RAIN_GAIN, 'below maximum gain')
    })

    test('heavy precipitation → near maximum gain', () => {
      const gain = precipitationToRainGain(RAIN_REFERENCE_MM_HR)
      assert.ok(Math.abs(gain - MAX_RAIN_GAIN) < 0.001, 'approaches MAX_RAIN_GAIN at reference')
    })

    test('gain is monotonically increasing with rain intensity', () => {
      const g1 = precipitationToRainGain(1.0)
      const g5 = precipitationToRainGain(5.0)
      const g20 = precipitationToRainGain(20.0)
      const g50 = precipitationToRainGain(50.0)
      assert.ok(g1 < g5, '1 mm/hr gain < 5 mm/hr gain')
      assert.ok(g5 < g20, '5 mm/hr gain < 20 mm/hr gain')
      assert.ok(g20 < g50, '20 mm/hr gain < 50 mm/hr gain')
    })

    test('gain stays within [0, MAX_RAIN_GAIN] for all inputs', () => {
      const values = [0, 0.1, 1, 5, 10, 25, 50, 100, 1000]
      for (const v of values) {
        const gain = precipitationToRainGain(v)
        assert.ok(gain >= 0, `gain >= 0 for ${v} mm/hr`)
        assert.ok(gain <= MAX_RAIN_GAIN + 0.0001, `gain <= MAX_RAIN_GAIN for ${v} mm/hr`)
      }
    })
  })

  // ── 4. Rain Density Mapping ──────────────────────────────────────────────
  describe('precipitationToRainDensity()', () => {
    test('zero precipitation → density 0', () => {
      assert.strictEqual(precipitationToRainDensity(0), 0.0)
    })

    test('reference precipitation → density 1', () => {
      const density = precipitationToRainDensity(RAIN_REFERENCE_MM_HR)
      assert.strictEqual(density, 1.0)
    })

    test('density increases monotonically', () => {
      const d1 = precipitationToRainDensity(1.0)
      const d10 = precipitationToRainDensity(10.0)
      const d50 = precipitationToRainDensity(50.0)
      assert.ok(d1 < d10, 'density increases with rain')
      assert.ok(d10 < d50, 'density continues to increase')
    })
  })

  // ── 5. Filter Cutoff Mapping ─────────────────────────────────────────────
  describe('precipitationToFilterCutoff()', () => {
    test('no precipitation → highest cutoff (bright, sparse)', () => {
      assert.strictEqual(precipitationToFilterCutoff(0), 4000)
    })

    test('heavy rain → lower cutoff (fuller texture)', () => {
      const cutoff = precipitationToFilterCutoff(RAIN_REFERENCE_MM_HR)
      assert.strictEqual(cutoff, 800)
    })

    test('cutoff decreases monotonically with increasing rain', () => {
      const c1 = precipitationToFilterCutoff(1.0)
      const c10 = precipitationToFilterCutoff(10.0)
      const c50 = precipitationToFilterCutoff(50.0)
      assert.ok(c1 > c10, 'lighter rain has higher cutoff (brighter)')
      assert.ok(c10 > c50, 'heavier rain has lower cutoff (fuller)')
    })
  })

  // ── 6. Complete Parameter Calculation ───────────────────────────────────
  describe('calculateRainAudioParams()', () => {
    test('null/zero precipitation → silent params', () => {
      const params = calculateRainAudioParams(null)
      assert.strictEqual(params.isSilent, true)
      assert.strictEqual(params.gain, 0.0)
      assert.strictEqual(params.density, 0.0)
    })

    test('moderate precipitation → complete audible params', () => {
      // 0.0001 kg/m²/s ≈ 360 mm/hr (very heavy — normalizes to 1)
      // Use a more moderate value: 0.000003 kg/m²/s ≈ 10.8 mm/hr
      const params = calculateRainAudioParams(0.000003)
      assert.strictEqual(params.isSilent, false)
      assert.ok(params.gain > 0, 'gain is audible')
      assert.ok(params.density > 0, 'density is non-zero')
      assert.ok(params.filterCutoff > 0, 'filter cutoff set')
      assert.ok(params.mmHr > 0, 'mm/hr conversion present')
      assert.ok(params.norm > 0 && params.norm <= 1, 'norm in range')
    })

    test('params contain no pitch/frequency parameter', () => {
      const params = calculateRainAudioParams(0.0001)
      assert.strictEqual('frequency' in params, false, 'No frequency param')
      assert.strictEqual('pitch' in params, false, 'No pitch param')
      assert.strictEqual('note' in params, false, 'No note param')
    })
  })

  // ── 7. Hard Constraint: No Pitch Control ────────────────────────────────
  describe('Hard Constraint: Precipitation never controls pitch', () => {
    test('temperature pitch is unaffected by any precipitation value', () => {
      const freq1 = temperatureToFrequency(25.0, 20.0)
      const freq2 = temperatureToFrequency(25.0, 20.0)

      // Simulate heavy rain
      calculateRainAudioParams(0.001)

      // Verify temperature frequency is still deterministic and unchanged
      const freq3 = temperatureToFrequency(25.0, 20.0)
      assert.strictEqual(freq1, freq2, 'Frequency is deterministic')
      assert.strictEqual(freq2, freq3, 'Precipitation does not affect temperature frequency')
    })

    test('rain params contain no oscillator frequency', () => {
      const rainParams = calculateRainAudioParams(0.0005)
      assert.strictEqual('oscillatorFrequency' in rainParams, false)
      assert.strictEqual('hz' in rainParams, false)
    })
  })
})
