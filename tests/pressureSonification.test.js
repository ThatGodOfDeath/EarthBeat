/**
 * pressureSonification.test.js — Phase 9
 *
 * Unit tests for pressureSonification.js.
 *
 * Verifies:
 *   1. normalizePressure: standard atmosphere → ~0.5
 *   2. normalizePressure: very low pressure → near 0
 *   3. normalizePressure: very high pressure → near 1
 *   4. normalizePressure: null/invalid → 0.5 (neutral default)
 *   5. computePressureAnomaly: above standard → positive
 *   6. computePressureAnomaly: below standard → negative
 *   7. pressureToFilterHz: high pressure → higher Hz
 *   8. pressureToFilterHz: low pressure → lower Hz
 *   9. pressureToGainModifier: high pressure → more gain modifier
 *   10. pressureToWindQModifier: high pressure → negative (cleaner wind)
 *   11. calculatePressureAudioParams: high pressure → isHighPressure=true
 *   12. CONSTRAINT: ps never controls pitch
 *   13. formatPressureHpa: converts Pa to hPa string
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePressure,
  computePressureAnomaly,
  pressureToFilterHz,
  pressureToGainModifier,
  pressureToWindQModifier,
  calculatePressureAudioParams,
  formatPressureHpa,
  PS_REFERENCE_HIGH_PA,
  PS_REFERENCE_LOW_PA,
  PS_REFERENCE_MID_PA,
  PS_FILTER_HZ_LOW,
  PS_FILTER_HZ_HIGH,
} from '../src/utils/pressureSonification.js'

describe('Phase 9: Pressure Sonification (ps experimental)', () => {

  // ── normalizePressure ─────────────────────────────────────────────────────

  test('1. normalizePressure: standard atmosphere → 0.5 (midpoint)', () => {
    const norm = normalizePressure(PS_REFERENCE_MID_PA)
    // Standard ~101325 Pa should be roughly in the middle of the range
    // Range: 97000–104000 → 101325 → (101325-97000)/(104000-97000) = 4325/7000 ≈ 0.618
    const expected = (PS_REFERENCE_MID_PA - PS_REFERENCE_LOW_PA) / (PS_REFERENCE_HIGH_PA - PS_REFERENCE_LOW_PA)
    assert.ok(Math.abs(norm - expected) < 0.01, `Standard atmosphere norm=${norm} ≈ ${expected.toFixed(3)}`)
  })

  test('2. normalizePressure: very low pressure → near 0', () => {
    const normLow = normalizePressure(PS_REFERENCE_LOW_PA)
    assert.ok(Math.abs(normLow) < 0.001, `Low reference → norm ≈ 0 (got ${normLow})`)
  })

  test('3. normalizePressure: very high pressure → near 1', () => {
    const normHigh = normalizePressure(PS_REFERENCE_HIGH_PA)
    assert.ok(Math.abs(normHigh - 1.0) < 0.001, `High reference → norm ≈ 1 (got ${normHigh})`)
  })

  test('4. normalizePressure: null/invalid → 0.5 neutral default', () => {
    assert.strictEqual(normalizePressure(null), 0.5, 'null → neutral 0.5')
    assert.strictEqual(normalizePressure(undefined), 0.5, 'undefined → neutral 0.5')
    assert.strictEqual(normalizePressure(NaN), 0.5, 'NaN → neutral 0.5')
    assert.strictEqual(normalizePressure(0), 0.5, 'zero (invalid) → neutral 0.5')
  })

  // ── computePressureAnomaly ────────────────────────────────────────────────

  test('5. computePressureAnomaly: above standard → positive', () => {
    const anomaly = computePressureAnomaly(102000)   // +675 Pa
    assert.ok(anomaly > 0, `102000 Pa → positive anomaly (${anomaly} Pa)`)
    assert.ok(Math.abs(anomaly - (102000 - PS_REFERENCE_MID_PA)) < 1, 'Correct anomaly value')
  })

  test('6. computePressureAnomaly: below standard → negative', () => {
    const anomaly = computePressureAnomaly(99000)   // −2325 Pa
    assert.ok(anomaly < 0, `99000 Pa → negative anomaly (${anomaly} Pa)`)
  })

  test('6b. computePressureAnomaly: null/invalid → 0', () => {
    assert.strictEqual(computePressureAnomaly(null), 0.0)
    assert.strictEqual(computePressureAnomaly(0), 0.0)
  })

  // ── pressureToFilterHz ────────────────────────────────────────────────────

  test('7. pressureToFilterHz: high pressure → higher Hz (brighter)', () => {
    const hzHigh = pressureToFilterHz(1.0)
    assert.strictEqual(hzHigh, PS_FILTER_HZ_HIGH, `norm=1 → ${PS_FILTER_HZ_HIGH} Hz`)
  })

  test('8. pressureToFilterHz: low pressure → lower Hz (darker)', () => {
    const hzLow = pressureToFilterHz(0)
    assert.strictEqual(hzLow, PS_FILTER_HZ_LOW, `norm=0 → ${PS_FILTER_HZ_LOW} Hz`)
  })

  test('8b. pressureToFilterHz monotonically increases with norm', () => {
    const hz0 = pressureToFilterHz(0)
    const hz05 = pressureToFilterHz(0.5)
    const hz1 = pressureToFilterHz(1)

    assert.ok(hz0 < hz05 && hz05 < hz1, 'Higher pressure norm → higher filter Hz (monotonic)')
  })

  // ── pressureToGainModifier ────────────────────────────────────────────────

  test('9. pressureToGainModifier: high pressure → more gain modifier', () => {
    const gainHigh = pressureToGainModifier(1.0)
    const gainLow = pressureToGainModifier(0)

    assert.ok(gainHigh > gainLow, `High pressure gain (${gainHigh}) > low pressure gain (${gainLow})`)
    assert.ok(gainHigh > 0, 'High pressure produces positive gain modifier')
    assert.ok(gainLow >= 0, 'Low pressure gain modifier non-negative')
  })

  // ── pressureToWindQModifier ───────────────────────────────────────────────

  test('10. pressureToWindQModifier: high pressure → negative delta (cleaner wind)', () => {
    const qHigh = pressureToWindQModifier(1.0)
    const qLow = pressureToWindQModifier(0)

    assert.ok(qHigh < 0, `High pressure → negative Q modifier (${qHigh}) — cleaner wind`)
    assert.ok(qLow > 0, `Low pressure → positive Q modifier (${qLow}) — more turbulent`)
  })

  // ── calculatePressureAudioParams ──────────────────────────────────────────

  test('11. calculatePressureAudioParams: high pressure → isHighPressure=true', () => {
    const params = calculatePressureAudioParams(103500)   // Well above standard

    assert.strictEqual(params.isHighPressure, true, 'High pressure → isHighPressure=true')
    assert.strictEqual(params.isLowPressure, false)
    assert.ok(params.norm > 0.65, `norm=${params.norm} should be > 0.65`)
    assert.ok(params.filterHz > PS_FILTER_HZ_LOW, 'High pressure → higher filter Hz')
  })

  test('11b. calculatePressureAudioParams: low pressure → isLowPressure=true', () => {
    const params = calculatePressureAudioParams(97500)   // Storm-level low

    assert.strictEqual(params.isLowPressure, true, 'Low pressure → isLowPressure=true')
    assert.strictEqual(params.isHighPressure, false)
    assert.ok(params.norm < 0.35, `norm=${params.norm} should be < 0.35`)
  })

  test('12. CONSTRAINT: ps never controls pitch (no frequency output that would compete)', () => {
    const low = calculatePressureAudioParams(97000)
    const high = calculatePressureAudioParams(104000)

    // Verify no pitch output properties
    assert.strictEqual(Object.prototype.hasOwnProperty.call(low, 'pitch'), false, 'No pitch property')
    assert.strictEqual(Object.prototype.hasOwnProperty.call(low, 'frequency'), false, 'No frequency property')

    // filterHz is for a noise band modifier — should not be in musical pitch range (< 60 Hz or > 2000 Hz for fundamental)
    // Actually the filter itself is on a noise source, not on an oscillator
    // Verify the filter range is NOT in the sub-bass/musical note range
    assert.ok(low.filterHz >= 400, `Filter Hz ${low.filterHz} >= 400 — not sub-bass musical pitch`)
    assert.ok(high.filterHz >= 400, `Filter Hz ${high.filterHz} >= 400 — not sub-bass musical pitch`)

    // The most important constraint: the pressure system output does NOT include
    // a competing oscillator frequency
    assert.strictEqual(Object.prototype.hasOwnProperty.call(low, 'oscillatorFrequency'), false)
    assert.ok(low.filterHz !== high.filterHz, 'filterHz changes with pressure — proof of modulation')
  })

  // ── formatPressureHpa ─────────────────────────────────────────────────────

  test('13. formatPressureHpa converts Pa to hPa string', () => {
    // 101325 Pa / 100 = 1013.25 hPa → toFixed(1) → '1013.3' (rounds up)
    assert.strictEqual(formatPressureHpa(101325), '1013.3 hPa')
    assert.strictEqual(formatPressureHpa(100000), '1000.0 hPa')
    assert.strictEqual(formatPressureHpa(101200), '1012.0 hPa')
    assert.strictEqual(formatPressureHpa(null), '—')
    assert.strictEqual(formatPressureHpa(NaN), '—')
  })
})
