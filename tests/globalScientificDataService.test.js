/**
 * globalScientificDataService.test.js
 *
 * Unit tests for global scientific data service (T2M, TS, PS, WIND).
 */

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  getGlobalScientificGrid,
  clearGlobalScientificCache,
  GRID_WIDTH,
  GRID_HEIGHT,
} from '../src/services/globalScientificDataService.js'

describe('Global Scientific Data Service', () => {
  beforeEach(() => {
    clearGlobalScientificCache()
  })

  test('1. Generates valid 360×180 grid for T2M', async () => {
    const grid = await getGlobalScientificGrid('T2M', '2026-10-05T12:00:00Z', { provider: 'mock' })
    assert.ok(grid, 'Grid returned')
    assert.strictEqual(grid.variable, 'T2M')
    assert.strictEqual(grid.width, GRID_WIDTH)
    assert.strictEqual(grid.height, GRID_HEIGHT)
    assert.ok(grid.values instanceof Float32Array)
    assert.strictEqual(grid.values.length, GRID_WIDTH * GRID_HEIGHT)
    assert.strictEqual(grid.unit, '°C')
  })

  test('2. Generates valid 360×180 grid for TS with surface temperature range', async () => {
    const grid = await getGlobalScientificGrid('TS', '2026-10-05T12:00:00Z', { provider: 'mock' })
    assert.ok(grid)
    assert.strictEqual(grid.variable, 'TS')
    assert.strictEqual(grid.unit, '°C')
    assert.strictEqual(grid.values.length, 360 * 180)
  })

  test('3. Generates valid 360×180 grid for PS with barometric range', async () => {
    const grid = await getGlobalScientificGrid('PS', '2026-10-05T12:00:00Z', { provider: 'mock' })
    assert.ok(grid)
    assert.strictEqual(grid.variable, 'PS')
    assert.strictEqual(grid.unit, 'hPa')
    // Plausible surface pressures between 900 and 1050 hPa
    const midVal = grid.values[GRID_WIDTH * 90 + 180]
    assert.ok(midVal >= 900 && midVal <= 1050, `Pressure ${midVal} within barometric range`)
  })

  test('4. Generates speed, uValues, and vValues for WIND', async () => {
    const grid = await getGlobalScientificGrid('WIND', '2026-10-05T12:00:00Z', { provider: 'mock' })
    assert.ok(grid)
    assert.strictEqual(grid.variable, 'WIND')
    assert.strictEqual(grid.unit, 'm/s')
    assert.ok(grid.values instanceof Float32Array)
    assert.ok(grid.uValues instanceof Float32Array)
    assert.ok(grid.vValues instanceof Float32Array)
    assert.strictEqual(grid.uValues.length, 360 * 180)
    assert.strictEqual(grid.vValues.length, 360 * 180)

    // Check non-negative speeds
    const sampleSpeed = grid.values[1000]
    assert.ok(sampleSpeed >= 0, 'Wind speed is non-negative')
  })

  test('5. In-memory cache isolates variables (no key collision between T2M and TS)', async () => {
    const ts = '2026-10-05T00:00:00Z'
    const t2mGrid = await getGlobalScientificGrid('T2M', ts, { provider: 'mock' })
    const tsGrid = await getGlobalScientificGrid('TS', ts, { provider: 'mock' })

    assert.strictEqual(t2mGrid.variable, 'T2M')
    assert.strictEqual(tsGrid.variable, 'TS')
    assert.notStrictEqual(t2mGrid, tsGrid, 'Different variable grids are stored in distinct cache slots')
  })

  test('6. Generates valid 360×180 grid for TPRECMAX with precipitation range', async () => {
    const grid = await getGlobalScientificGrid('TPRECMAX', '2026-10-05T12:00:00Z', { provider: 'mock' })
    assert.ok(grid)
    assert.strictEqual(grid.variable, 'TPRECMAX')
    assert.strictEqual(grid.unit, 'mm/h')
    assert.strictEqual(grid.values.length, 360 * 180)
    // Non-negative precipitation values
    assert.ok(grid.values[0] >= 0)
  })

  test('7. Generates valid 360×180 grid for TQV with atmospheric water vapor range', async () => {
    const grid = await getGlobalScientificGrid('TQV', '2026-10-05T12:00:00Z', { provider: 'mock' })
    assert.ok(grid)
    assert.strictEqual(grid.variable, 'TQV')
    assert.strictEqual(grid.unit, 'kg/m²')
    assert.strictEqual(grid.values.length, 360 * 180)
    // Plausible water vapor range
    assert.ok(grid.values[0] >= 0 && grid.values[0] <= 80)
  })

  test('8. Null timestamp returns null safely', async () => {
    const result = await getGlobalScientificGrid('T2M', null)
    assert.strictEqual(result, null)
  })
})
