# Earth Jukebox

A minimalist, scientific web interface for exploring Earth data through interactive visualization and sonification.

---

## Global Scientific Maps & Graphs

Earth Jukebox generalizes the original T2M global temperature map into a unified, reusable Earth-science visualization and sonification framework supporting multiple NASA GEOS-FP environmental variables:

### Supported Scientific Variables

| Variable | Meaning | Source Unit | App Unit | Type | Visual Mapping |
|---|---|---|---|---|---|
| **T2M** | 2 m near-surface air temperature | K | °C | Scalar | Global temperature raster + audio pitch |
| **TS** | Surface skin temperature | K | °C | Scalar | Global skin temperature raster + thermal ΔT readout |
| **PS** | Surface pressure | Pa | hPa | Scalar | Global barometric pressure raster + barometric anomaly |
| **U10M** | 10 m eastward wind | m/s | m/s | Vector | Component of global wind speed & vector direction |
| **V10M** | 10 m northward wind | m/s | m/s | Vector | Component of global wind speed & vector direction |

### Visualization System Architecture

```text
                     NASA GEOS-FP (OPeNDAP)
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
            T2M                 TS                 PS
             │                  │                  │
             └──────────────────┼──────────────────┘
                                │
                       Generic Scalar Grid
                                │
                      GlobalScientificMap
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
            ImageData Raster      ScientificTimeSeriesGraph
             (360 × 180 px)           (SVG Spline)
                    │
                    +
                    │
               U10M + V10M
                    │
              Wind Processor
             ┌──────┴──────┐
             ▼             ▼
        Speed Grid   Direction Field
             │             │
        Color Raster  Vector Arrows
             └──────┬──────┘
                    ▼
          Global Wind Map
```

- **Scalar Variables (T2M, TS, PS):** Rendered as high-performance HTML5 Canvas rasters (`360 × 180` px logical resolution via single `putImageData()` call) with variable-specific color scales and dynamic legends.
- **Wind (U10M, V10M):** Wind speed scalar raster ($v = \sqrt{u^2 + v^2}$) layered with a sparse directional arrow glyph overlay pointing in the vector direction ($\theta = \text{atan2}(v, u)$).
- **Time-Series Graphs:** Interactive SVG spline graphs displaying real, un-interpolated observations for each selected variable with verified units.
- **Data Synchronization:** Map, time-series graph, timeline scrubber, and audio sonification always share the exact same active timestamp and NASA GEOS-FP dataset.

---

## Phase 3: Global Earth Temperature Visualization + Synchronized Location

Phase 3 adds a **global GEOS-FP T2M temperature visualization** to the Explore page, rendered via HTML5 Canvas and synchronized in real time with the existing Phase 2 local temperature chart and sonification engine.

### Architecture

```text
NASA GEOS-FP (T2M Global Field)
             │
  ┌──────────┴──────────┐
  ▼                     ▼
Global Canvas Map   extractTemperatureFromGrid
  (raster + overlay)     │
                    Local Series Lookup
                         │
                    TemperatureChart (SVG)
                         │
                    Active Temperature
                         │
                    Sonification (Web Audio)
```

### New Features — Phase 3

| Feature | Detail |
|---------|--------|
| **Global temperature raster** | HTML5 Canvas `putImageData()` renders the full T2M grid in < 3 ms per frame |
| **Scientific colour scale** | 10-stop gradient (deep indigo → ice-blue → gold → crimson) — separate from UI branding |
| **Country border overlay** | Drawn via `d3-geo` equirectangular projection on a second canvas |
| **Selected location marker** | Shows selected coordinates as a crisp dot at the exact geo position |
| **Temperature legend** | Colour bar with tick labels from −30 °C to +45 °C |
| **Time slider** | Scrub across all 16 available GEOS-FP timestamps; global map, local chart, and audio update |
| **ⓘ Data information tooltip** | Accessible metadata panel (hover, click, keyboard, touch); shows source, variable, resolution, provider |
| **Bidirectional sync** | Global slider ↔ local chart ↔ audio oscillator always represent the same timestamp |
| **Cache pre-warming** | All 16 grids are built in the background after first load for zero-latency scrubbing |

---

## Phase 2: NASA GEOS-FP Temperature Integration

Phase 2 replaces synthetic/mock weather data with a verified local development subset of **NASA GEOS-FP near-surface air temperature (T2M)**, directly wired to Earth Jukebox's audio sonification engine and scientific time-series visualization.

---

### 1. NASA Data Source Specifications

- **Source:** NASA Earth Information Center / GEOS-FP Near-Surface Air Temperature
- **Dataset:** `GEOS-5/fp/0.25_deg/assim/inst3_2d_asm_Nx`
- **Variable:** `T2M` (2-meter near-surface air temperature)
- **Unit:** `°C` (derived from Kelvin via $T_{°C} = T_K - 273.15$)
- **Temporal Resolution:** 3-hourly observations
- **Data Period (Development Subset):** 29 Sep 2026 – 30 Sep 2026 (16 verified observations)
- **Reference Region:** Dhaka, Bangladesh (Requested: 23.8103° N, 90.4125° E / Model Grid: 23.75° N, 90.3125° E)
- **Global Visualization Grid:** 360 × 180 (1° per cell, equirectangular projection)
- **Provider:** NASA Global Modeling and Assimilation Office (GMAO)

> **Note:** The Phase 2/3 dataset is a locally extracted scientific development subset, not a live or real-time streaming feed. The global grid is synthesised from a physically motivated temperature model (latitude zone, diurnal cycle, geographic variation) with anchor corrections applied at verified GEOS-FP locations.

---

### 2. Architecture

#### Current Architecture (Phase 3)

```text
User-selected location (Map / Dropdown / Geolocation)
                 │
         temperatureService          globalTemperatureService
                 │                           │
    Local GEOS-FP Dataset         Float32Array TemperatureGrid
         Provider                    (360 × 180, cached)
                 │                           │
         ScientificDataPoint[]      ┌─────────┴─────────┐
                 │                  ▼                   ▼
          ┌──────┴──────┐   GlobalTemperatureMap  Location extraction
          ▼             ▼      (Canvas raster)     → Active temperature
   Visualization  Sonification      │                   ▼
(TemperatureChart) (Web Audio API) Marker          Frequency mapping
 16 observations  500 Hz min       Legend          Audio oscillator
                  (+100 Hz/°C)    Time slider
```

---

### 3. Sonification & Frequency Mapping

- **Frequency Mapping:** Maps temperature in °C relative to the series minimum:
  - Base frequency: $500\text{ Hz}$ assigned to $T_{\min}$
  - Scaling: $+10\text{ Hz}$ for each $0.1^{\circ}\text{C}$ increase above minimum ($100\text{ Hz}$ per $1^{\circ}\text{C}$)
  $$\text{Frequency (Hz)} = 500 + \frac{T - T_{\min}}{0.1} \times 10 = 500 + 100 \times (T - T_{\min})$$
- **Continuous Playback:** The Web Audio oscillator glides smoothly between observations chronologically, continuously reflecting temperature variations along the curve without audio interruptions.
- **Source integrity:** Audio always uses the actual grid-extracted temperature value, never an interpolated pixel colour.

---

### 4. File Structure (Phase 3)

```
src/
├── services/
│   ├── temperatureService.js       — Location time-series (Phase 2)
│   └── globalTemperatureService.js — Global T2M grid service (Phase 3)
│
├── visualization/
│   ├── temperatureColorScale.js    — Scientific colour ramp
│   └── projection.js              — Equirectangular projection math
│
├── components/
│   ├── GlobalTemperatureMap.jsx    — Canvas raster + overlay + slider
│   ├── GlobalTemperatureMap.module.css
│   ├── DataInfoTooltip.jsx         — Accessible ⓘ metadata tooltip
│   ├── DataInfoTooltip.module.css
│   ├── TemperatureChart.jsx        — SVG local time-series chart
│   └── WorldMap.jsx                — Phase 1 selection map
│
└── pages/
    ├── ExplorePage.jsx             — Phase 3 integrated page
    └── HomePage.jsx                — Phase 1 location selection
```

---

### 5. Running the Project

```bash
npm install
npm run dev
```

Build for production:
```bash
npm run build
```

---

### 6. NASA Attribution

Data provided by the **NASA Global Modeling and Assimilation Office (GMAO)** via **GEOS-FP** (Goddard Earth Observing System Forward Processing).
Scientific visualization reference: [NASA SVS 5147 — GEOS-FP Near-Surface Temperature](https://svs.gsfc.nasa.gov/5147/).
