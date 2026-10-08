/**
 * thermalSonification.test.js — Phase 9
 *
 * Unit tests for thermalSonification.js.
 *
 * Verifies:
 *   1. computeSurfaceAirDiff returns correct ts - t2m difference
 *   2. Invalid inputs return 0
 *   3. normalizeThermalDiff maps positive diff to [0, +1]
 *   4. normalizeThermalDiff maps negative diff to [-1, 0]
 *   5. normalizeThermalDiff clamps at boundaries
 *   6. thermalNormToFilterGainDb maps positive norm to positive dB
 *   7. thermalNormToFilterGainDb maps negative norm to negative dB
 *   8. thermalNormToFilterGainDb returns 0 for norm=0
 *   9. calculateThermalAudioParams returns expected filter constants
 *   10. calculateThermalAudioParams hot surface → positive gain
 *   11. calculateThermalAudioParams cold surface → negative gain
 *   12. CONSTRAINT: thermal system never affects pitch
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeSurfaceAirDiff,
  normalizeThermalDiff,
  thermalNormToFilterGainDb,
  calculateThermalAudioParams,
  THERMAL_DIFF_MAX_K,
  THERMAL_DIFF_MIN_K,
  THERMAL_MAX_PEAK_DB,
  THERMAL_MIN_PEAK_DB,
  THERMAL_FILTER_HZ,
  THERMAL_FILTER_Q,
} from '../src/utils/thermalSonification.js'

describe('Phase 9: Thermal Sonification (ts modifier)', () => {

  // ── computeSurfaceAirDiff ─────────────────────────────────────────────────

  test('1. computeSurfaceAirDiff returns ts - t2m', () => {
    assert.strictEqual(computeSurfaceAirDiff(320, 310), 10)
    assert.strictEqual(computeSurfaceAirDiff(295, 300), -5)
    assert.strictEqual(computeSurfaceAirDiff(300, 300), 0)
  })

  test('2. computeSurfaceAirDiff returns 0 for invalid inputs', () => {
    assert.strictEqual(computeSurfaceAirDiff(null, 300), 0)
    assert.strictEqual(computeSurfaceAirDiff(300, null), 0)
    assert.strictEqual(computeSurfaceAirDiff(NaN, 300), 0)
    assert.strictEqual(computeSurfaceAirDiff(undefined, undefined), 0)
  })

  // ── normalizeThermalDiff ──────────────────────────────────────────────────

  test('3. normalizeThermalDiff maps positive diff to (0, +1]', () => {
    const norm5 = normalizeThermalDiff(5)
    const norm10 = normalizeThermalDiff(10)
    const normMax = normalizeThermalDiff(THERMAL_DIFF_MAX_K)

    assert.ok(norm5 > 0 && norm5 < 1, `norm5=${norm5} should be (0,1)`)
    assert.ok(norm10 > norm5, 'Larger diff → larger norm')
    assert.ok(Math.abs(normMax - 1.0) < 0.001, `normMax=${normMax} should be 1.0`)
  })

  test('4. normalizeThermalDiff maps negative diff to [-1, 0)', () => {
    const normNeg5 = normalizeThermalDiff(-5)
    const normNeg10 = normalizeThermalDiff(-10)

    assert.ok(normNeg5 < 0 && normNeg5 > -1, `normNeg5=${normNeg5} should be (-1,0)`)
    assert.ok(normNeg10 < normNeg5, 'More negative diff → more negative norm')
  })

  test('5. normalizeThermalDiff clamps to [-1, +1]', () => {
    const beyond = normalizeThermalDiff(1000)
    const beyondNeg = normalizeThermalDiff(-1000)

    assert.strictEqual(beyond, 1.0, 'Very large diff clamped to 1.0')
    assert.strictEqual(beyondNeg, -1.0, 'Very negative diff clamped to -1.0')
  })

  test('5b. normalizeThermalDiff returns 0 for zero diff', () => {
    assert.strictEqual(normalizeThermalDiff(0), 0.0)
    assert.strictEqual(normalizeThermalDiff(NaN), 0.0)
  })

  // ── thermalNormToFilterGainDb ─────────────────────────────────────────────

  test('6. thermalNormToFilterGainDb: positive norm → positive dB (brighter)', () => {
    const db1 = thermalNormToFilterGainDb(1.0)
    const dbHalf = thermalNormToFilterGainDb(0.5)

    assert.ok(db1 > 0, `Full norm → positive dB (${db1})`)
    assert.ok(dbHalf > 0, `Half norm → positive dB (${dbHalf})`)
    assert.ok(db1 > dbHalf, 'More positive norm → more dB boost')
    assert.ok(Math.abs(db1 - THERMAL_MAX_PEAK_DB) < 0.01, 'At norm=1, gain=THERMAL_MAX_PEAK_DB')
  })

  test('7. thermalNormToFilterGainDb: negative norm → negative dB (cooler)', () => {
    const dbNeg1 = thermalNormToFilterGainDb(-1.0)
    const dbNegHalf = thermalNormToFilterGainDb(-0.5)

    assert.ok(dbNeg1 < 0, `Fully cold norm → negative dB (${dbNeg1})`)
    assert.ok(dbNegHalf < 0, `Half cold norm → negative dB (${dbNegHalf})`)
    assert.ok(dbNeg1 < dbNegHalf, 'More negative norm → more dB cut')
    assert.ok(Math.abs(dbNeg1 - THERMAL_MIN_PEAK_DB) < 0.01, 'At norm=-1, gain=THERMAL_MIN_PEAK_DB')
  })

  test('8. thermalNormToFilterGainDb: zero norm → 0 dB (neutral)', () => {
    assert.strictEqual(thermalNormToFilterGainDb(0), 0)
    assert.strictEqual(thermalNormToFilterGainDb(NaN), 0)
  })

  // ── calculateThermalAudioParams ───────────────────────────────────────────

  test('9. calculateThermalAudioParams returns expected filter constants', () => {
    const params = calculateThermalAudioParams(310, 300)   // 10 K warmer surface

    assert.strictEqual(params.filterHz, THERMAL_FILTER_HZ)
    assert.strictEqual(params.filterQ, THERMAL_FILTER_Q)
    assert.ok(typeof params.filterGainDb === 'number', 'filterGainDb is a number')
    assert.ok(typeof params.diff === 'number', 'diff is a number')
    assert.ok(typeof params.norm === 'number', 'norm is a number')
  })

  test('10. calculateThermalAudioParams: hot surface (ts >> t2m) → positive filterGainDb', () => {
    // ts=330K, t2m=305K → diff=+25K → near THERMAL_DIFF_MAX_K
    const params = calculateThermalAudioParams(330, 305)

    assert.ok(params.diff > 0, `diff=${params.diff} should be positive`)
    assert.ok(params.norm > 0, `norm=${params.norm} should be positive`)
    assert.ok(params.filterGainDb > 0, `filterGainDb=${params.filterGainDb} should be positive (brighter)`)
  })

  test('11. calculateThermalAudioParams: cool surface (ts << t2m) → negative filterGainDb', () => {
    // ts=290K, t2m=300K → diff=-10K → surface cooler than air (rain evaporation)
    const params = calculateThermalAudioParams(290, 300)

    assert.ok(params.diff < 0, `diff=${params.diff} should be negative`)
    assert.ok(params.norm < 0, `norm=${params.norm} should be negative`)
    assert.ok(params.filterGainDb < 0, `filterGainDb=${params.filterGainDb} should be negative (darker)`)
  })

  test('12. CONSTRAINT: thermal system never touches pitch (filterGainDb is EQ, not freq)', () => {
    // This test documents the architectural constraint:
    // The thermal modifier returns a filterGainDb (EQ level), NOT a frequency.
    // The filterHz is a fixed constant — thermal does NOT shift pitch.
    const cold = calculateThermalAudioParams(290, 305)
    const hot  = calculateThermalAudioParams(330, 305)

    assert.strictEqual(
      cold.filterHz,
      hot.filterHz,
      'filterHz is IDENTICAL regardless of thermal state — pitch never changes',
    )
    assert.strictEqual(
      cold.filterHz,
      THERMAL_FILTER_HZ,
      'filterHz matches the fixed THERMAL_FILTER_HZ constant',
    )
  })
})
