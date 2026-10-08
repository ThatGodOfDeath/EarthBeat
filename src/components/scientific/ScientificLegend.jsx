import { useRef, useEffect, memo } from 'react'
import { valueToRGBA } from '../../visualization/scientificColorScales'
import { getVariableConfig } from '../../data/scientificVariables'
import styles from './ScientificLegend.module.css'

/**
 * ScientificLegend
 *
 * Generic color legend for scientific variables.
 * Draws a smooth continuous color gradient dynamically from the variable's
 * defined color scale across its numerical domain [min, max].
 *
 * Props:
 *   variable  {string}  Variable ID ('T2M', 'TS', 'PS', 'WIND')
 */
function ScientificLegend({ variable = 'T2M' }) {
  const canvasRef = useRef(null)
  const config = getVariableConfig(variable)
  const { domain, legendTicks, colorScaleKey, label, unit } = config

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width
    const H = canvas.height
    const imgData = ctx.createImageData(W, H)

    for (let col = 0; col < W; col++) {
      const val = domain.min + (col / (W - 1)) * (domain.max - domain.min)
      const [r, g, b] = valueToRGBA(val, colorScaleKey, 255)
      for (let row = 0; row < H; row++) {
        const idx = (row * W + col) * 4
        imgData.data[idx]     = r
        imgData.data[idx + 1] = g
        imgData.data[idx + 2] = b
        imgData.data[idx + 3] = 255
      }
    }

    ctx.putImageData(imgData, 0, 0)
  }, [domain.min, domain.max, colorScaleKey])

  function formatTick(val) {
    if (unit === '°C') {
      return val > 0 ? `+${val}°C` : `${val}°C`
    }
    if (unit === 'hPa') {
      return `${val} hPa`
    }
    if (unit === 'm/s') {
      return `${val} m/s`
    }
    if (unit === 'mm/h') {
      return `${val} mm/h`
    }
    if (unit === 'kg/m²') {
      return `${val} kg/m²`
    }
    return `${val}`
  }

  return (
    <div className={styles.legendWrapper}>
      <span className={styles.legendTitle}>
        {label} ({unit})
      </span>
      <div className={styles.legend} aria-label={`${label} colour scale`}>
        <canvas
          ref={canvasRef}
          className={styles.legendCanvas}
          width={240}
          height={6}
          aria-hidden="true"
        />
        <div className={styles.legendTicks}>
          {legendTicks.map((t) => (
            <span key={t} className={styles.legendTick}>
              {formatTick(t)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default memo(ScientificLegend)
