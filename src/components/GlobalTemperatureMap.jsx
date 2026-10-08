/**
 * GlobalTemperatureMap.jsx
 *
 * Backward-compatible wrapper around GlobalScientificMap for variable="T2M".
 * Preserves the existing component interface.
 */
import { memo } from 'react'
import GlobalScientificMap from './scientific/GlobalScientificMap'

function GlobalTemperatureMap(props) {
  return <GlobalScientificMap variable="T2M" {...props} />
}

export default memo(GlobalTemperatureMap)
