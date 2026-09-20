# FLOWSHIELD — Flood Simulation & Early Warning Platform

> **Predict the flood. Protect the future.**

FLOWSHIELD is a dual-engine urban flood simulation and early warning command center combining a **Python/Streamlit** operational dashboard with a **React 18 / Three.js** 3D digital twin engine.

---

## Architecture

```
d:\Projects\Flood\
├── flowshield/               # Python/Streamlit host application
│   ├── app.py                # Main Streamlit dashboard (port 8501)
│   ├── live_warning_service.py   # Predictive 24h flood warning engine
│   ├── location_service.py   # Global geocoding & city config
│   ├── historical_flood_data.py  # SAR-based flood archive
│   ├── floodpy_pipeline.py   # Floodpy batch extraction pipeline
│   ├── live_location_widget.py   # Browser Geolocation API bridge
│   ├── location_search_widget.py # Nominatim autocomplete widget
│   └── static/3d/            # ← compiled React bundle goes here (git-ignored)
├── src/                      # React / Three.js 3D Digital Twin engine
│   ├── App.tsx               # Root component + Streamlit postMessage bridge
│   ├── engine/               # Physics, terrain, damage assessment
│   ├── components/HUD/       # HUD panels (sliders, analytics, maps)
│   ├── services/             # Overpass API, elevation, geocoding
│   └── workers/              # Web Worker physics engine
├── public/                   # Static presets and icons
├── .streamlit/config.toml    # Streamlit config (enableStaticServing = true)
├── app.py                    # Root Streamlit entry point
├── package.json              # NPM scripts
├── vite.config.ts            # Vite config (relative base for iframe serving)
└── requirements.txt          # Python dependencies
```

---

## Quickstart

### Prerequisites
- **Node.js** 18+ and **npm**
- **Python** 3.9+
- Install Python dependencies: `pip install -r requirements.txt`
- Install Node dependencies: `npm install`

### Step 1: Build the 3D Digital Twin bundle
```bash
npm run build
```
This compiles the React/Three.js engine and automatically copies the built files into `flowshield/static/3d/` (served by Streamlit via static serving).

### Step 2: Run the full platform
```bash
python -m streamlit run app.py
```
Open [http://localhost:8501](http://localhost:8501)

---

## Other Run Methods

| Command | Description |
|---|---|
| `npm run dev` | Run standalone React 3D twin on `http://localhost:5173` |
| `npm run dev:streamlit` | Run Streamlit dashboard only |
| `npm run build` | Build 3D bundle and deploy to `flowshield/static/3d/` |
| `python run.py` | Launch React dev server and open browser |
| `run.bat` | Windows batch launcher |

---

## Features

### 3D Digital Twin Engine
- **3D Diorama**: 90×90 grid voxel city rendered at 60fps with Three.js `InstancedMesh`
- **2D GIS Map**: Live Leaflet water depth heatmap synchronized with 3D simulation
- **Split Viewport**: Side-by-side 3D and 2D view
- **Web Worker Physics**: 20 ticks/sec hydrodynamic shallow-water simulation
- **Damage Assessment**: Real-time economic loss and population exposure
- **Cascading Failures**: Power grid → drainage pump → flood acceleration chain

### River Inflow Detection (2.5 km Buffer)
- Queries OpenStreetMap Overpass API within a 2.5 km bounding box
- Three states: **Direct channel** (internal), **Nearby** (within 2.5 km, with directional trajectory), **Inactive** (no river found)
- Dynamically enables/disables the River Inflow Dial

### Streamlit Host Dashboard
- **Live Sensors**: Real-time Open-Meteo weather and river discharge API
- **2D Forecast Map**: PyDeck flood propagation visualization
- **Predictive Warnings**: 24h cell-level RED SEVERE flood prediction
- **Live Geolocation**: Browser GPS → flood risk mapping at user's exact grid cell
- **Historical Archive**: 10+ historical storm events with SAR validation
- **Scenario Mode**: Design storm stress testing and drainage clogging scenarios

### Streamlit ↔ React Bridge
- URL parameter injection (`?rain=&river=&loc=&city=`) for iframe state seeding
- Bidirectional `postMessage`: `streamlit:render` / `FLOWSHIELD_UPDATE` → React; analytics back via `FLOWSHIELD_ANALYTICS`

---

## Physics Model

### Inflow & Surface Runoff
$$\Delta H_{precip} = \frac{R(t)}{1000} \cdot \Delta t$$

### Infiltration & Drainage
$$\Delta H_{drain} = \min\left(H, \frac{D(x,y) + K(x,y)}{1000} \cdot \Delta t\right)$$

### Gravity-Driven Head Routing
$$\eta(x,y) = Z_{ground}(x,y) + H(x,y), \quad \Delta\eta_{ij} = \eta_i - \eta_j$$

---

## License
MIT
