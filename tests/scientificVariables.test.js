/**
 * scientificVariables.test.js
 *
 * Unit tests for scientific variable configurations and unit conversions.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  SCIENTIFIC_VARIABLES,
  VARIABLE_LIST,
  ENVIRONMENTAL_TABS,
  getVariableConfig,
  kelvinToCelsius,
  pascalToHectopascal,
} from '../src/data/scientificVariables.js'

describe('Scientific Variables Configuration', () => {
  test('1. Includes all 4 required variables (T2M, TS, PS, WIND)', () => {
    assert.ok(VARIABLE_LIST.includes('T2M'))
    assert.ok(VARIABLE_LIST.includes('TS'))
    assert.ok(VARIABLE_LIST.includes('PS'))
    assert.ok(VARIABLE_LIST.includes('WIND'))
  })

  test('2. T2M has correct scientific metadata and °C unit', () => {
    const t2m = getVariableConfig('T2M')
    assert.strictEqual(t2m.id, 'T2M')
    assert.strictEqual(t2m.unit, '°C')
    assert.strictEqual(t2m.sourceUnit, 'K')
    assert.strictEqual(t2m.type, 'scalar')
    assert.strictEqual(t2m.hasSonification, true)
  })

  test('3. TS has correct scientific metadata and °C unit', () => {
    const ts = getVariableConfig('TS')
    assert.strictEqual(ts.id, 'TS')
    assert.strictEqual(ts.unit, '°C')
    assert.strictEqual(ts.sourceUnit, 'K')
    assert.strictEqual(ts.type, 'scalar')
  })

  test('4. PS has correct scientific metadata and hPa unit', () => {
    const ps = getVariableConfig('PS')
    assert.strictEqual(ps.id, 'PS')
    assert.strictEqual(ps.unit, 'hPa')
    assert.strictEqual(ps.sourceUnit, 'Pa')
    assert.strictEqual(ps.type, 'scalar')
  })

  test('5. WIND has correct vector metadata and m/s unit', () => {
    const wind = getVariableConfig('WIND')
    assert.strictEqual(wind.id, 'WIND')
    assert.strictEqual(wind.unit, 'm/s')
    assert.strictEqual(wind.type, 'vector')
  })

  test('6. kelvinToCelsius accurately converts temperature', () => {
    assert.strictEqual(Math.round(kelvinToCelsius(273.15) * 100) / 100, 0)
    assert.strictEqual(Math.round(kelvinToCelsius(300.15) * 100) / 100, 27)
    assert.strictEqual(Math.round(kelvinToCelsius(253.15) * 100) / 100, -20)
    assert.ok(isNaN(kelvinToCelsius(null)))
    assert.ok(isNaN(kelvinToCelsius(NaN)))
  })

  test('7. pascalToHectopascal accurately converts pressure', () => {
    assert.strictEqual(pascalToHectopascal(101325), 1013.25)
    assert.strictEqual(pascalToHectopascal(100000), 1000)
    assert.strictEqual(pascalToHectopascal(98000), 980)
    assert.ok(isNaN(pascalToHectopascal(null)))
    assert.ok(isNaN(pascalToHectopascal(NaN)))
  })

  test('8. TPRECMAX has correct precipitation metadata and mm/h unit', () => {
    const prec = getVariableConfig('TPRECMAX')
    assert.strictEqual(prec.id, 'TPRECMAX')
    assert.strictEqual(prec.unit, 'mm/h')
    assert.strictEqual(prec.sourceUnit, 'kg m-2 s-1')
    assert.strictEqual(prec.type, 'scalar')
    assert.strictEqual(prec.hasSonification, true)
    assert.strictEqual(prec.convert(0.00001), 36) // 0.00001 kg/m²/s * 3.6e6 = 36 mm/h
  })

  test('9. TQV has correct water vapor metadata and kg/m² unit', () => {
    const tqv = getVariableConfig('TQV')
    assert.strictEqual(tqv.id, 'TQV')
    assert.strictEqual(tqv.unit, 'kg/m²')
    assert.strictEqual(tqv.sourceUnit, 'kg m-2')
    assert.strictEqual(tqv.type, 'scalar')
    assert.strictEqual(tqv.hasSonification, true)
  })

  test('10. ENVIRONMENTAL_TABS contains 4 required system tabs', () => {
    const tabIds = ENVIRONMENTAL_TABS.map((t) => t.id)
    assert.deepStrictEqual(tabIds, ['temperature', 'wind', 'precipitation', 'pressure'])

    const tempTab = ENVIRONMENTAL_TABS.find((t) => t.id === 'temperature')
    assert.deepStrictEqual(tempTab.vars, ['T2M', 'TS'])

    const windTab = ENVIRONMENTAL_TABS.find((t) => t.id === 'wind')
    assert.deepStrictEqual(windTab.vars, ['WIND'])

    const precipTab = ENVIRONMENTAL_TABS.find((t) => t.id === 'precipitation')
    assert.deepStrictEqual(precipTab.vars, ['TPRECMAX', 'TQV'])

    const pressureTab = ENVIRONMENTAL_TABS.find((t) => t.id === 'pressure')
    assert.deepStrictEqual(pressureTab.vars, ['PS'])
  })

  test('11. getVariableConfig falls back gracefully for unknown variables', () => {
    const fallback = getVariableConfig('UNKNOWN')
    assert.strictEqual(fallback.id, 'T2M')
  })
})
