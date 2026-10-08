import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getSstMetadata, getSstFrame, getSstSync, getSstPreviewUrl } from '../api/sstApi'
import styles from './SstTestPage.module.css'

export default function SstTestPage() {
  const [selectedDate, setSelectedDate] = useState('2024-04-18')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  const [metadata, setMetadata] = useState(null)
  const [frameData, setFrameData] = useState(null)
  const [syncData, setSyncData] = useState(null)

  // Fetch baseline dataset metadata on mount
  useEffect(() => {
    getSstMetadata()
      .then((data) => setMetadata(data))
      .catch((err) => console.warn('Could not load SVS metadata:', err))
  }, [])

  const handleLoad = async (dateToLoad = selectedDate) => {
    setLoading(true)
    setError(null)

    try {
      const [frameRes, syncRes] = await Promise.all([
        getSstFrame(dateToLoad),
        getSstSync(dateToLoad),
      ])
      setFrameData(frameRes)
      setSyncData(syncRes)
    } catch (err) {
      setError(err.message || 'Failed to load SST frame data.')
    } finally {
      setLoading(false)
    }
  }

  // Load default on initial render
  useEffect(() => {
    handleLoad('2024-04-18')
  }, [])

  const selectPreset = (dateStr) => {
    setSelectedDate(dateStr)
    handleLoad(dateStr)
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className={styles.title}>Phase 5A: NASA EIC SST Investigation Prototype</h1>
            <p className={styles.subtitle}>
              NASA SVS #5101 Sea Surface Temperature (MUR SST) &times; NASA GEOS-FP Synchronization
            </p>
          </div>
          <Link to="/" style={{ color: '#38bdf8', textDecoration: 'none', fontSize: '0.9rem' }}>
            &larr; Back to Earth Jukebox Home
          </Link>
        </div>
      </header>

      {/* Scientific Distinction Rule Banner */}
      <section className={styles.distinctionBanner}>
        <h3>
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Scientific Data Distinction Rule
        </h3>
        <p style={{ margin: 0, fontSize: '0.9rem' }}>
          NASA GEOS-FP T2M and NASA EIC/SVS MUR SST represent completely distinct physical domains in the Earth system.
          They must not be conflated or treated as interchangeable.
        </p>
        <div className={styles.distinctionGrid}>
          <div className={styles.distinctionCard}>
            <strong>NASA GEOS-FP (T2M)</strong>
            <p>Interactive atmospheric near-surface air temperature (at 2 meters above ground/sea). Finer temporal resolution (3-hourly or hourly).</p>
          </div>
          <div className={styles.distinctionCard}>
            <strong>NASA EIC / SVS #5101 (MUR SST)</strong>
            <p>Visual storytelling layer showing ocean sea-surface water temperature. Coarser daily resolution (1 equirectangular global frame per calendar day).</p>
          </div>
        </div>
      </section>

      {/* Date Controls */}
      <section className={styles.controlsCard}>
        <div className={styles.controlsRow}>
          <div className={styles.dateInputGroup}>
            <label htmlFor="sst-date-input">Date:</label>
            <input
              id="sst-date-input"
              type="date"
              className={styles.dateInput}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <button
            className={styles.loadButton}
            onClick={() => handleLoad(selectedDate)}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Load SST'}
          </button>
        </div>

        <div className={styles.presetButtons}>
          <span className={styles.presetLabel}>Representative Test Dates:</span>
          <button
            className={styles.presetBtn}
            onClick={() => selectPreset('2024-04-18')}
          >
            Earliest (2024-04-18)
          </button>
          <button
            className={styles.presetBtn}
            onClick={() => selectPreset('2025-06-15')}
          >
            Middle (2025-06-15)
          </button>
          <button
            className={styles.presetBtn}
            onClick={() => selectPreset('2026-10-05')}
          >
            Latest (2026-10-05)
          </button>
          <button
            className={styles.presetBtn}
            onClick={() => selectPreset('2023-12-31')}
          >
            Unavailable / Pre-Start (2023-12-31)
          </button>
          <button
            className={styles.presetBtn}
            onClick={() => selectPreset('2027-01-01')}
          >
            Unavailable / Post-End (2027-01-01)
          </button>
        </div>
      </section>

      {error && <div className={styles.errorBanner}>{error}</div>}

      {frameData?.note && (
        <div className={styles.warningBanner}>
          <strong>Availability Notice:</strong> {frameData.note}
        </div>
      )}

      {frameData && (
        <div className={styles.mainGrid}>
          {/* Visual Frame Card */}
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>NASA SVS #5101 Frame Visualization</h2>
            
            <div className={styles.imageContainer}>
              <img
                src={getSstPreviewUrl(frameData.actualDate)}
                alt={`NASA SST Frame for ${frameData.actualDate}`}
                className={styles.frameImage}
              />
              <div className={styles.imageOverlay}>
                Equirectangular Preview (1024 &times; 512) &bull; Native: {frameData.frame.width} &times; {frameData.frame.height}
              </div>
            </div>

            <div className={styles.metaGrid}>
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Selected Date</div>
                <div className={styles.metaValue}>{frameData.requestedDate}</div>
              </div>
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Actual NASA Frame Date</div>
                <div className={styles.metaValue} style={{ color: frameData.isAvailable ? '#4ade80' : '#facc15' }}>
                  {frameData.actualDate} {frameData.isAvailable ? '(Exact Match)' : '(Nearest Clamped)'}
                </div>
              </div>
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Frame Number</div>
                <div className={styles.metaValue}>#{frameData.frameNumber} of {metadata?.frameCount || 901}</div>
              </div>
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Native Resolution</div>
                <div className={styles.metaValue}>{frameData.frame.width} &times; {frameData.frame.height} (OpenEXR)</div>
              </div>
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Dataset Source</div>
                <div className={styles.metaValue}>{frameData.source.name} ({frameData.source.dataset})</div>
              </div>
              <div className={styles.metaItem}>
                <div className={styles.metaLabel}>Authoritative NASA Asset URL</div>
                <div className={styles.metaValue}>
                  <a
                    href={frameData.frame.url}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.metaValueLink}
                  >
                    {frameData.frame.filename}
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* GEOS-FP Synchronization Card */}
          {syncData && (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>GEOS-FP Synchronization Mapping</h2>
              <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: '#cbd5e1' }}>
                Establishes the temporal correspondence between the daily SST visual frame ({syncData.visualDate})
                and the calendar-day observations in the active NASA GEOS-FP dataset.
              </p>

              <div className={styles.metaGrid}>
                <div className={styles.metaItem}>
                  <div className={styles.metaLabel}>Calendar Day</div>
                  <div className={styles.metaValue}>{syncData.visualDate}</div>
                </div>
                <div className={styles.metaItem}>
                  <div className={styles.metaLabel}>Atmospheric Dataset</div>
                  <div className={styles.metaValue}>{syncData.temperature.dataset} ({syncData.temperature.variable})</div>
                </div>
                <div className={styles.metaItem}>
                  <div className={styles.metaLabel}>GEOS-FP Resolution</div>
                  <div className={styles.metaValue}>{syncData.temperature.temporalResolution} (8 observations / day)</div>
                </div>
                <div className={styles.metaItem}>
                  <div className={styles.metaLabel}>Observation Window</div>
                  <div className={styles.metaValue}>{syncData.temperature.availableStart} &rarr; {syncData.temperature.availableEnd}</div>
                </div>
              </div>

              <div style={{ marginTop: '1rem' }}>
                <div className={styles.metaLabel}>Observations for {syncData.visualDate}</div>
                <div className={styles.timestampsGrid}>
                  {syncData.temperature.timestamps.map((ts) => (
                    <div key={ts} className={styles.timestampPill}>
                      {ts}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: '1.25rem' }}>
                <div className={styles.metaLabel}>Synchronization Metadata Object (Contract)</div>
                <pre className={styles.jsonViewer}>
                  {JSON.stringify(syncData, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
