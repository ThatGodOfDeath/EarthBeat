import { useState, useRef, memo } from 'react'
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from 'react-simple-maps'
import styles from './WorldMap.module.css'

// world-atlas@2 countries-110m uses geo.properties.name (e.g. "Bangladesh")
const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

const MIN_ZOOM = 1
const MAX_ZOOM = 10
const ZOOM_STEP = 1.6

/**
 * WorldMap — SVG world map built on react-simple-maps.
 *
 * Props:
 *   selectedCountry  {string | null}  world-atlas geo.properties.name of selected country
 *   onSelect         {fn}             Called with { geoName: string }
 */
function WorldMap({ selectedCountry, onSelect }) {
  const [position, setPosition] = useState({ coordinates: [0, 0], zoom: 1 })
  const [tooltipContent, setTooltipContent] = useState('')
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })


  // ─── Zoom controls ────────────────────────────────────────────
  function handleZoomIn() {
    setPosition((p) => ({ ...p, zoom: Math.min(p.zoom * ZOOM_STEP, MAX_ZOOM) }))
  }
  function handleZoomOut() {
    setPosition((p) => ({ ...p, zoom: Math.max(p.zoom / ZOOM_STEP, MIN_ZOOM) }))
  }
  function handleFit() {
    setPosition({ coordinates: [0, 0], zoom: 1 })
  }

  // ─── Pan controls ─────────────────────────────────────────────
  function handlePan(dir) {
    setPosition((p) => {
      const step = 45 / p.zoom
      let [lng, lat] = p.coordinates
      if (dir === 'up')    lat = Math.min(lat + step, 80)
      if (dir === 'down')  lat = Math.max(lat - step, -80)
      if (dir === 'left')  lng = Math.max(lng - step, -175)
      if (dir === 'right') lng = Math.min(lng + step, 175)
      return { ...p, coordinates: [lng, lat] }
    })
  }

  // Track pointer start to distinguish click from pan drag
  const pointerStartRef = useRef(null)

  const zoomPercent = Math.round(position.zoom * 100)

  return (
    <div className={styles.mapWrapper}>
      {/* ── Zoom bar — top left ──────────────────────────────── */}
      <div className={styles.zoomBar}>
        <button
          className={styles.zoomBtn}
          onClick={handleZoomOut}
          aria-label="Zoom out"
          title="Zoom out"
        >
          −
        </button>
        <span className={styles.zoomPercent}>{zoomPercent}%</span>
        <button
          className={styles.zoomFit}
          onClick={handleFit}
          aria-label="Fit to view"
          title="Fit to view"
        >
          Fit
        </button>
        <button
          className={styles.zoomBtn}
          onClick={handleZoomIn}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
      </div>

      {/* ── Map ─────────────────────────────────────────────── */}
      <ComposableMap
        className={styles.map}
        projection="geoNaturalEarth1"
        projectionConfig={{ scale: 160 }}
      >
        <ZoomableGroup
          zoom={position.zoom}
          center={position.coordinates}
          onMoveEnd={(pos) => setPosition(pos)}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const geoName = geo.properties.name
                const isSelected =
                  !!selectedCountry && selectedCountry === geoName

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    className={[
                      styles.geo,
                      isSelected ? styles.geoSelected : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onMouseEnter={(e) => {
                      setTooltipContent(geoName)
                      setTooltipPos({ x: e.clientX, y: e.clientY })
                    }}
                    onMouseMove={(e) =>
                      setTooltipPos({ x: e.clientX, y: e.clientY })
                    }
                    onMouseLeave={() => setTooltipContent('')}
                    onPointerDown={(e) => {
                      pointerStartRef.current = { x: e.clientX, y: e.clientY }
                    }}
                    onClick={(e) => {
                      if (pointerStartRef.current) {
                        const dx = Math.abs(e.clientX - pointerStartRef.current.x)
                        const dy = Math.abs(e.clientY - pointerStartRef.current.y)
                        pointerStartRef.current = null
                        if (dx > 6 || dy > 6) return
                      }
                      if (geoName) onSelect?.({ geoName })
                    }}
                    tabIndex={0}
                    aria-label={geoName}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        if (geoName) onSelect?.({ geoName })
                      }
                    }}
                  />
                )
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>

      {/* ── Pan joystick — bottom right ──────────────────────── */}
      <div className={styles.joystick} aria-label="Pan controls">
        <div className={styles.joystickRow}>
          <button
            className={styles.joystickBtn}
            onClick={() => handlePan('up')}
            aria-label="Pan up"
          >
            ▲
          </button>
        </div>
        <div className={styles.joystickRow}>
          <button
            className={styles.joystickBtn}
            onClick={() => handlePan('left')}
            aria-label="Pan left"
          >
            ◀
          </button>
          <div className={styles.joystickCenter} />
          <button
            className={styles.joystickBtn}
            onClick={() => handlePan('right')}
            aria-label="Pan right"
          >
            ▶
          </button>
        </div>
        <div className={styles.joystickRow}>
          <button
            className={styles.joystickBtn}
            onClick={() => handlePan('down')}
            aria-label="Pan down"
          >
            ▼
          </button>
        </div>
      </div>

      {/* ── Tooltip ──────────────────────────────────────────── */}
      {tooltipContent && (
        <div
          className={styles.tooltip}
          style={{
            left: tooltipPos.x + 14,
            top: tooltipPos.y - 32,
          }}
        >
          {tooltipContent}
        </div>
      )}
    </div>
  )
}

export default memo(WorldMap)
