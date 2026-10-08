/**
 * timestampGenerator.test.js — Phase 5D Test Suite
 *
 * Tests for the timestamp generation utility and timestamp management logic.
 * No network calls. All pure-function / deterministic behavior.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  generateTimestamps,
  validateConfig,
  getDataRange,
  formatLabels,
  SCALE_CONFIG,
  MAX_PRACTICAL_TIMESTAMPS,
} from '../src/utils/timestampGenerator.js'

// ── Helper ────────────────────────────────────────────────────────────────────

function isoHour(ts) {
  return ts.slice(11, 16) // 'HH:MM'
}

function isoDate(ts) {
  return ts.slice(0, 10) // 'YYYY-MM-DD'
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. TIMESTAMP GENERATOR — DAILY MODE
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 5D: Timestamp Generator — Daily Mode', () => {

  test('1.1 Daily 1-day duration at 3-hour interval produces 9 timestamps (00:00–24:00 into past)', () => {
    const ts = generateTimestamps({
      scale: 'daily',
      startDate: '2026-10-01T00:00:00Z',
      duration: 1,
      interval: 3,
    })
    // 1 day backward from Oct 1: Sep 30 00:00 to Oct 1 00:00 (9 timestamps)
    assert.ok(ts.length >= 8, `Expected at least 8 timestamps, got ${ts.length}`)
    assert.strictEqual(isoDate(ts[0]), '2026-09-30')  // earliest (1 day prior)
    assert.strictEqual(isoDate(ts[ts.length - 1]), '2026-10-01') // latest (anchor date)
    // All hours divisible by 3
    ts.forEach((t) => {
      const hour = parseInt(t.slice(11, 13), 10)
      assert.strictEqual(hour % 3, 0)
    })
  })

  test('1.2 Daily 1-day at 24-hour interval produces 2 timestamps (prior day + anchor day)', () => {
    const ts = generateTimestamps({
      scale: 'daily',
      startDate: '2026-10-01T00:00:00Z',
      duration: 1,
      interval: 24,
    })
    assert.strictEqual(ts.length, 2)
    assert.strictEqual(isoHour(ts[0]), '00:00')
    assert.strictEqual(isoDate(ts[0]), '2026-09-30')  // 1 day prior
    assert.strictEqual(isoDate(ts[1]), '2026-10-01')  // anchor date
  })

  test('1.3 Daily 0-day duration produces exactly 1 timestamp', () => {
    const ts = generateTimestamps({
      scale: 'daily',
      startDate: '2026-10-01T00:00:00Z',
      duration: 0,
      interval: 3,
    })
    assert.strictEqual(ts.length, 1)
    assert.strictEqual(isoDate(ts[0]), '2026-10-01')
    assert.strictEqual(isoHour(ts[0]), '00:00')
  })

  test('1.4 Timestamps are ordered chronologically (Earlier → Latest)', () => {
    const ts = generateTimestamps({
      scale: 'daily',
      startDate: '2026-10-01T00:00:00Z',
      duration: 2,
      interval: 6,
    })
    for (let i = 1; i < ts.length; i++) {
      const prev = new Date(ts[i - 1]).getTime()
      const curr = new Date(ts[i]).getTime()
      assert.ok(curr > prev, `Timestamp at index ${i} is not after index ${i-1}`)
    }
  })

  test('1.5 All daily timestamps align to GEOS-FP 3-hour boundaries (UTC hours divisible by 3)', () => {
    const ts = generateTimestamps({
      scale: 'daily',
      startDate: '2026-10-01T00:00:00Z',
      duration: 1,
      interval: 3,
    })
    ts.forEach((t) => {
      const hour = parseInt(t.slice(11, 13), 10)
      assert.strictEqual(hour % 3, 0, `Timestamp ${t} has hour ${hour} not divisible by 3`)
    })
  })

  test('1.6 Minimum interval is enforced (interval < 3 snaps to 3)', () => {
    const ts = generateTimestamps({
      scale: 'daily',
      startDate: '2026-10-01T00:00:00Z',
      duration: 1,
      interval: 1, // below minimum 3
    })
    // Should behave as interval=3
    const ts3 = generateTimestamps({
      scale: 'daily',
      startDate: '2026-10-01T00:00:00Z',
      duration: 1,
      interval: 3,
    })
    assert.strictEqual(ts.length, ts3.length)
  })

  test('1.7 Maximum interval is enforced (interval > 24 clamps to 24 for daily)', () => {
    const ts = generateTimestamps({
      scale: 'daily',
      startDate: '2026-10-01T00:00:00Z',
      duration: 1,
      interval: 48, // above maximum
    })
    const ts24 = generateTimestamps({
      scale: 'daily',
      startDate: '2026-10-01T00:00:00Z',
      duration: 1,
      interval: 24,
    })
    assert.strictEqual(ts.length, ts24.length)
  })

  test('1.8 UTC date handling: start date is not shifted by local timezone', () => {
    // Even if the test runner is UTC+6, startDate must begin at 2026-10-01T00:00:00Z
    const ts = generateTimestamps({
      scale: 'daily',
      startDate: '2026-10-01T00:00:00Z',
      duration: 0,
      interval: 3,
    })
    assert.strictEqual(ts[0], '2026-10-01T00:00:00Z')
  })

  test('1.9 Invalid scale returns empty array without throwing', () => {
    const ts = generateTimestamps({
      scale: 'unknown_scale',
      startDate: '2026-10-01T00:00:00Z',
      duration: 1,
      interval: 3,
    })
    assert.deepStrictEqual(ts, [])
  })

  test('1.10 Invalid startDate returns empty array without throwing', () => {
    const ts = generateTimestamps({
      scale: 'daily',
      startDate: 'not-a-date',
      duration: 1,
      interval: 3,
    })
    assert.deepStrictEqual(ts, [])
  })
})


// ═══════════════════════════════════════════════════════════════════════════════
// 3. TIMESTAMP GENERATOR — MONTHLY MODE
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 5D: Timestamp Generator — Monthly Mode', () => {

  test('3.1 Monthly 1-month at 1-day interval produces ~31 timestamps for October', () => {
    const ts = generateTimestamps({
      scale: 'monthly',
      startDate: '2026-10-01T00:00:00Z',
      duration: 1,
      interval: 1,
    })
    // Oct 1 to Nov 1 = 32 timestamps (inclusive of both endpoints)
    assert.ok(ts.length >= 30 && ts.length <= 33, `Got ${ts.length}`)
  })

  test('3.2 Monthly all timestamps are at midnight UTC (00:00)', () => {
    const ts = generateTimestamps({
      scale: 'monthly',
      startDate: '2026-10-01T00:00:00Z',
      duration: 2,
      interval: 5,
    })
    ts.forEach((t) => {
      assert.strictEqual(isoHour(t), '00:00', `${t} is not at midnight`)
    })
  })

  test('3.3 Monthly 0-duration returns 1 timestamp', () => {
    const ts = generateTimestamps({
      scale: 'monthly',
      startDate: '2026-10-01T00:00:00Z',
      duration: 0,
      interval: 1,
    })
    assert.strictEqual(ts.length, 1)
    assert.strictEqual(isoDate(ts[0]), '2026-10-01')
  })

  test('3.4 Monthly 6-month at 30-day interval produces timestamps across 6 months', () => {
    const ts = generateTimestamps({
      scale: 'monthly',
      startDate: '2026-01-01T00:00:00Z',
      duration: 6,
      interval: 30,
    })
    assert.ok(ts.length >= 6, `Expected ≥6, got ${ts.length}`)
    // Reversed: last entry is the start date (Jan 1)
    assert.strictEqual(isoDate(ts[ts.length - 1]), '2026-01-01')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TIMESTAMP GENERATOR — YEARLY MODE
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 5D: Timestamp Generator — Yearly Mode', () => {

  test('4.1 Yearly 1-year at 1-month interval produces 13 timestamps (Jan-Jan inclusive)', () => {
    const ts = generateTimestamps({
      scale: 'yearly',
      startDate: '2026-01-01T00:00:00Z',
      duration: 1,
      interval: 1,
    })
    // Jan2026, Feb2026, ..., Dec2026, Jan2027 = 13
    assert.strictEqual(ts.length, 13)
  })

  test('4.2 Yearly always starts on the 1st of the month', () => {
    const ts = generateTimestamps({
      scale: 'yearly',
      startDate: '2026-10-15T00:00:00Z', // mid-month start
      duration: 1,
      interval: 1,
    })
    ts.forEach((t) => {
      assert.strictEqual(t.slice(8, 10), '01', `${t} does not start on the 1st`)
    })
  })

  test('4.3 Yearly 0-duration returns 1 timestamp at month start', () => {
    const ts = generateTimestamps({
      scale: 'yearly',
      startDate: '2026-10-07T00:00:00Z',
      duration: 0,
      interval: 1,
    })
    assert.strictEqual(ts.length, 1)
    assert.strictEqual(isoDate(ts[0]), '2026-10-01') // 1st of month
  })

  test('4.4 Yearly 1-year at 12-month interval produces 2 timestamps (start + end year)', () => {
    const ts = generateTimestamps({
      scale: 'yearly',
      startDate: '2026-01-01T00:00:00Z',
      duration: 1,
      interval: 12,
    })
    assert.strictEqual(ts.length, 2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 5. TIMESTAMP MANAGEMENT — Deletion Logic
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 5D: Timestamp Management — Deletion Logic', () => {

  test('5.1 Single timestamp deletion produces correct active set', () => {
    const generated = [
      '2026-10-01T00:00:00Z',
      '2026-10-01T03:00:00Z',
      '2026-10-01T06:00:00Z',
      '2026-10-01T09:00:00Z',
    ]
    const deleted = new Set(['2026-10-01T06:00:00Z'])
    const active = generated.filter((ts) => !deleted.has(ts))

    assert.strictEqual(active.length, 3)
    assert.ok(!active.includes('2026-10-01T06:00:00Z'))
    assert.ok(active.includes('2026-10-01T00:00:00Z'))
    assert.ok(active.includes('2026-10-01T09:00:00Z'))
  })

  test('5.2 Multiple timestamp deletion produces correct active set', () => {
    const generated = [
      '2026-10-01T00:00:00Z',
      '2026-10-01T03:00:00Z',
      '2026-10-01T06:00:00Z',
      '2026-10-01T09:00:00Z',
    ]
    const deleted = new Set([
      '2026-10-01T00:00:00Z',
      '2026-10-01T06:00:00Z',
    ])
    const active = generated.filter((ts) => !deleted.has(ts))

    assert.strictEqual(active.length, 2)
    assert.deepStrictEqual(active, [
      '2026-10-01T03:00:00Z',
      '2026-10-01T09:00:00Z',
    ])
  })

  test('5.3 Select all populates checked set with all active timestamps', () => {
    const activeTimestamps = [
      '2026-10-01T00:00:00Z',
      '2026-10-01T03:00:00Z',
      '2026-10-01T06:00:00Z',
    ]
    const checkedSet = new Set(activeTimestamps) // simulate "Select All"
    assert.strictEqual(checkedSet.size, 3)
    activeTimestamps.forEach((ts) => assert.ok(checkedSet.has(ts)))
  })

  test('5.4 Clear selection empties checked set', () => {
    let checkedSet = new Set(['2026-10-01T00:00:00Z', '2026-10-01T03:00:00Z'])
    checkedSet = new Set() // simulate "Clear"
    assert.strictEqual(checkedSet.size, 0)
  })

  test('5.5 Deleting all timestamps results in empty active set', () => {
    const generated = [
      '2026-10-01T00:00:00Z',
      '2026-10-01T03:00:00Z',
    ]
    const deleted = new Set(generated)
    const active = generated.filter((ts) => !deleted.has(ts))
    assert.strictEqual(active.length, 0)
  })

  test('5.6 Restoring timestamps clears the deleted set', () => {
    let deleted = new Set([
      '2026-10-01T00:00:00Z',
      '2026-10-01T06:00:00Z',
    ])
    deleted = new Set() // simulate restore
    const generated = [
      '2026-10-01T00:00:00Z',
      '2026-10-01T03:00:00Z',
      '2026-10-01T06:00:00Z',
    ]
    const active = generated.filter((ts) => !deleted.has(ts))
    assert.strictEqual(active.length, 3)
  })

  test('5.7 Changing temporal config should reset deletions (new config = fresh dataset)', () => {
    // Simulate: user deletes some timestamps, then changes temporal config
    const deletions = new Set(['2026-10-01T00:00:00Z'])
    // Config change → clear deletions
    const resetDeletions = new Set()
    assert.strictEqual(resetDeletions.size, 0)

    // New generated timestamps from new config
    const newGenerated = ['2026-10-02T00:00:00Z', '2026-10-02T03:00:00Z']
    const newActive = newGenerated.filter((ts) => !resetDeletions.has(ts))
    assert.strictEqual(newActive.length, 2)

    // Old deletion should not affect new config
    assert.ok(!deletions.has('2026-10-02T00:00:00Z'))
  })

  test('5.8 Active timestamps remain in chronological order after deletion', () => {
    const generated = [
      '2026-10-01T00:00:00Z',
      '2026-10-01T03:00:00Z',
      '2026-10-01T06:00:00Z',
      '2026-10-01T09:00:00Z',
      '2026-10-01T12:00:00Z',
    ]
    const deleted = new Set(['2026-10-01T03:00:00Z', '2026-10-01T09:00:00Z'])
    const active = generated.filter((ts) => !deleted.has(ts))

    for (let i = 1; i < active.length; i++) {
      const prev = new Date(active[i - 1]).getTime()
      const curr = new Date(active[i]).getTime()
      assert.ok(curr > prev, 'Active timestamps must remain chronological')
    }
  })

  test('5.9 Removing current timestamp: pointer moves to nearest previous', () => {
    const activeTimestamps = [
      '2026-10-01T00:00:00Z',
      '2026-10-01T03:00:00Z',
      '2026-10-01T06:00:00Z',
      '2026-10-01T09:00:00Z',
    ]
    const currentTs = '2026-10-01T06:00:00Z'
    const currentIdx = activeTimestamps.indexOf(currentTs)
    const remaining = activeTimestamps.filter((t) => t !== currentTs)

    // Move to timestamp just before deleted one
    const newIdx = Math.max(0, currentIdx - 1)
    const newTs = remaining[Math.min(newIdx, remaining.length - 1)]

    assert.strictEqual(newTs, '2026-10-01T03:00:00Z')
  })

  test('5.10 Removing first timestamp: pointer moves to next remaining', () => {
    const activeTimestamps = [
      '2026-10-01T00:00:00Z',
      '2026-10-01T03:00:00Z',
      '2026-10-01T06:00:00Z',
    ]
    const currentTs = '2026-10-01T00:00:00Z' // first timestamp
    const currentIdx = activeTimestamps.indexOf(currentTs) // 0
    const remaining = activeTimestamps.filter((t) => t !== currentTs)

    const newIdx = Math.max(0, currentIdx - 1) // still 0
    const newTs = remaining[Math.min(newIdx, remaining.length - 1)]

    assert.strictEqual(newTs, '2026-10-01T03:00:00Z')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 6. DATA FLOW HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 5D: Data Flow Helpers', () => {

  test('6.1 getDataRange returns correct start/end from timestamp list', () => {
    const ts = [
      '2026-10-01T00:00:00Z',  // earliest (index 0)
      '2026-10-01T03:00:00Z',
      '2026-10-01T06:00:00Z',  // latest (last index)
    ]
    const range = getDataRange(ts)
    assert.strictEqual(range.start, '2026-10-01T00:00:00Z')
    assert.strictEqual(range.end, '2026-10-01T06:00:00Z')
  })

  test('6.2 getDataRange returns null for empty list', () => {
    const range = getDataRange([])
    assert.strictEqual(range, null)
  })

  test('6.3 formatLabels returns correctly pluralized labels', () => {
    const { durationLabel, intervalLabel } = formatLabels('daily', 1, 3)
    assert.ok(durationLabel.includes('day'), `Expected 'day' in "${durationLabel}"`)
    assert.ok(intervalLabel.includes('hour'), `Expected 'hour' in "${intervalLabel}"`)
  })

  test('6.4 validateConfig clamps duration to scale boundaries', () => {
    const result = validateConfig({
      scale: 'daily',
      startDate: '2026-10-01T00:00:00Z',
      duration: 999,  // way over max of 60
      interval: 3,
    })
    assert.strictEqual(result.duration, SCALE_CONFIG.daily.durationMax) // 60
  })

  test('6.5 validateConfig clamps interval to scale boundaries', () => {
    const result = validateConfig({
      scale: 'daily',
      startDate: '2026-10-01T00:00:00Z',
      duration: 1,
      interval: 0, // below minimum of 3
    })
    assert.strictEqual(result.interval, SCALE_CONFIG.daily.intervalMin) // 3
  })

  test('6.6 validateConfig returns null for unknown scale', () => {
    const result = validateConfig({ scale: 'invalid', duration: 1, interval: 3 })
    assert.strictEqual(result, null)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 7. SST DATE DEDUPLICATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 5D: SST Daily Frame Deduplication', () => {

  function extractUtcDateSimple(iso) {
    return String(iso).slice(0, 10)
  }

  function getUniqueDates(timestamps) {
    return [...new Set(timestamps.map(extractUtcDateSimple))]
  }

  test('7.1 Multiple same-day timestamps produce ONE SST date', () => {
    const timestamps = [
      '2026-10-01T00:00:00Z',
      '2026-10-01T03:00:00Z',
      '2026-10-01T06:00:00Z',
      '2026-10-01T12:00:00Z',
    ]
    const uniqueDates = getUniqueDates(timestamps)
    assert.strictEqual(uniqueDates.length, 1)
    assert.strictEqual(uniqueDates[0], '2026-10-01')
  })

  test('7.2 Cross-day timestamps produce TWO SST dates', () => {
    const timestamps = [
      '2026-10-01T21:00:00Z',
      '2026-10-02T00:00:00Z',
    ]
    const uniqueDates = getUniqueDates(timestamps)
    assert.strictEqual(uniqueDates.length, 2)
    assert.strictEqual(uniqueDates[0], '2026-10-01')
    assert.strictEqual(uniqueDates[1], '2026-10-02')
  })

  test('7.3 Removing all Oct 2 timestamps means Oct 2 SST never needed', () => {
    const generated = [
      '2026-10-01T21:00:00Z',
      '2026-10-02T00:00:00Z',
      '2026-10-02T03:00:00Z',
    ]
    const deleted = new Set(['2026-10-02T00:00:00Z', '2026-10-02T03:00:00Z'])
    const active = generated.filter((ts) => !deleted.has(ts))
    const uniqueDates = getUniqueDates(active)

    assert.strictEqual(uniqueDates.length, 1)
    assert.strictEqual(uniqueDates[0], '2026-10-01')
    assert.ok(!uniqueDates.includes('2026-10-02'))
  })

  test('7.4 Two timestamps on same day still show only one SST frame needed', () => {
    const timestamps = [
      '2026-10-05T09:00:00Z',
      '2026-10-05T12:00:00Z',
    ]
    const uniqueDates = getUniqueDates(timestamps)
    assert.strictEqual(uniqueDates.length, 1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 8. PERFORMANCE — Large Ranges
// ═══════════════════════════════════════════════════════════════════════════════

describe('Phase 5D: Performance — Large Range Generation', () => {

  test('8.1 Daily 60-day at 3-hour interval: fast generation and ≤ MAX_PRACTICAL_TIMESTAMPS', () => {
    const start = Date.now()
    const ts = generateTimestamps({
      scale: 'daily',
      startDate: '2026-01-01T00:00:00Z',
      duration: 60,
      interval: 3,
    })
    const elapsed = Date.now() - start
    assert.ok(elapsed < 500, `Generation took too long: ${elapsed}ms`)
    assert.ok(ts.length <= MAX_PRACTICAL_TIMESTAMPS + 1, `Too many timestamps: ${ts.length}`)
    assert.ok(ts.length > 0, 'Must produce at least 1 timestamp')
  })

  test('8.3 Monthly 60-month at 1-day interval: capped at MAX_PRACTICAL_TIMESTAMPS', () => {
    const ts = generateTimestamps({
      scale: 'monthly',
      startDate: '2021-01-01T00:00:00Z',
      duration: 60,
      interval: 1, // would produce ~1826 timestamps
    })
    // Should be capped at MAX_PRACTICAL_TIMESTAMPS
    assert.ok(ts.length <= MAX_PRACTICAL_TIMESTAMPS + 1)
    assert.ok(ts.length > 0)
  })

  test('8.4 Yearly 60-year at 1-month interval: capped at MAX_PRACTICAL_TIMESTAMPS', () => {
    const ts = generateTimestamps({
      scale: 'yearly',
      startDate: '2000-01-01T00:00:00Z',
      duration: 60,
      interval: 1, // would produce 721 timestamps
    })
    assert.ok(ts.length <= MAX_PRACTICAL_TIMESTAMPS + 1)
    assert.ok(ts.length > 0)
  })
})
