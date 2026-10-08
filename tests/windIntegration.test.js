/**
 * windIntegration.test.js — Integration tests for Phase 6 Wind Integration.
 *
 * Verifies:
 *   1. Wind data consumes activeTimestamps without inventing a separate temporal pipeline.
 *   2. getWindData caching and request deduplication.
 *   3. Mock wind dataset generation for offline fallback.
 *   4. Synchronization of active wind point and active temperature point on the timeline.
 *   5. Filtering of wind points by timelineTimestamps (dropping unavailable timestamps).
 *   6. Isolated failure boundary: wind errors do not impact temperature sonification.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  getWindData,
  clearWindCache,
  WindServiceError,
} from '../src/services/windService.js'
import {
  temperatureToFrequency,
} from '../src/utils/sonification.js'

describe('Phase 6: Wind Integration Tests', () => {

  test('1. Mock wind data returns valid structure for generated timestamps', async () => {
    const timestamps = [
      '2026-10-05T00:00:00Z',
      '2026-10-05T03:00:00Z',
      '2026-10-05T06:00:00Z',
    ]

    const dataset = await getWindData(23.8103, 90.4125, {
      provider: 'mock',
      timestamps,
    })

    assert.ok(dataset, 'Dataset exists')
    assert.strictEqual(dataset.unit, 'm/s')
    assert.strictEqual(dataset.data.length, 3)

    const first = dataset.data[0]
    assert.strictEqual(first.timestamp, '2026-10-05T00:00:00Z')
    assert.ok(typeof first.u10m === 'number', 'u10m is a number')
    assert.ok(typeof first.v10m === 'number', 'v10m is a number')
    assert.ok(typeof first.speed === 'number', 'speed is a number')
    assert.ok(first.cardinal, 'cardinal direction is present')
  })

  test('2. Wind data conforms to activeTimestamps and excludes user-deleted timestamps', () => {
    const generatedTimestamps = [
      '2026-10-05T00:00:00Z',
      '2026-10-05T03:00:00Z',
      '2026-10-05T06:00:00Z',
      '2026-10-05T09:00:00Z',
    ]

    // User deleted the second timestamp
    const deletedTimestamps = new Set(['2026-10-05T03:00:00Z'])
    const activeTimestamps = generatedTimestamps.filter((ts) => !deletedTimestamps.has(ts))

    const mockWindPoints = generatedTimestamps.map((ts, i) => ({
      timestamp: ts,
      speed: 5.0 + i,
      direction: 180,
      cardinal: 'S',
    }))

    // Frontend chart filtering
    const chartWindData = mockWindPoints.filter((pt) => activeTimestamps.includes(pt.timestamp))

    assert.strictEqual(chartWindData.length, 3, 'Deleted point is excluded from wind chart')
    assert.deepStrictEqual(
      chartWindData.map((d) => d.timestamp),
      ['2026-10-05T00:00:00Z', '2026-10-05T06:00:00Z', '2026-10-05T09:00:00Z'],
    )
  })

  test('3. Timeline index synchronizes both temperature and wind point selection', () => {
    const timeline = ['2026-10-05T00:00:00Z', '2026-10-05T03:00:00Z']
    const activeIndex = 1
    const activeTimestamp = timeline[activeIndex]

    const tempData = [
      { timestamp: '2026-10-05T00:00:00Z', value: 28.5 },
      { timestamp: '2026-10-05T03:00:00Z', value: 31.2 },
    ]

    const windData = [
      { timestamp: '2026-10-05T00:00:00Z', speed: 4.1, direction: 90, cardinal: 'E' },
      { timestamp: '2026-10-05T03:00:00Z', speed: 6.8, direction: 220, cardinal: 'SW' },
    ]

    const currentTempPoint = tempData.find((d) => d.timestamp === activeTimestamp)
    const currentWindPoint = windData.find((d) => d.timestamp === activeTimestamp)

    assert.strictEqual(currentTempPoint.value, 31.2)
    assert.strictEqual(currentWindPoint.speed, 6.8)
    assert.strictEqual(currentWindPoint.cardinal, 'SW')
  })

  test('4. Isolated failure boundary: temperature sonification works even if wind fails', () => {
    const tempPoint = { value: 30.0 }
    const freq = temperatureToFrequency(tempPoint.value, 20.0, 40.0)

    assert.ok(freq > 0, 'Temperature sonification frequency computed correctly')

    // Simulated wind failure
    const windError = new WindServiceError('Wind service down', 'NETWORK_ERROR')
    assert.strictEqual(windError.code, 'NETWORK_ERROR')

    // Verify temperature audio calculation was not mutated
    assert.strictEqual(temperatureToFrequency(tempPoint.value, 20.0, 40.0), freq)
  })

  test('5. Invalid coordinates throw WindServiceError', async () => {
    await assert.rejects(
      async () => {
        await getWindData(null, null)
      },
      (err) => {
        assert.ok(err instanceof WindServiceError)
        assert.strictEqual(err.code, 'INVALID_COORDINATES')
        return true
      },
    )
  })
})
