/**
 * EnvironmentalPanel.jsx — Phase 9
 *
 * Replaces SstVisualization as the unified environmental context display.
 *
 * Shows all GEOS-FP environmental variables for the current timestamp:
 *   - Temperature System: Air Temperature (t2m) + Surface Temperature (ts) + diff
 *   - Moisture System:    Precipitation (tprecmax) + Atmospheric Moisture (tqv)
 *   - Wind System:        Speed (u10m/v10m derived) + Direction
 *   - Pressure System:    Surface Pressure (ps)
 *
 * Design:
 *   - Replaces the SST section at the bottom of the Explore page
 *   - Uses the same visual language (dark panel, subtle borders)
 *   - Shows human-readable labels (not raw variable names)
 *   - Shows units clearly
 */

import styles from './EnvironmentalPanel.module.css'
import { formatPressureHpa } from '../../utils/pressureSonification.js'

/**
 * Format temperature to Celsius.
 * Handles both Kelvin (> 150) and Celsius values.
 */
function formatTempC(val) {
  if (typeof val !== 'number' || isNaN(val)) return '—'
  const c = val > 150 ? val - 273.15 : val
  return `${c.toFixed(1)} °C`
}

/**
 * Format temperature difference (ts - t2m).
 */
function formatDiffC(ts, t2m) {
  if (typeof ts !== 'number' || isNaN(ts) || typeof t2m !== 'number' || isNaN(t2m)) return '—'
  const tsC = ts > 150 ? ts - 273.15 : ts
  const t2mC = t2m > 150 ? t2m - 273.15 : t2m
  const diff = tsC - t2mC
  const sign = diff >= 0 ? '+' : ''
  return `${sign}${diff.toFixed(1)} °C`
}

/**
 * Format precipitation from kg/m²/s to mm/hr.
 * 1 kg/m²/s = 3,600,000 mm/hr.
 */
function formatPrecipMmHr(kgM2S) {
  if (typeof kgM2S !== 'number' || isNaN(kgM2S) || kgM2S <= 0) return '0 mm/hr'
  const mmHr = kgM2S * 3_600_000
  if (mmHr < 0.1) return '< 0.1 mm/hr'
  if (mmHr < 10) return `${mmHr.toFixed(1)} mm/hr`
  return `${Math.round(mmHr)} mm/hr`
}

/**
 * Format total precipitable water vapor.
 * tqv is in kg/m² (same as mm of equivalent water depth).
 */
function formatTqvMm(tqv) {
  if (typeof tqv !== 'number' || isNaN(tqv)) return '—'
  return `${tqv.toFixed(1)} kg/m²`
}

/**
 * Format wind speed in m/s.
 */
function formatWindSpeed(speed) {
  if (typeof speed !== 'number' || isNaN(speed)) return '—'
  return `${speed.toFixed(1)} m/s`
}

/**
 * Qualitative precipitation descriptor.
 */
function precipLabel(kgM2S) {
  if (!kgM2S || kgM2S <= 0) return 'None'
  const mmHr = kgM2S * 3_600_000
  if (mmHr < 0.5) return 'Trace'
  if (mmHr < 2.5) return 'Light'
  if (mmHr < 7.5) return 'Moderate'
  if (mmHr < 25) return 'Heavy'
  return 'Intense'
}

/**
 * Qualitative moisture descriptor.
 */
function moistureLabel(tqv) {
  if (typeof tqv !== 'number') return '—'
  if (tqv < 10) return 'Very Dry'
  if (tqv < 25) return 'Dry'
  if (tqv < 40) return 'Moderate'
  if (tqv < 55) return 'Humid'
  return 'Saturated'
}

/**
 * Qualitative pressure descriptor.
 */
function pressureLabel(ps) {
  if (typeof ps !== 'number') return '—'
  const hpa = ps / 100
  if (hpa < 970) return 'Very Low'
  if (hpa < 1000) return 'Low'
  if (hpa < 1015) return 'Normal'
  if (hpa < 1025) return 'High'
  return 'Very High'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EnvironmentalPanel({
  envPoint = null,
  windPoint = null,
  temperaturePoint = null,
  timestamp = '',
  isLoading = false,
}) {
  if (isLoading && !envPoint && !windPoint && !temperaturePoint) {
    return (
      <section className={styles.panel} aria-label="Environmental data panel">
        <div className={styles.panelHeader}>
          <h3 className={styles.panelTitle}>Environmental State</h3>
          <span className={styles.panelSubtitle}>NASA GEOS-FP · All Variables</span>
        </div>
        <div className={styles.loading}>Loading environmental data…</div>
      </section>
    )
  }

  const ts   = envPoint?.ts   ?? null
  const tqv  = envPoint?.tqv  ?? null
  const tprecmax = envPoint?.tprecmax ?? null
  const ps   = envPoint?.ps   ?? null

  // t2m comes from envPoint (if available), temperaturePoint, or windPoint
  const t2m = envPoint?.t2m ?? temperaturePoint?.value ?? temperaturePoint?.temperature ?? windPoint?.t2m ?? null

  const tsC = ts != null ? (ts > 150 ? ts - 273.15 : ts) : null
  const t2mC = t2m != null ? (t2m > 150 ? t2m - 273.15 : t2m) : null
  const tempDiff = (tsC != null && t2mC != null) ? tsC - t2mC : null

  return (
    <section className={styles.panel} aria-label="Environmental data panel">
      <div className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>Environmental State</h3>
        <span className={styles.panelSubtitle}>NASA GEOS-FP · {timestamp || 'No timestamp'}</span>
      </div>

      <div className={styles.grid}>

        {/* ── Temperature System ─────────────────────────────────────────── */}
        <div className={styles.systemCard}>
          <div className={styles.systemLabel}>Temperature System</div>
          <div className={styles.systemRows}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Air Temperature</span>
              <span className={styles.rowValue}>{t2m != null ? formatTempC(t2m) : '—'}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Surface Temperature</span>
              <span className={styles.rowValue}>{formatTempC(ts)}</span>
            </div>
            {tempDiff != null && (
              <div className={`${styles.row} ${styles.rowDiff}`}>
                <span className={styles.rowLabel}>Surface − Air</span>
                <span className={`${styles.rowValue} ${tempDiff > 0 ? styles.warm : styles.cool}`}>
                  {formatDiffC(ts, t2m)}
                </span>
              </div>
            )}
          </div>
          <div className={styles.systemNote}>t2m → Pitch · ts → Timbre</div>
        </div>

        {/* ── Moisture / Precipitation System ───────────────────────────── */}
        <div className={styles.systemCard}>
          <div className={styles.systemLabel}>Moisture System</div>
          <div className={styles.systemRows}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Precipitation</span>
              <span className={styles.rowValue}>{formatPrecipMmHr(tprecmax)}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}></span>
              <span className={`${styles.rowTag} ${!tprecmax ? styles.tagDry : ''}`}>
                {precipLabel(tprecmax)}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Atmospheric Moisture</span>
              <span className={styles.rowValue}>{formatTqvMm(tqv)}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}></span>
              <span className={styles.rowTag}>{moistureLabel(tqv)}</span>
            </div>
          </div>
          <div className={styles.systemNote}>tprecmax → Rain · tqv → Texture</div>
        </div>

        {/* ── Wind System ────────────────────────────────────────────────── */}
        <div className={styles.systemCard}>
          <div className={styles.systemLabel}>Wind System</div>
          <div className={styles.systemRows}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Wind Speed</span>
              <span className={styles.rowValue}>{formatWindSpeed(windPoint?.speed)}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Wind Direction</span>
              <span className={styles.rowValue}>
                {windPoint?.cardinal ?? '—'}
                {windPoint?.direction != null && (
                  <span className={styles.rowValueSub}> ({Math.round(windPoint.direction)}°)</span>
                )}
              </span>
            </div>
          </div>
          <div className={styles.systemNote}>Speed → Loudness · Direction → Pan</div>
        </div>

        {/* ── Pressure System ────────────────────────────────────────────── */}
        <div className={styles.systemCard}>
          <div className={styles.systemLabel}>Pressure System</div>
          <div className={styles.systemRows}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Surface Pressure</span>
              <span className={styles.rowValue}>{formatPressureHpa(ps)}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}></span>
              <span className={styles.rowTag}>{pressureLabel(ps)}</span>
            </div>
          </div>
          <div className={styles.systemNote}>ps → Experimental Timbre (Candidate D)</div>
        </div>

      </div>
    </section>
  )
}
