import styles from './SelectedLocation.module.css'

/**
 * SelectedLocation — Displays the current selection with coordinates.
 *
 * Props:
 *   name   {string}  e.g. "Dhaka, Bangladesh"
 *   lat    {number|null}
 *   lng    {number|null}
 */
export default function SelectedLocation({ name, lat, lng }) {
  const hasCoords = lat != null && lng != null

  function formatCoord(val, posLabel, negLabel) {
    if (val == null) return ''
    const abs = Math.abs(val).toFixed(4)
    const dir = val >= 0 ? posLabel : negLabel
    return `${abs}° ${dir}`
  }

  return (
    <div className={styles.wrapper}>
      <span className={styles.sectionLabel}>Selected Location</span>
      {name ? (
        <>
          <p className={styles.locationName}>{name}</p>
          {hasCoords && (
            <p className={styles.coords}>
              {formatCoord(lat, 'N', 'S')}
              <span className={styles.separator}> · </span>
              {formatCoord(lng, 'E', 'W')}
            </p>
          )}
        </>
      ) : (
        <p className={styles.placeholder}>No location selected</p>
      )}
    </div>
  )
}
