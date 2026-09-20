# FLOWSHIELD — Comprehensive Technical Architecture & Developer Handbook

> **Predict the flood. Protect the future.**  
> A complete, production-grade guide to the architecture, physics engine, 3D WebGL pipeline, data ingestion services, and runtime configuration of the **FLOWSHIELD** platform.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [High-Level System Architecture](#2-high-level-system-architecture)
3. [Technology Stack & Dependency Matrix](#3-technology-stack--dependency-matrix)
4. [APIs & External Services Catalogue](#4-apis--external-services-catalogue)
5. [Environment Variables & Configuration](#5-environment-variables--configuration)
6. [Detailed Codebase Directory Structure](#6-detailed-codebase-directory-structure)
7. [How the System Works (End-to-End Data Pipeline)](#7-how-the-system-works-end-to-end-data-pipeline)
8. [Hydrodynamic Physics & Numerical Modeling](#8-hydrodynamic-physics--numerical-modeling)
9. [Cascading Infrastructure Failure Engine](#9-cascading-infrastructure-failure-engine)
10. [3D Digital Twin & WebGL Graphics Pipeline](#10-3d-digital-twin--webgl-graphics-pipeline)
11. [Real-World Geospatial Ingestion Pipeline (Mission Portal)](#11-real-world-geospatial-ingestion-pipeline-mission-portal)
12. [Streamlit ↔ React Inter-Process Communication Bridge](#12-streamlit--react-inter-process-communication-bridge)
13. [How to Run, Build & Deploy](#13-how-to-run-build--deploy)
14. [Critical Technical Details & Implementation Gotchas](#14-critical-technical-details--implementation-gotchas)
15. [Known Risks, Failure Modes & Mitigations](#15-known-risks-failure-modes--mitigations)

---

## 1. Executive Summary

**FLOWSHIELD** is a dual-engine urban flood forecasting, hydrodynamic simulation, and municipal early-warning command center. It bridges macro-scale meteorological forecasting with micro-scale urban digital twin simulation:

- **The Python / Streamlit Host Engine (`flowshield/app.py`)** acts as the central command server. It connects to live meteorological APIs (Open-Meteo precipitation, GloFAS river inflow), models broad municipal watersheds over a 12×12 or 72×72 grid across entire cities (e.g. Bengaluru, 12 km × 12 km), runs fast 2D mass-balance overland flow simulations using NumPy/SciPy, and presents real-time hazard KPIs and interactive PyDeck geospatial maps.
- **The Client-Side React Engine (`src/App.tsx`)** is an embedded single-page application built on React 18, TypeScript, and Tailwind CSS. It manages simulation time-scrubbing (24-hour horizon), interactive sandbox defenses (sandbag placement, culvert clearing/obstruction), and real-time impact analytics.
- **The 3D WebGL Digital Twin (`src/components/Scene3D.tsx`)** renders an isometric 90×90 (8,100 cell) micro-watershed diorama using Three.js. It features continuous digital elevation terrain, procedural road networks, extruded building footprints, elevated metro viaducts, animated downhill fluid flow shaders, Marching Squares vector flood isolines, and floating 3D status beacons for critical lifelines (hospitals, power substations, transit hubs).
- **Communication Protocol**: Streamlit embeds the React application via a same-origin iframe (`components.iframe`). Parameters such as rainfall intensity (mm/h) and river surge ($m^3/s$) are passed on initialization through URL query parameters and dynamically via HTML5 `postMessage` event channels, with React streaming computed casualty and infrastructure risk telemetry back to Streamlit.

---

## 2. High-Level System Architecture

```text
                               ┌──────────────────────────────────────────────┐
                               │             EXTERNAL DATA SOURCES            │
                               │  Open-Meteo (Precipitation & Elevation)      │
                               │  GloFAS (River Discharge Inflow)             │
                               │  OpenStreetMap & Overpass (3D Urban Vectors) │
                               │  AWS Terrarium (Fallback DEM Tiles)          │
                               └──────────────────────┬───────────────────────┘
                                                      │
                                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ PYTHON STREAMLIT ENGINE (flowshield/app.py)                                                                │
│                                                                                                             │
│  ┌──────────────────────┐    ┌──────────────────────────┐    ┌───────────────────────────────────────────┐  │
│  │   WeatherProvider    │    │    HydrologyProvider     │    │            ElevationProvider              │  │
│  │ Open-Meteo Forecast  │    │   GloFAS River Outflow   │    │ Synthetic DEM & Taluk Drainage Basins     │  │
│  └──────────┬───────────┘    └────────────┬─────────────┘    └─────────────────────┬─────────────────────┘  │
│             │                             │                                        │                        │
│             └─────────────────────────────┼────────────────────────────────────────┘                        │
│                                           ▼                                                                 │
│                      ┌──────────────────────────────────────────┐                                           │
│                      │       FloodSimulationEngine (NumPy)      │                                           │
│                      │ 2D Overland Inundation, Drainage & Head  │                                           │
│                      └────────────────────┬─────────────────────┘                                           │
│                                           │                                                                 │
│                   ┌───────────────────────┴───────────────────────┐                                         │
│                   ▼                                               ▼                                         │
│       ┌───────────────────────┐                       ┌───────────────────────┐                             │
│       │   Tab 1: 2D GIS Map   │                       │   Tab 2: 3D Twin      │                             │
│       │ PyDeck Inundation GL  │                       │ Same-Origin iframe    │                             │
│       │ KPIs & Impact Cards   │                       │ /app/static/3d/       │                             │
│       └───────────────────────┘                       └───────────┬───────────┘                             │
└───────────────────────────────────────────────────────────────────┼─────────────────────────────────────────┘
                                                                    │
                                                 URL Query Params (?rain=&river=)
                                                 HTML5 postMessage Bi-directional Bridge
                                                                    │
                                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ REACT 18 & THREE.JS 3D CLIENT ENGINE (src/)                                                                │
│                                                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ React State Coordinator (src/App.tsx)                                                                 │  │
│  │ • Clock Scrubber & Speed Control (1× – 20×)     • Emergency Scenario Multipliers (0.5× – 4.0×)        │  │
│  │ • Interactive Defense Tools (Sandbags/Barriers) • Mission Portal (Custom OSM Coordinates Ingestion)   │  │
│  └───────────────────────────────────┬───────────────────────────────────────────────────────────────────┘  │
│                                      │                                                                      │
│             ┌────────────────────────┴────────────────────────┐                                             │
│             ▼                                                 ▼                                             │
│  ┌─────────────────────────────────────────┐   ┌─────────────────────────────────────────────────────────┐  │
│  │ Physics Worker Thread                   │   │ Three.js 3D Viewport (src/components/Scene3D.tsx)       │  │
│  │ (src/workers/physicsWorker.ts)          │   │ • 8,100 Instanced Voxel Pedestal                        │  │
│  │ • 2D Diffusive Wave Hydrologic Solver   │   │ • Continuous Draped Fluid Mesh (Custom Wave Shader)     │  │
│  │ • Hydraulic Head Slope Routing          │──▶│ • Marching Squares 3D Vector Flood Contours             │  │
│  │ • Manning's Friction & Infiltration     │   │ • Road Network Ribbons & Procedural Streetlights        │  │
│  │ • Cascading Power/Hospital/Metro Outages│   │ • Floating Lifeline Beacons (🏥 Hospital, ⚡ Substation)│  │
│  └─────────────────────────────────────────┘   └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack & Dependency Matrix

### Frontend Ecosystem (Client Engine)
| Technology | Package Version | Location | Architectural Purpose |
| --- | --- | --- | --- |
| **React** | `18.3.1` | `package.json:20` | Declarative UI, state orchestration, component lifecycle |
| **React DOM** | `18.3.1` | `package.json:21` | Browser DOM rendering and mount root (`src/main.tsx`) |
| **TypeScript** | `5.7.3` | `package.json:35` | Strict static typing across simulation structs, vectors, and grid states |
| **Three.js** | `0.170.0` | `package.json:24` | WebGL 3D scene graph, instanced mesh rendering, custom GLSL shaders, camera controls |
| **Leaflet** | `1.9.4` | `package.json:18` | Interactive 2D coordinate picker map in the real-world ingestion portal (`MapPicker2D.tsx`) |
| **Tailwind CSS** | `3.4.17` | `package.json:34` | Tactical dark HUD styling, responsive grids, and layout overlays |
| **Lucide React** | `1.16.0` | `package.json:19` | High-fidelity UI icons for instrumentation and critical infrastructure alerts |
| **Simplex Noise** | `4.0.3` | `package.json:22` | Procedural elevation heightmap perturbations and water ripple noise synthesis |
| **Vite** | `6.0.7` | `package.json:36` | High-speed ESM development server, HMR, and Rollup production bundler |

### Backend & Scientific Computing Ecosystem (Python Host)
| Technology | Version Spec | Location | Architectural Purpose |
| --- | --- | --- | --- |
| **Python** | `>= 3.10` | System runtime | Application runtime environment |
| **Streamlit** | `>= 1.35.0` | `requirements.txt:1` | Web presentation layer, reactive UI widgets, and custom component host |
| **PyDeck** | `>= 0.9.0` | `requirements.txt:2` | Large-scale 2D GPU-accelerated geospatial visualization via Deck.gl |
| **NumPy** | `>= 1.24.0` | `requirements.txt:3` | Vectorized matrix operations for 2D mass-balance water depth and flow arrays |
| **Pandas** | `>= 2.0.0` | `requirements.txt:4` | Ward-level population aggregation, CSV dataset parsing, tabular records |
| **Requests** | `>= 2.31.0` | `requirements.txt:5` | Synchronous HTTP client querying live REST endpoints (Open-Meteo & GloFAS) |
| **SciPy** | `>= 1.11.0` | `requirements.txt:6` | Numerical spatial algorithms and Gaussian interpolation kernels |
| **PyArrow** | `>= 14.0.0` | `requirements.txt:7` | High-throughput columnar serialization for PyDeck data tables |

---

## 4. APIs & External Services Catalogue

The application communicates with **10 external services and geospatial endpoints**. Every call includes robust deterministic offline fallbacks to ensure uninterrupted operation.

### 1. Open-Meteo Weather Forecast API
- **Purpose**: Retrieves live 3-day hourly precipitation forecasts (mm/h) based on geographic coordinates and timezone.
- **Source Call**: [`flowshield/app.py:283`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/flowshield/app.py#L283)
- **URL Endpoint**: `https://api.open-meteo.com/v1/forecast` ([`flowshield/app.py:279`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/flowshield/app.py#L279))
- **Parameters**: `latitude`, `longitude`, `hourly=precipitation`, `forecast_days=3`, `timezone`
- **Authentication**: None (Free public endpoint).
- **Rate Limit**: Not specified in code (Open-Meteo standard non-commercial threshold: up to 10,000 requests/day).
- **Fallback**: Synthetic diurnal monsoon profile shaped by a pseudo-random seed based on coordinates ([`flowshield/app.py:319`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/flowshield/app.py#L319)).

### 2. Open-Meteo GloFAS Flood API
- **Purpose**: Queries hydrological river discharge ($m^3/s$) from the Global Flood Awareness System (GloFAS) to model river surge entering the urban domain.
- **Source Call**: [`flowshield/app.py:343`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/flowshield/app.py#L343)
- **URL Endpoint**: `https://flood-api.open-meteo.com/v1/flood` ([`flowshield/app.py:339`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/flowshield/app.py#L339))
- **Parameters**: `latitude`, `longitude`, `daily=river_discharge`, `forecast_days=1`
- **Authentication**: None.
- **Rate Limit**: Not specified in code.
- **Fallback**: Deterministic random river discharge between 50 and 250 $m^3/s$ ([`flowshield/app.py:354`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/flowshield/app.py#L354)).

### 3. CARTO Basemap Positron Vector Style (PyDeck)
- **Purpose**: Provides the minimal dark/light vector basemap styling JSON for Deck.gl / PyDeck in Streamlit.
- **Source Call**: [`flowshield/app.py:596`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/flowshield/app.py#L596) (passed to `pdk.Deck(map_style=MAP_STYLE)`)
- **URL Endpoint**: `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json` ([`flowshield/app.py:76`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/flowshield/app.py#L76))
- **Authentication**: None.
- **Rate Limit**: Not specified in code.

### 4. OpenStreetMap Nominatim Geocoding API
- **Purpose**: Powers real-time search in the Mission Portal, converting city names, postal codes, or landmarks into coordinates and geodetic bounding boxes.
- **Source Call**: [`src/services/geocoding.ts:20`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/services/geocoding.ts#L20)
- **URL Endpoint**: `https://nominatim.openstreetmap.org/search?format=json&q={query}&limit=5&addressdetails=1` ([`src/services/geocoding.ts:16`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/services/geocoding.ts#L16))
- **Headers**: `Accept: application/json`
- **Authentication**: None.
- **Rate Limit**: Not specified in code (Subject to standard OSM usage policy: 1 req/sec).

### 5. Open-Meteo Elevation API (DEM Ingestion)
- **Purpose**: Queries a 9×9 uniform coordinate grid of ground elevations over a custom bounding box; subsequently upsampled to 90×90 via bilinear interpolation.
- **Source Call**: [`src/services/elevationService.ts:67`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/services/elevationService.ts#L67)
- **URL Endpoint**: `https://api.open-meteo.com/v1/elevation?latitude={lat1,lat2...}&longitude={lon1,lon2...}` ([`src/services/elevationService.ts:65`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/services/elevationService.ts#L65))
- **Authentication**: None.
- **Rate Limit**: Not specified in code.

### 6. AWS Nextzen Terrarium Elevation Tiles (DEM Fallback)
- **Purpose**: Fallback elevation provider if Open-Meteo elevation is unreachable. Decodes raster PNG elevation values via $(R \times 256 + G + B / 256) - 32768$.
- **Source Call**: [`src/services/elevationService.ts:168`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/services/elevationService.ts#L168) (via HTML Canvas `Image` load)
- **URL Endpoint**: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{zoom}/{x}/{y}.png` ([`src/services/elevationService.ts:134`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/services/elevationService.ts#L134))
- **Authentication**: None (Public AWS S3 bucket).
- **Rate Limit**: Not specified in code.

### 7. OpenStreetMap Official REST API (Map Data)
- **Purpose**: Ingests actual OpenStreetMap XML/JSON vectors (buildings, highways, waterways, emergency nodes) for arbitrary bounding boxes.
- **Source Call**: [`src/services/overpassService.ts:72`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/services/overpassService.ts#L72)
- **URL Endpoint**: `https://api.openstreetmap.org/api/0.6/map.json?bbox={west,south,east,north}` ([`src/services/overpassService.ts:68`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/services/overpassService.ts#L68))
- **Headers**: `User-Agent: FLOWSHIELD-UrbanFloodTwin/1.0`
- **Authentication**: None.
- **Rate Limit**: Not specified in code (OSM 0.6 size cap: 0.25 sq degrees or 50,000 nodes).

### 8. Overpass API Interpreters (Vector Query Fallback)
- **Purpose**: Secondary fallback querying complex urban geometries using the Overpass QL language if the official OSM REST API times out.
- **Source Call**: [`src/services/overpassService.ts:119`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/services/overpassService.ts#L119)
- **URL Endpoints**:
  - `https://overpass-api.de/api/interpreter` ([`src/services/overpassService.ts:109`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/services/overpassService.ts#L109))
  - `https://overpass.kumi.systems/api/interpreter` ([`src/services/overpassService.ts:110`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/services/overpassService.ts#L110))
  - `https://maps.mail.ru/osm/tools/overpass/api/interpreter` ([`src/services/overpassService.ts:111`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/services/overpassService.ts#L111))
- **Authentication**: None.
- **Rate Limit**: Not specified in code.

### 9. CARTO Dark Raster Tile Layer (MapPicker2D)
- **Purpose**: Dark-themed slippy map tiles for the interactive coordinate selection modal.
- **Source Call**: [`src/components/HUD/MapPicker2D.tsx:57`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/components/HUD/MapPicker2D.tsx#L57)
- **URL Endpoint**: `https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key={key}`
- **Authentication**: `VITE_CARTO_API_KEY` (environment variable, with built-in public demo key fallback in [`src/components/HUD/MapPicker2D.tsx:11`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/components/HUD/MapPicker2D.tsx#L11)).
- **Rate Limit**: Not specified in code.

### 10. ESRI World Dark Gray Canvas
- **Purpose**: Alternative minimalist dark base map layer in Leaflet picker.
- **Source Call**: [`src/components/HUD/MapPicker2D.tsx:55`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/components/HUD/MapPicker2D.tsx#L55)
- **URL Endpoint**: `https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`
- **Authentication**: None.
- **Rate Limit**: Not specified in code.

---

## 5. Environment Variables & Configuration

The application is engineered to be **zero-config and keyless by default**. It runs out of the box without requiring API keys or external secrets:

| Variable Name | Context / Consumer | Purpose | Required? | Default Fallback |
| --- | --- | --- | --- | --- |
| `VITE_CARTO_API_KEY` | Vite / React (`MapPicker2D.tsx:11`) | Access key for CARTO raster tiles in coordinate picker | **No** | Hardcoded public key string (`'cb1_3qpu_1_175ab61e2e6c39ded466ba7d'`) |
| `PATH` | Python launcher (`run.py:18`) | Ensures Node.js binary directory is visible in Windows environments | **No** | Prepends `C:\Program Files\nodejs` if present |
| `IMD_API_KEY` | *(Documented in `flowshield/README.md:27`)* | Reserved for future integration with India Meteorological Dept | **No** | Not implemented in code |
| `CWC_API_KEY` | *(Documented in `flowshield/README.md:28`)* | Reserved for future Central Water Commission discharge sensors | **No** | Not implemented in code |

---

## 6. Detailed Codebase Directory Structure

```text
flowshield3dmap/
│
├── app.py                            # Deployment root entry point: delegates via runpy to flowshield/app.py
├── requirements.txt                  # Python dependencies for Streamlit Cloud deployment
├── package.json                      # Node dependencies, scripts, and build targets
├── vite.config.ts                    # Vite build configuration, server port 5173, and security headers
├── run.bat                           # 1-Click Windows execution script for Streamlit
├── run.py                            # Standalone Python helper script launching Vite + web browser
├── index.html                        # Vite development HTML entry template
├── PROJECT_OVERVIEW.md               # This architectural reference manual
│
├── flowshield/                       # Core Python Streamlit Host Application
│   ├── __init__.py                   # Python package initializer
│   ├── app.py                        # Monolithic Streamlit application (1,225 lines)
│   │                                 # - WeatherProvider & HydrologyProvider (Open-Meteo REST calls)
│   │                                 # - FloodSimulationEngine (NumPy 2D finite-difference mass-balance)
│   │                                 # - PyDeck deck.gl 2D Inundation Layer
│   │                                 # - Same-origin iframe embedding and parameter serialization
│   ├── requirements.txt              # Sub-package Python dependency mirror
│   ├── README.md                     # Documentation for India Monsoon Edition prototype
│   └── static/                       # Static web server asset directory
│       └── 3d/                       # Compiled React distribution files served by Streamlit
│           ├── index.html            # Static HTML iframe container with handshake script
│           ├── assets/               # Production minified JS bundles, CSS, and Web Workers
│           └── presets/              # Pre-cached JSON benchmark city datasets (Shibuya, Manhattan, Venice)
│
├── dist/                             # Output directory produced by `npm run build`
│   ├── index.html                    # Minified production HTML
│   ├── assets/                       # Bundle chunks (index-*.js, index-*.css, physicsWorker-*.js)
│   └── presets/                      # Presets copied to build output
│
└── src/                              # React 18 & Three.js Client Source
    ├── main.tsx                      # React root rendering mount point
    ├── App.tsx                       # Central application coordinator (561 lines)
    │                                 # - Global simulation clock & speed governor (1× to 20×)
    │                                 # - postMessage bridge between Streamlit and React
    │                                 # - Defense tools dispatch (sandbags, drain clearing)
    ├── index.css                     # Tailwind CSS imports and custom HUD visual utilities
    │
    ├── components/                   # UI Viewports and Overlays
    │   ├── Scene3D.tsx               # Three.js 3D Viewport (949 lines):
    │   │                             # - InstancedMesh voxel columns, digital elevation ground
    │   │                             # - Continuous fluid mesh with custom downhill wave ripple shader
    │   │                             # - 3D Marching Squares vector flood isolines (Shoreline, Warning, Critical)
    │   │                             # - Road ribbon meshes, streetlights, elevated metro viaduct
    │   │                             # - Floating lifeline beacons with animated hover raycasting tooltips
    │   │
    │   └── HUD/                      # Heads-Up Display Overlay Components
    │       ├── Header.tsx            # Operations bar, location selector, scenario status, help modal
    │       ├── RainSlider.tsx        # Rainfall adjustment slider with real-time mm/h readout
    │       ├── ToolBar.tsx           # Active sandbox tools: Inspect, Deploy Sandbags, Obstruct Culverts
    │       ├── TimeEngineBar.tsx     # 24-hour time scrubber, Play/Pause toggle, playback rate (1×–20×)
    │       ├── AnalyticsPanel.tsx    # Live casualty estimation, flood depth, and cascading alerts
    │       ├── InspectorModal.tsx    # Detailed cell inspection modal (elevation, depth, assets, actions)
    │       ├── MainMenuModal.tsx     # Global Mission Portal: search city or click map to stream 3D twin
    │       ├── MapPicker2D.tsx       # Leaflet bounding-box coordinate selection canvas
    │       ├── Legend.tsx            # Depth classification swatches (<150mm, 150-199mm, 200-249mm, >=250mm)
    │       ├── HelpModal.tsx         # Operational shortcut and physics documentation dialog
    │       └── ScenarioBar.tsx       # Emergency scenario preset quick-selector
    │
    ├── engine/                       # Simulation Algorithms & Mathematical Models
    │   ├── physics.ts                # 2D Diffusive Wave hydrodynamics and cascading outage logic (320 lines)
    │   ├── physicsWorkerClient.ts    # Promise-based client wrapper communicating with physicsWorker.ts
    │   ├── terrain.ts                # City elevation, building, road, and river feature compiler (390 lines)
    │   ├── terrainTexture.ts         # High-resolution procedural cartographic canvas texture generator
    │   ├── dataBridge.ts             # Ingests raw Overpass JSON and DEM arrays into `GridState`
    │   └── scenarios.ts              # Pre-configured emergency scenarios (Cloudburst, Surge, Dam Failure)
    │
    ├── services/                     # Network Fetchers & Geospatial Ingestion
    │   ├── elevationService.ts       # Open-Meteo elevation API + AWS Terrarium DEM fetcher
    │   ├── overpassService.ts        # OpenStreetMap REST API & Overpass QL vector extractor
    │   ├── geocoding.ts              # OpenStreetMap Nominatim city search
    │   └── ingestionPipeline.ts      # Orchestrates end-to-end data ingestion for custom bounding boxes
    │
    ├── types/                        # TypeScript Interface Declarations
    │   ├── simulation.ts             # Definitions for `Cell`, `GridState`, `CriticalAsset`, `SimulationAnalytics`
    │   └── locations.ts              # Benchmark locations (Singapore, Shibuya, Manhattan, Venice, Bengaluru)
    │
    ├── utils/                        # Coordinate Transformation Utilities
    │   └── GeoTransformer.ts         # Planar Mercator projection converting WGS84 coordinates to local meters
    │
    └── workers/                      # Web Worker Background Threads
        └── physicsWorker.ts          # Off-thread 2D hydrodynamic numerical loop sustaining 60 FPS
```

---

## 7. How the System Works (End-to-End Data Pipeline)

The data pipeline runs through **7 distinct phases**, from remote satellite sensors down to client-side GPU vertex shaders:

```text
Phase 1: Ingestion  ──▶ Phase 2: Macro Sim ──▶ Phase 3: Bridge ──▶ Phase 4: Micro Sim ──▶ Phase 5: 3D Render
(Open-Meteo REST)       (Python NumPy)        (Iframe URL/Msg)    (Web Worker)         (Three.js WebGL)
```

1. **Phase 1 — Remote Ingestion (`flowshield/app.py:281, 341`)**:
   Streamlit connects to Open-Meteo's precipitation API and GloFAS river discharge API for the selected city (e.g. Bengaluru, $12.9716^\circ\text{ N}, 77.5946^\circ\text{ E}$). If online, it parses hourly forecast values; if offline or rate-limited, it transitions transparently to synthetic diurnal monsoon profile generators.
2. **Phase 2 — Python Macro-Scale 2D Simulation (`flowshield/app.py:400-530`)**:
   The `FloodSimulationEngine` models rainfall accumulation and drainage clearance over an urban grid ($12\times 12$ or $72\times 72$ cells). At each hourly time step:
   $$\text{Depth}_{t+1} = \text{Depth}_t + \text{Effective Rain} + \text{River Inflow} - \text{Drainage} \pm \text{Lateral Flow}$$
   The results are rendered as color-coded polygons onto an interactive PyDeck map layer.
3. **Phase 3 — Iframe Data Bridge (`flowshield/app.py:1041` & `src/App.tsx:98`)**:
   Inside Tab 2, Streamlit embeds `/app/static/3d/index.html` via an iframe. Streamlit appends initial parameters directly to the query string:
   `?rain=85.0&river=180.0&loc=shibuya`
   Streamlit also establishes a postMessage listener to receive simulation analytics back from the React app.
4. **Phase 4 — React Micro-Scale Grid Ingestion (`src/App.tsx:108-147`)**:
   React parses the query parameters on mount and loads a high-resolution $90\times 90$ grid ($8,100$ cells, $1.2\text{ km} \times 1.2\text{ km}$ footprint) representing the active urban watershed.
5. **Phase 5 — Background Web Worker Execution (`src/workers/physicsWorker.ts`)**:
   When the user clicks Play or drags the Time Scrubber, React dispatches the current `gridState` and environmental parameters to `physicsWorker.ts`. The worker executes the hydrodynamic routing equations asynchronously and returns the next step state along with casualty and infrastructure analytics.
6. **Phase 6 — Three.js GPU Scene Update (`src/components/Scene3D.tsx`)**:
   Upon receiving the updated state:
   - Dynamic fluid surfaces update their corner elevations and normal vectors.
   - The custom water fragment shader animates downhill wave ripples according to local topographic slopes.
   - Marching Squares vector isolines re-triangulate to trace shoreline ($h \ge 0.04\text{m}$), warning ($h \ge 0.18\text{m}$), and critical ($h \ge 0.38\text{m}$) hazard boundaries.
   - Floating 3D beacons update their colors and pulse rates if nearby floodwater compromises their operations.
7. **Phase 7 — Telemetry Streaming Back to Streamlit (`src/App.tsx:165-175`)**:
   Every physics step, React emits a `FLOWSHIELD_ANALYTICS` message to `window.parent`, providing the host dashboard with affected population counts, maximum inundation depths, and infrastructure outage alerts.

---

## 8. Hydrodynamic Physics & Numerical Modeling

The hydrodynamic core implements a mass-conserving **2D diffusive wave overland flow solver** adapted for high-speed execution in both Python NumPy and JavaScript:

### 1. Mass Conservation Formulation
At any cell $(x, y)$, fluid volume changes according to the balance of vertical sources/sinks and lateral fluxes:
$$\frac{\partial H}{\partial t} = R(t) - D(x, y) - K(x, y) - \nabla \cdot \mathbf{q}$$

Where:
- $H(x, y)$: Surface water depth above local terrain (meters).
- $R(t)$: Precipitation intensity applied uniformly across permeable and impervious cells ($\text{m/s}$).
- $D(x, y)$: Municipal stormwater drainage capacity ($\text{m/s}$), derived from taluk drainage density and ground slope.
- $K(x, y)$: Infiltration permeability ($2\text{ mm/h}$ on concrete/asphalt, up to $25\text{ mm/h}$ on permeable soils).
- $\mathbf{q}$: Lateral discharge vector per unit width ($\text{m}^2/\text{s}$).

### 2. Gravity-Driven Hydraulic Head Routing
Overland flow is driven by the gradient of the total hydraulic head $\eta$:
$$\eta(x, y) = Z_{ground}(x, y) + H(x, y)$$

Between any cell $i$ and neighbor $j$, the head differential is:
$$\Delta \eta_{ij} = \eta_i - \eta_j$$

Flux occurs only if $\Delta \eta_{ij} > 0$ and is modulated by the available water depth $H_i$:
$$q_{ij} = C_{transfer} \cdot H_i \cdot \sqrt{\frac{|\Delta \eta_{ij}|}{\Delta x}}$$

### 3. Numerical Stability (CFL Condition)
To prevent numerical oscillations or negative water volumes during time-stepping, the maximum transfer fraction per iteration is strictly capped by a Courant-Friedrichs-Lewy (CFL) stability limiter:
$$\sum_{j} q_{ij} \cdot \Delta t \le \alpha_{CFL} \cdot H_i \cdot \Delta x^2, \quad \text{with } \alpha_{CFL} \le 0.25$$

### 4. Interactive Sandbox Defenses
- **Sandbag Barriers (`cell.hasBarrier = true`)**: Sets boundary transmissivity to $0$ on all 4 faces of the cell, redirecting oncoming floodwaters around critical facilities.
- **Culvert Obstruction (`cell.isObstructed = true`)**: Simulates debris clogging by reducing municipal drainage clearance $D(x, y)$ to zero, causing rapid localized surface ponding.

---

## 9. Cascading Infrastructure Failure Engine

The simulation tracks inter-dependent lifeline vulnerabilities in real time (`src/engine/physics.ts:240-310`):

```text
┌──────────────────────────────────────┐
│ Water Depth at Substation >= 0.35m   │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│ POWER SUBSTATION TRIPS OFFLINE       │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│ Stormwater Pumps Lose Grid Power     │
│ Drainage clearance drops to 0 mm/h   │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│ Accelerated Flooding in Sector       │
│ Road Inundation Surpasses 0.40m      │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│ HOSPITAL ACCESS ROAD ISOLATED        │
│ Ambulances & Emergency Supply Blocked│
└──────────────────────────────────────┘
```

1. **⚡ Power Substation Inundation**:
   - If water depth at a power substation node exceeds **$0.35\text{ m}$**, the substation undergoes an emergency trip (`status: 'critical'`).
   - Power failure cascades to all dependent stormwater pump stations in that quadrant, dropping drainage capacity to **$0\text{ mm/h}$**. Flood expansion immediately accelerates.
2. **🏥 Hospital Access Isolation**:
   - The engine samples all road cells within a 5-cell radius surrounding each emergency medical center.
   - If water depth on these access roads exceeds **$0.40\text{ m}$** (impassable for standard emergency vehicles), the hospital is flagged as **ISOLATED**, dispatching urgent Common Alerting Protocol warnings.
3. **🚇 Subterranean Metro Suspension**:
   - Underground metro entrances and elevated track viaducts are monitored. If water depth at any station entrance surpasses **$0.25\text{ m}$**, metro line operations are halted (`metroOperational: false`), transitioning the viaduct tube color to flashing alert red.

---

## 10. 3D Digital Twin & WebGL Graphics Pipeline

The 3D visualization in [`src/components/Scene3D.tsx`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/components/Scene3D.tsx) runs at a steady **60 FPS** using advanced Three.js rendering techniques:

### 1. Solid Voxel Pedestal (InstancedMesh)
- 8,100 extruded columns ($90\times 90$ grid) are rendered in a **single draw call** via `THREE.InstancedMesh` (`Scene3D.tsx:218`).
- Every column extends seamlessly from the dark pedestal base ($y = 0$) up to the terrain elevation $Z(x, y)$, completely eliminating visible polygon gaps, edge tearing, or backplane leak-through.

### 2. Continuous Water Surface & Downhill Ripple Shader
- Rather than rendering discrete voxel boxes of water, surface water is rendered as a continuous subdivided `PlaneGeometry` mesh draped over the terrain.
- A custom GLSL shader evaluates local topographic gradients ($-\nabla Z = (-\frac{\partial Z}{\partial x}, -\frac{\partial Z}{\partial z})$), directing wave ripples to propagate realistically downhill from ridges toward drainage basins (`Scene3D.tsx:684`).
- **4-Tier Depth Color Ramp**:
  - $< 150\text{ mm}$: Dry / Transparent (`discard` in fragment shader; underlying asphalt and terrain remain fully visible).
  - $150–199\text{ mm}$: Mild Ponding (`#4D96C4`, opacity 0.72).
  - $200–249\text{ mm}$: Flooded Area (`#2E86DE`, opacity 0.82).
  - $\ge 250\text{ mm}$: Deep Inundation (`#2952E3`, opacity 0.88).

### 3. Marching Squares 3D Vector Flood Isolines
- Three distinct `THREE.LineSegments` meshes trace exact fluid-land boundaries in real time (`Scene3D.tsx:375-408`):
  - **Inundation Shoreline ($h \ge 0.04\text{m}$)**: Vibrant Electric Cyan (`#00F0FF`).
  - **Warning Risk Contour ($h \ge 0.18\text{m}$)**: Electric Amber (`#FFB300`).
  - **Critical Hazard Boundary ($h \ge 0.38\text{m}$)**: Neon Coral Red (`#FF1744`).

### 4. Road Networks, Streetlights & Metro Viaducts
- **Asphalt Ribbons**: Road vectors are triangulated into continuous 3D ribbon strips offset by $+0.15\text{ m}$ above the terrain to completely eliminate z-fighting (`Scene3D.tsx:530`).
- **Procedural Streetlights**: Placed at regular intervals along arterial avenues with emissive golden lamp heads (`#fef08a`).
- **Elevated Metro Viaduct**: A continuous 3D tube geometry mounted on concrete support piers that transitions from glowing violet (`#a855f7`) to flashing alert red (`#ef4444`) under flood conditions.

---

## 11. Real-World Geospatial Ingestion Pipeline (Mission Portal)

The Mission Portal (`src/components/HUD/MainMenuModal.tsx`) enables users to ingest and simulate **any real-world urban location on Earth**:

```text
User searches city or clicks map
               │
               ▼
Nominatim Geocoding (src/services/geocoding.ts)
Resolves latitude, longitude, and bounding box
               │
               ▼
Ingestion Orchestration (src/services/ingestionPipeline.ts)
               │
       ┌───────┴───────────────────────────────┐
       ▼                                       ▼
Open-Meteo DEM Grid                      OpenStreetMap REST API
9×9 Elevation Samples                    Buildings, Highways, Water
       │                                       │
       ▼                                       ▼
Bilinear Interpolation                   Planar Mercator Projection
90×90 Continuous DEM Grid                Metric Coordinates (x, z)
       │                                       │
       └───────┬───────────────────────────────┘
               │
               ▼
DataBridge (src/engine/dataBridge.ts)
Compiles unified GridState with 8,100 cells
               │
               ▼
Live 3D Digital Twin Streams in Viewport
```

1. **Coordinate Resolution**: Nominatim resolves the target location into center coordinates $(lat, lon)$ and computes a $1.2\text{ km} \times 1.2\text{ km}$ bounding box.
2. **Elevation Ingestion**: `elevationService.ts` queries Open-Meteo for an 81-point DEM grid over the bounding box and bilinearly interpolates it to a $90\times 90$ grid. If unreachable, it decodes AWS Terrarium elevation tiles.
3. **Urban Vector Ingestion**: `overpassService.ts` queries the OpenStreetMap API for building footprints, street networks, waterways, and critical lifelines.
4. **Coordinate Transformation**: `GeoTransformer.ts` converts WGS84 angular degrees into a metric Cartesian frame centered at $(0, 0)$.
5. **Data Compilation**: `dataBridge.ts` maps all features onto the 90×90 grid cells, assigns base elevations, and instantiates the new simulation environment.

---

## 12. Streamlit ↔ React Inter-Process Communication Bridge

Streamlit and the embedded React 3D twin maintain continuous two-way communication across an iframe boundary:

### 1. Inbound (Streamlit ➔ React)
- **Initialization via URL Parameters**:
  Streamlit formats the iframe URL with live meteorological conditions:
  ```python
  map_url = f"/app/static/3d/index.html?rain={effective_rain:.1f}&river={effective_river:.1f}&loc=shibuya"
  components.iframe(map_url, height=750, scrolling=False)
  ```
  React reads these parameters during mount:
  ```typescript
  const params = new URLSearchParams(window.location.search);
  const rain = params.get('rain'); // -> setRainfallRate
  ```
- **Live Updates via postMessage**:
  When sliders change in Streamlit, it emits an event to the iframe:
  ```typescript
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'FLOWSHIELD_UPDATE') {
      setRainfallRate(event.data.rainfallRate);
      setRiverSurge(event.data.riverSurge);
    }
  });
  ```

### 2. Outbound (React ➔ Streamlit)
Every simulation tick, React broadcasts its impact metrics to Streamlit:
```typescript
const payload = {
  affectedPopulation: analytics.affectedPopulation,
  maxDepthM: analytics.maxDepthM,
  safePct: analytics.safePct,
  warningPct: analytics.warningPct,
  criticalPct: analytics.criticalPct,
  metroOperational: analytics.metroOperational,
  cascadingAlerts: analytics.cascadingAlerts,
};

// Streamlit native component protocol
window.parent.postMessage({
  isStreamlitMessage: true,
  type: 'streamlit:setComponentValue',
  value: payload,
}, '*');

// Custom application event
window.parent.postMessage({
  type: 'FLOWSHIELD_ANALYTICS',
  ...payload,
}, '*');
```

---

## 13. How to Run, Build & Deploy

### Prerequisites
- **Node.js** `>= 18.0.0` (with `npm`)
- **Python** `>= 3.10` (with `pip`)

### 1. Installation
Install JavaScript and Python dependencies:
```bash
# Install frontend dependencies
npm install

# Install Python backend dependencies
pip install -r requirements.txt
```

### 2. Development Execution
- **Option A — Unified Concurrent Mode (Recommended)**:
  Starts both Vite (port 5173) and Streamlit (port 8501) with live hot-reloading:
  ```bash
  npm run dev:all
  ```
- **Option B — Standalone React 3D Twin**:
  Runs the React application standalone in the browser:
  ```bash
  npm run dev
  # Opens at http://localhost:5173
  ```
- **Option C — Streamlit Backend Only**:
  Runs the Streamlit dashboard using pre-built static assets:
  ```bash
  python -m streamlit run flowshield/app.py
  # Opens at http://localhost:8501
  ```
- **Option D — Windows 1-Click Batch File**:
  Double-click `run.bat` in the project root.

### 3. Production Build
To compile the React/TypeScript codebase for production:
```bash
npm run build
```
This runs `tsc && vite build`, creating minified assets in `dist/`.

> [!IMPORTANT]
> **Static Asset Synchronization**: Because Streamlit serves static files from `flowshield/static/3d/`, after running `npm run build`, ensure that the output files from `dist/` are copied to `flowshield/static/3d/`:
> ```bash
> # Windows PowerShell
> Copy-Item -Path "dist\*" -Destination "flowshield\static\3d\" -Recurse -Force
> ```

### 4. Cloud Deployment (Streamlit Cloud)
The repository is pre-configured for zero-friction deployment on **Streamlit Community Cloud**:
- **Main file path**: `app.py`
- **Requirements file**: `requirements.txt`
- The root `app.py` automatically resolves directory paths, adds `flowshield` to `sys.path`, and executes `flowshield/app.py`.
- No Node.js runtime is needed on the cloud server because Streamlit serves the pre-compiled static bundle from `flowshield/static/3d/`.

---

## 14. Critical Technical Details & Implementation Gotchas

1. **Entrypoint Delegation**: Root [`app.py`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/app.py) uses Python's `runpy.run_path` to execute [`flowshield/app.py`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/flowshield/app.py). This avoids broken import paths on platforms that enforce a root `app.py`.
2. **Iframe Same-Origin Pathing**: Streamlit serves the 3D twin under `/app/static/3d/index.html`. Using this relative path rather than an external `http://localhost:5173` URL eliminates browser cross-origin (CORS) blocking and mixed-content SSL warnings.
3. **Off-Thread Physics Execution**: The numerical hydrodynamic solver runs inside a Web Worker (`src/workers/physicsWorker.ts`). The main browser thread remains 100% free to handle Three.js camera orbiting and UI interactions without stutter.
4. **Voxel Skirt Extrusions**: All voxel columns are anchored at $y = 0$ on a beveled pedestal base. This design prevents visual tearing and holes when looking at the terrain from low isometric camera angles.
5. **Marching Squares Contours**: Vector flood boundary lines are re-computed dynamically using the Marching Squares algorithm on the continuous depth field $H(x, y)$, avoiding the jagged look of discrete grid blocks.
6. **Bilinear DEM Resampling**: Open-Meteo elevation queries sample a coarse 9×9 grid (81 points) to minimize API latency, which is bilinearly upsampled to a fine 90×90 grid ($8,100$ cells) in client memory.

---

## 15. Known Risks, Failure Modes & Mitigations

| # | Risk / Failure Mode | Root Cause | Impact | Mitigation in Codebase |
| --- | --- | --- | --- | --- |
| 1 | **Missing Drainage Dataset** | `flowshield/karnataka_taluk_drainage.csv` is not present in repository | Piped drainage capacity cannot be read from disk | `load_drainage_dataset()` catches missing file and falls back to documented municipal defaults ([`flowshield/app.py:160`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/flowshield/app.py#L160)) |
| 2 | **External Weather API Outages** | Open-Meteo or GloFAS HTTP endpoints time out or drop connection | Weather parameters fail to return | `WeatherProvider` and `HydrologyProvider` catch all exceptions and switch to synthetic diurnal monsoon generators ([`flowshield/app.py:319, 354`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/flowshield/app.py#L319)) |
| 3 | **Overpass API Rate Limits** | Public community Overpass endpoints (`overpass-api.de`) experience high traffic | Real-world 3D ingestion in Mission Portal could hang | Tries official OSM REST API first, iterates through 3 fallback Overpass mirrors, and finally falls back to procedural watershed synthesis ([`src/services/overpassService.ts:109`](file:///c:/Users/prane/OneDrive/Desktop/flowshield3dmap/src/services/overpassService.ts#L109)) |
| 4 | **Static Bundle Desynchronization** | Developer updates code in `src/` but does not copy `dist/` into `flowshield/static/3d/` | Streamlit continues serving stale 3D twin bundle | Documented in build steps; running `npm run dev:all` uses live Vite server during local development |
| 5 | **Hardware WebGL Support** | Client browser has hardware acceleration disabled or lacks WebGL 2 support | 3D diorama canvas fails to initialize | Scene3D checks WebGL context availability and falls back gracefully; 2D PyDeck map in Tab 1 remains fully functional |
