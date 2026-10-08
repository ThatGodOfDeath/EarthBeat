import { useState, useRef, useEffect, useCallback } from 'react'
import styles from './DataInfoTooltip.module.css'

/**
 * DataInfoTooltip
 *
 * Accessible ⓘ information button with a compact scientific metadata tooltip.
 *
 * Behaviour:
 *   Desktop:  hover shows tooltip; click toggles pinned state
 *   Mobile:   tap opens; tap-outside or Escape closes
 *
 * Keyboard:
 *   Tab to focus button → Enter / Space to open → Escape to close
 *
 * Props:
 *   label    {string}  aria-label for the icon button (default: "Temperature data information")
 *   rows     {Array<{ field: string, value: string }>}  metadata rows to display
 *   align    {string}  'right' | 'left' (default: 'right')  tooltip anchor
 */
export default function DataInfoTooltip({
  label = 'Temperature data information',
  rows = [],
  align = 'right',
}) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const buttonRef = useRef(null)
  const tooltipRef = useRef(null)

  const isVisible = open || hovered

  // ── Close on Escape ────────────────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && open) {
      setOpen(false)
      buttonRef.current?.focus()
    }
  }, [open])

  // ── Close on outside click ─────────────────────────────────────
  useEffect(() => {
    if (!open) return

    function handlePointerDown(e) {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target) &&
        tooltipRef.current && !tooltipRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, handleKeyDown])

  return (
    <span className={styles.wrapper}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.iconBtn}
        aria-label={label}
        aria-expanded={isVisible}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        ⓘ
      </button>

      {isVisible && (
        <div
          ref={tooltipRef}
          className={[styles.tooltip, align === 'left' ? styles.alignLeft : styles.alignRight].join(' ')}
          role="tooltip"
          aria-live="polite"
        >
          <table className={styles.table}>
            <tbody>
              {rows.map(({ field, value }) => (
                <tr key={field} className={styles.row}>
                  <td className={styles.field}>{field}</td>
                  <td className={styles.value}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </span>
  )
}
