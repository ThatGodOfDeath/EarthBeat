import { useMemo, memo } from 'react'
import styles from './ScientificTimeSeriesGraph.module.css'

/**
 * ScientificTimeSeriesGraph
 *
 * Generic, lightweight SVG line chart for scientific time series.
 * Supports arbitrary variables with dynamic Y-axis scaling, formatted ticks,
 * interactive observation points, and cubic spline curves through real data.
 *
 * Props:
 *   data          {Array<{ timestamp: string, value: number }>} Time series observations
 *   unit          {string}                                     Display unit (e.g. "°C", "hPa", "m/s")
 *   label         {string}                                     Variable label
 *   activeIndex   {number|null}                                Index of currently active timestamp
 *   onSelectPoint {Function}                                   Callback (point, index) => void
 */
function ScientificTimeSeriesGraph({
  data = [],
  unit = '°C',
  label = 'Value',
  activeIndex = null,
  onSelectPoint,
}) {
  // Chart dimensions in SVG user coordinates
  const width = 560
  const height = 200
  const padding = { top: 24, right: 28, bottom: 36, left: 52 }

  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  // Calculate scales and coordinate mappings
  const { points, yTicks, xTicks } = useMemo(() => {
    if (!data || data.length === 0) {
      return { points: [], yTicks: [], xTicks: [] }
    }

    const validData = data.filter((d) => typeof d.value === 'number' && !isNaN(d.value))
    if (validData.length === 0) {
      return { points: [], yTicks: [], xTicks: [] }
    }

    const values = validData.map((d) => d.value)
    const rawMin = Math.min(...values)
    const rawMax = Math.max(...values)

    // Add breathing room
    const range = rawMax - rawMin || 1
    const minVal = rawMin - range * 0.1
    const maxVal = rawMax + range * 0.1

    // Map each data point to svg coordinates
    const points = data.map((d, i) => {
      const x =
        data.length > 1
          ? padding.left + (i / (data.length - 1)) * chartWidth
          : padding.left + chartWidth / 2

      const val = typeof d.value === 'number' && !isNaN(d.value) ? d.value : rawMin
      const normY = (val - minVal) / (maxVal - minVal || 1)
      const y = padding.top + (1 - normY) * chartHeight
      return { x, y, timestamp: d.timestamp, value: d.value, index: i }
    })

    // Y-axis ticks (4 ticks)
    const yTicks = [0, 0.33, 0.66, 1].map((ratio) => {
      const val = minVal + ratio * (maxVal - minVal)
      const y = padding.top + (1 - ratio) * chartHeight
      const formattedVal = val >= 100 || val <= -100 ? val.toFixed(0) : val.toFixed(1)
      return { val: formattedVal, y }
    })

    // X-axis ticks (sample 5-6 points across series)
    const step = Math.max(1, Math.floor(data.length / 5))
    const xTicks = points.filter((_, i) => i % step === 0 || i === points.length - 1)

    return { points, yTicks, xTicks }
  }, [data, chartWidth, chartHeight, padding.left, padding.top])

  // Construct smooth cubic spline path through real observations
  const linePath = useMemo(() => {
    if (!points || points.length === 0) return ''
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
    if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`

    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = i > 0 ? points[i - 1] : points[i]
      const p1 = points[i]
      const p2 = points[i + 1]
      const p3 = i < points.length - 2 ? points[i + 2] : p2

      const cp1x = p1.x + (p2.x - p0.x) / 6
      const cp1y = p1.y + (p2.y - p0.y) / 6
      const cp2x = p2.x - (p3.x - p1.x) / 6
      const cp2y = p2.y - (p3.y - p1.y) / 6

      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
    }
    return d
  }, [points])

  if (!data || data.length === 0) {
    return (
      <div className={styles.emptyContainer}>
        <p className={styles.emptyText}>No {label.toLowerCase()} data available to chart.</p>
      </div>
    )
  }

  function formatXLabel(isoString) {
    if (!isoString) return ''
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return ''
    const day = date.getUTCDate()
    const hours = String(date.getUTCHours()).padStart(2, '0')
    const mins = String(date.getUTCMinutes()).padStart(2, '0')
    return `${day}d ${hours}:${mins}`
  }

  return (
    <div className={styles.chartWrapper}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${label} over time line chart`}
      >
        {/* Horizontal grid lines & Y labels */}
        {yTicks.map((tick, i) => (
          <g key={`ytick-${i}`} className={styles.gridGroup}>
            <line
              x1={padding.left}
              y1={tick.y}
              x2={width - padding.right}
              y2={tick.y}
              className={styles.gridLine}
            />
            <text
              x={padding.left - 8}
              y={tick.y + 3.5}
              textAnchor="end"
              className={styles.axisLabel}
            >
              {tick.val}{unit}
            </text>
          </g>
        ))}

        {/* Vertical tick markers & X labels */}
        {xTicks.map((pt, i) => (
          <g key={`xtick-${i}`} className={styles.gridGroup}>
            <line
              x1={pt.x}
              y1={height - padding.bottom}
              x2={pt.x}
              y2={height - padding.bottom + 4}
              className={styles.tickLine}
            />
            <text
              x={pt.x}
              y={height - padding.bottom + 16}
              textAnchor="middle"
              className={styles.axisLabel}
            >
              {formatXLabel(pt.timestamp)}
            </text>
          </g>
        ))}

        {/* Data curve */}
        <path d={linePath} className={styles.dataLine} />

        {/* Interactive observation points */}
        {points.map((pt) => {
          const isActive = activeIndex === pt.index
          const valDisplay = typeof pt.value === 'number' && !isNaN(pt.value)
            ? `${pt.value.toFixed(1)}${unit}`
            : '—'

          return (
            <g
              key={`pt-${pt.index}`}
              className={styles.pointGroup}
              onClick={() => onSelectPoint?.(data[pt.index], pt.index)}
              role="button"
              tabIndex={0}
              aria-label={`${valDisplay} at ${pt.timestamp}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onSelectPoint?.(data[pt.index], pt.index)
                }
              }}
            >
              {/* Invisible touch/mouse hit circle */}
              <circle cx={pt.x} cy={pt.y} r={10} className={styles.hitTarget} />

              {/* Active selection outer ring */}
              {isActive && (
                <circle cx={pt.x} cy={pt.y} r={7} className={styles.activeRing} />
              )}

              {/* Visible observation point */}
              <circle
                cx={pt.x}
                cy={pt.y}
                r={isActive ? 4.5 : 3}
                className={[styles.dataPoint, isActive ? styles.dataPointActive : ''].join(' ')}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default memo(ScientificTimeSeriesGraph)
