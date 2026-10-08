/**
 * TemporalControls.jsx — Phase 5D
 *
 * Self-contained temporal configuration box.
 * Controls: scale selector, start date, duration slider, interval slider.
 *
 * Props:
 *   config      {object}   Current temporal config (scale, startDate, duration, interval)
 *   onChange    {function} Called with updated config whenever any control changes (draft)
 *   onConfirm   {function} Called when user clicks "Apply" — clears cache & commits config
 *   isLoading   {boolean}  Whether temperature data is loading
 *   isDirty     {boolean}  Whether the draft differs from the last committed config
 *   hideTitle   {boolean}  When true, hides the title row (for embedding in sidebar)
 */

import { useMemo, useCallback } from 'react'
import {
  SCALE_CONFIG,
  formatLabels,
  summarizeConfig,
} from '../../utils/timestampGenerator'
import styles from './TemporalControls.module.css'

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

// Build year list: 2018–2028
const YEAR_OPTIONS = Array.from({ length: 11 }, (_, i) => 2018 + i)

export default function TemporalControls({
  config,
  onChange,
  onConfirm,
  isLoading,
  isDirty = false,
  hideTitle = false,
}) {
  const cfg = SCALE_CONFIG[config.scale] || SCALE_CONFIG.daily

  // ── Parse start date parts (UTC) ───────────────────────────────────────────
  const startDate = useMemo(() => {
    const d = new Date(config.startDate)
    return isNaN(d.getTime()) ? new Date('2026-10-01T00:00:00.000Z') : d
  }, [config.startDate])

  const startDay   = startDate.getUTCDate()
  const startMonth = startDate.getUTCMonth() // 0-indexed
  const startYear  = startDate.getUTCFullYear()

  // ── Helper: build a new startDate ISO string from parts ───────────────────
  const buildStartDate = useCallback((year, month0, day) => {
    // Clamp day to valid range for month
    const maxDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
    const safeDay = Math.min(day, maxDay)
    return new Date(Date.UTC(year, month0, safeDay, 0, 0, 0, 0)).toISOString()
  }, [])

  // ── Scale selector ─────────────────────────────────────────────────────────
  function handleScaleChange(newScale) {
    const newCfg = SCALE_CONFIG[newScale]
    if (!newCfg) return
    onChange({
      ...config,
      scale: newScale,
      duration: newCfg.durationDefault,
      interval: newCfg.intervalDefault,
    })
  }

  // ── Start date changes ────────────────────────────────────────────────────
  function handleDayChange(e) {
    const day = parseInt(e.target.value, 10)
    if (isNaN(day)) return
    onChange({ ...config, startDate: buildStartDate(startYear, startMonth, day) })
  }

  function handleMonthChange(e) {
    const month0 = parseInt(e.target.value, 10)
    if (isNaN(month0)) return
    onChange({ ...config, startDate: buildStartDate(startYear, month0, startDay) })
  }

  function handleYearChange(e) {
    const year = parseInt(e.target.value, 10)
    if (isNaN(year)) return
    onChange({ ...config, startDate: buildStartDate(year, startMonth, startDay) })
  }

  // ── Duration / Interval ───────────────────────────────────────────────────
  function handleDurationChange(e) {
    onChange({ ...config, duration: parseInt(e.target.value, 10) })
  }

  function handleIntervalChange(e) {
    onChange({ ...config, interval: parseInt(e.target.value, 10) })
  }

  const { durationLabel, intervalLabel } = useMemo(
    () => formatLabels(config.scale, config.duration, config.interval),
    [config.scale, config.duration, config.interval],
  )

  // ── Days in current start month (for day dropdown) ─────────────────────────
  const daysInMonth = useMemo(() => {
    return new Date(Date.UTC(startYear, startMonth + 1, 0)).getUTCDate()
  }, [startYear, startMonth])

  const scaleOptions = Object.entries(SCALE_CONFIG).map(([key, sc]) => ({
    key,
    label: sc.label,
  }))

  return (
    <section className={styles.box} aria-label="Temporal Exploration Controls">
      {/* ── Title Row ──────────────────────────────────────────────────────── */}
      {!hideTitle && (
        <>
          <div className={styles.titleRow}>
            <h3 className={styles.title}>Temporal Exploration</h3>
            {isLoading && (
              <span className={styles.loadingBadge} aria-live="polite">
                Loading…
              </span>
            )}
          </div>
          <div className={styles.divider} />
        </>
      )}

      {/* ── Scale Selector ──────────────────────────────────────────────────── */}
      <div className={styles.row}>
        <span className={styles.controlLabel}>Scale</span>
        <div className={styles.scaleSelector} role="group" aria-label="Temporal scale">
          {scaleOptions.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`${styles.scaleBtn} ${config.scale === key ? styles.scaleBtnActive : ''}`}
              onClick={() => handleScaleChange(key)}
              aria-pressed={config.scale === key}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Start Date Input ─────────────────────────────────────────────────── */}
      <div className={styles.row}>
        <span className={styles.controlLabel}>Date</span>
        <div className={styles.dateInputs}>
          {/* Day — only shown for Daily */}
          {config.scale === 'daily' && (
            <select
              className={styles.select}
              value={startDay}
              onChange={handleDayChange}
              aria-label="Start day"
            >
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{String(d).padStart(2, '0')}</option>
              ))}
            </select>
          )}

          {/* Month — shown for Daily/Weekly/Monthly */}
          {config.scale !== 'yearly' && (
            <select
              className={styles.select}
              value={startMonth}
              onChange={handleMonthChange}
              aria-label="Start month"
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
          )}

          {/* Year — always shown */}
          <select
            className={styles.select}
            value={startYear}
            onChange={handleYearChange}
            aria-label="Start year"
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Duration Slider ──────────────────────────────────────────────────── */}
      <div className={styles.sliderRow}>
        <div className={styles.sliderHeader}>
          <label className={styles.controlLabel} htmlFor="duration-slider">
            Duration
          </label>
          <span className={styles.sliderValue} aria-live="polite">
            {durationLabel}
          </span>
        </div>
        <input
          id="duration-slider"
          type="range"
          className={styles.slider}
          min={cfg.durationMin}
          max={cfg.durationMax}
          step={1}
          value={config.duration}
          onChange={handleDurationChange}
          aria-label={`Duration: ${durationLabel}`}
          aria-valuetext={durationLabel}
        />
        <div className={styles.sliderExtents}>
          <span>{cfg.durationMin} {cfg.durationUnit}</span>
          <span>{cfg.durationMax} {cfg.durationUnit}</span>
        </div>
      </div>

      {/* ── Interval Slider ──────────────────────────────────────────────────── */}
      <div className={styles.sliderRow}>
        <div className={styles.sliderHeader}>
          <label className={styles.controlLabel} htmlFor="interval-slider">
            Interval
          </label>
          <span className={styles.sliderValue} aria-live="polite">
            {intervalLabel}
          </span>
        </div>
        <input
          id="interval-slider"
          type="range"
          className={styles.slider}
          min={cfg.intervalMin}
          max={cfg.intervalMax}
          step={cfg.intervalStep}
          value={config.interval}
          onChange={handleIntervalChange}
          aria-label={`Interval: ${intervalLabel}`}
          aria-valuetext={intervalLabel}
        />
        <div className={styles.sliderExtents}>
          <span>{cfg.intervalMin} {cfg.intervalUnit}</span>
          <span>{cfg.intervalMax} {cfg.intervalUnit}</span>
        </div>
      </div>

      {/* ── Range Summary ────────────────────────────────────────────────────── */}
      <p className={styles.summary} aria-label="Temporal range summary">
        {summarizeConfig(config)}
      </p>

      {/* ── Confirm / Apply Button ───────────────────────────────────────────── */}
      {onConfirm && (
        <div className={styles.confirmRow}>
          <button
            type="button"
            className={`${styles.confirmBtn} ${isDirty ? styles.confirmBtnDirty : ''}`}
            onClick={onConfirm}
            disabled={isLoading}
            aria-label="Apply temporal settings and fetch fresh data"
            title="Clears cache and fetches new data for this time range"
          >
            {isLoading ? 'Loading…' : isDirty ? '↻ Apply Changes' : '↻ Refresh Data'}
          </button>
          {isDirty && (
            <span className={styles.dirtyHint} aria-live="polite">
              Unsaved changes
            </span>
          )}
        </div>
      )}
    </section>
  )
}

