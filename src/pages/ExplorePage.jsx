/**
 * ExplorePage.jsx — Phase 9
 *
 * Phase 9: Replace SST + Vegetation with unified GEOS-FP Environmental Systems.
 *
 * Environmental data model (all from inst3_2d_asm_Nx):
 *   t2m      — 2-metre air temperature  → Pitch
 *   ts       — Surface skin temperature → Thermal timbral modifier
 *   u10m     — 10-m eastward wind       → Wind speed (via u²+v²)
 *   v10m     — 10-m northward wind      → Wind direction (meteorological)
 *   tprecmax — Total precipitation max  → Rain texture
 *   tqv      — Total precipitable water → Atmospheric moisture character
 *   ps       — Surface pressure         → Experimental subtle modifier
 *
 * Four environmental systems:
 *   1. TEMPERATURE  t2m + ts  → Pitch + timbral brightness
 *   2. MOISTURE     tqv + tprecmax → Rain texture + atmospheric character
 *   3. WIND         u10m + v10m → Loudness + stereo pan
 *   4. PRESSURE     ps → Experimental timbre (Candidate D)
 *
 * Temporal State Architecture:
 *
 *   temporalConfig { scale, startDate, duration, interval }
 *         │
 *         ▼  generateTimestamps()
 *   generatedTimestamps[]
 *         │
 *         ▼  user deletes via TimestampPanel
 *   activeTimestamps[]   (generatedTimestamps minus user deletions)
 *         │
 *   ┌─────┼──────┬──────────┬──────────┐
 *   ▼     ▼      ▼          ▼          ▼
 *  Graph Map  Timeline   Playback   Audio
 */


import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useLocation, Link } from 'react-router-dom'
import GlobalScientificMap from '../components/scientific/GlobalScientificMap'
import ScientificTimeSeriesGraph from '../components/scientific/ScientificTimeSeriesGraph'
import DataInfoTooltip from '../components/DataInfoTooltip'
import EnvironmentalPanel from '../components/environmental/EnvironmentalPanel'
import WindVisualization from '../components/wind/WindVisualization'
import WindChart from '../components/wind/WindChart'
import TimestampPanel from '../components/temporal/TimestampPanel'
import { parseTemporalComponents } from '../utils/dateUtils'
import {
  ENVIRONMENTAL_TABS,
} from '../data/scientificVariables'
import { precipitationToMmHr } from '../utils/precipitationSonification'
import { getGlobalScientificGrid } from '../services/globalScientificDataService'
import {
  generateTimestamps,
  getDataRange,
  SCALE_CONFIG,
} from '../utils/timestampGenerator'
import {
  getTemperatureData,
  TemperatureServiceError,
} from '../services/temperatureService'
import {
  getWindData,
  WindServiceError,
} from '../services/windService'
import { windAudioService } from '../services/windAudioService'
import { precipitationAudioService } from '../services/precipitationAudioService'
import { vegetationAudioService } from '../services/vegetationAudioService'
import {
  getEnvironmentalData,
  EnvironmentalServiceError,
} from '../services/environmentalService'
import {
  setAvailableTimestamps,
  clearGridCache,
} from '../services/globalTemperatureService'
import {
  temperatureToFrequency,
  computeSeriesStats,
  MIN_FREQUENCY_HZ,
} from '../utils/sonification'
import { calculateThermalAudioParams } from '../utils/thermalSonification'
import styles from './ExplorePage.module.css'


// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_LOCATION = {
  name: 'Dhaka, Bangladesh',
  lat: 23.8103,
  lng: 90.4125,
}

const PLAYBACK_STEP_MS = 750

/**
 * Build the default temporal config for initial load.
 * Daily · 1 day · 3 hour interval, starting today UTC.
 */
function buildDefaultTemporalConfig() {
  const now = new Date()
  // Start at midnight UTC of today
  const startDate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0, 0,
  ))
  return {
    scale: 'daily',
    startDate: startDate.toISOString(),
    duration: SCALE_CONFIG.daily.durationDefault,     // 1 day
    interval: SCALE_CONFIG.daily.intervalDefault,     // 3 hours
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ExplorePage() {
  const { state } = useLocation()

  const initialLocation = useMemo(() => ({
    name:  state?.name || DEFAULT_LOCATION.name,
    lat:   state?.lat  ?? DEFAULT_LOCATION.lat,
    lng:   state?.lng  ?? DEFAULT_LOCATION.lng,
  }), [state])

  const [activeLocation, setActiveLocation] = useState(initialLocation)
  const [dataset, setDataset] = useState(null)
  const [localLoading, setLocalLoading] = useState(true)
  const [localError, setLocalError] = useState(null)
  const [provider, setProvider] = useState('geosfp')

  // ── Temporal State (Phase 5D) ──────────────────────────────────────────────
  /**
   * draftConfig: live UI state updated on every slider/selector change.
   * Does NOT trigger data fetches — changes are cheap and instant.
   */
  const [draftConfig, setDraftConfig] = useState(buildDefaultTemporalConfig)

  /**
   * committedConfig: the config that was last confirmed by the user.
   * This is what triggers timestamp generation and backend fetches.
   * Updated only when the user clicks "Apply Changes" / "Refresh Data".
   */
  const [committedConfig, setCommittedConfig] = useState(buildDefaultTemporalConfig)

  /**
   * isDirty: true when the draft differs from the last committed config.
   * Used to show the "unsaved changes" indicator and make the Apply button prominent.
   */
  const isDirty = useMemo(() => {
    return JSON.stringify(draftConfig) !== JSON.stringify(committedConfig)
  }, [draftConfig, committedConfig])

  /**
   * generatedTimestamps: deterministic output of generateTimestamps(committedConfig).
   * This is never mutated by user deletion — it always reflects the committed config.
   */
  const [generatedTimestamps, setGeneratedTimestamps] = useState([])

  /**
   * deletedTimestamps: set of timestamps the user has explicitly removed.
   * When temporalConfig changes, this resets (new temporal config = fresh dataset).
   */
  const [deletedTimestamps, setDeletedTimestamps] = useState(new Set())

  /**
   * activeTimestamps: generatedTimestamps minus deletedTimestamps.
   * This is the source of truth for graph, map, timeline, playback, audio.
   */
  const activeTimestamps = useMemo(() => {
    return generatedTimestamps.filter((ts) => !deletedTimestamps.has(ts))
  }, [generatedTimestamps, deletedTimestamps])


  /**
   * availableDatasetTimestamps: timestamps actually present with valid temperature
   * in the backend response. Timestamps missing observation data are excluded.
   */
  const availableDatasetTimestamps = useMemo(
    () => dataset?.data?.filter((d) => d.value != null && !isNaN(d.value)).map((d) => d.timestamp) ?? null,
    [dataset],
  )

  /**
   * timelineTimestamps: the subset of activeTimestamps that HAVE observation data.
   * Dates with missing observation data are kept in the sidebar list only, and are
   * excluded from the graph and the sonification slider.
   */
  const timelineTimestamps = useMemo(() => {
    if (!dataset?.data || availableDatasetTimestamps === null) {
      return activeTimestamps
    }
    const availSet = new Set(availableDatasetTimestamps)
    return activeTimestamps.filter((ts) => availSet.has(ts))
  }, [activeTimestamps, dataset, availableDatasetTimestamps])

  // ── Timeline Index ─────────────────────────────────────────────────────────
  /**
   * timestampIndex: index into timelineTimestamps (not generatedTimestamps).
   * Always clamped to [0, timelineTimestamps.length - 1].
   */
  const [timestampIndex, setTimestampIndex] = useState(0)

  // Clamp index when timelineTimestamps shrinks
  const safeIndex = Math.min(timestampIndex, Math.max(0, timelineTimestamps.length - 1))
  const activeTimestamp = timelineTimestamps[safeIndex] ?? ''

  // Automatically anchor/clamp index when timelineTimestamps updates
  const prevTimelineLenRef = useRef(0)
  useEffect(() => {
    if (timelineTimestamps.length > 0 && prevTimelineLenRef.current === 0) {
      setTimestampIndex(timelineTimestamps.length - 1)
    } else if (timestampIndex >= timelineTimestamps.length) {
      setTimestampIndex(Math.max(0, timelineTimestamps.length - 1))
    }
    prevTimelineLenRef.current = timelineTimestamps.length
  }, [timelineTimestamps.length, timestampIndex])

  // ── Environmental System Tabs & Scientific Grids (Phase 10) ───────────────
  const [activeSystemTab, setActiveSystemTab] = useState('temperature')
  const activeTabConfig = useMemo(
    () => ENVIRONMENTAL_TABS.find((t) => t.id === activeSystemTab) || ENVIRONMENTAL_TABS[0],
    [activeSystemTab]
  )

  const [grids, setGrids] = useState({})
  const [gridLoadings, setGridLoadings] = useState({})
  const [gridErrors, setGridErrors] = useState({})

  // ── Playback ───────────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false)

  // ── Audio Channel Enables (Phase 9) ────────────────────────────────────────
  const [isTempAudioEnabled, setIsTempAudioEnabled] = useState(true)
  const [isWindAudioEnabled, setIsWindAudioEnabled] = useState(true)
  const [isMoistureAudioEnabled, setIsMoistureAudioEnabled] = useState(true)
  const [isPressureAudioEnabled, setIsPressureAudioEnabled] = useState(true)

  // ── Right Panel ────────────────────────────────────────────────────────────
  const [panelOpen, setPanelOpen] = useState(false)

  // ── Stale-request protection ───────────────────────────────────────────────
  const activeLocationReqId = useRef(0)

  // ── Backend metadata ───────────────────────────────────────────────────────
  const [_backendMeta, setBackendMeta] = useState(null)

  // ── Wind State (Phase 6) ───────────────────────────────────────────────────
  const [windDataset, setWindDataset] = useState(null)
  const [windLoading, setWindLoading] = useState(false)
  const [windError, setWindError] = useState(null)
  const activeWindReqId = useRef(0)

  // ── Environmental State (Phase 9: ts, tqv, tprecmax, ps) ──────────────────
  const [envDataset, setEnvDataset] = useState(null)
  const [_envLoading, setEnvLoading] = useState(false)
  const [_envError, setEnvError] = useState(null)
  const activeEnvReqId = useRef(0)

  // ── Audio refs ─────────────────────────────────────────────────────────────
  const audioCtxRef      = useRef(null)
  const oscillatorRef    = useRef(null)
  const gainRef          = useRef(null)
  const playbackTimerRef = useRef(null)
  const auditionTimerRef = useRef(null)

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPORAL CONFIG → TIMESTAMP GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Re-generate timestamps whenever committedConfig changes (user clicks Apply).
   * Also resets all user deletions (new config = fresh dataset).
   */
  useEffect(() => {
    const timestamps = generateTimestamps(committedConfig)
    setGeneratedTimestamps(timestamps)
    setDeletedTimestamps(new Set())          // clear deletions for new config
    setTimestampIndex(timestamps.length > 0 ? timestamps.length - 1 : 0) // anchor date is the latest (last) index
    stopAudio()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedConfig])

  // Update globalTemperatureService when timelineTimestamps changes
  useEffect(() => {
    setAvailableTimestamps(timelineTimestamps)
  }, [timelineTimestamps])

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPERATURE DATA FETCH (Local Series)
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (generatedTimestamps.length === 0) return

    const currentReqId = ++activeLocationReqId.current

    async function fetchLocalData() {
      setLocalLoading(true)
      setLocalError(null)

      try {
        // Determine the required time range from generated timestamps
        const range = getDataRange(generatedTimestamps)
        const timeRange = provider !== 'mock' && range
          ? { start: range.start, end: range.end }
          : {}

        const result = await getTemperatureData(
          activeLocation.lat,
          activeLocation.lng,
          {
            locationName: activeLocation.name,
            provider,
            timestamps: generatedTimestamps,
            ...timeRange,
          },
        )

        if (currentReqId !== activeLocationReqId.current) return

        setDataset(result)
        if (result.resolution) setBackendMeta(result)
      } catch (err) {
        if (currentReqId !== activeLocationReqId.current) return
        if (err instanceof TemperatureServiceError) {
          setLocalError(err)
        } else {
          setLocalError(new TemperatureServiceError(
            'Temperature data is not available. Please ensure the backend is running.',
            'UNKNOWN_ERROR',
          ))
        }
        setDataset(null)
      } finally {
        if (currentReqId === activeLocationReqId.current) {
          setLocalLoading(false)
        }
      }
    }

    fetchLocalData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocation, provider, generatedTimestamps])

  // ═══════════════════════════════════════════════════════════════════════════
  // WIND DATA FETCH (Phase 6 — Local Series)
  // ═══════════════════════════════════════════════════════════════════════════

  const fetchWindSeries = useCallback(async () => {
    if (generatedTimestamps.length === 0) return

    const currentReqId = ++activeWindReqId.current
    setWindLoading(true)
    setWindError(null)

    try {
      const range = getDataRange(generatedTimestamps)
      const timeRange = provider !== 'mock' && range
        ? { start: range.start, end: range.end }
        : {}

      const result = await getWindData(
        activeLocation.lat,
        activeLocation.lng,
        {
          provider,
          timestamps: generatedTimestamps,
          ...timeRange,
        },
      )

      if (currentReqId !== activeWindReqId.current) return
      setWindDataset(result)
    } catch (err) {
      if (currentReqId !== activeWindReqId.current) return
      if (err instanceof WindServiceError) {
        setWindError(err)
      } else {
        setWindError(new WindServiceError(
          'Wind data is temporarily unavailable.',
          'UNKNOWN_ERROR',
        ))
      }
      setWindDataset(null)
    } finally {
      if (currentReqId === activeWindReqId.current) {
        setWindLoading(false)
      }
    }
  }, [activeLocation, provider, generatedTimestamps])

  useEffect(() => {
    fetchWindSeries()
  }, [fetchWindSeries])


  // ═══════════════════════════════════════════════════════════════════════════
  // ENVIRONMENTAL DATA FETCH (Phase 9 — ts, tqv, tprecmax, ps)
  // ═══════════════════════════════════════════════════════════════════════════

  const fetchEnvironmentalSeries = useCallback(async () => {
    if (generatedTimestamps.length === 0) return

    const currentReqId = ++activeEnvReqId.current
    setEnvLoading(true)
    setEnvError(null)

    try {
      const range = getDataRange(generatedTimestamps)
      const timeRange = provider !== 'mock' && range
        ? { start: range.start, end: range.end }
        : {}

      const result = await getEnvironmentalData(
        activeLocation.lat,
        activeLocation.lng,
        {
          provider,
          timestamps: generatedTimestamps,
          ...timeRange,
        },
      )

      if (currentReqId !== activeEnvReqId.current) return
      setEnvDataset(result)
    } catch (err) {
      if (currentReqId !== activeEnvReqId.current) return
      // Environmental failure is non-fatal — temperature and wind remain functional
      setEnvError(err instanceof EnvironmentalServiceError ? err : new EnvironmentalServiceError(
        'Environmental data temporarily unavailable. Temperature and wind continue.',
        'UNKNOWN_ERROR',
      ))
      setEnvDataset(null)
    } finally {
      if (currentReqId === activeEnvReqId.current) {
        setEnvLoading(false)
      }
    }
  }, [activeLocation, provider, generatedTimestamps])

  useEffect(() => {
    fetchEnvironmentalSeries()
  }, [fetchEnvironmentalSeries])


  // ═══════════════════════════════════════════════════════════════════════════
  // GLOBAL GRID — Load on active timestamp or variable change
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const ts = activeTimestamp
    if (!ts) return

    const tabVars = activeTabConfig.vars
    const controller = new AbortController()
    let prefetchTimer = null

    // Debounce remote grid fetching (150ms) to prevent network flooding while scrubbing
    const debounceTimer = setTimeout(() => {
      tabVars.forEach((varId) => {
        setGridLoadings((prev) => ({ ...prev, [varId]: true }))
        setGridErrors((prev) => ({ ...prev, [varId]: null }))

        getGlobalScientificGrid(varId, ts, { provider, signal: controller.signal })
          .then((grid) => {
            if (controller.signal.aborted) return
            setGrids((prev) => ({ ...prev, [varId]: grid }))
            setGridLoadings((prev) => ({ ...prev, [varId]: false }))
          })
          .catch((err) => {
            if (controller.signal.aborted || err.name === 'AbortError') return
            console.warn(`[ExplorePage] Global ${varId} frame unavailable:`, err)
            setGridErrors((prev) => ({ ...prev, [varId]: err }))
            setGridLoadings((prev) => ({ ...prev, [varId]: false }))
          })
      })

      // Prefetch next frame for active tab variables after active request has settled
      const nextTs = activeTimestamps[safeIndex + 1]
      if (nextTs) {
        prefetchTimer = setTimeout(() => {
          if (controller.signal.aborted) return
          tabVars.forEach((varId) => {
            getGlobalScientificGrid(varId, nextTs, { provider, signal: controller.signal }).catch(() => {})
          })
        }, 1200)
      }
    }, 150)

    return () => {
      clearTimeout(debounceTimer)
      if (prefetchTimer) clearTimeout(prefetchTimer)
      controller.abort()
    }
  }, [activeTimestamp, activeTabConfig.id, activeTabConfig.vars, provider, safeIndex, activeTimestamps])

  // ═══════════════════════════════════════════════════════════════════════════
  // DERIVED STATE
  // ═══════════════════════════════════════════════════════════════════════════

  const temporal = useMemo(() => parseTemporalComponents(activeTimestamp), [activeTimestamp])

  /**
   * Find the temperature data point closest to the active timestamp.
   * activeTimestamps may not perfectly align with dataset.data timestamps
   * (e.g., when using monthly/yearly modes spanning multiple backend requests).
   */
  const currentIndex = useMemo(() => {
    if (!dataset?.data || !activeTimestamp) return 0
    const exact = dataset.data.findIndex((d) => d.timestamp === activeTimestamp)
    if (exact !== -1) return exact
    const target = new Date(activeTimestamp).getTime()
    let bestIdx = 0
    let bestDiff = Infinity
    dataset.data.forEach((d, i) => {
      const diff = Math.abs(new Date(d.timestamp).getTime() - target)
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i }
    })
    return bestIdx
  }, [dataset, activeTimestamp])

  const currentPoint = dataset?.data?.[currentIndex] ?? null

  /**
   * missingObservationsMap: maps each timestamp to an array of missing observation types.
   * SST removed in Phase 9 — now tracks t2m, global temp, wind, and env data.
   */
  const missingObservationsMap = useMemo(() => {
    const map = new Map()
    if (!generatedTimestamps.length) return map

    const availT2mSet = availableDatasetTimestamps ? new Set(availableDatasetTimestamps) : null

    generatedTimestamps.forEach((ts) => {
      const missing = []

      // 1. Check t2m
      const hasT2m = availT2mSet ? availT2mSet.has(ts) : true
      if (!hasT2m) missing.push('t2m')

      // 2. Check global temp
      const hasGlobalTemp = hasT2m && (activeTimestamp !== ts || !gridErrors.T2M)
      if (!hasGlobalTemp) missing.push('global temp')

      // 3. Check wind
      const hasWind = windDataset?.data
        ? windDataset.data.some((w) => w.timestamp === ts && w.speed != null)
        : hasT2m
      if (!hasWind) missing.push('wind')

      // 4. Check environmental (ts, tqv, tprecmax, ps)
      const hasEnv = envDataset?.data
        ? envDataset.data.some((e) => e.timestamp === ts && (e.ts != null || e.tqv != null))
        : true   // assume present if dataset not loaded yet
      if (!hasEnv) missing.push('environmental')

      map.set(ts, missing)
    })

    return map
  }, [generatedTimestamps, availableDatasetTimestamps, activeTimestamp, gridErrors.T2M, windDataset, envDataset])

  /**
   * chartData: the subset of dataset.data matching timelineTimestamps.
   * Timestamps with missing observation data are excluded from the graph.
   */
  const chartData = useMemo(
    () => dataset?.data?.filter((d) => timelineTimestamps.includes(d.timestamp)) ?? [],
    [dataset, timelineTimestamps],
  )



  /**
   * windChartData: the subset of windDataset.data matching timelineTimestamps.
   */
  const windChartData = useMemo(
    () => windDataset?.data?.filter((d) => timelineTimestamps.includes(d.timestamp)) ?? [],
    [windDataset, timelineTimestamps],
  )

  /**
   * windChartActiveIndex: index within windChartData matching activeTimestamp.
   */
  const windChartActiveIndex = useMemo(() => {
    if (!activeTimestamp || windChartData.length === 0) return 0
    const idx = windChartData.findIndex((d) => d.timestamp === activeTimestamp)
    return idx !== -1 ? idx : 0
  }, [activeTimestamp, windChartData])

  /**
   * tsChartData: Surface skin temperature observations matching timelineTimestamps.
   */
  const tsChartData = useMemo(() => {
    if (!envDataset?.data || !timelineTimestamps.length) return []
    return timelineTimestamps
      .map((ts) => {
        const pt = envDataset.data.find((d) => d.timestamp === ts)
        if (!pt || typeof pt.ts !== 'number' || isNaN(pt.ts)) return null
        const val = pt.ts > 150 ? pt.ts - 273.15 : pt.ts
        return { timestamp: ts, value: Math.round(val * 10) / 10 }
      })
      .filter(Boolean)
  }, [envDataset, timelineTimestamps])

  /**
   * psChartData: Surface pressure observations (in hPa) matching timelineTimestamps.
   */
  const psChartData = useMemo(() => {
    if (!envDataset?.data || !timelineTimestamps.length) return []
    return timelineTimestamps
      .map((ts) => {
        const pt = envDataset.data.find((d) => d.timestamp === ts)
        if (!pt || typeof pt.ps !== 'number' || isNaN(pt.ps)) return null
        const hpa = pt.ps > 2000 ? pt.ps / 100 : pt.ps
        return { timestamp: ts, value: Math.round(hpa * 10) / 10 }
      })
      .filter(Boolean)
  }, [envDataset, timelineTimestamps])

  /**
   * tprecmaxChartData: Total precipitation rate (mm/h) matching timelineTimestamps.
   */
  const tprecmaxChartData = useMemo(() => {
    if (!envDataset?.data || !timelineTimestamps.length) return []
    return timelineTimestamps
      .map((ts) => {
        const pt = envDataset.data.find((d) => d.timestamp === ts)
        if (!pt || typeof pt.tprecmax !== 'number' || isNaN(pt.tprecmax)) return null
        const mmHr = precipitationToMmHr(pt.tprecmax)
        return { timestamp: ts, value: Math.round(mmHr * 10) / 10 }
      })
      .filter(Boolean)
  }, [envDataset, timelineTimestamps])

  /**
   * tqvChartData: Total precipitable water vapor (kg/m²) matching timelineTimestamps.
   */
  const tqvChartData = useMemo(() => {
    if (!envDataset?.data || !timelineTimestamps.length) return []
    return timelineTimestamps
      .map((ts) => {
        const pt = envDataset.data.find((d) => d.timestamp === ts)
        if (!pt || typeof pt.tqv !== 'number' || isNaN(pt.tqv)) return null
        return { timestamp: ts, value: Math.round(pt.tqv * 10) / 10 }
      })
      .filter(Boolean)
  }, [envDataset, timelineTimestamps])

  const activeT2mIndex = useMemo(() => {
    if (!activeTimestamp || chartData.length === 0) return 0
    const idx = chartData.findIndex((d) => d.timestamp === activeTimestamp)
    return idx !== -1 ? idx : 0
  }, [activeTimestamp, chartData])

  const activeTsIndex = useMemo(() => {
    if (!activeTimestamp || tsChartData.length === 0) return 0
    const idx = tsChartData.findIndex((d) => d.timestamp === activeTimestamp)
    return idx !== -1 ? idx : 0
  }, [activeTimestamp, tsChartData])

  const activePrecipIndex = useMemo(() => {
    if (!activeTimestamp || tprecmaxChartData.length === 0) return 0
    const idx = tprecmaxChartData.findIndex((d) => d.timestamp === activeTimestamp)
    return idx !== -1 ? idx : 0
  }, [activeTimestamp, tprecmaxChartData])

  const activeTqvIndex = useMemo(() => {
    if (!activeTimestamp || tqvChartData.length === 0) return 0
    const idx = tqvChartData.findIndex((d) => d.timestamp === activeTimestamp)
    return idx !== -1 ? idx : 0
  }, [activeTimestamp, tqvChartData])

  const activePsIndex = useMemo(() => {
    if (!activeTimestamp || psChartData.length === 0) return 0
    const idx = psChartData.findIndex((d) => d.timestamp === activeTimestamp)
    return idx !== -1 ? idx : 0
  }, [activeTimestamp, psChartData])

  /**
   * currentWindPoint: current wind observation point matching activeTimestamp.
   */
  const currentWindPoint = useMemo(() => {
    if (!windDataset?.data || !activeTimestamp) return null
    const exact = windDataset.data.find((d) => d.timestamp === activeTimestamp)
    if (exact) return exact
    const target = new Date(activeTimestamp).getTime()
    let bestPt = windDataset.data[0]
    let bestDiff = Infinity
    for (const pt of windDataset.data) {
      const diff = Math.abs(new Date(pt.timestamp).getTime() - target)
      if (diff < bestDiff) { bestDiff = diff; bestPt = pt }
    }
    return bestPt
  }, [windDataset, activeTimestamp])

  /**
   * currentEnvPoint: current environmental data point (ts, tqv, tprecmax, ps)
   * matching the active timestamp. Uses nearest-neighbor fallback.
   */
  const currentEnvPoint = useMemo(() => {
    if (!envDataset?.data || !activeTimestamp) return null
    const exact = envDataset.data.find((d) => d.timestamp === activeTimestamp)
    if (exact) return exact
    const target = new Date(activeTimestamp).getTime()
    let bestPt = envDataset.data[0]
    let bestDiff = Infinity
    for (const pt of envDataset.data) {
      const diff = Math.abs(new Date(pt.timestamp).getTime() - target)
      if (diff < bestDiff) { bestDiff = diff; bestPt = pt }
    }
    return bestPt
  }, [envDataset, activeTimestamp])

  const windInfoRows = useMemo(() => [
    { field: 'Data Source', value: 'NASA GEOS-FP (GMAO Forward Processing)' },
    { field: 'Variables', value: 'u10m (Eastward), v10m (Northward)' },
    { field: 'Derived Metrics', value: 'Wind Speed (m/s), Meteorological Direction (°)' },
    { field: 'Spatial Resolution', value: '0.25° × 0.3125° lat/lon grid' },
    { field: 'Temporal Resolution', value: '3-hourly assimilation (inst3_2d_asm_Nx)' },
    { field: 'Convention', value: 'Meteorological (Direction wind is blowing FROM; 0° N, 90° E)' },
  ], [])


  const stats = useMemo(() => {
    if (!dataset?.data) return { min: 0, max: 0, count: 0 }
    return computeSeriesStats(dataset.data)
  }, [dataset])

  const currentFrequency = useMemo(() => {
    if (!currentPoint) return MIN_FREQUENCY_HZ
    return temperatureToFrequency(currentPoint.value, stats.min, stats.max)
  }, [currentPoint, stats.min, stats.max])

  const shortLocationName = useMemo(() => {
    const name = dataset?.requestedLocation?.name || activeLocation.name || ''
    return name.split(',')[0].trim()
  }, [dataset, activeLocation])

  const tempInfoRows = useMemo(() => [
    { field: 'Variables', value: 'T2M (2m Air Temperature), TS (Surface Skin Temperature)' },
    { field: 'Data Source', value: 'NASA GEOS-FP (GMAO Forward Processing)' },
    { field: 'Dataset', value: 'GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx' },
    { field: 'Units', value: 'Kelvin (K) converted to Degrees Celsius (°C)' },
    { field: 'Spatial Grid', value: '0.25° × 0.3125° native; 1° × 1° display (360×180)' },
    { field: 'Sonification Role', value: 'T2M owns Pitch; TS modifies Timbral Brightness' },
  ], [])

  const precipInfoRows = useMemo(() => [
    { field: 'Variables', value: 'TPRECMAX (Precipitation), TQV (Total Precipitable Water Vapor)' },
    { field: 'Data Source', value: 'NASA GEOS-FP (GMAO Forward Processing)' },
    { field: 'Dataset', value: 'GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx' },
    { field: 'Source Units', value: 'TPRECMAX: kg m-2 s-1 (→ mm/h); TQV: kg m-2' },
    { field: 'Spatial Grid', value: '0.25° × 0.3125° native; 1° × 1° display (360×180)' },
    { field: 'Sonification Role', value: 'TPRECMAX controls rain droplet density; TQV sets atmospheric warmth' },
  ], [])

  const pressureInfoRows = useMemo(() => [
    { field: 'Variable', value: 'PS (Surface Pressure)' },
    { field: 'Data Source', value: 'NASA GEOS-FP (GMAO Forward Processing)' },
    { field: 'Dataset', value: 'GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx' },
    { field: 'Source Unit', value: 'Pascal (Pa) converted to Hectopascal (hPa)' },
    { field: 'Spatial Grid', value: '0.25° × 0.3125° native; 1° × 1° display (360×180)' },
    { field: 'Sonification Role', value: 'Experimental atmospheric timbre (low-shelf filtering)' },
  ], [])

  const currentPrecipMmHr = useMemo(() => {
    return currentEnvPoint?.tprecmax != null ? precipitationToMmHr(currentEnvPoint.tprecmax) : 0
  }, [currentEnvPoint])

  const currentTsC = useMemo(() => {
    if (currentEnvPoint?.ts == null) return null
    return currentEnvPoint.ts > 150 ? currentEnvPoint.ts - 273.15 : currentEnvPoint.ts
  }, [currentEnvPoint])

  const deltaT = useMemo(() => {
    if (currentTsC != null && currentPoint?.value != null) {
      const t2mC = currentPoint.value > 150 ? currentPoint.value - 273.15 : currentPoint.value
      return currentTsC - t2mC
    }
    return null
  }, [currentTsC, currentPoint])

  const deltaTString = useMemo(() => {
    if (deltaT == null) return '—'
    return `${deltaT >= 0 ? '+' : ''}${deltaT.toFixed(1)}°C`
  }, [deltaT])

  const currentPsHpa = useMemo(() => {
    if (currentEnvPoint?.ps == null) return null
    return currentEnvPoint.ps > 2000 ? currentEnvPoint.ps / 100 : currentEnvPoint.ps
  }, [currentEnvPoint])

  const psAnomalyString = useMemo(() => {
    if (currentPsHpa == null) return '—'
    const anom = currentPsHpa - 1013.25
    return `${anom >= 0 ? '+' : ''}${anom.toFixed(1)} hPa`
  }, [currentPsHpa])

  function precipIntensityLabel(mmHr) {
    if (mmHr == null || mmHr <= 0.05) return 'Dry (No Rain)'
    if (mmHr < 2.0) return 'Light Drizzle / Rain'
    if (mmHr < 10.0) return 'Moderate Rain'
    if (mmHr < 25.0) return 'Heavy Rain'
    return 'Torrential Cloudburst'
  }

  function tqvLabel(tqv) {
    if (tqv == null) return '—'
    if (tqv < 15) return 'Dry Atmospheric Column'
    if (tqv < 35) return 'Moderate Column Humidity'
    if (tqv < 50) return 'High Tropical Moisture'
    return 'Deep Monsoon / Saturated Air'
  }

  function psCategory(hpa) {
    if (hpa == null) return '—'
    if (hpa < 1000) return 'Low Pressure Depression'
    if (hpa < 1020) return 'Standard Atmospheric Range'
    return 'High Pressure Anticyclone'
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIO ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  function getAudioCtx() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
      windAudioService.init(audioCtxRef.current)
      precipitationAudioService.init(audioCtxRef.current)
      vegetationAudioService.init(audioCtxRef.current)
    }
    return audioCtxRef.current
  }

  const ensureContinuousOscillator = useCallback((initialFreq) => {
    const ctx = getAudioCtx()
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    if (!oscillatorRef.current) {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(initialFreq, ctx.currentTime)
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      if (isTempAudioEnabled) {
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.08)
      }
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      oscillatorRef.current = osc
      gainRef.current = gain
    }
    return { ctx, osc: oscillatorRef.current, gain: gainRef.current }
  }, [isTempAudioEnabled])

  const glideToFrequency = useCallback((targetFreq, glideTimeSec = 0.5) => {
    if (!isTempAudioEnabled) {
      if (gainRef.current && audioCtxRef.current) {
        const ctx = audioCtxRef.current
        gainRef.current.gain.cancelScheduledValues(ctx.currentTime)
        gainRef.current.gain.setValueAtTime(Math.max(0.0001, gainRef.current.gain.value), ctx.currentTime)
        gainRef.current.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.1)
      }
      return
    }
    const { ctx, osc, gain } = ensureContinuousOscillator(targetFreq)
    gain.gain.cancelScheduledValues(ctx.currentTime)
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.04)
    osc.frequency.cancelScheduledValues(ctx.currentTime)
    osc.frequency.setValueAtTime(osc.frequency.value, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, targetFreq),
      ctx.currentTime + glideTimeSec,
    )
  }, [ensureContinuousOscillator, isTempAudioEnabled])

  // stopAudio must be defined before use in useEffect
  const stopAudio = useCallback(() => {
    if (playbackTimerRef.current) { clearInterval(playbackTimerRef.current); playbackTimerRef.current = null }
    if (auditionTimerRef.current) { clearTimeout(auditionTimerRef.current); auditionTimerRef.current = null }
    if (oscillatorRef.current && audioCtxRef.current && gainRef.current) {
      try {
        const ctx     = audioCtxRef.current
        const gainNode = gainRef.current
        const oscNode  = oscillatorRef.current
        gainNode.gain.cancelScheduledValues(ctx.currentTime)
        gainNode.gain.setValueAtTime(Math.max(0.0001, gainNode.gain.value), ctx.currentTime)
        gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
        setTimeout(() => { try { oscNode.stop(); oscNode.disconnect() } catch { /* ignore */ } }, 130)
      } catch { /* ignore */ }
      oscillatorRef.current = null
      gainRef.current = null
    }
    windAudioService.stop(0.12)
    precipitationAudioService.stop(0.12)
    vegetationAudioService.stop(0.15)
    setIsPlaying(false)
  }, [])


  // ═══════════════════════════════════════════════════════════════════════════
  // TIMELINE / PLAYBACK HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  const handleTimelineChange = useCallback((newIndex) => {
    // Clamp to valid range of timelineTimestamps
    const clamped = Math.max(0, Math.min(timelineTimestamps.length - 1, newIndex))
    setTimestampIndex(clamped)
    const ts = timelineTimestamps[clamped]

    // 1. Temperature Audio (t2m → pitch, frozen)
    if (dataset?.data) {
      const matchIdx = dataset.data.findIndex((d) => d.timestamp === ts)
      const pt = dataset.data[matchIdx !== -1 ? matchIdx : 0]
      if (pt && isTempAudioEnabled) {
        const freq = temperatureToFrequency(pt.value, stats.min, stats.max)
        glideToFrequency(freq, 0.25)
      }
    }

    // Look up current env point for ts/tqv/tprecmax/ps
    const envPt = envDataset?.data?.find((d) => d.timestamp === ts) || null

    // 2. Wind Audio (u10m + v10m → loudness + pan)
    if (windDataset?.data && isWindAudioEnabled) {
      const windPt = windDataset.data.find((d) => d.timestamp === ts) || null
      getAudioCtx()
      windAudioService.updateWind(windPt, 0.25)
    } else {
      windAudioService.stop(0.25)
    }

    // 3. Moisture Audio (tprecmax + tqv → rain texture + atmospheric character)
    if (isMoistureAudioEnabled) {
      getAudioCtx()
      precipitationAudioService.updateMoisture(
        envPt?.tprecmax ?? null,
        envPt?.tqv ?? null,
        0.4,
      )
    } else {
      precipitationAudioService.stop(0.25)
    }

    // 4. Pressure Audio (ps → experimental subtle timbre modifier)
    if (isPressureAudioEnabled) {
      getAudioCtx()
      vegetationAudioService.updatePressure(envPt?.ps ?? null, 0.6)
    } else {
      vegetationAudioService.stop(0.25)
    }

    // 5. Thermal modifier (ts → timbral brightness via peaking EQ)
    //    Applied to temperature oscillator when available
    if (envPt?.ts != null && currentPoint != null) {
      const thermalParams = calculateThermalAudioParams(envPt.ts, currentPoint.value + 273.15)
      // ts is in K from GEOS-FP; currentPoint.value is in °C → convert to K for diff
      // Store for potential filter node in future — for now just compute (no oscillator filter yet)
      void thermalParams   // suppress unused warning — will be used in Phase 9 audio node chain
    }

    if (!isPlaying) {
      if (auditionTimerRef.current) clearTimeout(auditionTimerRef.current)
      auditionTimerRef.current = setTimeout(() => stopAudio(), 700)
    }
  }, [dataset, windDataset, envDataset, timelineTimestamps, stats.min, stats.max, isPlaying, currentPoint,
      isTempAudioEnabled, isWindAudioEnabled, isMoistureAudioEnabled, isPressureAudioEnabled,
      glideToFrequency, stopAudio])

  const handleSelectChartPointByTimestamp = useCallback((ts) => {
    if (!ts) return
    const idx = timelineTimestamps.indexOf(ts)
    if (idx !== -1) handleTimelineChange(idx)
  }, [timelineTimestamps, handleTimelineChange])

  const handleTogglePlayback = useCallback(() => {
    if (isPlaying) { stopAudio(); return }
    if (!dataset?.data?.length || timelineTimestamps.length === 0) return

    // If at or past the end, restart from 0
    let stepIndex = safeIndex >= timelineTimestamps.length - 1 ? 0 : safeIndex
    setTimestampIndex(stepIndex)
    setIsPlaying(true)

    const ctx = getAudioCtx()
    windAudioService.init(ctx)
    precipitationAudioService.init(ctx)
    vegetationAudioService.init(ctx)

    const currentTs = timelineTimestamps[stepIndex]
    const envPt = envDataset?.data?.find((d) => d.timestamp === currentTs) || null

    // 1. Temperature Start
    const matchIdx = dataset.data.findIndex((d) => d.timestamp === currentTs)
    if (isTempAudioEnabled) {
      if (matchIdx !== -1) {
        const initialFreq = temperatureToFrequency(dataset.data[matchIdx].value, stats.min, stats.max)
        ensureContinuousOscillator(initialFreq)
      } else {
        ensureContinuousOscillator(MIN_FREQUENCY_HZ)
      }
    }

    // 2. Wind Start
    if (isWindAudioEnabled && windDataset?.data) {
      const windPt = windDataset.data.find((d) => d.timestamp === currentTs) || null
      windAudioService.updateWind(windPt, 0.2)
    } else {
      windAudioService.stop(0.1)
    }

    // 3. Moisture Start (tprecmax + tqv)
    if (isMoistureAudioEnabled) {
      precipitationAudioService.updateMoisture(
        envPt?.tprecmax ?? null,
        envPt?.tqv ?? null,
        0.4,
      )
    } else {
      precipitationAudioService.stop(0.1)
    }

    // 4. Pressure Start (ps)
    if (isPressureAudioEnabled) {
      vegetationAudioService.updatePressure(envPt?.ps ?? null, 0.6)
    } else {
      vegetationAudioService.stop(0.1)
    }

    playbackTimerRef.current = setInterval(() => {
      stepIndex += 1

      // Check against timelineTimestamps inside the timer to pick up deletions
      if (stepIndex >= timelineTimestamps.length) {
        stopAudio()
        return
      }

      const ts    = timelineTimestamps[stepIndex]
      const ptIdx = dataset.data.findIndex((d) => d.timestamp === ts)
      const stepEnvPt = envDataset?.data?.find((d) => d.timestamp === ts) || null

      if (ptIdx === -1) {
        setTimestampIndex(stepIndex)
        return
      }

      setTimestampIndex(stepIndex)

      // Temperature advance
      if (isTempAudioEnabled) {
        const nextFreq = temperatureToFrequency(dataset.data[ptIdx].value, stats.min, stats.max)
        glideToFrequency(nextFreq, (PLAYBACK_STEP_MS * 0.85) / 1000)
      }

      // Wind advance
      if (isWindAudioEnabled && windDataset?.data) {
        const windPt = windDataset.data.find((d) => d.timestamp === ts) || null
        windAudioService.updateWind(windPt, (PLAYBACK_STEP_MS * 0.85) / 1000)
      } else {
        windAudioService.stop((PLAYBACK_STEP_MS * 0.85) / 1000)
      }

      // Moisture advance
      if (isMoistureAudioEnabled) {
        precipitationAudioService.updateMoisture(
          stepEnvPt?.tprecmax ?? null,
          stepEnvPt?.tqv ?? null,
          (PLAYBACK_STEP_MS * 0.85) / 1000,
        )
      } else {
        precipitationAudioService.stop((PLAYBACK_STEP_MS * 0.85) / 1000)
      }

      // Pressure advance
      if (isPressureAudioEnabled) {
        vegetationAudioService.updatePressure(stepEnvPt?.ps ?? null, (PLAYBACK_STEP_MS * 0.85) / 1000)
      } else {
        vegetationAudioService.stop((PLAYBACK_STEP_MS * 0.85) / 1000)
      }
    }, PLAYBACK_STEP_MS)
  }, [isPlaying, dataset, windDataset, envDataset, timelineTimestamps, safeIndex,
      stats.min, stats.max, isTempAudioEnabled, isWindAudioEnabled, isMoistureAudioEnabled, isPressureAudioEnabled,
      ensureContinuousOscillator, glideToFrequency, stopAudio])


  const handleToggleTempAudio = useCallback(() => {
    setIsTempAudioEnabled((prev) => {
      const next = !prev
      if (!next && gainRef.current && audioCtxRef.current) {
        const ctx = audioCtxRef.current
        gainRef.current.gain.cancelScheduledValues(ctx.currentTime)
        gainRef.current.gain.setValueAtTime(Math.max(0.0001, gainRef.current.gain.value), ctx.currentTime)
        gainRef.current.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.1)
      } else if (next && isPlaying && currentPoint) {
        const freq = temperatureToFrequency(currentPoint.value, stats.min, stats.max)
        glideToFrequency(freq, 0.2)
      }
      return next
    })
  }, [isPlaying, currentPoint, stats.min, stats.max, glideToFrequency])

  const handleToggleWindAudio = useCallback(() => {
    setIsWindAudioEnabled((prev) => {
      const next = !prev
      windAudioService.setEnabled(next)
      if (next && isPlaying && currentWindPoint) {
        windAudioService.updateWind(currentWindPoint, 0.2)
      }
      return next
    })
  }, [isPlaying, currentWindPoint])

  const handleToggleMoistureAudio = useCallback(() => {
    setIsMoistureAudioEnabled((prev) => {
      const next = !prev
      precipitationAudioService.setEnabled(next)
      if (next && isPlaying && currentEnvPoint) {
        precipitationAudioService.updateMoisture(
          currentEnvPoint.tprecmax ?? null,
          currentEnvPoint.tqv ?? null,
          0.2,
        )
      }
      return next
    })
  }, [isPlaying, currentEnvPoint])

  const handleTogglePressureAudio = useCallback(() => {
    setIsPressureAudioEnabled((prev) => {
      const next = !prev
      vegetationAudioService.setEnabled(next)
      if (next && isPlaying && currentEnvPoint) {
        vegetationAudioService.updatePressure(currentEnvPoint.ps ?? null, 0.3)
      }
      return next
    })
  }, [isPlaying, currentEnvPoint])


  // ═══════════════════════════════════════════════════════════════════════════
  // TIMESTAMP MANAGEMENT (TimestampPanel handlers)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Delete a single timestamp. If it's the current one, move to the
   * nearest remaining active timestamp.
   */
  const handleDeleteOne = useCallback((ts) => {
    setDeletedTimestamps((prev) => {
      const next = new Set(prev)
      next.add(ts)
      return next
    })

    // If the deleted timestamp is currently active, move pointer
    if (ts === activeTimestamp) {
      const remainingAfterDelete = activeTimestamps.filter((t) => t !== ts)
      if (remainingAfterDelete.length === 0) {
        stopAudio()
        setTimestampIndex(0)
      } else {
        // Move to the timestamp just before the deleted one (or 0 if first)
        const currentIdx = activeTimestamps.indexOf(ts)
        const newIdx = Math.max(0, currentIdx - 1)
        // Map newIdx to the remaining array
        const newTs = remainingAfterDelete[Math.min(newIdx, remainingAfterDelete.length - 1)]
        const newActiveIdx = activeTimestamps.indexOf(newTs)
        setTimestampIndex(Math.max(0, newActiveIdx))
      }
    }
  }, [activeTimestamp, activeTimestamps, stopAudio])

  /**
   * Delete multiple timestamps at once.
   */
  const handleDeleteSelected = useCallback((tsList) => {
    const toDeleteSet = new Set(tsList)
    setDeletedTimestamps((prev) => {
      const next = new Set(prev)
      tsList.forEach((ts) => next.add(ts))
      return next
    })

    // If current timestamp is among deleted, move pointer
    if (toDeleteSet.has(activeTimestamp)) {
      const remainingAfterDelete = activeTimestamps.filter((t) => !toDeleteSet.has(t))
      if (remainingAfterDelete.length === 0) {
        stopAudio()
        setTimestampIndex(0)
      } else {
        // Find nearest remaining before current
        const currentIdx = activeTimestamps.indexOf(activeTimestamp)
        let newTs = remainingAfterDelete[0]
        for (let i = currentIdx - 1; i >= 0; i--) {
          if (!toDeleteSet.has(activeTimestamps[i])) {
            newTs = activeTimestamps[i]
            break
          }
        }
        const newIdx = activeTimestamps.indexOf(newTs)
        setTimestampIndex(Math.max(0, newIdx))
      }
    }
  }, [activeTimestamp, activeTimestamps, stopAudio])

  /**
   * Restore all timestamps (clear deletions). Does not change committedConfig.
   */
  const handleRestore = useCallback(() => {
    setDeletedTimestamps(new Set())
    setTimestampIndex(Math.max(0, generatedTimestamps.length - 1))
  }, [generatedTimestamps])

  /**
   * Handle temporal config changes from TemporalControls sliders/selectors.
   * Only updates the draft — does NOT trigger any fetch or timestamp regeneration.
   * The user must click "Apply" to commit.
   */
  const handleTemporalConfigChange = useCallback((newConfig) => {
    setDraftConfig(newConfig)
  }, [])

  /**
   * Handle "Apply Changes" / "Refresh Data" button click.
   * Clears the in-memory grid cache so fresh data is fetched, then commits
   * the current draft config (triggering timestamp regeneration and a fetch).
   */
  const handleTemporalConfirm = useCallback(() => {
    clearGridCache()
    setCommittedConfig(draftConfig)
    stopAudio()
  }, [draftConfig, stopAudio])

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    return () => {
      stopAudio()
      windAudioService.dispose()
      precipitationAudioService.dispose()
      vegetationAudioService.dispose()
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {})
    }
  }, [stopAudio])


  // ═══════════════════════════════════════════════════════════════════════════
  // TIMESTAMP SELECTION (from sidebar)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Navigate to a specific timestamp by clicking it in the TimestampPanel sidebar.
   * Only works for timestamps that have observation data and are on the timeline.
   */
  const handleSelectTimestamp = useCallback((ts) => {
    const idx = timelineTimestamps.indexOf(ts)
    if (idx !== -1) handleTimelineChange(idx)
  }, [timelineTimestamps, handleTimelineChange])

  // ═══════════════════════════════════════════════════════════════════════════
  // FORMATTING HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function formatFullDateTime(isoString) {
    if (!isoString) return '—'
    const d = new Date(isoString)
    const day = d.getUTCDate()
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const month = months[d.getUTCMonth()]
    const year  = d.getUTCFullYear()
    const hh = String(d.getUTCHours()).padStart(2, '0')
    const mm = String(d.getUTCMinutes()).padStart(2, '0')
    return `${day} ${month} ${year} · ${hh}:${mm} UTC`
  }

  const isAtEnd = safeIndex >= timelineTimestamps.length - 1

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className={styles.appShell}>
      {/* ── Right Timestamp Panel ───────────────────────────────────────── */}
      <TimestampPanel
        temporalConfig={draftConfig}
        onTemporalConfigChange={handleTemporalConfigChange}
        onTemporalConfirm={handleTemporalConfirm}
        isDirty={isDirty}
        isTemporalLoading={localLoading}
        generatedTimestamps={generatedTimestamps}
        activeTimestamps={activeTimestamps}
        availableDatasetTimestamps={availableDatasetTimestamps}
        missingObservationsMap={missingObservationsMap}
        currentTimestamp={activeTimestamp}
        isOpen={panelOpen}
        onToggle={() => setPanelOpen((v) => !v)}
        onSelectTimestamp={handleSelectTimestamp}
        onDeleteOne={handleDeleteOne}
        onDeleteSelected={handleDeleteSelected}
        onRestore={handleRestore}
      />

      {/* ── Main Content (75% when panel open, 100% when closed) ─────────── */}
      <main
        className={`${styles.page} ${panelOpen ? styles.pageWithPanel : ''}`}
        aria-label="Earth Jukebox Explore"
      >
        {/* ── Navigation ──────────────────────────────────────────────────── */}
        <nav className={styles.nav}>
          <Link to="/" className={styles.navBack}>← Earth Jukebox</Link>
        </nav>

        {/* ── Location Title ──────────────────────────────────────────────── */}
        <header className={styles.header}>
          <h2 className={styles.locationTitle}>
            {dataset?.requestedLocation?.name || activeLocation.name}
          </h2>
        </header>

        {/* ── Loading State ────────────────────────────────────────────────── */}
        {localLoading && (
          <section className={styles.motherbox}>
            <p className={styles.statusMessage}>Loading NASA GEOS-FP data…</p>
          </section>
        )}

        {/* ── Error State ──────────────────────────────────────────────────── */}
        {!localLoading && localError && (
          <section className={styles.motherbox}>
            <p className={styles.errorMessage}>{localError.message}</p>
            <div className={styles.actionRow}>
              <button
                className={styles.btnPrimary}
                onClick={() => {
                  setProvider('geosfp')
                  setActiveLocation(DEFAULT_LOCATION)
                }}
              >
                Explore Dhaka NASA Dataset
              </button>
            </div>
          </section>
        )}

        {/* ── Empty Timestamp State ────────────────────────────────────────── */}
        {!localLoading && !localError && dataset && activeTimestamps.length === 0 && (
          <section className={styles.motherbox}>
            <p className={styles.statusMessage}>No timestamps selected.</p>
            <div className={styles.actionRow}>
              <button className={styles.btnPrimary} onClick={handleRestore}>
                ↺ Restore Timestamps
              </button>
            </div>
          </section>
        )}

        {/* ── All Timestamps Missing Observation Data State ──────────────── */}
        {!localLoading && !localError && dataset && activeTimestamps.length > 0 && timelineTimestamps.length === 0 && (
          <section className={styles.motherbox}>
            <p className={styles.statusMessage}>
              No observation data available in NASA datasets for the selected range.
            </p>
            <p className={styles.errorMessage} style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
              All requested timestamps are missing observation data. Check the sidebar list for details.
            </p>
          </section>
        )}

        {/* ── Unified Motherbox ────────────────────────────────────────────── */}
        {!localLoading && dataset && timelineTimestamps.length > 0 && (
          <section
            className={styles.motherbox}
            aria-label="Earth Jukebox global temperature and sonification instrument"
          >
            {/* ── Environmental System Tabs Bar (Phase 10) ─────────────────── */}
            <div className={styles.systemTabsBar} role="tablist" aria-label="Environmental System Visualizations">
              {ENVIRONMENTAL_TABS.map((tab) => {
                const isActive = activeSystemTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`tab-${tab.id}`}
                    aria-selected={isActive}
                    aria-controls={`tabpanel-${tab.id}`}
                    className={`${styles.systemTab} ${isActive ? styles.systemTabActive : ''}`}
                    onClick={() => setActiveSystemTab(tab.id)}
                  >
                    <span className={styles.tabSymbolBadge}>{tab.symbol}</span>
                    <div className={styles.tabTextGroup}>
                      <span className={styles.systemTabTitle}>{tab.label}</span>
                      <span className={styles.systemTabSubtitle}>{tab.subtitle}</span>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* ── TAB 1: TEMPERATURE SYSTEM (T2M + TS) ────────────────────── */}
            {activeSystemTab === 'temperature' && (
              <div id="tabpanel-temperature" role="tabpanel" aria-labelledby="tab-temperature">
                <div className={styles.motherboxHeader}>
                  <div className={styles.motherboxTitleRow}>
                    <h3 className={styles.motherboxTitle}>Temperature System — Air & Surface Skin Comparison</h3>
                    <DataInfoTooltip
                      label="Temperature system information"
                      rows={tempInfoRows}
                      align="right"
                    />
                  </div>
                  <div className={styles.motherboxMeta}>
                    NASA GEOS-FP · T2M & TS (°C) · Air Temperature owns Pitch; Surface Skin modifies Timbral Brightness
                  </div>
                </div>

                {/* Thermal Coupling / Difference Summary */}
                <div className={styles.systemSummaryBanner} style={{ marginTop: '0.65rem' }}>
                  <div className={styles.bannerMetricGroup}>
                    <span>Air (T₂ₘ): <strong>{currentPoint ? `${currentPoint.value.toFixed(1)}°C` : '—'}</strong></span>
                    <span>·</span>
                    <span>Surface Skin (Tₛ): <strong>{currentTsC != null ? `${currentTsC.toFixed(1)}°C` : '—'}</strong></span>
                  </div>
                  <div className={styles.bannerMetricGroup}>
                    <span>Surface Contrast:</span>
                    <span className={styles.bannerDiff}>ΔT = {deltaTString}</span>
                    <span className={styles.sonificationPill}>
                      {deltaT != null && deltaT > 2
                        ? 'Solar Ground Heating'
                        : deltaT != null && deltaT < -2
                        ? 'Surface Radiative Cooling'
                        : 'Equilibrated Boundary'}
                    </span>
                  </div>
                </div>

                <div className={styles.divider} style={{ margin: '1rem 0' }} />

                {/* Dual Column: T2M on Left, TS on Right */}
                <div className={styles.dualColumnGrid}>
                  {/* Card 1: T2M Air Temperature */}
                  <div className={styles.systemCard}>
                    <div className={styles.columnHeader}>
                      <span className={styles.columnTitle}>T2M — Near-Surface Air Temperature</span>
                      <span className={styles.locationTag}>● {shortLocationName}</span>
                    </div>
                    <GlobalScientificMap
                      variable="T2M"
                      grid={grids.T2M}
                      selectedLat={activeLocation.lat}
                      selectedLon={activeLocation.lng}
                      locationName={shortLocationName}
                      isLoading={Boolean(gridLoadings.T2M)}
                      error={gridErrors.T2M}
                    />
                    {currentPoint && (
                      <div className={styles.localReadout}>
                        <div className={styles.primaryTemp}>{currentPoint.value.toFixed(1)}°C</div>
                        <div className={styles.readoutDate}>{formatFullDateTime(currentPoint.timestamp)}</div>
                        <div className={styles.readoutFrequency}>
                          <span className={styles.freqValue}>{currentFrequency} Hz</span>
                          <span className={styles.freqLabel}>Primary mapped pitch (frozen formula)</span>
                        </div>
                      </div>
                    )}
                    <div className={styles.chartContainer}>
                      <ScientificTimeSeriesGraph
                        data={chartData}
                        unit="°C"
                        label="Air Temperature"
                        activeIndex={activeT2mIndex}
                        onSelectPoint={(_, idx) => handleSelectChartPointByTimestamp(chartData[idx]?.timestamp)}
                      />
                    </div>
                  </div>

                  {/* Card 2: TS Surface Skin Temperature */}
                  <div className={styles.systemCard}>
                    <div className={styles.columnHeader}>
                      <span className={styles.columnTitle}>TS — Surface Skin Temperature</span>
                      <span className={styles.coordsTag}>Thermal Diff: {deltaTString}</span>
                    </div>
                    <GlobalScientificMap
                      variable="TS"
                      grid={grids.TS}
                      selectedLat={activeLocation.lat}
                      selectedLon={activeLocation.lng}
                      locationName={shortLocationName}
                      isLoading={Boolean(gridLoadings.TS)}
                      error={gridErrors.TS}
                    />
                    <div className={styles.localReadout}>
                      <div className={styles.primaryTemp}>
                        {currentTsC != null ? `${currentTsC.toFixed(1)}°C` : '—'}
                      </div>
                      <div className={styles.readoutDate}>
                        {currentEnvPoint ? formatFullDateTime(currentEnvPoint.timestamp) : (activeTimestamp ? formatFullDateTime(activeTimestamp) : '—')}
                      </div>
                      <div className={styles.readoutFrequency}>
                        <span className={styles.freqValue}>{deltaTString} (Ts − T2m)</span>
                        <span className={styles.freqLabel}>Timbral brightness modifier · No independent pitch</span>
                      </div>
                    </div>
                    <div className={styles.chartContainer}>
                      <ScientificTimeSeriesGraph
                        data={tsChartData}
                        unit="°C"
                        label="Surface Skin Temp"
                        activeIndex={activeTsIndex}
                        onSelectPoint={(_, idx) => handleSelectChartPointByTimestamp(tsChartData[idx]?.timestamp)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB 2: WIND SYSTEM (U10M + V10M) ────────────────────────── */}
            {activeSystemTab === 'wind' && (
              <div id="tabpanel-wind" role="tabpanel" aria-labelledby="tab-wind">
                <div className={styles.motherboxHeader}>
                  <div className={styles.motherboxTitleRow}>
                    <h3 className={styles.motherboxTitle}>Wind System — 10-Meter Wind Speed & Direction</h3>
                    <DataInfoTooltip
                      label="Wind system information"
                      rows={windInfoRows}
                      align="right"
                    />
                  </div>
                  <div className={styles.motherboxMeta}>
                    NASA GEOS-FP · 10 m wind vector (U10M, V10M) · Speed controls Loudness; Direction controls Stereo Pan
                  </div>
                </div>

                {/* Wind Summary Banner */}
                <div className={styles.systemSummaryBanner} style={{ marginTop: '0.65rem' }}>
                  <div className={styles.bannerMetricGroup}>
                    <span>Speed: <strong>{currentWindPoint?.speed != null ? `${currentWindPoint.speed.toFixed(1)} m/s` : '—'}</strong></span>
                    <span>·</span>
                    <span>Direction: <strong>{currentWindPoint?.direction != null ? `${Math.round(currentWindPoint.direction)}° ${currentWindPoint.cardinal}` : '—'}</strong></span>
                  </div>
                  <div className={styles.bannerMetricGroup}>
                    <span className={styles.sonificationPill}>
                      {currentWindPoint?.direction != null
                        ? Math.sin((currentWindPoint.direction * Math.PI) / 180) > 0.1
                          ? 'Stereo Right'
                          : Math.sin((currentWindPoint.direction * Math.PI) / 180) < -0.1
                          ? 'Stereo Left'
                          : 'Stereo Center'
                        : 'Stereo Center'}
                    </span>
                    <span className={styles.sonificationPill}>
                      {currentWindPoint?.speed != null && currentWindPoint.speed < 1.5
                        ? 'Calm Breeze'
                        : currentWindPoint?.speed != null && currentWindPoint.speed > 10
                        ? 'High Intensity Wind'
                        : 'Moderate Flow'}
                    </span>
                  </div>
                </div>

                <div className={styles.divider} style={{ margin: '1rem 0' }} />

                {/* Two-Column: Map on Left, Compass & Chart on Right */}
                <div className={styles.instrumentBody}>
                  {/* Left Column: Global Vector & Speed Raster Map */}
                  <div className={styles.mapColumn}>
                    <div className={styles.columnHeader}>
                      <span className={styles.columnTitle}>Global 10-Meter Wind Field & Vector Overlay</span>
                      <span className={styles.locationTag}>● {shortLocationName}</span>
                    </div>
                    <GlobalScientificMap
                      variable="WIND"
                      grid={grids.WIND}
                      selectedLat={activeLocation.lat}
                      selectedLon={activeLocation.lng}
                      locationName={shortLocationName}
                      isLoading={Boolean(gridLoadings.WIND)}
                      error={gridErrors.WIND}
                    />
                  </div>

                  {/* Right Column: Local Wind Compass, Readout, and Chart */}
                  <div className={styles.localColumn}>
                    <div className={styles.columnHeader}>
                      <span className={styles.columnTitle}>Local Wind Vector Compass</span>
                      {activeLocation.lat != null && activeLocation.lng != null && (
                        <span className={styles.coordsTag}>
                          {Math.abs(activeLocation.lat).toFixed(4)}° {activeLocation.lat >= 0 ? 'N' : 'S'} ·{' '}
                          {Math.abs(activeLocation.lng).toFixed(4)}° {activeLocation.lng >= 0 ? 'E' : 'W'}
                        </span>
                      )}
                    </div>

                    <WindVisualization
                      point={currentWindPoint}
                      isLoading={windLoading}
                      error={windError}
                      onRetry={fetchWindSeries}
                    />

                    <div className={styles.localReadout}>
                      <div className={styles.primaryTemp}>
                        {currentWindPoint?.speed != null ? `${currentWindPoint.speed.toFixed(1)} m/s` : '—'}
                      </div>
                      <div className={styles.readoutDate}>
                        {currentWindPoint ? formatFullDateTime(currentWindPoint.timestamp) : (activeTimestamp ? formatFullDateTime(activeTimestamp) : '—')}
                      </div>
                      <div className={styles.readoutFrequency}>
                        <span className={styles.freqValue}>
                          {currentWindPoint?.direction != null ? `${Math.round(currentWindPoint.direction)}° ${currentWindPoint.cardinal}` : (currentWindPoint?.cardinal || '—')}
                        </span>
                        <span className={styles.freqLabel}>Meteorological direction (from which wind blows)</span>
                      </div>
                    </div>

                    <div className={styles.chartContainer}>
                      <WindChart
                        data={windChartData}
                        activeIndex={windChartActiveIndex}
                        onSelectPoint={(_, idx) => {
                          const pt = windChartData[idx]
                          if (!pt) return
                          handleSelectChartPointByTimestamp(pt.timestamp)
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB 3: PRECIPITATION SYSTEM (TPRECMAX + TQV) ─────────────── */}
            {activeSystemTab === 'precipitation' && (
              <div id="tabpanel-precipitation" role="tabpanel" aria-labelledby="tab-precipitation">
                <div className={styles.motherboxHeader}>
                  <div className={styles.motherboxTitleRow}>
                    <h3 className={styles.motherboxTitle}>Precipitation & Moisture System — Rain Rate & Water Vapor</h3>
                    <DataInfoTooltip
                      label="Precipitation system information"
                      rows={precipInfoRows}
                      align="right"
                    />
                  </div>
                  <div className={styles.motherboxMeta}>
                    NASA GEOS-FP · TPRECMAX (mm/h) & TQV (kg/m²) · Controls Rain Droplet Density & Atmospheric Timbre
                  </div>
                </div>

                {/* Moisture Summary Banner */}
                <div className={styles.systemSummaryBanner} style={{ marginTop: '0.65rem' }}>
                  <div className={styles.bannerMetricGroup}>
                    <span>Precipitation Rate: <strong>{currentPrecipMmHr.toFixed(1)} mm/h</strong></span>
                    <span>·</span>
                    <span>Column Water Vapor: <strong>{currentEnvPoint?.tqv != null ? `${currentEnvPoint.tqv.toFixed(1)} kg/m²` : '—'}</strong></span>
                  </div>
                  <div className={styles.bannerMetricGroup}>
                    <span className={styles.sonificationPill}>{precipIntensityLabel(currentPrecipMmHr)}</span>
                    <span className={styles.sonificationPill}>{tqvLabel(currentEnvPoint?.tqv)}</span>
                  </div>
                </div>

                <div className={styles.divider} style={{ margin: '1rem 0' }} />

                {/* Dual Column: TPRECMAX on Left, TQV on Right */}
                <div className={styles.dualColumnGrid}>
                  {/* Card 1: TPRECMAX Precipitation */}
                  <div className={styles.systemCard}>
                    <div className={styles.columnHeader}>
                      <span className={styles.columnTitle}>TPRECMAX — Total Precipitation Rate</span>
                      <span className={styles.locationTag}>● {shortLocationName}</span>
                    </div>
                    <GlobalScientificMap
                      variable="TPRECMAX"
                      grid={grids.TPRECMAX}
                      selectedLat={activeLocation.lat}
                      selectedLon={activeLocation.lng}
                      locationName={shortLocationName}
                      isLoading={Boolean(gridLoadings.TPRECMAX)}
                      error={gridErrors.TPRECMAX}
                    />
                    <div className={styles.localReadout}>
                      <div className={styles.primaryTemp}>
                        {currentPrecipMmHr < 0.1 && currentPrecipMmHr > 0 ? '< 0.1 mm/h' : `${currentPrecipMmHr.toFixed(1)} mm/h`}
                      </div>
                      <div className={styles.readoutDate}>
                        {currentEnvPoint ? formatFullDateTime(currentEnvPoint.timestamp) : (activeTimestamp ? formatFullDateTime(activeTimestamp) : '—')}
                      </div>
                      <div className={styles.readoutFrequency}>
                        <span className={styles.freqValue}>{precipIntensityLabel(currentPrecipMmHr)}</span>
                        <span className={styles.freqLabel}>Rain droplet texture & density (gain controller)</span>
                      </div>
                    </div>
                    <div className={styles.chartContainer}>
                      <ScientificTimeSeriesGraph
                        data={tprecmaxChartData}
                        unit="mm/h"
                        label="Precipitation Rate"
                        activeIndex={activePrecipIndex}
                        onSelectPoint={(_, idx) => handleSelectChartPointByTimestamp(tprecmaxChartData[idx]?.timestamp)}
                      />
                    </div>
                  </div>

                  {/* Card 2: TQV Precipitable Water Vapor */}
                  <div className={styles.systemCard}>
                    <div className={styles.columnHeader}>
                      <span className={styles.columnTitle}>TQV — Total Precipitable Water Vapor</span>
                      <span className={styles.coordsTag}>Column Mass</span>
                    </div>
                    <GlobalScientificMap
                      variable="TQV"
                      grid={grids.TQV}
                      selectedLat={activeLocation.lat}
                      selectedLon={activeLocation.lng}
                      locationName={shortLocationName}
                      isLoading={Boolean(gridLoadings.TQV)}
                      error={gridErrors.TQV}
                    />
                    <div className={styles.localReadout}>
                      <div className={styles.primaryTemp}>
                        {currentEnvPoint?.tqv != null ? `${currentEnvPoint.tqv.toFixed(1)} kg/m²` : '—'}
                      </div>
                      <div className={styles.readoutDate}>
                        {currentEnvPoint ? formatFullDateTime(currentEnvPoint.timestamp) : (activeTimestamp ? formatFullDateTime(activeTimestamp) : '—')}
                      </div>
                      <div className={styles.readoutFrequency}>
                        <span className={styles.freqValue}>{tqvLabel(currentEnvPoint?.tqv)}</span>
                        <span className={styles.freqLabel}>Atmospheric moisture resonance & warmth</span>
                      </div>
                    </div>
                    <div className={styles.chartContainer}>
                      <ScientificTimeSeriesGraph
                        data={tqvChartData}
                        unit="kg/m²"
                        label="Water Vapor"
                        activeIndex={activeTqvIndex}
                        onSelectPoint={(_, idx) => handleSelectChartPointByTimestamp(tqvChartData[idx]?.timestamp)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── TAB 4: PRESSURE SYSTEM (PS) ─────────────────────────────── */}
            {activeSystemTab === 'pressure' && (
              <div id="tabpanel-pressure" role="tabpanel" aria-labelledby="tab-pressure">
                <div className={styles.motherboxHeader}>
                  <div className={styles.motherboxTitleRow}>
                    <h3 className={styles.motherboxTitle}>Pressure System — Atmospheric Surface Pressure</h3>
                    <DataInfoTooltip
                      label="Pressure system information"
                      rows={pressureInfoRows}
                      align="right"
                    />
                  </div>
                  <div className={styles.motherboxMeta}>
                    NASA GEOS-FP · PS (hPa) · Experimental Atmospheric Timbre (Low-shelf boost & damping)
                  </div>
                </div>

                {/* Pressure Summary Banner */}
                <div className={styles.systemSummaryBanner} style={{ marginTop: '0.65rem' }}>
                  <div className={styles.bannerMetricGroup}>
                    <span>Surface Pressure: <strong>{currentPsHpa != null ? `${currentPsHpa.toFixed(1)} hPa` : '—'}</strong></span>
                    <span>·</span>
                    <span>Standard Reference: <strong>1013.25 hPa</strong></span>
                  </div>
                  <div className={styles.bannerMetricGroup}>
                    <span>Anomaly:</span>
                    <span className={styles.bannerDiff}>{psAnomalyString}</span>
                    <span className={styles.sonificationPill}>{psCategory(currentPsHpa)}</span>
                  </div>
                </div>

                <div className={styles.divider} style={{ margin: '1rem 0' }} />

                {/* Two-Column: Map on Left, Readout & Chart on Right */}
                <div className={styles.instrumentBody}>
                  {/* Left Column: Global Pressure Map */}
                  <div className={styles.mapColumn}>
                    <div className={styles.columnHeader}>
                      <span className={styles.columnTitle}>Global Atmospheric Surface Pressure</span>
                      <span className={styles.locationTag}>● {shortLocationName}</span>
                    </div>
                    <GlobalScientificMap
                      variable="PS"
                      grid={grids.PS}
                      selectedLat={activeLocation.lat}
                      selectedLon={activeLocation.lng}
                      locationName={shortLocationName}
                      isLoading={Boolean(gridLoadings.PS)}
                      error={gridErrors.PS}
                    />
                  </div>

                  {/* Right Column: Local Pressure Time Series & Readout */}
                  <div className={styles.localColumn}>
                    <div className={styles.columnHeader}>
                      <span className={styles.columnTitle}>Local Surface Pressure & Anomaly</span>
                      {activeLocation.lat != null && activeLocation.lng != null && (
                        <span className={styles.coordsTag}>
                          {Math.abs(activeLocation.lat).toFixed(4)}° {activeLocation.lat >= 0 ? 'N' : 'S'} ·{' '}
                          {Math.abs(activeLocation.lng).toFixed(4)}° {activeLocation.lng >= 0 ? 'E' : 'W'}
                        </span>
                      )}
                    </div>

                    <div className={styles.localReadout}>
                      <div className={styles.primaryTemp}>
                        {currentPsHpa != null ? `${currentPsHpa.toFixed(1)} hPa` : '—'}
                      </div>
                      <div className={styles.readoutDate}>
                        {currentEnvPoint ? formatFullDateTime(currentEnvPoint.timestamp) : (activeTimestamp ? formatFullDateTime(activeTimestamp) : '—')}
                      </div>
                      <div className={styles.readoutFrequency}>
                        <span className={styles.freqValue}>{psAnomalyString} from 1013.25 hPa</span>
                        <span className={styles.freqLabel}>Experimental timbre modifier · Low-shelf character</span>
                      </div>
                    </div>

                    <div className={styles.chartContainer}>
                      <ScientificTimeSeriesGraph
                        data={psChartData}
                        unit="hPa"
                        label="Surface Pressure"
                        activeIndex={activePsIndex}
                        onSelectPoint={(_, idx) => handleSelectChartPointByTimestamp(psChartData[idx]?.timestamp)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className={styles.divider} />

            {/* ── Shared Timeline ──────────────────────────────────────────── */}
            <div className={styles.timelineSection} aria-label="Shared observation timeline">
              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>Earlier</span>
                <div className={styles.sliderTrack}>
                  <input
                    type="range"
                    className={styles.slider}
                    min={0}
                    max={Math.max(0, timelineTimestamps.length - 1)}
                    step={1}
                    value={safeIndex}
                    onChange={(e) => handleTimelineChange(parseInt(e.target.value, 10))}
                    aria-label="Observation timeline slider"
                    aria-valuetext={formatFullDateTime(activeTimestamp)}
                    disabled={timelineTimestamps.length <= 1}
                  />
                </div>
                <span className={styles.sliderLabel}>Latest</span>
              </div>

              <div
                className={styles.timelineTimestamp}
                aria-label={`Current observation: ${temporal.humanDate} · ${temporal.timeString}`}
              >
                <span className={styles.timelineDateLabel}>{temporal.humanDate}</span>
                <span className={styles.timelineSeparator}>·</span>
                <span className={styles.timelineTimeLabel}>{temporal.timeString}</span>
              </div>
            </div>

            {/* ── Playback Controls ────────────────────────────────────────── */}
            <div className={styles.playbackRow}>
              <button
                className={styles.btnPlay}
                onClick={handleTogglePlayback}
                aria-label={isPlaying ? 'Pause' : isAtEnd ? 'Replay' : 'Play'}
              >
                {isPlaying ? '❚❚ PAUSE' : isAtEnd ? '↺ REPLAY' : '▶ PLAY'}
              </button>

              {/* ── Audio Channel Layers (Phase 9) ─────────────────────────── */}
              <div className={styles.audioChannelsWrapper}>
                <span className={styles.audioChannelsLabel}>Audio Layers:</span>
                <button
                  type="button"
                  className={`${styles.audioChannelBtn} ${isTempAudioEnabled ? styles.audioChannelActive : ''}`}
                  onClick={handleToggleTempAudio}
                  aria-pressed={isTempAudioEnabled}
                  title="Toggle Temperature Pitch Audio Layer"
                >
                  <span className={styles.channelLed} />
                  Temperature (Pitch)
                </button>
                <button
                  type="button"
                  className={`${styles.audioChannelBtn} ${isWindAudioEnabled ? styles.audioChannelActive : ''}`}
                  onClick={handleToggleWindAudio}
                  aria-pressed={isWindAudioEnabled}
                  title="Toggle Wind Noise Texture Audio Layer"
                >
                  <span className={styles.channelLed} />
                  Wind (Texture & Pan)
                </button>
                <button
                  type="button"
                  className={`${styles.audioChannelBtn} ${isMoistureAudioEnabled ? styles.audioChannelActive : ''}`}
                  onClick={handleToggleMoistureAudio}
                  aria-pressed={isMoistureAudioEnabled}
                  title="Toggle Moisture (Rain + Atmosphere) Audio Layer"
                >
                  <span className={styles.channelLed} />
                  Moisture (Rain + Air)
                </button>
                <button
                  type="button"
                  className={`${styles.audioChannelBtn} ${isPressureAudioEnabled ? styles.audioChannelActive : ''}`}
                  onClick={handleTogglePressureAudio}
                  aria-pressed={isPressureAudioEnabled}
                  title="Toggle Pressure Experimental Timbre Audio Layer"
                >
                  <span className={styles.channelLed} />
                  Pressure (Experimental)
                </button>
              </div>


              <button
                className={styles.btnSecondaryText}
                onClick={() => setProvider(provider === 'mock' ? 'geosfp' : 'mock')}
              >
                {provider === 'mock' ? 'Use NASA GEOS-FP' : 'Test Mock Data'}
              </button>
            </div>
          </section>
        )}

        {/* ── Environmental State Panel (Phase 9) ───────────────────────────── */}
        {/* Displays all four GEOS-FP environmental systems at the active timestamp */}
        <EnvironmentalPanel
          envPoint={currentEnvPoint}
          windPoint={currentWindPoint}
          temperaturePoint={currentPoint}
          timestamp={temporal.humanDate + ' · ' + temporal.timeString}
          isLoading={_envLoading}
        />
      </main>
    </div>
  )
}
