/**
 * TemperatureChart.jsx
 *
 * Backward-compatible wrapper around ScientificTimeSeriesGraph for temperature (°C).
 * Preserves the existing component interface.
 */
import { memo } from 'react'
import ScientificTimeSeriesGraph from './scientific/ScientificTimeSeriesGraph'

function TemperatureChart(props) {
  return <ScientificTimeSeriesGraph unit="°C" label="Temperature" {...props} />
}

export default memo(TemperatureChart)
