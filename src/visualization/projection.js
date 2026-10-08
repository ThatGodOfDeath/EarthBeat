/**
 * projection.js
 *
 * Equirectangular (Plate Carrée) projection utilities for the global
 * GEOS-FP T2M temperature grid visualization.
 *
 * Coordinate convention:
 *   Longitude:  -180 (left)  → +180 (right)  → x = 0 → W
 *   Latitude:   +90  (top)   → -90  (bottom)  → y = 0 → H
 *
 * This matches the GEOS-FP grid row-major convention where row 0 is the
 * northern-most latitude band.
 */

/**
 * Map geographic coordinates to canvas pixel coordinates.
 *
 * @param {number} lat   Latitude in degrees  [-90, +90]
 * @param {number} lon   Longitude in degrees [-180, +180]
 * @param {number} W     Canvas pixel width
 * @param {number} H     Canvas pixel height
 * @returns {{ x: number, y: number }} Pixel position (may be fractional)
 */
export function geoToPixel(lat, lon, W, H) {
  // Normalise longitude to [-180, 180)
  const normLon = ((lon + 180) % 360 + 360) % 360 - 180
  const x = ((normLon + 180) / 360) * W
  const y = ((90 - lat) / 180) * H
  return { x, y }
}

/**
 * Map canvas pixel coordinates to geographic coordinates.
 *
 * @param {number} x     Pixel x
 * @param {number} y     Pixel y
 * @param {number} W     Canvas pixel width
 * @param {number} H     Canvas pixel height
 * @returns {{ lat: number, lon: number }}
 */
export function pixelToGeo(x, y, W, H) {
  const lon = (x / W) * 360 - 180
  const lat = 90 - (y / H) * 180
  return { lat, lon }
}

/**
 * Map geographic coordinates to a grid cell index within a TemperatureGrid.
 *
 * @param {number} lat      Latitude in degrees  [-90, +90]
 * @param {number} lon      Longitude in degrees [-180, +180]
 * @param {object} grid     TemperatureGrid (see globalTemperatureService)
 * @returns {number} Flat index into grid.values, or -1 if out of range.
 */
export function geoToGridIndex(lat, lon, grid) {
  if (!grid || !grid.values) return -1

  // GEOS-FP: latitude from +90 to -90, longitude from -180 to +180
  // Clamp to grid bounds
  const clampedLat = Math.max(-90, Math.min(90, lat))
  // Normalise longitude
  const normLon = ((lon + 180) % 360 + 360) % 360 - 180
  const clampedLon = Math.max(-180, Math.min(180, normLon))

  // Grid column (longitude axis)
  const col = Math.min(
    grid.width - 1,
    Math.max(0, Math.round(((clampedLon + 180) / 360) * (grid.width - 1))),
  )
  // Grid row (latitude axis, row 0 = north)
  const row = Math.min(
    grid.height - 1,
    Math.max(0, Math.round(((90 - clampedLat) / 180) * (grid.height - 1))),
  )

  return row * grid.width + col
}

/**
 * Extracts the temperature at geographic coordinates from a TemperatureGrid.
 * Returns NaN for missing (NaN) grid values.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {object} grid  TemperatureGrid
 * @returns {number} Temperature in °C, or NaN
 */
export function getTemperatureAtCoords(lat, lon, grid) {
  const idx = geoToGridIndex(lat, lon, grid)
  if (idx < 0 || idx >= grid.values.length) return NaN
  const val = grid.values[idx]
  return isFinite(val) ? val : NaN
}
