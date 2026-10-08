import { useRef, useEffect, useCallback, memo } from 'react'
import { feature } from 'topojson-client'
import { geoPath, geoEquirectangular } from 'd3-geo'
import { valueToRGBA } from '../../visualization/scientificColorScales'
import { getVariableConfig } from '../../data/scientificVariables'
import { geoToPixel } from '../../visualization/projection'
import ScientificLegend from './ScientificLegend'
import styles from './GlobalScientificMap.module.css'

// ── GEO_URL for country boundary overlay ───────────────────────────────────
const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

// ── Canvas logical resolution (matches GRID_WIDTH × GRID_HEIGHT) ───────────
const CANVAS_W = 360
const CANVAS_H = 180

// ── Module-level boundary data cache ──────────────────────────────────────
let _boundaryGeoJson = null
let _boundaryPromise = null

function getBoundaryData() {
  if (_boundaryGeoJson) return Promise.resolve(_boundaryGeoJson)
  if (_boundaryPromise) return _boundaryPromise

  _boundaryPromise = fetch(GEO_URL)
    .then((r) => r.json())
    .then((topo) => {
      _boundaryGeoJson = feature(topo, topo.objects.countries)
      return _boundaryGeoJson
    })
    .catch((err) => {
      console.warn('[GlobalScientificMap] Boundary load failed:', err)
      _boundaryPromise = null
      return null
    })

  return _boundaryPromise
}

function makeProjection(w, h) {
  return geoEquirectangular()
    .translate([w / 2, h / 2])
    .scale(w / (2 * Math.PI))
}

/**
 * GlobalScientificMap
 *
 * Universal Canvas-based global GEOS-FP raster map.
 * Supports:
 *   - Scalar variables: T2M, TS, PS
 *   - Vector variable: WIND (speed scalar raster + directional vector overlay)
 *   - Country boundaries overlay (cached TopoJSON)
 *   - Selected-location marker & label
 *   - Scientific color legend matching the selected variable
 *
 * Props:
 *   variable     {string}                Variable identifier ('T2M', 'TS', 'PS', 'WIND')
 *   grid         {ScientificGrid|null}   Active scientific grid
 *   selectedLat  {number}                Location latitude
 *   selectedLon  {number}                Location longitude
 *   locationName {string}                Display name (e.g. "Dhaka")
 *   isLoading    {boolean}               Whether data is loading
 *   error        {object|null}           Error object or message
 */
function GlobalScientificMap({
  variable = 'T2M',
  grid,
  selectedLat,
  selectedLon,
  locationName,
  isLoading = false,
  error = null,
}) {
  const rasterCanvasRef = useRef(null)
  const overlayCanvasRef = useRef(null)
  const boundaryRef = useRef(null)

  const config = getVariableConfig(variable)
  const { colorScaleKey, label } = config

  // ── Paint scalar raster whenever grid or variable changes ─────────────
  useEffect(() => {
    const canvas = rasterCanvasRef.current
    if (!canvas || !grid?.values) return

    const ctx = canvas.getContext('2d')
    const imgData = ctx.createImageData(CANVAS_W, CANVAS_H)
    const buf = imgData.data

    const isWind = (variable || '').toUpperCase() === 'WIND'
    const scaleKey = isWind ? 'wind' : colorScaleKey

    for (let i = 0; i < CANVAS_W * CANVAS_H; i++) {
      const val = grid.values[i]
      const [r, g, b, a] = valueToRGBA(val, scaleKey, 230)
      const p = i * 4
      buf[p]     = r
      buf[p + 1] = g
      buf[p + 2] = b
      buf[p + 3] = a === 0 ? 0 : 230
    }

    ctx.putImageData(imgData, 0, 0)
  }, [grid, variable, colorScaleKey])

  // ── Draw country boundaries + wind vectors + location marker on overlay ──
  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current
    if (!canvas) return

    const W = canvas.width
    const H = canvas.height
    const scaleX = W / CANVAS_W
    const scaleY = H / CANVAS_H
    const minScale = Math.min(scaleX, scaleY)

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, H)

    // 1. Country borders
    if (boundaryRef.current) {
      const projection = makeProjection(CANVAS_W, CANVAS_H)
      const pg = geoPath(projection, ctx)

      ctx.save()
      ctx.scale(scaleX, scaleY)
      ctx.beginPath()
      pg(boundaryRef.current)
      ctx.strokeStyle = 'rgba(7, 7, 6, 0.45)'
      ctx.lineWidth = 0.4 / minScale
      ctx.stroke()
      ctx.restore()
    }

    // 2. Wind Direction Vectors (when variable is WIND and vector fields present)
    const isWind = (variable || '').toUpperCase() === 'WIND'
    if (isWind && grid?.uValues && grid?.vValues) {
      const stepX = 15 // 24 columns across 360
      const stepY = 15 // 12 rows down 180

      for (let gy = 7; gy < CANVAS_H; gy += stepY) {
        for (let gx = 7; gx < CANVAS_W; gx += stepX) {
          const idx = Math.min(CANVAS_W * CANVAS_H - 1, Math.round(gy) * CANVAS_W + Math.round(gx))
          const u = grid.uValues[idx]
          const v = grid.vValues[idx]

          if (typeof u === 'number' && typeof v === 'number' && !isNaN(u) && !isNaN(v)) {
            const speed = Math.hypot(u, v)
            if (speed >= 0.6) {
              // Vector heading direction: screen X is East (+u), screen Y is South (-v)
              const screenAngle = Math.atan2(-v, u)
              const arrowLen = Math.max(4, Math.min(11, 3.5 + speed * 0.35)) * minScale
              const px = gx * scaleX
              const py = gy * scaleY

              ctx.save()
              ctx.translate(px, py)
              ctx.rotate(screenAngle)

              // Shaft and arrowhead
              ctx.beginPath()
              ctx.moveTo(-arrowLen * 0.45, 0)
              ctx.lineTo(arrowLen * 0.5, 0)
              ctx.lineTo(arrowLen * 0.5 - 3 * minScale, -2.5 * minScale)
              ctx.moveTo(arrowLen * 0.5, 0)
              ctx.lineTo(arrowLen * 0.5 - 3 * minScale, 2.5 * minScale)

              // Dark shadow outline for contrast over bright patches
              ctx.strokeStyle = 'rgba(7, 7, 6, 0.75)'
              ctx.lineWidth = 2.0 * minScale
              ctx.lineCap = 'round'
              ctx.lineJoin = 'round'
              ctx.stroke()

              // Bright foreground stroke
              ctx.strokeStyle = 'rgba(240, 248, 255, 0.95)'
              ctx.lineWidth = 1.0 * minScale
              ctx.stroke()

              ctx.restore()
            }
          }
        }
      }
    }

    // 3. Location marker
    if (typeof selectedLat === 'number' && typeof selectedLon === 'number') {
      const { x, y } = geoToPixel(selectedLat, selectedLon, CANVAS_W, CANVAS_H)
      const px = x * scaleX
      const py = y * scaleY

      // Outer ring
      ctx.beginPath()
      ctx.arc(px, py, 5.5, 0, Math.PI * 2)
      ctx.strokeStyle = '#f9f8f3'
      ctx.lineWidth = 2.5
      ctx.stroke()

      // Inner filled dot
      ctx.beginPath()
      ctx.arc(px, py, 3.5, 0, Math.PI * 2)
      ctx.fillStyle = '#070706'
      ctx.fill()

      // Location name label
      if (locationName) {
        const fontSize = Math.max(7.5, 8.5 * minScale)
        ctx.font = `bold ${fontSize}px sans-serif`
        const labelText = locationName
        const labelX = px + 8
        const labelY = py - 5

        ctx.strokeStyle = '#070706'
        ctx.lineWidth = 2.5
        ctx.lineJoin = 'round'
        ctx.strokeText(labelText, labelX, labelY)

        ctx.fillStyle = '#f9f8f3'
        ctx.fillText(labelText, labelX, labelY)
      }
    }
  }, [variable, grid, selectedLat, selectedLon, locationName])

  // Load boundaries once, then draw overlay
  useEffect(() => {
    getBoundaryData().then((geoJson) => {
      if (geoJson) boundaryRef.current = geoJson
      drawOverlay()
    })
  }, [drawOverlay])

  // ResizeObserver keeps overlay canvas crisp and aligned
  useEffect(() => {
    const canvas = overlayCanvasRef.current
    if (!canvas) return

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) {
        canvas.width  = Math.round(width)
        canvas.height = Math.round(height)
        drawOverlay()
      }
    })
    ro.observe(canvas.parentElement || canvas)
    return () => ro.disconnect()
  }, [drawOverlay])

  return (
    <div className={styles.wrapper}>
      {/* ── Canvas stack ─────────────────────────────────────────── */}
      <div className={styles.mapContainer}>
        {/* Layer 1: Scalar raster */}
        <canvas
          ref={rasterCanvasRef}
          className={styles.rasterCanvas}
          width={CANVAS_W}
          height={CANVAS_H}
          aria-hidden="true"
        />
        {/* Layer 2: Country borders + wind vectors + location marker */}
        <canvas
          ref={overlayCanvasRef}
          className={styles.overlayCanvas}
          width={CANVAS_W}
          height={CANVAS_H}
          aria-label={
            locationName && typeof selectedLat === 'number'
              ? `Global ${label} map with ${locationName} marker`
              : `Global ${label} map`
          }
        />

        {/* Loading / Error placeholder */}
        {error ? (
          <div className={styles.placeholder} aria-live="polite">
            Global {label} data unavailable.
          </div>
        ) : !grid || isLoading ? (
          <div className={styles.placeholder} aria-live="polite">
            {isLoading ? `Loading global ${label} field…` : `Building ${label} field…`}
          </div>
        ) : null}
      </div>

      {/* ── Dynamic Scientific Legend ─────────────────────────────── */}
      <div className={styles.legendWrapper}>
        <ScientificLegend variable={variable} />
      </div>

      {/* ── Attribution ──────────────────────────────────────────── */}
      <div className={styles.attribution}>
        Data: NASA Global Modeling and Assimilation Office (GMAO) / GEOS-FP
      </div>
    </div>
  )
}

export default memo(GlobalScientificMap)
