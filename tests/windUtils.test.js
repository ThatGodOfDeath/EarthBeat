/**
 * windUtils.test.js — Unit tests for Phase 6 wind calculations and formatting.
 *
 * Verifies:
 *   1. calculateWindSpeed (hypot, zero handling, NaN/null handling)
 *   2. calculateWindDirection (meteorological convention, calm/zero wind handling)
 *   3. getCardinalDirection (16-point compass coverage)
 *   4. formatWindSpeed and formatWindDirection
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  calculateWindSpeed,
  calculateWindDirection,
  getCardinalDirection,
  formatWindSpeed,
  formatWindDirection,
} from '../src/utils/windUtils.js'

describe('Phase 6: Wind Utils Unit Tests', () => {

  // ── 1. calculateWindSpeed ────────────────────────────────────────────────
  test('calculateWindSpeed computes Euclidean norm sqrt(u² + v²)', () => {
    // 3-4-5 triangle
    assert.strictEqual(calculateWindSpeed(3.0, 4.0), 5.0)
    assert.strictEqual(calculateWindSpeed(-3.0, -4.0), 5.0)
    assert.strictEqual(calculateWindSpeed(6.0, 8.0), 10.0)
    assert.strictEqual(calculateWindSpeed(0, 7.5), 7.5)
  })

  test('calculateWindSpeed handles 0, null, and NaN safely', () => {
    assert.strictEqual(calculateWindSpeed(0, 0), 0)
    assert.strictEqual(calculateWindSpeed(null, 5), 0)
    assert.strictEqual(calculateWindSpeed(5, undefined), 0)
    assert.strictEqual(calculateWindSpeed(NaN, 5), 0)
  })

  // ── 2. calculateWindDirection ────────────────────────────────────────────
  test('calculateWindDirection follows meteorological convention (from where wind blows)', () => {
    // Wind blowing towards South (u=0, v<0): comes FROM North (0°)
    const degN = calculateWindDirection(0, -5)
    assert.strictEqual(degN, 0)

    // Wind blowing towards West (u<0, v=0): comes FROM East (90°)
    const degE = calculateWindDirection(-5, 0)
    assert.strictEqual(degE, 90)

    // Wind blowing towards North (u=0, v>0): comes FROM South (180°)
    const degS = calculateWindDirection(0, 5)
    assert.strictEqual(degS, 180)

    // Wind blowing towards East (u>0, v=0): comes FROM West (270°)
    const degW = calculateWindDirection(5, 0)
    assert.strictEqual(degW, 270)
  })

  test('calculateWindDirection handles diagonal vectors accurately', () => {
    // u>0, v>0 (blowing to NE) -> comes FROM SW (225°)
    const degSW = calculateWindDirection(10, 10)
    assert.strictEqual(degSW, 225)

    // u<0, v<0 (blowing to SW) -> comes FROM NE (45°)
    const degNE = calculateWindDirection(-10, -10)
    assert.strictEqual(degNE, 45)
  })

  test('calculateWindDirection handles calm / zero wind safely', () => {
    assert.strictEqual(calculateWindDirection(0, 0), null)
    assert.strictEqual(calculateWindDirection(null, null), null)
    assert.strictEqual(calculateWindDirection(NaN, 0), null)
  })

  // ── 3. getCardinalDirection ──────────────────────────────────────────────
  test('getCardinalDirection converts degrees to 16-point compass', () => {
    assert.strictEqual(getCardinalDirection(0), 'N')
    assert.strictEqual(getCardinalDirection(22.5), 'NNE')
    assert.strictEqual(getCardinalDirection(45), 'NE')
    assert.strictEqual(getCardinalDirection(90), 'E')
    assert.strictEqual(getCardinalDirection(135), 'SE')
    assert.strictEqual(getCardinalDirection(180), 'S')
    assert.strictEqual(getCardinalDirection(225), 'SW')
    assert.strictEqual(getCardinalDirection(270), 'W')
    assert.strictEqual(getCardinalDirection(315), 'NW')
    assert.strictEqual(getCardinalDirection(355), 'N')
  })

  test('getCardinalDirection returns Calm for null or undefined', () => {
    assert.strictEqual(getCardinalDirection(null), 'Calm')
    assert.strictEqual(getCardinalDirection(undefined), 'Calm')
    assert.strictEqual(getCardinalDirection(NaN), 'Calm')
  })

  // ── 4. Formatting Helpers ────────────────────────────────────────────────
  test('formatWindSpeed and formatWindDirection format strings properly', () => {
    assert.strictEqual(formatWindSpeed(12.38), '12.4 m/s')
    assert.strictEqual(formatWindSpeed(null), '— m/s')

    assert.strictEqual(formatWindDirection(225), '225° SW')
    assert.strictEqual(formatWindDirection(null), 'Calm')
  })
})
