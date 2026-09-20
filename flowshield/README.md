# 🌊 FLOWSHIELD — Flood Simulation & Early Warning Dashboard

> **Hackathon Prototype** · India Monsoon Edition · Built with Streamlit + PyDeck + NumPy

---

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Run the Dashboard

```bash
streamlit run app.py
```

Open **http://localhost:8501** in your browser.

### 3. Environment Variables (Optional)

| Variable | Purpose | Default |
|---|---|---|
| `IMD_API_KEY` | Future IMD rainfall API key | *(not required)* |
| `CWC_API_KEY` | Future Central Water Commission key | *(not required)* |

No API keys are required to run the prototype. Open-Meteo is free and keyless.

---

## How the Flood Simulation Works

### Grid Model
The selected city is divided into a **12 × 12 grid** (144 cells, each ≈ 1 km²).
Every time step advances one hour over a 24-hour horizon.

### Per-Cell Water Balance

```
New Depth[i,j] = Old Depth[i,j]
               + Effective Rainfall   (hourly mm → metres, scaled by rain_mult)
               + River Inflow         (GloFAS discharge distributed to low-elevation cells)
               - Effective Drainage   (min of drain capacity and available water)
               + Lateral Flow         (water flowing in/out from neighbours)
```

### Terrain-Guided Flow
Hydraulic Head = Terrain Elevation + Water Depth.
Water moves from higher-head cells to lower-head cells at a small fraction (5 %) per hour — stable, fast, visually realistic without full CFD.

### Risk Classification
| Level | Water Depth | Color |
|---|---|---|
| Safe | < 0.15 m | 🟢 Green |
| Warning | 0.15 – 0.40 m | 🟡 Amber |
| Critical | ≥ 0.40 m | 🔴 Red |
| Newly Flooded (scenario) | n/a | 🟣 Magenta |

---

## Forecast Mode vs. Scenario Mode

| Feature | Forecast Mode | Scenario Mode |
|---|---|---|
| **Input data** | Live API (Open-Meteo + GloFAS) | Same cached data |
| **Rain multiplier** | Fixed at 1.0× | Adjustable 0–4× |
| **Storm duration** | Full 24 h | Adjustable 1–24 h |
| **Drainage clogging** | 0 % | Adjustable 0–100 % |
| **River surge** | 1× baseline | Adjustable 0.5–5× |
| **Infrastructure failure** | None | User-selectable cells |
| **API requests on slider change** | — | ❌ Never (uses cached data) |
| **Comparison panel** | Not shown | ✅ Shown (Δ wards, Δ area, Δ pop) |

**Key principle:** Sliders never trigger network calls. Data is fetched once, cached for 1 hour, and all scenario variations run as pure NumPy operations (~50–200 ms).

---

## Data Sources

| Provider | Live Source | Fallback |
|---|---|---|
| **WeatherProvider** | Open-Meteo hourly precipitation | Synthetic monsoon diurnal profile |
| **HydrologyProvider** | GloFAS daily river discharge | Synthetic monsoon discharge |
| **ElevationProvider** | Synthetic DEM (city-shaped) | Same synthetic |
| **Drainage / Population** | Synthetic municipal-grade grid | Same synthetic |

All providers use a modular class interface — swap implementations by editing the respective `fetch()` method.

---

## Architecture

```
WeatherProvider   HydrologyProvider   ElevationProvider
     │                   │                   │
     └───────────────────┴───────────────────┘
                         │
              FloodSimulationEngine (NumPy)
                         │
         ┌───────────────┴───────────────┐
         │                               │
   Baseline History               Scenario History
   (24-hr pre-computed)           (24-hr pre-computed)
         │                               │
         └───────────────┬───────────────┘
                         │
                  Streamlit UI
              ┌──────────┼──────────┐
           Map (PyDeck)  KPIs   Warning Table
```

---

## Scenario Presets

| Preset | Rain | Duration | Clogging | River |
|---|---|---|---|---|
| Live Forecast | 1.0× | 24 h | 0 % | 1.0× |
| Monsoon Cloudburst | 3.0× | 6 h | 30 % | 2.0× |
| 70% Drainage Choke | 1.5× | 12 h | 70 % | 1.5× |
