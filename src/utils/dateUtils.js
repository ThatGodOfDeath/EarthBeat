/**
 * dateUtils.js — Unified Date & Time Utilities for Earth Jukebox
 *
 * Guarantees consistent UTC handling across GEOS-FP 3-hourly observations
 * and NASA EIC/SVS daily MUR SST visualization frames.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Format a YYYY-MM-DD date string into human-readable format: "Month Day, Year"
 * E.g., "2026-10-01" -> "October 1, 2026"
 */
export function formatSstDate(dateStr) {
  if (!dateStr) return '—'
  const parts = String(dateStr).split('-')
  if (parts.length < 3) return String(dateStr)
  const year = parseInt(parts[0], 10)
  const month = parseInt(parts[1], 10)
  const day = parseInt(parts[2], 10)
  if (isNaN(year) || isNaN(month) || isNaN(day)) return String(dateStr)

  const monthName = MONTH_NAMES[month - 1]
  if (!monthName) return String(dateStr)

  return `${monthName} ${day}, ${year}`
}

/**
 * Extract the pure UTC calendar date string (YYYY-MM-DD) from an ISO 8601 string.
 * Uses string slicing to avoid any local timezone skewing.
 * E.g., "2026-10-01T21:00:00Z" -> "2026-10-01"
 */
export function extractUtcDate(isoString) {
  if (!isoString) return ''
  return String(isoString).slice(0, 10)
}

/**
 * Extract the UTC time string (HH:MM UTC) from an ISO 8601 string.
 * E.g., "2026-10-01T15:00:00Z" -> "15:00 UTC"
 */
export function extractUtcTime(isoString) {
  if (!isoString) return '—'
  const match = String(isoString).match(/T(\d{2}):(\d{2})/)
  if (!match) return '—'
  return `${match[1]}:${match[2]} UTC`
}

/**
 * Deconstruct an ISO 8601 UTC timestamp into distinct temporal scale components:
 * - calendarDate (YYYY-MM-DD)
 * - humanDate ("October 1, 2026")
 * - timeString ("15:00 UTC")
 * - fullString ("October 1, 2026 · 15:00 UTC")
 */
export function parseTemporalComponents(isoString) {
  if (!isoString) {
    return {
      calendarDate: '',
      humanDate: '—',
      timeString: '—',
      fullString: '—',
    }
  }

  const calendarDate = extractUtcDate(isoString)
  const humanDate = formatSstDate(calendarDate)
  const timeString = extractUtcTime(isoString)

  return {
    calendarDate,
    humanDate,
    timeString,
    fullString: `${humanDate} · ${timeString}`,
  }
}
