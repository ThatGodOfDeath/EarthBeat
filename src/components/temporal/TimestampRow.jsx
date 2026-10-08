/**
 * TimestampRow.jsx — Phase 5D
 *
 * A single row in the timestamp panel.
 *
 * Props:
 *   timestamp       {string}    ISO 8601 UTC string
 *   checked         {boolean}   Whether this timestamp is checked (marked for deletion)
 *   active          {boolean}   Whether this is the currently active playback timestamp
 *   isUnavailable   {boolean}   Whether data for this timestamp is unavailable in the dataset
 *   onSelect        {function}  Called with (timestamp) when clicking the timestamp to view it
 *   onCheck         {function}  Called with (timestamp, checked) when checkbox toggled
 *   onDelete        {function}  Called with (timestamp) when X is clicked
 */

import { parseTemporalComponents } from '../../utils/dateUtils'
import styles from './TimestampRow.module.css'

export default function TimestampRow({
  timestamp,
  checked,
  active,
  isUnavailable = false,
  missingObservations = [],
  onSelect,
  onCheck,
  onDelete,
}) {
  const { humanDate, timeString } = parseTemporalComponents(timestamp)

  const missingTooltipText =
    isUnavailable && missingObservations.length > 0
      ? `Missing observations: ${missingObservations.join(', ')}`
      : isUnavailable
        ? 'Observation data unavailable in NASA dataset'
        : `Set active observation to ${humanDate} ${timeString}`

  return (
    <div
      className={`${styles.row} ${active ? styles.activeRow : ''} ${
        isUnavailable ? styles.unavailableRow : ''
      }`}
      aria-current={active ? 'true' : undefined}
    >
      {/* Checkbox for selection (marks for deletion) */}
      <input
        type="checkbox"
        className={styles.checkbox}
        checked={checked}
        onChange={(e) => onCheck(timestamp, e.target.checked)}
        aria-label={`Select ${humanDate} ${timeString}`}
      />

      {/* Timestamp display container with hover tooltip */}
      <div className={styles.timestampContainer}>
        <button
          type="button"
          className={`${styles.timestampBtn} ${isUnavailable ? styles.unavailableBtn : ''}`}
          onClick={() => !isUnavailable && onSelect?.(timestamp)}
          disabled={isUnavailable}
          title={missingTooltipText}
          aria-label={
            isUnavailable
              ? `${humanDate} ${timeString} - Missing: ${missingObservations.join(', ')}`
              : `Set active observation to ${humanDate} ${timeString}`
          }
        >
          <span className={styles.dateStr}>{humanDate}</span>
          <span className={styles.separator}>·</span>
          <span className={styles.timeStr}>{timeString}</span>

          {/* Unavailable notice mark */}
          {isUnavailable && (
            <span
              className={styles.unavailableBadge}
              aria-label="Observation unavailable"
            >
              !
            </span>
          )}
        </button>

        {/* Floating tooltip on hover */}
        {isUnavailable && missingObservations.length > 0 && (
          <div className={styles.tooltipPopup} role="tooltip" aria-hidden="true">
            <span className={styles.tooltipHeader}>Missing observations</span>
            <div className={styles.missingPills}>
              {missingObservations.map((obs) => (
                <span key={obs} className={styles.obsPill}>
                  {obs}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Active indicator */}
      {active && !isUnavailable && (
        <span className={styles.activeDot} aria-hidden="true" title="Current" />
      )}

      {/* Delete button */}
      <button
        type="button"
        className={styles.deleteBtn}
        onClick={() => onDelete(timestamp)}
        aria-label={`Remove ${humanDate} ${timeString}`}
        title="Remove this timestamp"
      >
        ×
      </button>
    </div>
  )
}

