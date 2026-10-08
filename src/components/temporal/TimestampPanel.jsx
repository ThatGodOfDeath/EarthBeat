/**
 * TimestampPanel.jsx — Phase 5D
 *
 * Collapsible right-side panel showing the generated timestamp list.
 * Each timestamp can be checked (for bulk deletion) or individually deleted.
 * The panel is independently scrollable and responsive.
 *
 * Props:
 *   generatedTimestamps  {string[]}  Full generated set (authoritative config output)
 *   activeTimestamps     {string[]}  User-modified active set (excludes deleted/disabled)
 *   currentTimestamp     {string}    Currently playing/active timestamp
 *   isOpen               {boolean}   Whether the panel is expanded
 *   onToggle             {function}  Called to open/close panel
 *   onDeleteOne          {function}  Called with (timestamp) to permanently delete it
 *   onDeleteSelected     {function}  Called with (timestamp[]) to delete multiple
 *   onRestore            {function}  Called to restore all timestamps from config
 */

import { useState, useCallback, useMemo } from 'react'
import TemporalControls from './TemporalControls'
import TimestampRow from './TimestampRow'
import styles from './TimestampPanel.module.css'

export default function TimestampPanel({
  temporalConfig,
  onTemporalConfigChange,
  onTemporalConfirm,
  isDirty = false,
  isTemporalLoading = false,
  generatedTimestamps = [],
  activeTimestamps = [],
  availableDatasetTimestamps = null,
  missingObservationsMap = null,
  currentTimestamp = '',
  isOpen,
  onToggle,
  onSelectTimestamp,
  onDeleteOne,
  onDeleteSelected,
  onRestore,
}) {
  // ── Checkbox selection state (for bulk deletion) ────────────────────────
  const [checkedSet, setCheckedSet] = useState(new Set())

  // Fast set of available dataset timestamps
  const availableSet = useMemo(() => {
    if (!availableDatasetTimestamps) return null
    return new Set(availableDatasetTimestamps)
  }, [availableDatasetTimestamps])

  // Handle individual checkbox toggle
  const handleCheck = useCallback((ts, isChecked) => {
    setCheckedSet((prev) => {
      const next = new Set(prev)
      if (isChecked) {
        next.add(ts)
      } else {
        next.delete(ts)
      }
      return next
    })
  }, [])

  // Select all currently active timestamps
  function handleSelectAll() {
    setCheckedSet(new Set(activeTimestamps))
  }

  // Clear all checkbox selections
  function handleClearSelection() {
    setCheckedSet(new Set())
  }

  // Delete individually — also clear from checkedSet
  const handleDeleteOne = useCallback((ts) => {
    setCheckedSet((prev) => {
      const next = new Set(prev)
      next.delete(ts)
      return next
    })
    onDeleteOne(ts)
  }, [onDeleteOne])

  // Delete all checked items
  function handleDeleteSelected() {
    if (checkedSet.size === 0) return
    const toDelete = Array.from(checkedSet)
    setCheckedSet(new Set())
    onDeleteSelected(toDelete)
  }

  // Restore: clear selection and restore all
  function handleRestore() {
    setCheckedSet(new Set())
    onRestore()
  }

  const hasActive = activeTimestamps.length > 0
  const hasChecked = checkedSet.size > 0
  const isEmpty = activeTimestamps.length === 0

  return (
    <>
      {/* ── Toggle Button (always visible on right edge) ─────────────────── */}
      <button
        type="button"
        className={`${styles.toggleBtn} ${isOpen ? styles.toggleBtnOpen : ''}`}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Close temporal panel' : 'Open temporal exploration panel'}
        title={isOpen ? 'Collapse panel' : 'Expand temporal exploration & timestamps'}
      >
        <span className={styles.toggleIcon} aria-hidden="true">
          {isOpen ? '›' : '‹'}
        </span>
        <span className={styles.toggleLabel}>
          {isOpen ? 'Close' : 'Temporal'}
        </span>
      </button>

      {/* ── Panel Content ───────────────────────────────────────────────── */}
      {isOpen && (
        <aside
          className={styles.panel}
          aria-label="Temporal exploration and timestamp management panel"
        >
          {/* Panel Header with explicit Close button */}
          <div className={styles.panelHeader}>
            <div className={styles.panelTitleGroup}>
              <h4 className={styles.panelTitle}>Temporal Exploration</h4>
              <span className={styles.countBadge}>
                {activeTimestamps.length} active
                {generatedTimestamps.length !== activeTimestamps.length && (
                  <span className={styles.deletedHint}>
                    {' '}/ {generatedTimestamps.length} generated
                  </span>
                )}
              </span>
            </div>

            <button
              type="button"
              className={styles.closeBtn}
              onClick={onToggle}
              aria-label="Collapse temporal exploration panel"
              title="Close panel"
            >
              ✕
            </button>
          </div>

          <div className={styles.scrollableBody}>
            {/* ── Embedded Temporal Controls ── */}
            {temporalConfig && onTemporalConfigChange && (
              <div className={styles.controlsSection}>
                <TemporalControls
                  config={temporalConfig}
                  onChange={onTemporalConfigChange}
                  onConfirm={onTemporalConfirm}
                  isDirty={isDirty}
                  isLoading={isTemporalLoading}
                  hideTitle={true}
                />
              </div>
            )}

            <div className={styles.divider} />

            {/* ── Timestamps Section Header & Bulk Actions ── */}
            <div className={styles.timestampsHeader}>
              <h5 className={styles.sectionSubtitle}>Timestamps</h5>
              {hasActive && (
                <div className={styles.bulkActions}>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={handleSelectAll}
                    disabled={checkedSet.size === activeTimestamps.length}
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={handleClearSelection}
                    disabled={!hasChecked}
                  >
                    Clear
                  </button>
                  {hasChecked && (
                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.actionBtnDelete}`}
                      onClick={handleDeleteSelected}
                    >
                      Delete ({checkedSet.size})
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── Timestamp List ── */}
            <div className={styles.listContainer} role="list">
              {isEmpty ? (
                /* Empty State */
                <div className={styles.emptyState}>
                  <p className={styles.emptyText}>No timestamps selected.</p>
                  <button
                    type="button"
                    className={styles.restoreBtn}
                    onClick={handleRestore}
                  >
                    ↺ Restore Timestamps
                  </button>
                </div>
              ) : (
                activeTimestamps.map((ts) => {
                  const isUnavailable =
                    availableSet !== null && !availableSet.has(ts)
                  const missingObs = missingObservationsMap?.get(ts) || []
                  return (
                    <div key={ts} role="listitem">
                      <TimestampRow
                        timestamp={ts}
                        checked={checkedSet.has(ts)}
                        active={ts === currentTimestamp}
                        isUnavailable={isUnavailable}
                        missingObservations={missingObs}
                        onSelect={onSelectTimestamp}
                        onCheck={handleCheck}
                        onDelete={handleDeleteOne}
                      />
                    </div>
                  )
                })
              )}
            </div>

            {/* Restore footer — only if some were deleted */}
            {!isEmpty && generatedTimestamps.length > activeTimestamps.length && (
              <div className={styles.panelFooter}>
                <button
                  type="button"
                  className={styles.restoreBtn}
                  onClick={handleRestore}
                  title="Restore all deleted timestamps"
                >
                  ↺ Restore all ({generatedTimestamps.length - activeTimestamps.length} deleted)
                </button>
              </div>
            )}
          </div>
        </aside>
      )}
    </>
  )
}

