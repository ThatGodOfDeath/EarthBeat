/**
 * scientificVariables.js — Centralized Scientific Variable Configurations
 *
 * Centralized definition for all supported NASA GEOS-FP variables:
 *   - T2M:  Near-Surface Air Temperature (2 m)
 *   - TS:   Surface Skin Temperature
 *   - PS:   Surface Pressure
 *   - WIND: 10-Meter Surface Wind (derived from U10M + V10M)
 *
 * Each variable configuration specifies:
 *   - Display labels and descriptions
 *   - Scientific units (source unit in GEOS-FP vs application display unit)
 *   - Mathematical unit conversion functions
 *   - Scientific color scale reference and display domain
 *   - Default legend tick marks
 *   - Associated metadata for UI tooltips
 */

/**
 * Unit conversion functions
 */
export function kelvinToCelsius(kelvin) {
  if (typeof kelvin !== 'number' || isNaN(kelvin)) return NaN
  return kelvin - 273.15
}

export function pascalToHectopascal(pascal) {
  if (typeof pascal !== 'number' || isNaN(pascal)) return NaN
  return pascal / 100.0
}

export function identityConversion(val) {
  return typeof val === 'number' && !isNaN(val) ? val : NaN
}

export const SCIENTIFIC_VARIABLES = {
  T2M: {
    id: 'T2M',
    label: 'Near-Surface Air Temperature',
    shortLabel: 'Air Temperature',
    symbol: 'T₂ₘ',
    sourceVariable: 't2m',
    sourceUnit: 'K',
    unit: '°C',
    type: 'scalar',
    convert: kelvinToCelsius,
    description: 'Modeled air temperature at 2 meters above the displacement height from NASA GEOS-FP.',
    domain: { min: -50, max: 50 },
    legendTicks: [-30, -15, 0, 15, 30, 45],
    colorScaleKey: 't2m',
    hasSonification: true,
    sonificationRole: 'Primary Pitch (Base 500 Hz + 10 Hz/0.1°C)',
    infoRows: [
      { field: 'Variable', value: 'T2M (2-metre air temperature)' },
      { field: 'Data Source', value: 'NASA GEOS-FP (GMAO Forward Processing)' },
      { field: 'Dataset', value: 'GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx' },
      { field: 'Source Unit', value: 'Kelvin (K)' },
      { field: 'Display Unit', value: 'Degrees Celsius (°C)' },
      { field: 'Spatial Grid', value: '0.25° × 0.3125° native; 1° × 1° display (360×180)' },
      { field: 'Temporal Res.', value: '3-hourly assimilation snapshot' },
    ],
  },

  TS: {
    id: 'TS',
    label: 'Surface Skin Temperature',
    shortLabel: 'Surface Temperature',
    symbol: 'Tₛ',
    sourceVariable: 'ts',
    sourceUnit: 'K',
    unit: '°C',
    type: 'scalar',
    convert: kelvinToCelsius,
    description: 'Modeled radiometric surface skin temperature (ground or water surface) from NASA GEOS-FP.',
    domain: { min: -50, max: 60 },
    legendTicks: [-40, -20, 0, 20, 40, 60],
    colorScaleKey: 'ts',
    hasSonification: true, // Timbral brightness modifier in Phase 9
    sonificationRole: 'Timbral Brightness Modifier (Surface-Air ΔT)',
    infoRows: [
      { field: 'Variable', value: 'TS (Surface skin temperature)' },
      { field: 'Data Source', value: 'NASA GEOS-FP (GMAO Forward Processing)' },
      { field: 'Dataset', value: 'GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx' },
      { field: 'Source Unit', value: 'Kelvin (K)' },
      { field: 'Display Unit', value: 'Degrees Celsius (°C)' },
      { field: 'Spatial Grid', value: '0.25° × 0.3125° native; 1° × 1° display (360×180)' },
      { field: 'Temporal Res.', value: '3-hourly assimilation snapshot' },
    ],
  },

  PS: {
    id: 'PS',
    label: 'Surface Pressure',
    shortLabel: 'Surface Pressure',
    symbol: 'Pₛ',
    sourceVariable: 'ps',
    sourceUnit: 'Pa',
    unit: 'hPa',
    type: 'scalar',
    convert: pascalToHectopascal,
    description: 'Modeled atmospheric surface pressure at terrain elevation from NASA GEOS-FP.',
    domain: { min: 920, max: 1040 },
    legendTicks: [920, 950, 980, 1010, 1040],
    colorScaleKey: 'ps',
    hasSonification: true, // Experimental timbre modifier in Phase 9
    sonificationRole: 'Experimental Atmospheric Timbre (Candidate D)',
    infoRows: [
      { field: 'Variable', value: 'PS (Surface pressure)' },
      { field: 'Data Source', value: 'NASA GEOS-FP (GMAO Forward Processing)' },
      { field: 'Dataset', value: 'GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx' },
      { field: 'Source Unit', value: 'Pascal (Pa)' },
      { field: 'Display Unit', value: 'Hectopascal (hPa = 100 Pa)' },
      { field: 'Spatial Grid', value: '0.25° × 0.3125° native; 1° × 1° display (360×180)' },
      { field: 'Temporal Res.', value: '3-hourly assimilation snapshot' },
    ],
  },

  WIND: {
    id: 'WIND',
    label: '10-Meter Surface Wind',
    shortLabel: 'Wind Speed & Direction',
    symbol: 'W₁₀',
    sourceVariable: 'u10m, v10m',
    sourceUnit: 'm/s',
    unit: 'm/s',
    type: 'vector',
    convert: identityConversion,
    description: '10-metre wind speed magnitude with directional vector glyph overlay from NASA GEOS-FP.',
    domain: { min: 0, max: 35 },
    legendTicks: [0, 5, 10, 15, 20, 25, 30],
    colorScaleKey: 'wind',
    hasSonification: true,
    sonificationRole: 'Wind Loudness & Stereo Pan (sin(θ))',
    infoRows: [
      { field: 'Variables', value: 'u10m (Eastward), v10m (Northward)' },
      { field: 'Derived Metrics', value: 'Speed = √(u² + v²), Direction = atan2(v, u)' },
      { field: 'Data Source', value: 'NASA GEOS-FP (GMAO Forward Processing)' },
      { field: 'Dataset', value: 'GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx' },
      { field: 'Display Unit', value: 'Meters per second (m/s)' },
      { field: 'Spatial Grid', value: '0.25° × 0.3125° native; 1° × 1° display (360×180)' },
      { field: 'Temporal Res.', value: '3-hourly assimilation snapshot' },
      { field: 'Convention', value: 'Meteorological direction (from which wind blows) for audio; Vector orientation for map overlay' },
    ],
  },

  TPRECMAX: {
    id: 'TPRECMAX',
    label: 'Total Precipitation Rate',
    shortLabel: 'Precipitation',
    symbol: 'Pᵣ',
    sourceVariable: 'tprecmax',
    sourceUnit: 'kg m-2 s-1',
    unit: 'mm/h',
    type: 'scalar',
    convert: (kgM2S) => (typeof kgM2S === 'number' && !isNaN(kgM2S) ? Math.max(0, kgM2S * 3_600_000) : 0),
    description: 'Modeled total surface precipitation rate from NASA GEOS-FP assimilation state.',
    domain: { min: 0, max: 50 },
    legendTicks: [0, 2, 5, 15, 30, 50],
    colorScaleKey: 'tprecmax',
    hasSonification: true,
    sonificationRole: 'Rain Sound Texture (Droplet Density & Energy)',
    infoRows: [
      { field: 'Variable', value: 'TPRECMAX (Total precipitation)' },
      { field: 'Data Source', value: 'NASA GEOS-FP (GMAO Forward Processing)' },
      { field: 'Dataset', value: 'GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx' },
      { field: 'Source Unit', value: 'Kilogram per square meter per second (kg m-2 s-1)' },
      { field: 'Display Unit', value: 'Millimeters per hour (mm/h = kg/m²/s × 3.6×10⁶)' },
      { field: 'Spatial Grid', value: '0.25° × 0.3125° native; 1° × 1° display (360×180)' },
      { field: 'Temporal Res.', value: '3-hourly assimilation snapshot' },
      { field: 'Physical Role', value: 'Liquid and frozen precipitation reaching surface' },
    ],
  },

  TQV: {
    id: 'TQV',
    label: 'Total Precipitable Water Vapor',
    shortLabel: 'Water Vapor',
    symbol: 'Wᵥ',
    sourceVariable: 'tqv',
    sourceUnit: 'kg m-2',
    unit: 'kg/m²',
    type: 'scalar',
    convert: identityConversion,
    description: 'Total vertically integrated atmospheric column water vapor (precipitable water) from NASA GEOS-FP.',
    domain: { min: 0, max: 70 },
    legendTicks: [0, 15, 30, 45, 60, 70],
    colorScaleKey: 'tqv',
    hasSonification: true,
    sonificationRole: 'Atmospheric Moisture Timbre (Filter Resonance & Warmth)',
    infoRows: [
      { field: 'Variable', value: 'TQV (Total precipitable water vapor)' },
      { field: 'Data Source', value: 'NASA GEOS-FP (GMAO Forward Processing)' },
      { field: 'Dataset', value: 'GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx' },
      { field: 'Source Unit', value: 'Kilogram per square meter (kg m-2)' },
      { field: 'Display Unit', value: 'Kilograms per square meter (kg/m² ≈ mm liquid equivalent)' },
      { field: 'Spatial Grid', value: '0.25° × 0.3125° native; 1° × 1° display (360×180)' },
      { field: 'Temporal Res.', value: '3-hourly assimilation snapshot' },
      { field: 'Physical Role', value: 'Atmospheric moisture column mass / total vapor depth' },
    ],
  },
}

export const VARIABLE_LIST = ['T2M', 'TS', 'PS', 'WIND', 'TPRECMAX', 'TQV']

export const ENVIRONMENTAL_TABS = [
  {
    id: 'temperature',
    label: 'Temperature',
    symbol: 'T',
    subtitle: 'Air (T2M) & Surface Skin (TS)',
    vars: ['T2M', 'TS'],
    description: 'Near-surface air temperature at 2m and radiometric surface skin temperature.',
  },
  {
    id: 'wind',
    label: 'Wind',
    symbol: 'W',
    subtitle: 'Vector (U10M + V10M)',
    vars: ['WIND'],
    description: '10-meter surface wind speed magnitude and vector direction.',
  },
  {
    id: 'precipitation',
    label: 'Precipitation',
    symbol: 'P',
    subtitle: 'Rain (TPRECMAX) & Moisture (TQV)',
    vars: ['TPRECMAX', 'TQV'],
    description: 'Total surface precipitation rate and total precipitable water vapor column.',
  },
  {
    id: 'pressure',
    label: 'Pressure',
    symbol: 'Pₛ',
    subtitle: 'Surface Pressure (PS)',
    vars: ['PS'],
    description: 'Atmospheric surface pressure at terrain elevation.',
  },
]

export function getVariableConfig(variableId) {
  const key = (variableId || 'T2M').toUpperCase()
  return SCIENTIFIC_VARIABLES[key] || SCIENTIFIC_VARIABLES.T2M
}

