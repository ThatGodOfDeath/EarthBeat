/**
 * temperatureColorScale.js
 *
 * Scientific temperature-to-colour mapping for the global NASA GEOS-FP T2M
 * visualization.
 *
 * Colour stops inspired by NASA Scientific Visualization Studio GEOS-FP
 * Near-Surface Temperature (SVS 5147). Intentionally distinct from the Earth
 * Jukebox UI palette (green/blue branding).
 *
 * The scale spans the realistic global T2M range: approximately -40 °C to +50 °C.
 */

// ── Colour stops ────────────────────────────────────────────────────────────
// Each stop: [temperature °C, [R, G, B]]
const STOPS = [
  [-50, [16,   0,  64]],   // Deep indigo – extreme cold (polar vortex)
  [-35, [28,   8,  90]],   // Violet-indigo
  [-20, [20,  80, 180]],   // Deep royal blue – polar / winter
  [ -5, [100, 195, 215]],  // Pale ice-blue – cool temperate
  [  5, [195, 230, 225]],  // Near-white aqua – mild
  [ 15, [230, 240, 180]],  // Pale yellow-green – warm temperate
  [ 22, [248, 218,  80]],  // Gold-yellow – subtropical
  [ 30, [235, 120,  30]],  // Deep orange – tropical heat
  [ 38, [195,  30,  20]],  // Red-crimson
  [ 50, [ 90,   0,  10]],  // Dark maroon – extreme heat
]

/**
 * Maps a temperature value in °C to an RGBA array [R, G, B, A].
 * A = 255 for valid data; A = 0 for missing (NaN).
 *
 * @param {number} tempC - Temperature in degrees Celsius
 * @returns {[number, number, number, number]} RGBA values 0-255
 */
export function temperatureToRGBA(tempC) {
  if (typeof tempC !== 'number' || isNaN(tempC)) {
    return [0, 0, 0, 0] // Transparent for missing data
  }

  // Clamp to stop range
  if (tempC <= STOPS[0][0]) {
    const [r, g, b] = STOPS[0][1]
    return [r, g, b, 255]
  }
  if (tempC >= STOPS[STOPS.length - 1][0]) {
    const [r, g, b] = STOPS[STOPS.length - 1][1]
    return [r, g, b, 255]
  }

  // Find surrounding stops and lerp
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [t0, c0] = STOPS[i]
    const [t1, c1] = STOPS[i + 1]
    if (tempC >= t0 && tempC <= t1) {
      const t = (tempC - t0) / (t1 - t0)
      const r = Math.round(c0[0] + t * (c1[0] - c0[0]))
      const g = Math.round(c0[1] + t * (c1[1] - c0[1]))
      const b = Math.round(c0[2] + t * (c1[2] - c0[2]))
      return [r, g, b, 255]
    }
  }

  // Fallback (should not reach here)
  return [128, 128, 128, 255]
}

/**
 * Returns the colour stops array for rendering the legend.
 * Each entry: { tempC: number, hex: string }
 */
export function getLegendStops() {
  return STOPS.map(([tempC, [r, g, b]]) => ({
    tempC,
    hex: `rgb(${r},${g},${b})`,
  }))
}

/**
 * Visible legend tick marks for display.
 */
export const LEGEND_TICKS = [-30, -15, 0, 15, 30, 45]

/**
 * The temperature domain for the global visualization display range.
 */
export const TEMP_DOMAIN = { min: STOPS[0][0], max: STOPS[STOPS.length - 1][0] }
