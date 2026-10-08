/**
 * sstApi.js — NASA EIC SST Frontend API Client
 *
 * Dedicated client for Phase 5A Sea Surface Temperature investigation prototype.
 * Completely isolated from core temperatureApi to ensure zero regression
 * and zero interference with the Explore page loading path.
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'

/**
 * Fetch authoritative metadata for NASA SVS #5101 SST visualization.
 */
export async function getSstMetadata() {
  const url = new URL('/api/eic/sst/metadata', BACKEND_URL)
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Failed to load SST metadata: HTTP ${res.status}`)
  }
  return res.json()
}

/**
 * Fetch frame info for a target date (YYYY-MM-DD).
 */
export async function getSstFrame(dateStr) {
  const url = new URL('/api/eic/sst/frame', BACKEND_URL)
  url.searchParams.set('date', dateStr)
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(errorBody.detail || `Failed to fetch SST frame: HTTP ${res.status}`)
  }
  return res.json()
}

/**
 * Fetch GEOS-FP synchronization metadata for the calendar day.
 */
export async function getSstSync(dateStr) {
  const url = new URL('/api/eic/sst/sync', BACKEND_URL)
  url.searchParams.set('date', dateStr)
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(errorBody.detail || `Failed to fetch GEOS-FP sync: HTTP ${res.status}`)
  }
  return res.json()
}

/**
 * Build the backend preview image URL for a target date.
 */
export function getSstPreviewUrl(dateStr) {
  const url = new URL('/api/eic/sst/preview', BACKEND_URL)
  url.searchParams.set('date', dateStr)
  return url.toString()
}
