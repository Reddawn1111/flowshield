# 🛡️ FLOWSHIELD
> **Dual-Engine Urban Flood Forecasting, Hydrodynamic Simulation, and Municipal Command Center**

[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](#)
[![React 18](https://img.shields.io/badge/React-18.3-61DAFB?style=for-the-badge&logo=react&logoColor=black)](#)
[![Three.js](https://img.shields.io/badge/Three.js-WebGL-000000?style=for-the-badge&logo=three.js&logoColor=white)](#)
[![Streamlit](https://img.shields.io/badge/Streamlit-1.35+-FF4B4B?style=for-the-badge&logo=streamlit&logoColor=white)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](#)

---

## 📌 Executive Summary

**FLOWSHIELD** bridges macro-scale meteorological forecasting with micro-scale urban digital twin simulation to deliver a dual-engine flood forecasting and municipal early-warning command center.

1. **Python / Streamlit Host Engine (`flowshield/app.py`):** Acts as the central command server. It connects to live meteorological APIs (Open-Meteo precipitation, GloFAS river inflow), models broad municipal watersheds over a $12 \times 12$ or $72 \times 72$ grid across entire cities (e.g., Bengaluru, $12\text{ km} \times 12\text{ km}$), runs fast 2D mass-balance overland flow simulations using NumPy/SciPy, and presents real-time hazard KPIs and interactive PyDeck geospatial maps.
2. **Client-Side React Engine (`src/App.tsx`):** An embedded single-page application built on React 18, TypeScript, and Tailwind CSS. It manages simulation time-scrubbing across a 24-hour horizon, interactive sandbox defenses (sandbag placement, culvert clearing/obstruction), and real-time impact analytics.
3. **3D WebGL Digital Twin (`src/components/Scene3D.tsx`):** Renders an isometric $90 \times 90$ ($8,100$ cell) micro-watershed diorama using Three.js. It features continuous digital elevation terrain, procedural road networks, extruded building footprints, elevated metro viaducts, animated downhill fluid flow shaders, Marching Squares vector flood isolines, and floating 3D status beacons for critical lifelines (hospitals, power substations, transit hubs).

---

## 🏗️ High-Level System Architecture

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


---

## 🛠️ Technology Stack & Dependency Matrix

### Frontend Ecosystem (Client Engine)

| Technology | Version | Location | Architectural Purpose |
| :--- | :--- | :--- | :--- |
| **React** | 18.3.1 | `package.json` | Declarative UI, state orchestration, component lifecycle |
| **React DOM** | 18.3.1 | `package.json` | Browser DOM rendering and mount root (`src/main.tsx`) |
| **TypeScript** | 5.7.3 | `package.json` | Strict static typing across simulation structs, vectors, and grid states |
| **Three.js** | 0.170.0 | `package.json` | WebGL 3D scene graph, instanced mesh rendering, GLSL shaders, camera controls |
| **Leaflet** | 1.9.4 | `package.json` | Interactive 2D coordinate picker map in real-world portal (`MapPicker2D.tsx`) |
| **Tailwind CSS** | 3.4.17 | `package.json` | Tactical dark HUD styling, responsive grids, and layout overlays |
| **Lucide React** | 1.16.0 | `package.json` | High-fidelity UI icons for instrumentation and critical alerts |
| **Simplex Noise** | 4.0.3 | `package.json` | Procedural elevation heightmap perturbations & water ripple noise synthesis |
| **Vite** | 6.0.7 | `package.json` | High-speed ESM development server, HMR, and Rollup production bundler |

### Backend & Scientific Computing Ecosystem (Python Host)

| Technology | Version | Location | Architectural Purpose |
| :--- | :--- | :--- | :--- |
| **Python** | $\ge 3.10$ | System | Application runtime environment |
| **Streamlit** | $\ge 1.35.0$ | `requirements.txt` | Web presentation layer, reactive UI widgets, custom component host |
| **PyDeck** | $\ge 0.9.0$ | `requirements.txt` | Large-scale 2D GPU-accelerated geospatial visualization via Deck.gl |
| **NumPy** | $\ge 1.24.0$ | `requirements.txt` | Vectorized matrix operations for 2D mass-balance water depth & flow arrays |
| **Pandas** | $\ge 2.0.0$ | `requirements.txt` | Ward-level population aggregation, CSV dataset parsing |
| **Requests** | $\ge 2.31.0$ | `requirements.txt` | Synchronous HTTP client querying live REST endpoints |
| **SciPy** | $\ge 1.11.0$ | `requirements.txt` | Numerical spatial algorithms and Gaussian interpolation kernels |
| **PyArrow** | $\ge 14.0.0$ | `requirements.txt` | High-throughput columnar serialization for PyDeck data tables |

---

## 🌐 APIs & External Services Catalogue

The application connects to 10 external services and geospatial endpoints, each equipped with deterministic offline fallbacks:

1. **Open-Meteo Weather Forecast API:** Retrieves live 3-day hourly precipitation forecasts ($\text{mm/h}$) based on geographic coordinates.
2. **Open-Meteo GloFAS Flood API:** Queries river discharge ($\text{m}^3/\text{s}$) from the Global Flood Awareness System to model river surge.
3. **CARTO Basemap Positron Vector Style:** Provides dark/light vector basemap styling JSON for Deck.gl / PyDeck in Streamlit.
4. **OpenStreetMap Nominatim Geocoding API:** Powers real-time search in the Mission Portal, converting landmarks into bounding boxes.
5. **Open-Meteo Elevation API:** Queries a $9 \times 9$ coordinate grid of ground elevations; upsampled to $90 \times 90$ via bilinear interpolation.
6. **AWS Nextzen Terrarium Elevation Tiles:** Decodes raster PNG elevation values via $(R \times 256 + G + B / 256) - 32768$ as an elevation fallback.
7. **OpenStreetMap Official REST API:** Ingests actual OpenStreetMap XML/JSON vectors (buildings, highways, waterways, emergency nodes).
8. **Overpass API Interpreters:** Secondary fallback querying complex urban geometries using Overpass QL if OSM REST times out.
9. **CARTO Dark Raster Tile Layer:** Dark-themed slippy map tiles for the interactive coordinate selection modal (`MapPicker2D.tsx`).
10. **ESRI World Dark Gray Canvas:** Alternative minimalist dark base map layer in Leaflet picker.

---

## ⚙️ Environment Variables & Configuration

The application is engineered to be zero-config and keyless by default, running out of the box without requiring external secrets:

| Variable Name | Context / Consumer | Purpose | Required? | Default Fallback |
| :--- | :--- | :--- | :--- | :--- |
| `VITE_CARTO_API_KEY` | Vite / React (`MapPicker2D.tsx`) | Access key for CARTO raster tiles in coordinate picker | No | Hardcoded public key string |
| `PATH` | Python launcher (`run.py`) | Ensures Node.js binary directory is visible in Windows | No | Prepends `C:\Program Files\nodejs` if present |
| `IMD_API_KEY` | `flowshield/README.md` | Reserved for future integration with India Meteorological Dept | No | Not implemented in code |
| `CWC_API_KEY` | `flowshield/README.md` | Reserved for future Central Water Commission sensors | No | Not implemented in code |

---

## 📂 Codebase Directory Layout

flowshield3dmap/
├── app.py                            # Deployment root entry point: delegates via runpy to flowshield/app.py
├── requirements.txt                  # Python dependencies for Streamlit Cloud deployment
├── package.json                      # Node dependencies, scripts, and build targets
├── vite.config.ts                    # Vite build configuration, server port 5173, security headers
├── run.bat                           # 1-Click Windows execution script for Streamlit
├── run.py                            # Standalone Python helper script launching Vite + browser
├── index.html                        # Vite development HTML entry template
├── PROJECT_OVERVIEW.md               # Architectural reference manual
│
├── flowshield/                       # Core Python Streamlit Host Application
│   ├── app.py                        # Monolithic Streamlit application (1,225 lines)
│   ├── requirements.txt              # Sub-package Python dependency mirror
│   └── static/3d/                    # Compiled React distribution files served by Streamlit
│       ├── index.html                # Static HTML iframe container with handshake script
│       ├── assets/                   # Production minified JS bundles, CSS, and Web Workers
│       └── presets/                  # Pre-cached JSON benchmark city datasets (Shibuya, Manhattan, Venice)
│
└── src/                              # React 18 & Three.js Client Source
├── main.tsx                      # React root rendering mount point
├── App.tsx                       # Central application coordinator (561 lines)
├── components/                   # UI Viewports and Overlays
│   ├── Scene3D.tsx               # Three.js 3D Viewport (949 lines): InstancedMesh, fluid shaders, isolines
│   └── HUD/                      # Heads-Up Display Overlay Components (Analytics, Tools, Controls)
├── engine/                       # Simulation Algorithms & Mathematical Models
│   ├── physics.ts                # 2D Diffusive Wave hydrodynamics & cascading outage logic (320 lines)
│   ├── terrain.ts                # City elevation, building, road, and river feature compiler (390 lines)
│   ├── dataBridge.ts             # Ingests raw Overpass JSON and DEM arrays into GridState
│   └── scenarios.ts              # Pre-configured emergency scenarios (Cloudburst, Surge, Dam Failure)
├── services/                     # Network Fetchers & Geospatial Ingestion (DEM, Overpass, Geocoding)
├── types/                        # TypeScript Interface Declarations
├── utils/                        # Planar Mercator projection utilities
└── workers/                      # Web Worker Background Threads
└── physicsWorker.ts          # Off-thread 2D hydrodynamic numerical loop sustaining 60 FPS


---

## 🔄 End-to-End Data Pipeline

Phase 1: Ingestion  ──▶ Phase 2: Macro Sim ──▶ Phase 3: Bridge ──▶ Phase 4: Micro Sim ──▶ Phase 5: 3D Render
(Open-Meteo REST)       (Python NumPy)        (Iframe URL/Msg)    (Web Worker)         (Three.js WebGL)


1. **Phase 1 — Remote Ingestion:** Streamlit connects to Open-Meteo's precipitation and GloFAS river discharge APIs. Switches to synthetic diurnal monsoon profiles if unreachable.
2. **Phase 2 — Python Macro-Scale 2D Simulation:** `FloodSimulationEngine` models rainfall accumulation and drainage clearance over an urban grid ($12 \times 12$ or $72 \times 72$ cells). Rendered via PyDeck map layers.
3. **Phase 3 — Iframe Data Bridge:** Streamlit embeds `/app/static/3d/index.html` via an iframe, appending initial parameters (`?rain=85.0&river=180.0&loc=shibuya`).
4. **Phase 4 — React Micro-Scale Grid Ingestion:** React parses query parameters on mount and loads a high-resolution $90 \times 90$ grid ($8,100$ cells, $1.2\text{ km} \times 1.2\text{ km}$ footprint).
5. **Phase 5 — Background Web Worker Execution:** `physicsWorker.ts` runs hydrodynamic equations asynchronously off the main thread, returning state updates and analytics.
6. **Phase 6 — Three.js GPU Scene Update:** Dynamic fluid surfaces update elevations and normal vectors. Shader animates downhill wave ripples, and Marching Squares re-triangulates isolines.
7. **Phase 7 — Telemetry Streaming:** React emits `FLOWSHIELD_ANALYTICS` messages to `window.parent`, updating Streamlit with affected population counts, maximum depths, and infrastructure outage alerts.

---

## 🌊 Hydrodynamic Physics & Numerical Modeling

The hydrodynamic core implements a mass-conserving 2D diffusive wave overland flow solver:

### 1. Mass Conservation Formulation
At any cell $(x, y)$, fluid volume changes according to the balance of vertical sources/sinks and lateral fluxes:

$$\frac{\partial H}{\partial t} = R(t) - D(x, y) - K(x, y) - \nabla \cdot \mathbf{q}$$

* $H(x, y)$: Surface water depth above local terrain ($\text{m}$).
* $R(t)$: Precipitation intensity applied uniformly across cells ($\text{m/s}$).
* $D(x,y)$: Municipal stormwater drainage capacity ($\text{m/s}$).
* $K(x,y)$: Infiltration permeability ($2\text{ mm/h}$ on asphalt, up to $25\text{ mm/h}$ on soil).
* $\mathbf{q}$: Lateral discharge vector per unit width ($\text{m}^2/\text{s}$).

### 2. Gravity-Driven Hydraulic Head Routing
Overland flow is driven by the gradient of total hydraulic head $\eta$:

$$\eta(x, y) = Z_{\text{ground}}(x, y) + H(x, y)$$

Between cell $i$ and neighbor $j$, head differential is $\Delta\eta_{ij} = \eta_i - \eta_j$. Flux occurs only if $\Delta\eta_{ij} > 0$:

$$q_{ij} = C_{\text{transfer}} \cdot H_i \cdot \frac{\vert{}\Delta\eta_{ij}\vert{}}{\Delta x}$$

### 3. Numerical Stability (CFL Condition)
The maximum transfer fraction per iteration is strictly capped by a Courant-Friedrichs-Lewy (CFL) stability limiter to prevent numerical oscillations:

$$\sum_{j} q_{ij} \cdot \Delta t \le \alpha_{\text{CFL}} \cdot H_i \cdot \Delta x^2, \quad \text{with } \alpha_{\text{CFL}} \le 0.25$$

---

## ⚡ Cascading Infrastructure Failure Engine

The simulation tracks inter-dependent lifeline vulnerabilities in real time:

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


* ⚡ **Power Substation Inundation:** If water depth at a power substation node exceeds $0.35\text{ m}$, the substation trips offline. Stormwater pumps in that quadrant lose power (drainage drops to $0\text{ mm/h}$).
* 🏥 **Hospital Access Isolation:** Road cells within a 5-cell radius of hospitals are monitored. If water depth exceeds $0.40\text{ m}$, the hospital is flagged as **ISOLATED**.
* 🚇 **Subterranean Metro Suspension:** Underground entrances and elevated tracks are monitored. Water depth exceeding $0.25\text{ m}$ halts line operations and flashes the viaduct tube red.

---

## 🎨 3D Digital Twin & WebGL Graphics Pipeline

1. **Solid Voxel Pedestal (`THREE.InstancedMesh`):** Renders 8,100 extruded columns ($90 \times 90$ grid) in a single draw call. Columns extend down to $y=0$ to eliminate visual terrain gaps.
2. **Continuous Water Surface & Downhill Ripple Shader:** Surface water is rendered as a continuous subdivided `PlaneGeometry` mesh draped over terrain. A custom GLSL shader evaluates local topographic gradients ($-\nabla Z$) to direct wave ripples downhill.
   * **Depth Color Ramp:** $<150\text{ mm}$ (Transparent), $150\text{--}199\text{ mm}$ (`#4D96C4`), $200\text{--}249\text{ mm}$ (`#2E86DE`), $\ge 250\text{ mm}$ (`#2952E3`).
3. **Marching Squares 3D Vector Flood Isolines:** Traces fluid-land boundaries dynamically:
   * **Inundation Shoreline ($h \ge 0.04\text{ m}$):** Vibrant Electric Cyan (`#00F0FF`).
   * **Warning Risk Contour ($h \ge 0.18\text{ m}$):** Electric Amber (`#FFB300`).
   * **Critical Hazard Boundary ($h \ge 0.38\text{ m}$):** Neon Coral Red (`#FF1744`).

---

## 🗺️ Real-World Geospatial Ingestion Pipeline (Mission Portal)

User searches city or clicks map ──▶ Nominatim Geocoding ──▶ Ingestion Orchestrator
│
┌───────────────────────────────────────────┴───────────────────────────────────────────┐
▼                                                                                       ▼
Open-Meteo DEM (9×9 Grid)                                                                 OpenStreetMap REST API
│                                                                                       │
▼                                                                                       ▼
Bilinear Interpolation (90×90 DEM)                                                      Planar Mercator Projection
│                                                                                       │
└───────────────────────────────────────────┬───────────────────────────────────────────┘
▼
DataBridge -> Unified GridState (8,100 cells)


---

## 🌉 Streamlit ↔ React Inter-Process Communication Bridge

### Inbound (Streamlit ➔ React)
Initialized via URL query string (`?rain=85.0&river=180.0&loc=shibuya`). Live slider changes emit HTML5 `postMessage` events:

```javascript
window.addEventListener('message', (event) => {
  if (event.data?.type === 'FLOWSHIELD_UPDATE') {
    setRainfallRate(event.data.rainfallRate);
    setRiverSurge(event.data.riverSurge);
  }
});
Outbound (React ➔ Streamlit)
React emits telemetry back to Streamlit every physics step:

JavaScript
window.parent.postMessage({
  type: 'FLOWSHIELD_ANALYTICS',
  affectedPopulation: analytics.affectedPopulation,
  maxDepthM: analytics.maxDepthM,
  criticalPct: analytics.criticalPct,
  metroOperational: analytics.metroOperational
}, '*');
