/**
 * windSonification.test.js — Phase 7 Wind Sonification Unit Tests
 *
 * Verifies:
 *   1. Speed normalization (clamp, boundary values, invalid values)
 *   2. Speed to gain (non-linear curve, calm/zero wind silence, bounded maximum)
 *   3. Speed to spectral filter parameters (cutoff frequency & Q factor)
 *   4. Direction to stereo pan (continuous sinusoidal interpolation)
 *   5. Calm wind parameter resolution
 *   6. Hard constraint verification: temperature is the ONLY variable controlling pitch
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  SPEED_REFERENCE_MS,
  MAX_WIND_GAIN,
  MIN_FILTER_CUTOFF_HZ,
  MAX_FILTER_CUTOFF_HZ,
  normalizeWindSpeed,
  windSpeedToGain,
  windSpeedToFilterParams,
  windDirectionToPan,
  calculateWindAudioParams,
} from '../src/utils/windSonification.js'
import {
  temperatureToFrequency,
} from '../src/utils/sonification.js'

describe('Phase 7: Wind Sonification Parameter Utilities', () => {

  // ── 1. Speed Normalization ───────────────────────────────────────────────
  test('normalizeWindSpeed clamps speed to [0, 1] relative to SPEED_REFERENCE_MS', () => {
    assert.strictEqual(normalizeWindSpeed(0), 0.0)
    assert.strictEqual(normalizeWindSpeed(12.5), 0.5)
    assert.strictEqual(normalizeWindSpeed(SPEED_REFERENCE_MS), 1.0)
    // Speeds above reference are clamped to 1.0
    assert.strictEqual(normalizeWindSpeed(35.0), 1.0)
    // Negative, null, or NaN speeds return 0.0
    assert.strictEqual(normalizeWindSpeed(-5.0), 0.0)
    assert.strictEqual(normalizeWindSpeed(null), 0.0)
    assert.strictEqual(normalizeWindSpeed(NaN), 0.0)
  })

  // ── 2. Speed to Gain ─────────────────────────────────────────────────────
  test('windSpeedToGain returns 0 for zero or negative wind', () => {
    assert.strictEqual(windSpeedToGain(0), 0.0)
    assert.strictEqual(windSpeedToGain(-2.5), 0.0)
    assert.strictEqual(windSpeedToGain(null), 0.0)
    assert.strictEqual(windSpeedToGain(NaN), 0.0)
  })

  test('windSpeedToGain applies non-linear power curve bounded by MAX_WIND_GAIN', () => {
    const gainMax = windSpeedToGain(SPEED_REFERENCE_MS)
    assert.strictEqual(gainMax, MAX_WIND_GAIN)

    const gainQuarter = windSpeedToGain(6.25)  // 25% speed
    const gainHalf = windSpeedToGain(12.5)     // 50% speed

    // Non-linear power curve ensures low wind is very soft, ramping smoothly at high wind
    assert.ok(gainQuarter < gainHalf, 'Gain increases monotonically with speed')
    assert.ok(gainHalf < gainMax, 'Gain stays bounded below max')
    assert.ok(gainQuarter < gainMax * 0.25, 'Power curve keeps low winds gentle')
    assert.ok(gainMax <= 0.25, 'Wind gain stays safely bounded to prevent clipping with temperature')
  })

  // ── 3. Speed to Filter Parameters ────────────────────────────────────────
  test('windSpeedToFilterParams scales cutoff and Q smoothly with speed', () => {
    const calmFilter = windSpeedToFilterParams(0)
    assert.strictEqual(calmFilter.cutoffHz, MIN_FILTER_CUTOFF_HZ)

    const galeFilter = windSpeedToFilterParams(SPEED_REFERENCE_MS)
    assert.strictEqual(galeFilter.cutoffHz, MAX_FILTER_CUTOFF_HZ)

    const midFilter = windSpeedToFilterParams(12.5)
    assert.ok(midFilter.cutoffHz > MIN_FILTER_CUTOFF_HZ)
    assert.ok(midFilter.cutoffHz < MAX_FILTER_CUTOFF_HZ)
    assert.ok(midFilter.q >= calmFilter.q, 'Q increases or stays consistent with speed')
  })

  // ── 4. Direction to Stereo Pan ───────────────────────────────────────────
  test('windDirectionToPan maps meteorological compass angles to stereo pan in [-1, +1]', () => {
    // 0° (North) → Center (0.0)
    assert.strictEqual(windDirectionToPan(0), 0.0)

    // 90° (East) → Full Right (+1.0)
    assert.strictEqual(windDirectionToPan(90), 1.0)

    // 180° (South) → Center (0.0)
    assert.strictEqual(windDirectionToPan(180), 0.0)

    // 270° (West) → Full Left (-1.0)
    assert.strictEqual(windDirectionToPan(270), -1.0)

    // 360° wraps to North → 0.0
    assert.strictEqual(windDirectionToPan(360), 0.0)

    // Null or invalid → Center
    assert.strictEqual(windDirectionToPan(null), 0.0)
    assert.strictEqual(windDirectionToPan(NaN), 0.0)
  })

  test('windDirectionToPan produces smooth continuous transitions across diagonals', () => {
    const panNE = windDirectionToPan(45)   // North-East → positive pan
    const panNW = windDirectionToPan(315)  // North-West → negative pan

    assert.ok(panNE > 0.6 && panNE < 0.8, 'NE pans right')
    assert.ok(panNW < -0.6 && panNW > -0.8, 'NW pans left')
  })

  // ── 5. Full Wind Audio Parameter Resolution ──────────────────────────────
  test('calculateWindAudioParams resolves complete audio parameters', () => {
    const normalPoint = { speed: 10.0, direction: 90.0 }
    const params = calculateWindAudioParams(normalPoint)

    assert.strictEqual(params.isCalm, false)
    assert.ok(params.gain > 0, 'Gain is audible')
    assert.strictEqual(params.pan, 1.0, 'Panned right for East wind')
    assert.ok(params.cutoffHz > MIN_FILTER_CUTOFF_HZ)

    // Calm point
    const calmPoint = { speed: 0.0, direction: null }
    const calmParams = calculateWindAudioParams(calmPoint)
    assert.strictEqual(calmParams.isCalm, true)
    assert.strictEqual(calmParams.gain, 0.0)
  })

  // ── 6. Hard Constraint Verification ──────────────────────────────────────
  test('Hard Constraint: Temperature remains the ONLY variable controlling pitch/frequency', () => {
    // Verify temperatureToFrequency is unaffected and computes pitch strictly from temperature
    const f1 = temperatureToFrequency(25.0, 20.0)
    const f2 = temperatureToFrequency(30.0, 20.0)

    assert.strictEqual(f1, 1000)
    assert.strictEqual(f2, 1500)

    // Wind parameters DO NOT contain or manipulate frequency/pitch
    const windParams = calculateWindAudioParams({ speed: 15.0, direction: 270.0 })
    assert.strictEqual('frequency' in windParams, false, 'Wind has no pitch frequency parameter')
    assert.strictEqual('note' in windParams, false, 'Wind has no note parameter')
  })
})
