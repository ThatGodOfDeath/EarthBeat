import { useMemo } from 'react'
import { formatWindSpeed, formatWindDirection, getCardinalDirection } from '../../utils/windUtils'
import styles from './WindVisualization.module.css'

/**
 * WindVisualization
 *
 * Minimalist, elegant visualization displaying the 10-meter wind vector
 * at the currently selected observation timestamp.
 *
 * Displays:
 *   - Compass dial with rotating meteorological wind indicator
 *   - Wind speed (m/s)
 *   - Meteorological direction (degrees [0, 360) and 16-point cardinal e.g. "237° SW")
 *   - Zero wind / calm handling ("Calm")
 *   - Vector components: u10m (eastward) and v10m (northward)
 *
 * Props:
 *   point     {object|null} { timestamp, u10m, v10m, speed, direction, cardinal }
 *   isLoading {boolean}
 *   error     {Error|string|null}
 *   onRetry   {Function}
 */
export default function WindVisualization({
  point = null,
  isLoading = false,
  error = null,
  onRetry,
}) {
  const isCalm = useMemo(() => {
    if (!point) return true
    if (point.speed != null && point.speed === 0) return true
    if (point.direction == null) return true
    return false
  }, [point])

  const cardinal = useMemo(() => {
    if (isCalm || !point || point.direction == null) return 'Calm'
    return point.cardinal || getCardinalDirection(point.direction)
  }, [isCalm, point])

  // In meteorology, wind direction is the angle FROM which wind blows (0° = North, 90° = East).
  // The arrow shows the wind stream flowing towards (direction + 180°).
  const rotationAngle = useMemo(() => {
    if (isCalm || !point || point.direction == null) return 0
    // Rotate indicator to point where the wind is coming FROM or blowing TO
    return point.direction
  }, [isCalm, point])

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingState}>
          <div className={styles.loadingSpinner} aria-hidden="true" />
          <p className={styles.statusText}>Loading wind observation…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <p className={styles.errorText}>
            {typeof error === 'string' ? error : error.message || 'Wind data unavailable'}
          </p>
          {onRetry && (
            <button
              type="button"
              className={styles.retryButton}
              onClick={onRetry}
            >
              Retry Wind Data
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!point) {
    return (
      <div className={styles.container}>
        <p className={styles.emptyText}>No wind data for selected timestamp.</p>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* ── Left: Compass Dial ────────────────────────────────────── */}
      <div className={styles.dialWrapper}>
        <svg
          viewBox="0 0 160 160"
          className={styles.dialSvg}
          role="img"
          aria-label={`Wind direction compass: ${formatWindDirection(point.direction)}`}
        >
          {/* Compass outer dial ring */}
          <circle cx="80" cy="80" r="70" className={styles.dialRing} />
          <circle cx="80" cy="80" r="66" className={styles.dialInnerRing} />

          {/* Cardinal markers (N, E, S, W) */}
          <text x="80" y="24" textAnchor="middle" className={styles.cardinalText}>N</text>
          <text x="144" y="84" textAnchor="middle" className={styles.cardinalText}>E</text>
          <text x="80" y="146" textAnchor="middle" className={styles.cardinalText}>S</text>
          <text x="16" y="84" textAnchor="middle" className={styles.cardinalText}>W</text>

          {/* Dial tick marks */}
          <line x1="80" y1="12" x2="80" y2="18" className={styles.tickMajor} />
          <line x1="148" y1="80" x2="142" y2="80" className={styles.tickMajor} />
          <line x1="80" y1="148" x2="80" y2="142" className={styles.tickMajor} />
          <line x1="12" y1="80" x2="18" y2="80" className={styles.tickMajor} />

          {isCalm ? (
            /* Calm state: concentric ripple circle, no directional arrow */
            <g className={styles.calmGroup}>
              <circle cx="80" cy="80" r="16" className={styles.calmRing} />
              <circle cx="80" cy="80" r="6" className={styles.calmCenter} />
            </g>
          ) : (
            /* Active wind arrow: rotated to meteorological direction */
            <g
              transform={`rotate(${rotationAngle} 80 80)`}
              className={styles.arrowGroup}
            >
              {/* Origin indicator circle (where wind originates from) */}
              <circle cx="80" cy="24" r="3.5" className={styles.originMarker} />

              {/* Streamline connecting origin through center to destination */}
              <line
                x1="80"
                y1="28"
                x2="80"
                y2="132"
                className={styles.streamLine}
              />

              {/* Arrowhead at destination (pointing towards direction wind is blowing) */}
              <polygon
                points="80,138 74,124 86,124"
                className={styles.arrowHead}
              />

              {/* Center pivot */}
              <circle cx="80" cy="80" r="4" className={styles.pivot} />
            </g>
          )}
        </svg>
      </div>

      {/* ── Right: Readouts ────────────────────────────────────────── */}
      <div className={styles.readoutColumn}>
        <div className={styles.speedRow}>
          <span className={styles.speedValue}>{formatWindSpeed(point.speed)}</span>
          <span className={styles.speedLabel}>10 m wind speed</span>
        </div>

        <div className={styles.directionRow}>
          <span className={styles.directionValue}>
            {isCalm ? 'Calm' : `${Math.round(point.direction)}° ${cardinal}`}
          </span>
          <span className={styles.directionLabel}>
            {isCalm ? 'No prevailing wind' : `from ${cardinal} (meteorological)`}
          </span>
        </div>

        {/* Vector breakdown */}
        <div className={styles.vectorRow}>
          <div className={styles.vectorItem}>
            <span className={styles.vectorLabel}>u10m (East)</span>
            <span className={styles.vectorVal}>
              {point.u10m != null ? `${point.u10m > 0 ? '+' : ''}${point.u10m.toFixed(1)} m/s` : '—'}
            </span>
          </div>
          <div className={styles.vectorDivider} />
          <div className={styles.vectorItem}>
            <span className={styles.vectorLabel}>v10m (North)</span>
            <span className={styles.vectorVal}>
              {point.v10m != null ? `${point.v10m > 0 ? '+' : ''}${point.v10m.toFixed(1)} m/s` : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
