import { useMemo } from 'react'
import styles from './WindChart.module.css'

/**
 * WindChart
 *
 * Lightweight, minimalist SVG time-series line chart for 10-meter wind speed.
 * Synchronized with the active observation timeline.
 *
 * Props:
 *   data          {Array<{ timestamp: string, speed: number, direction?: number, cardinal?: string }>}
 *   activeIndex   {number|null} Index of currently playing/selected observation
 *   onSelectPoint {Function} Called with (point, index) when user clicks a point
 */
export default function WindChart({
  data = [],
  activeIndex = null,
  onSelectPoint,
}) {
  const width = 560
  const height = 200
  const padding = { top: 24, right: 28, bottom: 36, left: 48 }

  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  const { points, yTicks, xTicks } = useMemo(() => {
    if (!data || data.length === 0) {
      return { points: [], yTicks: [], xTicks: [] }
    }

    const speeds = data.map((d) => (d.speed != null ? d.speed : d.value ?? 0))
    const rawMax = Math.max(0, ...speeds)

    // Wind speed scale: always anchor at 0 m/s with 15% head room
    const minVal = 0
    const maxVal = Math.max(2, Math.ceil(rawMax + (rawMax > 0 ? rawMax * 0.15 : 1)))

    const points = data.map((d, i) => {
      const speed = d.speed != null ? d.speed : d.value ?? 0
      const x =
        data.length > 1
          ? padding.left + (i / (data.length - 1)) * chartWidth
          : padding.left + chartWidth / 2
      const normY = (speed - minVal) / (maxVal - minVal || 1)
      const y = padding.top + (1 - normY) * chartHeight
      return {
        x,
        y,
        timestamp: d.timestamp,
        speed,
        direction: d.direction,
        cardinal: d.cardinal,
        index: i,
      }
    })

    // Y-axis ticks (4 ticks: 0%, 33%, 66%, 100%)
    const yTicks = [0, 0.33, 0.66, 1].map((ratio) => {
      const val = minVal + ratio * (maxVal - minVal)
      const y = padding.top + (1 - ratio) * chartHeight
      return { val: val.toFixed(1), y }
    })

    // X-axis ticks (show every 4th point or key timestamps)
    const step = Math.max(1, Math.floor(data.length / 5))
    const xTicks = points.filter((_, i) => i % step === 0 || i === points.length - 1)

    return { points, yTicks, xTicks }
  }, [data, chartWidth, chartHeight, padding.left, padding.top])

  // Construct smooth cubic spline path through wind points
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
        <p className={styles.emptyText}>No wind data available to chart.</p>
      </div>
    )
  }

  function formatXLabel(isoString) {
    if (!isoString) return ''
    const date = new Date(isoString)
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
        aria-label="Wind speed over time line chart"
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
              {tick.val} m/s
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

        {/* Wind speed line */}
        <path d={linePath} className={styles.dataLine} />

        {/* Data points */}
        {points.map((pt) => {
          const isActive = activeIndex === pt.index

          return (
            <g
              key={`pt-${pt.index}`}
              className={styles.pointGroup}
              onClick={() => onSelectPoint?.(data[pt.index], pt.index)}
              role="button"
              tabIndex={0}
              aria-label={`${pt.speed} m/s at ${pt.timestamp}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onSelectPoint?.(data[pt.index], pt.index)
                }
              }}
            >
              <circle cx={pt.x} cy={pt.y} r={10} className={styles.hitTarget} />

              {isActive && (
                <circle cx={pt.x} cy={pt.y} r={7} className={styles.activeRing} />
              )}

              <circle
                cx={pt.x}
                cy={pt.y}
                r={isActive ? 4.5 : 3}
                className={[styles.dataPoint, isActive ? styles.dataPointActive : ''].join(
                  ' ',
                )}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
