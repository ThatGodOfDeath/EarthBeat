/**
 * SstVisualization.jsx — Phase 5C NASA EIC SST Temporal Synchronization
 *
 * Complementary global Earth-system visual context layer using
 * NASA Scientific Visualization Studio #5101 Sea Surface Temperature (MUR SST).
 *
 * Temporal Hierarchy & Scientific Principle:
 *   NASA SST represents the selected DAY (Daily global equirectangular frame).
 *   NASA GEOS-FP represents the TIME within that day (3-hourly atmospheric T2M).
 *   SST provides global context; GEOS-FP drives location graph & sound.
 *
 * Phase 5C Smoothness & Robustness Guarantees:
 *   - Same-day scrubbing: scrubbing 00:00 -> 21:00 on the same date NEVER re-fetches SST.
 *   - Midnight transition: Oct 1 21:00 -> Oct 2 00:00 keeps Oct 1 visible with a subtle
 *     update badge, preloads Oct 2 offscreen, and swaps seamlessly with ZERO flicker.
 *   - Playback independence: GEOS-FP playback & audio NEVER freeze or pause for SST.
 *   - Rapid scrubbing: 100ms debounce coalesces rapid slider drags; request IDs guarantee
 *     stale network responses can NEVER overwrite newer dates.
 *   - Cache reuse: previously loaded frames resolve synchronously from memory.
 *   - Graceful boundary handling: out-of-range dates clearly report availability without crashing.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import DataInfoTooltip from '../DataInfoTooltip'
import { getSstFrame, getSstPreviewUrl } from '../../api/sstApi'
import { formatSstDate } from '../../utils/dateUtils'
import styles from './SstVisualization.module.css'

// ── In-Memory Metadata Cache & In-Flight Tracking ─────────────────────────────
const frameMetaCache = new Map()      // dateStr -> frameData
const inFlightRequests = new Map()    // dateStr -> Promise<frameData>

// ── Tooltip Metadata ──────────────────────────────────────────────────────────
const SST_INFO_ROWS = [
  { field: 'Visualization',  value: 'NASA EIC / SVS #5101' },
  { field: 'Variable',       value: 'Sea Surface Temperature (SST)' },
  { field: 'Dataset',        value: 'MUR SST (JPL PO.DAAC)' },
  { field: 'Provider',       value: 'NASA Scientific Visualization Studio' },
  { field: 'Temporal Scale', value: 'Daily · Global Equirectangular' },
  { field: 'Role',           value: 'Global Earth-system visual context' },
  {
    field: 'Distinction',
    value: 'Measures ocean sea-surface temperature. Separate from GEOS-FP atmospheric 2 m air temperature.',
  },
]

export default function SstVisualization({ targetDate, activeTime = '', className = '' }) {
  // Currently displayed frame data and image URL (persists across transitions to prevent blanking)
  const [displayedFrameData, setDisplayedFrameData] = useState(() => {
    return targetDate ? frameMetaCache.get(targetDate) || null : null
  })
  const [displayedImgUrl, setDisplayedImgUrl] = useState(() => {
    const cached = targetDate ? frameMetaCache.get(targetDate) : null
    return cached ? getSstPreviewUrl(cached.actualDate) : null
  })

  const [isLoading, setIsLoading] = useState(!displayedFrameData)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [error, setError] = useState(null)

  // Tracking refs for stale-response protection
  const latestTargetDateRef = useRef(targetDate)
  useEffect(() => {
    latestTargetDateRef.current = targetDate
  }, [targetDate])

  const activeRequestIdRef = useRef(0)
  const debounceTimerRef = useRef(null)

  // ── Core Frame Fetch & Transition Engine ────────────────────────────────────
  const executeFrameTransition = useCallback(async (dateToFetch, forceRetry = false) => {
    if (!dateToFetch) return

    const requestId = ++activeRequestIdRef.current

    // If we already have this frame on screen, don't re-render
    if (!forceRetry && displayedFrameData && (
      displayedFrameData.requestedDate === dateToFetch ||
      displayedFrameData.actualDate === dateToFetch
    )) {
      setIsTransitioning(false)
      setIsLoading(false)
      return
    }

    // Set transition state (keeps previous image visible without blanking)
    if (displayedFrameData) {
      setIsTransitioning(true)
    } else {
      setIsLoading(true)
    }
    setError(null)

    try {
      // 1. Retrieve frame metadata (from cache or backend)
      let data
      if (!forceRetry && frameMetaCache.has(dateToFetch)) {
        data = frameMetaCache.get(dateToFetch)
      } else {
        let reqPromise = inFlightRequests.get(dateToFetch)
        if (!reqPromise || forceRetry) {
          reqPromise = getSstFrame(dateToFetch)
            .then((res) => {
              frameMetaCache.set(dateToFetch, res)
              inFlightRequests.delete(dateToFetch)
              return res
            })
            .catch((err) => {
              inFlightRequests.delete(dateToFetch)
              throw err
            })
          inFlightRequests.set(dateToFetch, reqPromise)
        }
        data = await reqPromise
      }

      // Stale Check 1: Has a newer date been requested while fetching metadata?
      if (requestId !== activeRequestIdRef.current || latestTargetDateRef.current !== dateToFetch) {
        return // Discard stale response
      }

      // 2. Preload the new preview image offscreen to eliminate flicker
      const newImgUrl = getSstPreviewUrl(data.actualDate)

      await new Promise((resolve) => {
        const preloadImg = new Image()
        preloadImg.src = newImgUrl
        preloadImg.onload = () => resolve(true)
        preloadImg.onerror = () => {
          // If image load fails, resolve anyway so state updates with error/fallback
          resolve(false)
        }
      })

      // Stale Check 2: Has a newer date been requested while preloading image?
      if (requestId !== activeRequestIdRef.current || latestTargetDateRef.current !== dateToFetch) {
        return // Discard stale response
      }

      // 3. Atomically update displayed visual frame
      setDisplayedFrameData(data)
      setDisplayedImgUrl(newImgUrl)
      setIsLoading(false)
      setIsTransitioning(false)
      setError(null)
    } catch (err) {
      if (requestId === activeRequestIdRef.current && latestTargetDateRef.current === dateToFetch) {
        console.warn('[SstVisualization] Frame retrieval failed:', err)
        setError('NASA SST visualization is temporarily unavailable.')
        setIsLoading(false)
        setIsTransitioning(false)
      }
    }
  }, [displayedFrameData])

  // ── Synchronize with Prop Changes (Debounced for Rapid Scrubbing) ───────────
  useEffect(() => {
    if (!targetDate) return

    // If target date is identical to what's already displayed, skip completely
    if (displayedFrameData && (
      displayedFrameData.requestedDate === targetDate ||
      displayedFrameData.actualDate === targetDate
    )) {
      return
    }

    // Cancel any pending debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }

    // Fast-path: If already in memory cache, execute immediately without debounce
    if (frameMetaCache.has(targetDate)) {
      executeFrameTransition(targetDate)
      return
    }

    // Uncached: Short 100ms debounce to coalesce rapid timeline slider scrubs
    debounceTimerRef.current = setTimeout(() => {
      executeFrameTransition(targetDate)
    }, 100)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [targetDate, displayedFrameData, executeFrameTransition])

  const handleRetry = useCallback(() => {
    executeFrameTransition(targetDate, true)
  }, [targetDate, executeFrameTransition])

  const humanDisplayDate = formatSstDate(displayedFrameData?.actualDate || targetDate)
  const isOutOfBounds = displayedFrameData?.isAvailable === false

  return (
    <section
      className={`${styles.container} ${className}`.trim()}
      aria-label="NASA Earth Visualization Sea Surface Temperature"
    >
      {/* ── Section Header ─────────────────────────────────────── */}
      <div className={styles.headerRow}>
        <div className={styles.titleGroup}>
          <h3 className={styles.title}>NASA Earth Visualization</h3>
          <span className={styles.meta}>
            NASA EIC / SVS #5101 · Sea Surface Temperature
          </span>

          {/* Compact Temporal Scale Context */}
          <div className={styles.temporalContext} aria-label={`SST Daily Frame Date: ${humanDisplayDate}, Active Time: ${activeTime || 'UTC'}`}>
            <span>Daily Frame: <strong className={styles.temporalScaleTag}>{humanDisplayDate}</strong></span>
            {activeTime && (
              <>
                <span>·</span>
                <span>Observation Time: <strong className={styles.temporalTimeTag}>{activeTime}</strong></span>
              </>
            )}
          </div>
        </div>

        <DataInfoTooltip
          label="NASA Sea Surface Temperature visualization information"
          rows={SST_INFO_ROWS}
          align="right"
        />
      </div>

      <div className={styles.divider} />

      {/* ── Out-of-Bounds Notice (Dataset Boundary Protection) ── */}
      {isOutOfBounds && (
        <div className={styles.boundaryNotice} role="status">
          <strong>Notice:</strong> {displayedFrameData.note || `Requested date (${targetDate}) is outside NASA SVS #5101 range (2024-04-18 – 2026-10-05). Showing nearest available frame.`}
        </div>
      )}

      {/* ── Dominant Visualization Frame ──────────────────────── */}
      <div className={styles.imageWrapper}>
        {/* Initial loading placeholder (only before first frame arrives) */}
        {isLoading && !displayedImgUrl && (
          <div className={styles.loadingOverlay}>
            <span className={styles.loadingText}>Loading NASA visualization…</span>
          </div>
        )}

        {/* Transition indicator (previous frame remains visible underneath) */}
        {isTransitioning && (
          <div className={styles.updatingBadge} aria-live="polite">
            Updating NASA visualization…
          </div>
        )}

        {error && !displayedImgUrl ? (
          <div className={styles.errorBox}>
            <p className={styles.errorMessage}>{error}</p>
            <button
              type="button"
              className={styles.retryBtn}
              onClick={handleRetry}
            >
              Retry
            </button>
          </div>
        ) : (
          displayedImgUrl && (
            <img
              src={displayedImgUrl}
              alt={`NASA global sea surface temperature visualization for ${humanDisplayDate}.`}
              className={styles.image}
              loading="lazy"
            />
          )
        )}
      </div>

      {/* ── Footer Attribution & Date Display ─────────────────── */}
      <div className={styles.footerRow}>
        <div className={styles.dateDisplay}>
          Date: {humanDisplayDate}
          {isOutOfBounds && (
            <span className={styles.noteText}>
              (Nearest available frame)
            </span>
          )}
        </div>

        <div className={styles.attribution}>
          NASA Scientific Visualization Studio · MUR SST
        </div>
      </div>
    </section>
  )
}
