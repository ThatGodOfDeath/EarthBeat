/**
 * moistureSonification.test.js — Phase 9
 *
 * Unit tests for moistureSonification.js.
 *
 * Verifies:
 *   1. normalizeTqv: zero/null/dry → 0
 *   2. normalizeTqv: humid → approaches 1
 *   3. normalizeTqv clamps at [0, 1]
 *   4. tqvNormToFilterHz: dry (low tqv) → higher Hz
 *   5. tqvNormToFilterHz: wet (high tqv) → lower Hz
 *   6. tqvNormToFilterQ: dry → higher Q, wet → lower Q
 *   7. tqvNormToAmbientGain: zero tqv → no gain
 *   8. tqvNormToAmbientGain: high tqv → small but audible ambient gain
 *   9. calculateMoistureAudioParams: dry + no rain → isDry=true
 *   10. calculateMoistureAudioParams: high tqv + no rain → humid character
 *   11. calculateMoistureAudioParams: high tqv + rain → saturated
 *   12. CONSTRAINT: tqv never controls pitch
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeTqv,
  tqvNormToFilterHz,
  tqvNormToFilterQ,
  tqvNormToAmbientGain,
  calculateMoistureAudioParams,
  TQV_REFERENCE_KGM2,
  TQV_DRY_THRESHOLD_KGM2,
  TQV_FILTER_HZ_DRY,
  TQV_FILTER_HZ_WET,
  TQV_FILTER_Q_DRY,
  TQV_FILTER_Q_WET,
  TQV_MAX_AMBIENT_GAIN,
} from '../src/utils/moistureSonification.js'

describe('Phase 9: Moisture Sonification (tqv + tprecmax)', () => {

  // ── normalizeTqv ──────────────────────────────────────────────────────────

  test('1. normalizeTqv: null/zero/dry returns 0', () => {
    assert.strictEqual(normalizeTqv(null), 0.0)
    assert.strictEqual(normalizeTqv(undefined), 0.0)
    assert.strictEqual(normalizeTqv(NaN), 0.0)
    assert.strictEqual(normalizeTqv(0), 0.0)
    assert.strictEqual(normalizeTqv(TQV_DRY_THRESHOLD_KGM2), 0.0)
  })

  test('2. normalizeTqv: humid/tropical approaches 1', () => {
    const norm50 = normalizeTqv(50)   // Tropical humid
    const normMax = normalizeTqv(TQV_REFERENCE_KGM2)

    assert.ok(norm50 > 0.5, `Tropical tqv=50 kg/m² → norm=${norm50} should be > 0.5`)
    assert.ok(Math.abs(normMax - 1.0) < 0.001, `At reference tqv, norm ≈ 1.0 (got ${normMax})`)
  })

  test('3. normalizeTqv clamps at [0, 1]', () => {
    assert.strictEqual(normalizeTqv(-10), 0.0, 'Negative tqv → 0')
    const clamped = normalizeTqv(1000)   // Way above reference
    assert.ok(clamped <= 1.0, `Very high tqv clamped to 1.0 (got ${clamped})`)
    assert.ok(clamped > 0.9, 'Very high tqv still near 1.0')
  })

  // ── tqvNormToFilterHz ─────────────────────────────────────────────────────

  test('4. tqvNormToFilterHz: dry (norm=0) → highest Hz (bright)', () => {
    const hzDry = tqvNormToFilterHz(0)
    assert.strictEqual(hzDry, TQV_FILTER_HZ_DRY, `Dry → ${TQV_FILTER_HZ_DRY} Hz`)
  })

  test('5. tqvNormToFilterHz: wet (norm=1) → lowest Hz (full/rich)', () => {
    const hzWet = tqvNormToFilterHz(1)
    assert.strictEqual(hzWet, TQV_FILTER_HZ_WET, `Wet → ${TQV_FILTER_HZ_WET} Hz`)
  })

  test('5b. tqvNormToFilterHz: monotonically decreasing with moisture', () => {
    const hz0 = tqvNormToFilterHz(0)
    const hz05 = tqvNormToFilterHz(0.5)
    const hz1 = tqvNormToFilterHz(1)

    assert.ok(hz0 > hz05 && hz05 > hz1, 'More moisture → lower filter Hz (monotonic)')
    assert.ok(hz0 > hz1, `Dry (${hz0} Hz) > Wet (${hz1} Hz)`)
  })

  // ── tqvNormToFilterQ ──────────────────────────────────────────────────────

  test('6. tqvNormToFilterQ: dry → higher Q; wet → lower Q', () => {
    const qDry = tqvNormToFilterQ(0)
    const qWet = tqvNormToFilterQ(1)

    assert.strictEqual(qDry, TQV_FILTER_Q_DRY, `Dry → Q=${TQV_FILTER_Q_DRY}`)
    assert.strictEqual(qWet, TQV_FILTER_Q_WET, `Wet → Q=${TQV_FILTER_Q_WET}`)
    assert.ok(qDry > qWet, `Dry Q (${qDry}) > Wet Q (${qWet})`)
  })

  // ── tqvNormToAmbientGain ──────────────────────────────────────────────────

  test('7. tqvNormToAmbientGain: zero/null tqv → no ambient gain', () => {
    assert.strictEqual(tqvNormToAmbientGain(0), 0.0)
    assert.strictEqual(tqvNormToAmbientGain(null), 0.0)
  })

  test('8. tqvNormToAmbientGain: high tqv → small but non-zero ambient gain', () => {
    const ambientGain = tqvNormToAmbientGain(1.0)
    assert.ok(ambientGain > 0, 'Full moisture → non-zero ambient gain')
    assert.ok(ambientGain <= TQV_MAX_AMBIENT_GAIN + 0.001, `Stays within max (${TQV_MAX_AMBIENT_GAIN})`)
    assert.ok(ambientGain < 0.02, 'Ambient gain stays very quiet (< 0.02)')
  })

  // ── calculateMoistureAudioParams ──────────────────────────────────────────

  test('9. calculateMoistureAudioParams: dry + no rain → isDry=true', () => {
    const params = calculateMoistureAudioParams(1.5, null)   // Very dry air, no rain

    assert.strictEqual(params.isDry, true, 'Very dry atmosphere → isDry=true')
    assert.ok(params.tqvNorm < 0.05, `tqvNorm=${params.tqvNorm} should be near 0`)
    assert.ok(params.ambientGain <= 0.001, 'No ambient gain when dry')
  })

  test('10. calculateMoistureAudioParams: high tqv + no rain → humid character', () => {
    const params = calculateMoistureAudioParams(55, 0)   // Saturated air, no rain

    assert.strictEqual(params.isDry, false, 'High tqv → not dry')
    assert.ok(params.tqvNorm > 0.7, `High tqv norm=${params.tqvNorm} should be > 0.7`)
    assert.ok(params.filterHz < TQV_FILTER_HZ_DRY, 'Humid → lower filter Hz')
    assert.ok(params.ambientGain > 0, 'High tqv → some ambient gain even without rain')
  })

  test('11. calculateMoistureAudioParams: high tqv + heavy rain → saturated', () => {
    const params = calculateMoistureAudioParams(55, 0.0001)   // Tropical downpour

    assert.strictEqual(params.isDry, false)
    assert.ok(params.tqvNorm > 0.7, 'High moisture norm')
    assert.ok(params.filterHz < TQV_FILTER_HZ_DRY, 'Heavy rain + high moisture → lower freq')
    // Filter Q with rain should be lower (wider, more immersive)
    assert.ok(params.filterQ <= TQV_FILTER_Q_DRY, 'Saturated air → Q reduced or equal')
  })

  test('12. CONSTRAINT: tqv never controls pitch (no frequency output)', () => {
    // moistureSonification outputs filter parameters but never an oscillator frequency.
    // The only Hz value is the bandpass CENTER (not pitch). Verify it is in the tqv range.
    const dry = calculateMoistureAudioParams(2, 0)
    const wet = calculateMoistureAudioParams(65, 0)

    // Both filter Hz values should be in the moisture filter range — not audio pitch range
    // (audio pitch would be 100–2000 Hz for musical notes; moisture filter is in 600–2000 Hz noise band)
    assert.ok(dry.filterHz >= TQV_FILTER_HZ_WET, `Dry filter Hz (${dry.filterHz}) >= wet minimum`)
    assert.ok(wet.filterHz <= TQV_FILTER_HZ_DRY, `Wet filter Hz (${wet.filterHz}) <= dry maximum`)
    assert.ok(dry.filterHz !== wet.filterHz, 'Filter Hz differs between dry and wet — tqv modulates texture')

    // Confirm the return type does NOT include any pitch/frequency output that would compete with t2m
    assert.strictEqual(Object.prototype.hasOwnProperty.call(dry, 'frequency'), false,
      'No "frequency" property returned — tqv never outputs pitch')
    assert.strictEqual(Object.prototype.hasOwnProperty.call(dry, 'pitch'), false,
      'No "pitch" property returned')
  })
})
