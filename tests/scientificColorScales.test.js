/**
 * scientificColorScales.test.js
 *
 * Unit tests for scientific color scales (T2M, TS, PS, WIND).
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  valueToRGBA,
  temperatureToRGBA,
  T2M_STOPS,
  TS_STOPS,
  PS_STOPS,
  WIND_STOPS,
} from '../src/visualization/scientificColorScales.js'

describe('Scientific Color Scales', () => {
  test('1. valueToRGBA returns transparent [0,0,0,0] for NaN or null', () => {
    assert.deepStrictEqual(valueToRGBA(NaN, 't2m'), [0, 0, 0, 0])
    assert.deepStrictEqual(valueToRGBA(null, 'ts'), [0, 0, 0, 0])
    assert.deepStrictEqual(valueToRGBA(undefined, 'ps'), [0, 0, 0, 0])
  })

  test('2. T2M scale preserves existing temperatureColorScale values at stops', () => {
    // At -50°C
    const colCold = valueToRGBA(-50, 't2m')
    assert.deepStrictEqual(colCold, [16, 0, 64, 255])

    // At +50°C
    const colHot = valueToRGBA(50, 't2m')
    assert.deepStrictEqual(colHot, [90, 0, 10, 255])

    // At 0°C (interpolated between -5 and +5)
    const colZero = valueToRGBA(0, 't2m')
    assert.ok(colZero[0] > 100 && colZero[0] < 195)
    assert.strictEqual(colZero[3], 255)
  })

  test('3. temperatureToRGBA alias behaves identically to valueToRGBA t2m', () => {
    assert.deepStrictEqual(temperatureToRGBA(25), valueToRGBA(25, 't2m'))
    assert.deepStrictEqual(temperatureToRGBA(-10), valueToRGBA(-10, 't2m'))
    assert.deepStrictEqual(temperatureToRGBA(NaN), [0, 0, 0, 0])
  })

  test('4. TS scale renders plausible colors across its -50 to +60 domain', () => {
    const tsCold = valueToRGBA(-50, 'ts')
    const tsHot = valueToRGBA(60, 'ts')
    const tsMid = valueToRGBA(25, 'ts')

    assert.strictEqual(tsCold[3], 255)
    assert.strictEqual(tsHot[3], 255)
    assert.strictEqual(tsMid[3], 255)

    // Cold is dark/violet, Hot is reddish
    assert.ok(tsCold[2] > tsCold[0], 'Cold surface has stronger blue than red')
    assert.ok(tsHot[0] > tsHot[2], 'Hot surface has stronger red than blue')
  })

  test('5. PS scale renders plausible barometric colors across 920 to 1040 hPa', () => {
    const psLow = valueToRGBA(920, 'ps')
    const psStd = valueToRGBA(1013, 'ps')
    const psHigh = valueToRGBA(1040, 'ps')

    assert.strictEqual(psLow[3], 255)
    assert.strictEqual(psStd[3], 255)
    assert.strictEqual(psHigh[3], 255)

    // Standard atmosphere ~1013 hPa is pale cream/neutral
    assert.ok(psStd[0] > 200 && psStd[1] > 200, 'Standard pressure has light/neutral tone')
  })

  test('6. WIND scale renders calm vs hurricane colors across 0 to 35 m/s', () => {
    const windCalm = valueToRGBA(0, 'wind')
    const windFresh = valueToRGBA(12, 'wind')
    const windStorm = valueToRGBA(35, 'wind')

    assert.deepStrictEqual(windCalm, [8, 16, 50, 255])
    assert.ok(windFresh[1] > 150, 'Moderate wind has prominent green channel')
    assert.deepStrictEqual(windStorm, [180, 20, 80, 255])
  })

  test('7. Clamping: values outside stop bounds clamp to extreme stop colors', () => {
    assert.deepStrictEqual(valueToRGBA(-100, 't2m'), valueToRGBA(-50, 't2m'))
    assert.deepStrictEqual(valueToRGBA(100, 't2m'), valueToRGBA(50, 't2m'))
  })

  test('8. TPRECMAX scale renders dry vs torrential downpour colors', () => {
    const dry = valueToRGBA(0, 'tprecmax')
    const light = valueToRGBA(2, 'tprecmax')
    const torrential = valueToRGBA(50, 'tprecmax')

    assert.strictEqual(dry[3], 255)
    assert.strictEqual(light[3], 255)
    assert.strictEqual(torrential[3], 255)
    // Dry is dark slate
    assert.ok(dry[0] < 30 && dry[1] < 35 && dry[2] < 50)
    // Torrential has high red/magenta
    assert.ok(torrential[0] > 200)
  })

  test('9. TQV scale renders arid vs saturated column colors', () => {
    const arid = valueToRGBA(0, 'tqv')
    const saturated = valueToRGBA(70, 'tqv')

    assert.strictEqual(arid[3], 255)
    assert.strictEqual(saturated[3], 255)
    // Arid is sandy/ochre
    assert.ok(arid[0] > arid[2], 'Arid has warmer tone than blue')
    // Saturated has intense purple-magenta
    assert.ok(saturated[0] > 100 && saturated[2] > 150)
  })
})
