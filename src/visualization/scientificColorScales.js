/**
 * scientificColorScales.js — Scientific Variable Color Scales
 *
 * Centralized color scales for all Earth Jukebox scientific variables:
 *   - T2M:  2 m air temperature (NASA SVS GEOS-FP scale, frozen from Phase 4)
 *   - TS:   Surface skin temperature (radiometric surface scale, -50 to +60 °C)
 *   - PS:   Surface pressure (meteorological barometric scale, 920 to 1040 hPa)
 *   - WIND: 10 m wind speed (meteorological wind velocity scale, 0 to 35 m/s)
 *
 * All scales support piecewise linear RGB interpolation.
 */

// ── T2M Stops (Frozen — preserved exactly from temperatureColorScale.js) ──────
export const T2M_STOPS = [
  [-50, [16,   0,  64]],   // Deep indigo – extreme cold
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

// ── TS Stops (Surface skin temperature — spans -50 °C to +60 °C) ──────────────
export const TS_STOPS = [
  [-50, [10,   0,  48]],   // Deep midnight indigo
  [-30, [30,  20, 100]],   // Dark violet
  [-15, [25,  90, 185]],   // Deep royal blue
  [  0, [85, 190, 210]],   // Crisp cyan
  [ 15, [190, 235, 195]],  // Pale mint / temperate
  [ 25, [245, 225,  80]],  // Golden yellow – warm surface
  [ 35, [240, 130,  25]],  // Amber-orange – heated ground
  [ 45, [210,  45,  20]],  // Vivid crimson – intense solar heating
  [ 60, [110,   0,  35]],  // Scorched garnet – desert extreme
]

// ── PS Stops (Surface pressure — 920 to 1040 hPa) ─────────────────────────────
export const PS_STOPS = [
  [ 920, [40,   0,  85]],   // Deep violet – deep mountain/cyclone low
  [ 950, [20,  50, 160]],   // Cobalt blue – strong cyclonic depression
  [ 980, [40, 140, 195]],   // Azure blue – low pressure
  [1000, [90, 195, 175]],   // Sea teal – below-average pressure
  [1013, [230, 235, 200]],  // Pale neutral cream – standard atmosphere (~1013.25 hPa)
  [1025, [245, 165,  45]],  // Warm amber – high pressure ridge
  [1040, [190,  25,  25]],  // Deep crimson – strong polar/continental anticyclone
]

// ── WIND Stops (Wind speed — 0 to 35 m/s) ─────────────────────────────────────
export const WIND_STOPS = [
  [ 0,  [ 8,  16,  50]],    // Midnight navy – calm (< 1 m/s)
  [ 3,  [15,  75, 130]],    // Deep blue – light breeze
  [ 7,  [30, 150, 160]],    // Teal cyan – gentle/moderate
  [12,  [70, 190,  95]],    // Fresh green – fresh breeze
  [18,  [235, 205, 50]],    // Vibrant yellow – strong breeze / near gale
  [25,  [240, 115, 30]],    // Coral orange – gale / storm
  [35,  [180,  20,  80]],   // Vivid magenta-crimson – violent storm / hurricane
]

// ── TPRECMAX Stops (Total precipitation rate — 0 to 50 mm/h) ─────────────────
export const TPRECMAX_STOPS = [
  [ 0.0, [ 16,  24,  38]],   // Dark slate – dry / no precipitation
  [ 0.5, [ 50, 110, 130]],   // Faint teal – trace precipitation
  [ 2.0, [ 56, 189, 248]],   // Sky blue – light rain (1–5 mm/h)
  [ 8.0, [ 37,  99, 235]],   // Vibrant royal blue – moderate rain (5–15 mm/h)
  [20.0, [139,  92, 246]],   // Violet purple – heavy rain (15–30 mm/h)
  [35.0, [217,  70, 239]],   // Orchid magenta – very heavy rain
  [50.0, [244,  63, 140]],   // Vivid pink-magenta – torrential / cloudburst (≥ 50 mm/h)
]

// ── TQV Stops (Total precipitable water vapor — 0 to 70 kg/m²) ───────────────
export const TQV_STOPS = [
  [ 0,   [ 90,  80,  65]],   // Arid sand / polar dry
  [10,   [140, 145, 115]],   // Pale straw – dry continental air
  [20,   [ 90, 165, 160]],   // Soft pale teal – temperate column
  [35,   [ 45, 140, 200]],   // Bright cyan-azure – moderate maritime moisture
  [50,   [ 30,  80, 210]],   // Deep tropical blue – high atmospheric moisture
  [60,   [ 70,  35, 195]],   // Rich indigo-violet – monsoon / ITCZ saturation
  [70,   [130,  25, 180]],   // Saturated magenta-violet – extreme precipitable water
]

export const COLOR_STOPS_MAP = {
  t2m:      T2M_STOPS,
  ts:       TS_STOPS,
  ps:       PS_STOPS,
  wind:     WIND_STOPS,
  tprecmax: TPRECMAX_STOPS,
  tqv:      TQV_STOPS,
}

/**
 * Generic value-to-RGBA mapper using piecewise linear RGB interpolation.
 *
 * @param {number} value - Scientific value in application units
 * @param {string|Array} scaleKeyOrStops - Scale identifier ('t2m', 'ts', 'ps', 'wind') or custom stops array
 * @param {number} [alpha=255] - Alpha channel (0-255)
 * @returns {[number, number, number, number]} [R, G, B, A]
 */
export function valueToRGBA(value, scaleKeyOrStops = 't2m', alpha = 255) {
  if (typeof value !== 'number' || isNaN(value)) {
    return [0, 0, 0, 0] // Transparent for missing data
  }

  const stops = Array.isArray(scaleKeyOrStops)
    ? scaleKeyOrStops
    : COLOR_STOPS_MAP[String(scaleKeyOrStops).toLowerCase()] || T2M_STOPS

  if (stops.length === 0) return [128, 128, 128, alpha]

  // Clamp below minimum
  if (value <= stops[0][0]) {
    const [r, g, b] = stops[0][1]
    return [r, g, b, alpha]
  }

  // Clamp above maximum
  if (value >= stops[stops.length - 1][0]) {
    const [r, g, b] = stops[stops.length - 1][1]
    return [r, g, b, alpha]
  }

  // Piecewise linear interpolation
  for (let i = 0; i < stops.length - 1; i++) {
    const [v0, c0] = stops[i]
    const [v1, c1] = stops[i + 1]
    if (value >= v0 && value <= v1) {
      const t = (value - v0) / (v1 - v0)
      const r = Math.round(c0[0] + t * (c1[0] - c0[0]))
      const g = Math.round(c0[1] + t * (c1[1] - c0[1]))
      const b = Math.round(c0[2] + t * (c1[2] - c0[2]))
      return [r, g, b, alpha]
    }
  }

  return [128, 128, 128, alpha]
}

/**
 * Backward-compatible alias for T2M: maps temperature in °C to RGBA.
 */
export function temperatureToRGBA(tempC) {
  return valueToRGBA(tempC, 't2m', 255)
}
