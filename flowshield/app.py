# -*- coding: utf-8 -*-
"""
FLOWSHIELD — Flood Simulation & Early Warning
Map-first interface | Python + Streamlit + PyDeck

Data flow (unchanged architecture)
----------------------------------
  Open-Meteo rainfall  +  GloFAS river discharge  +  synthetic DEM
  +  Karnataka taluk drainage sheet (drainage density / slope)
                     |
                     v
          FloodSimulationEngine (NumPy grid model)
                     |
                     v
          Simulated surface-water depth (mm) per 1 km cell, per hour
                     |
                     v
          Map colour:  Blue -> Yellow -> Orange -> Red

Rainfall is an INPUT. Map colour is the model's OUTPUT depth. The two are
never wired together directly.

Per-hour cell balance, the gridded form of (R * Sm) - (Cd * D) > Hmax:
    depth(t+1) = depth(t)
                 + rainfall(t) * runoff_coefficient        (R)
                 + river inflow * surge                    (Sm)
                 - piped drainage capacity                 (Cd, applied each hour D)
                 - recession (infiltration / sub-surface outflow)
                 + lateral flow along the hydraulic gradient
The 150 mm blue/yellow boundary plays the role of Hmax: below it the drainage
and available surface storage coped, above it the cell is flooding.
"""

import csv
import math
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import pydeck as pdk
import requests
import streamlit as st
import streamlit.components.v1 as components

# ──────────────────────────────────────────────────────────────────
#  CONSTANTS
# ──────────────────────────────────────────────────────────────────

GRID_SIZE = 12            # 12x12 cells
CELL_SIZE_KM = 1.0        # each cell ~1 km^2
SIM_HOURS = 24            # exactly 24 forecast hours

# ── Flood depth thresholds, in MILLIMETRES of simulated surface water ──
#    < 150      Blue    slight / minimal
#    150 - 199  Yellow  mild
#    200 - 249  Orange  significant
#    >= 250     Red     severe / deep
DEPTH_MILD_MM = 150.0
DEPTH_SIGNIFICANT_MM = 200.0
DEPTH_SEVERE_MM = 250.0

FLOODED_AREA_THRESHOLD_MM = DEPTH_MILD_MM   # counted as "flooded" from here up
CRITICAL_DEPTH_MM = DEPTH_SEVERE_MM

# Map fill colours [R, G, B, A]. Blue keeps a low alpha so the basemap and the
# grid stay readable where nothing much is happening.
COLOR_MINIMAL     = [59, 130, 246, 60]
COLOR_MILD        = [234, 179, 8, 125]
COLOR_SIGNIFICANT = [249, 115, 22, 160]
COLOR_SEVERE      = [239, 68, 68, 190]
COLOR_GRID_LINE   = [120, 140, 170, 90]

MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"

# Drainage dataset — looked for next to this file
DRAINAGE_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "karnataka_taluk_drainage.csv")

CITIES = {
    "Bengaluru": {
        "lat": 12.9716, "lon": 77.5946,
        "timezone": "Asia/Kolkata",
        "terrain": "undulating",
        "pop_density_base": 12000,
        # Taluks covering the modelled grid, by compass sector from the centre.
        "taluks": {
            "centre": "Bengaluru",
            "north": "Yelahanka",
            "east": "Krishnarajapura",
            "south": "Anekal",
            "west": "Kengeri",
        },
        "fallback_drainage_mm_h": 10.6,
    },
}

# ──────────────────────────────────────────────────────────────────
#  STREAMLIT COMPATIBILITY HELPERS
# ──────────────────────────────────────────────────────────────────

def _accepts(fn, param: str) -> bool:
    import inspect
    try:
        return param in inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return False


def stretch(fn) -> Dict:
    """Kwargs that make `fn` fill its container, on old or new Streamlit."""
    if _accepts(fn, "width"):
        return {"width": "stretch"}
    if _accepts(fn, "use_container_width"):
        return {"use_container_width": True}
    return {}


def columns(spec, gap: str = "small", align: Optional[str] = None):
    kwargs: Dict = {"gap": gap}
    if align and _accepts(st.columns, "vertical_alignment"):
        kwargs["vertical_alignment"] = align
    return st.columns(spec, **kwargs)


# ──────────────────────────────────────────────────────────────────
#  DRAINAGE DATASET
# ──────────────────────────────────────────────────────────────────
#  What the uploaded sheet actually contains, and what it does not:
#
#  Present : area, stream length, drainage density (km/km2), mean slope (%),
#            average annual rainfall (mm), hydrological zone.
#  Absent  : drain capacity (cu m/s). The sheet states plainly that this column
#            was left blank because there is no defensible basis for estimating
#            it without local-body records.
#
#  So drainage capacity is DERIVED from drainage density and slope through the
#  transfer function below, rather than read from the sheet. The sheet also
#  warns its values are regional estimates with roughly +/-30% error on density,
#  and every Bengaluru taluk in it carries identical figures, so the dataset
#  fixes the city-wide level of drainage but carries no sub-taluk detail.
# ──────────────────────────────────────────────────────────────────

# mm/h of removal capacity per unit of drainage density (km/km^2).
# Anchors Bengaluru (density 1.6, slope 3.5%) near 10.6 mm/h, consistent with
# reporting that BBMP storm drains surcharge well below their design intensity.
DRAIN_K_MM_H = 6.0
DRAIN_SLOPE_GAIN = 0.03        # faster conveyance on steeper ground
SUBTALUK_VARIATION = 0.20      # +/-20% synthetic within-taluk spread (see note)


@st.cache_data(show_spinner=False)
def load_drainage_dataset() -> Tuple[Dict[str, Dict], str]:
    """
    Read the taluk drainage sheet. Returns (rows_by_taluk, status_message).
    A missing file is not fatal — the app falls back to documented defaults.
    """
    if not os.path.exists(DRAINAGE_CSV):
        return {}, "not found"
    try:
        rows: Dict[str, Dict] = {}
        with open(DRAINAGE_CSV, newline="", encoding="utf-8") as fh:
            for rec in csv.DictReader(fh):
                name = (rec.get("taluk") or "").strip()
                if not name:
                    continue

                def num(key: str) -> Optional[float]:
                    raw = (rec.get(key) or "").strip().replace("~", "").replace(",", "")
                    try:
                        return float(raw)
                    except ValueError:
                        return None

                rows[name] = {
                    "taluk": name,
                    "district": (rec.get("district") or "").strip(),
                    "basin": (rec.get("primary_basin") or "").strip(),
                    "density": num("drainage_density_km_per_sq_km_est"),
                    "slope_pct": num("mean_slope_pct_est"),
                    "annual_rain_mm": num("avg_annual_rain_mm_est"),
                    "capacity_cumecs": num("drain_capacity_cumecs"),  # blank in sheet
                    "zone": (rec.get("zone") or "").strip(),
                }
        return rows, f"loaded {len(rows)} taluks"
    except Exception as exc:
        return {}, f"unreadable ({type(exc).__name__})"


def capacity_from_dataset(density: float, slope_pct: float) -> float:
    """Derive piped drainage capacity in mm/h from drainage density and slope."""
    return DRAIN_K_MM_H * density * (1.0 + DRAIN_SLOPE_GAIN * slope_pct)


def sector_of(i: int, j: int, g: int) -> str:
    """Compass sector of a grid cell, used to attach a taluk to each cell."""
    ci = cj = (g - 1) / 2.0
    di, dj = i - ci, j - cj
    if abs(di) <= g * 0.17 and abs(dj) <= g * 0.17:
        return "centre"
    if abs(di) >= abs(dj):
        return "north" if di > 0 else "south"
    return "east" if dj > 0 else "west"


@st.cache_data(show_spinner=False)
def build_drainage_grid(city_name: str) -> Tuple[np.ndarray, np.ndarray, Dict]:
    """
    Per-cell drainage capacity (mm/h) and the taluk label behind each cell.

    Capacity comes from the dataset's drainage density and slope. A small
    deterministic +/-20% spread is layered on top because the sheet resolves
    only to taluk level and every Bengaluru taluk in it carries identical
    figures — without it the whole grid would drain at one uniform rate. That
    spread is synthetic and is labelled as such in the UI.
    """
    cfg = CITIES[city_name]
    dataset, status = load_drainage_dataset()
    g = GRID_SIZE
    rng = np.random.default_rng(seed=abs(hash(city_name)) % 9999)

    capacity = np.zeros((g, g), dtype=np.float32)
    labels = np.empty((g, g), dtype=object)

    used_rows: Dict[str, Dict] = {}
    missing: List[str] = []
    for i in range(g):
        for j in range(g):
            taluk = cfg["taluks"][sector_of(i, j, g)]
            row = dataset.get(taluk)
            if row and row.get("density") and row.get("slope_pct") is not None:
                base = capacity_from_dataset(row["density"], row["slope_pct"])
                used_rows[taluk] = row
            else:
                base = cfg["fallback_drainage_mm_h"]
                if taluk not in missing:
                    missing.append(taluk)
            capacity[i, j] = base
            labels[i, j] = taluk

    spread = rng.uniform(1.0 - SUBTALUK_VARIATION, 1.0 + SUBTALUK_VARIATION, (g, g))
    capacity = (capacity * spread).astype(np.float32)

    meta = {
        "status": status,
        "dataset_backed": bool(used_rows),
        "taluks": sorted({str(x) for x in labels.flatten().tolist()}),
        "missing": missing,
        "mean_capacity_mm_h": float(capacity.mean()),
        "density": next((r["density"] for r in used_rows.values()), None),
        "slope_pct": next((r["slope_pct"] for r in used_rows.values()), None),
        "basin": next((r["basin"] for r in used_rows.values()), ""),
    }
    return capacity, labels, meta


@st.cache_data(show_spinner=False)
def build_population_grid(city_name: str) -> np.ndarray:
    cfg = CITIES[city_name]
    g = GRID_SIZE
    rng = np.random.default_rng(seed=abs(hash(city_name + "pop")) % 9999)
    cx = cy = g // 2
    ii, jj = np.mgrid[0:g, 0:g]
    dist = np.sqrt((ii - cx) ** 2 + (jj - cy) ** 2)
    pop = (cfg["pop_density_base"] * np.exp(-dist / (g * 0.4))).astype(np.float32)
    pop += rng.uniform(-1000, 2000, (g, g)).astype(np.float32)
    return np.clip(pop, 500, cfg["pop_density_base"] * 2)


# ──────────────────────────────────────────────────────────────────
#  DATA PROVIDERS
# ──────────────────────────────────────────────────────────────────

class WeatherProvider:
    """Hourly precipitation from Open-Meteo, aligned to the current local hour."""

    OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

    def fetch(self, lat: float, lon: float, tz_name: str) -> Dict:
        try:
            resp = requests.get(self.OPEN_METEO_URL, timeout=8, params={
                "latitude": lat, "longitude": lon,
                "hourly": "precipitation", "forecast_days": 3, "timezone": tz_name,
            })
            resp.raise_for_status()
            data = resp.json()
            times = data["hourly"]["time"]
            values = data["hourly"]["precipitation"]
            offset = int(data.get("utc_offset_seconds", 0))
            start = self._current_hour_index(times, offset)

            precip = [float(v or 0.0) for v in values[start:start + SIM_HOURS]]
            while len(precip) < SIM_HOURS:
                precip.append(0.0)

            return {
                "hourly_precip_mm": precip,
                "source": "Open-Meteo (live)",
                "window_start_local": (times[start].replace("T", " ")
                                       if start < len(times) else "—"),
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            return self._synthetic_fallback(lat, lon, type(exc).__name__)

    @staticmethod
    def _current_hour_index(times: List[str], utc_offset_seconds: int) -> int:
        now_local = datetime.now(timezone.utc) + timedelta(seconds=utc_offset_seconds)
        stamp = now_local.strftime("%Y-%m-%dT%H:00")
        if stamp in times:
            return times.index(stamp)
        for idx, t in enumerate(times):
            if t >= stamp:
                return idx
        return 0

    def _synthetic_fallback(self, lat: float, lon: float, reason: str = "") -> Dict:
        rng = np.random.default_rng(seed=int(abs(lat * lon)) % 9999)
        base = rng.uniform(0.5, 2.5, SIM_HOURS)
        diurnal = np.array([
            0.2, 0.1, 0.1, 0.1, 0.2, 0.4, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.5,
            3.0, 3.5, 3.8, 3.5, 3.0, 2.5, 2.0, 1.5, 1.0, 0.7, 0.5, 0.4,
        ])[:SIM_HOURS]
        start_hour = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).hour
        diurnal = np.roll(diurnal, -start_hour % len(diurnal))
        return {
            "hourly_precip_mm": (base * diurnal).tolist(),
            "source": f"Synthetic fallback ({reason or 'offline'})",
            "window_start_local": "—",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }


class HydrologyProvider:
    """River discharge from the Open-Meteo GloFAS flood API."""

    GLOFAS_URL = "https://flood-api.open-meteo.com/v1/flood"

    def fetch(self, lat: float, lon: float) -> Dict:
        try:
            resp = requests.get(self.GLOFAS_URL, timeout=8, params={
                "latitude": lat, "longitude": lon,
                "daily": "river_discharge", "forecast_days": 1,
            })
            resp.raise_for_status()
            value = resp.json()["daily"]["river_discharge"][0]
            if value is None:
                raise ValueError("no discharge at this point")
            return {"river_discharge_m3s": float(value),
                    "source": "GloFAS / Open-Meteo (live)"}
        except Exception as exc:
            rng = np.random.default_rng(int(abs(lat + lon) * 100) % 9999)
            return {"river_discharge_m3s": float(rng.uniform(50, 250)),
                    "source": f"Synthetic fallback ({type(exc).__name__})"}


class ElevationProvider:
    """Synthetic DEM shaped by terrain type. Hook: Bhuvan / Cartosat DEM."""

    def fetch(self, city_name: str, city_cfg: Dict) -> np.ndarray:
        terrain = city_cfg.get("terrain", "undulating")
        rng = np.random.default_rng(
            int(abs(city_cfg["lat"] * city_cfg["lon"] * 100)) % 9999)
        g = GRID_SIZE
        if terrain == "undulating":
            x = np.linspace(0, 2 * math.pi, g)
            xx, yy = np.meshgrid(x, x)
            dem = (900 + 40 * np.sin(xx) + 30 * np.cos(yy * 0.7)
                   + 15 * np.sin(xx * 1.3 + yy) + rng.uniform(-5, 5, (g, g)))
        else:
            dem = 900 + rng.uniform(-5, 5, (g, g))
        return dem.astype(np.float32)


def river_ingress_mask(elevation: np.ndarray, percentile: float = 20.0) -> np.ndarray:
    """Lowest cells, where river water enters the grid. One shared definition."""
    flat = elevation.flatten()
    return (flat <= np.percentile(flat, percentile)).reshape(elevation.shape)


# ──────────────────────────────────────────────────────────────────
#  FLOOD SIMULATION ENGINE
# ──────────────────────────────────────────────────────────────────

class FloodSimulationEngine:
    """
    Grid-based hourly surface-water model. Depth is carried in METRES
    internally and converted to mm only for display and classification.
    """

    # Share of rainfall that becomes surface runoff on dense urban ground
    # rather than infiltrating. Bengaluru's built-up core is largely sealed.
    RUNOFF_COEFFICIENT = 0.85

    # Head-driven recession: infiltration and sub-surface/channel outflow that
    # continues once the piped network is at capacity. Without it the grid is a
    # closed basin and any DEM minimum fills without bound.
    RECESSION_RATE = 0.07
    CLOG_BLOCKS_RECESSION = 0.6

    LATERAL_ALPHA = 0.25
    # Share of a cell's water that may move downhill in one hour. Kept low:
    # at higher values the synthetic DEM's minima swallow the whole grid and
    # the map degenerates into a few cells at implausible metre-scale depths
    # surrounded by dry ground.
    LATERAL_MAX_FRAC = 0.06

    def __init__(self, elevation: np.ndarray, drainage_mm_h: np.ndarray,
                 cell_area_km2: float = CELL_SIZE_KM ** 2):
        self.elevation = elevation
        self.drainage_m_h = (drainage_mm_h / 1000.0).astype(np.float32)
        self.cell_area_km2 = cell_area_km2
        self.g = elevation.shape[0]

    def run(
        self,
        hourly_precip_mm: List[float],
        river_discharge_m3s: float,
        rain_mult: float = 1.0,
        design_storm_mm_h: float = 0.0,
        storm_duration_h: int = SIM_HOURS,
        drain_clog_frac: float = 0.0,
        river_surge_mult: float = 1.0,
    ) -> np.ndarray:
        """Returns depth history in METRES, shape (SIM_HOURS + 1, g, g)."""
        g = self.g
        water = np.zeros((g, g), dtype=np.float32)
        drain_eff = self.drainage_m_h * (1.0 - drain_clog_frac)

        river_inflow_m_h = (river_discharge_m3s * river_surge_mult * 3600.0
                            / (g * g * self.cell_area_km2 * 1e6))
        river_mask = river_ingress_mask(self.elevation)

        history = np.zeros((SIM_HOURS + 1, g, g), dtype=np.float32)

        for t in range(SIM_HOURS):
            if t < storm_duration_h:
                if design_storm_mm_h > 0.0:
                    raw_mm = design_storm_mm_h            # synthetic design storm
                elif t < len(hourly_precip_mm):
                    raw_mm = float(hourly_precip_mm[t]) * rain_mult
                else:
                    raw_mm = 0.0
            else:
                raw_mm = 0.0

            rain_m = (raw_mm / 1000.0) * self.RUNOFF_COEFFICIENT
            river_in = np.where(river_mask, river_inflow_m_h, 0.0)
            removed = np.minimum(drain_eff, water + rain_m)

            recession = (self.RECESSION_RATE * water
                         * (1.0 - drain_clog_frac * self.CLOG_BLOCKS_RECESSION))
            recession = np.minimum(recession, np.maximum(water - removed, 0.0))

            lateral = self._lateral_flow(water, self.elevation + water)

            water = water + rain_m + river_in - removed - recession + lateral
            water = np.maximum(water, 0.0)
            history[t + 1] = water.copy()

        return history

    def _lateral_flow(self, water: np.ndarray, head: np.ndarray) -> np.ndarray:
        """
        Mass-conserving neighbour transfer from higher to lower hydraulic head.

        Outflow is capped by the water actually present and by half the head
        difference, then the four directional outflows are scaled so no cell
        loses more than LATERAL_MAX_FRAC of its depth in an hour. Flows that
        would wrap around the grid edge are zeroed, so the domain is closed
        rather than toroidal and total mass is preserved exactly.
        """
        dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
        potentials: List[np.ndarray] = []
        total_out = np.zeros_like(water)

        for dr, dc in dirs:
            shifted = np.roll(head, shift=(-dr, -dc), axis=(0, 1))
            diff = np.maximum(head - shifted, 0.0)
            pot = self.LATERAL_ALPHA * np.minimum(diff * 0.5, water)
            pot = np.maximum(pot, 0.0).astype(np.float32)
            if dr == -1:
                pot[0, :] = 0.0
            elif dr == 1:
                pot[-1, :] = 0.0
            elif dc == -1:
                pot[:, 0] = 0.0
            elif dc == 1:
                pot[:, -1] = 0.0
            potentials.append(pot)
            total_out += pot

        allowance = water * self.LATERAL_MAX_FRAC
        scale = np.where(total_out > 1e-12,
                         np.minimum(1.0, allowance / np.maximum(total_out, 1e-12)),
                         0.0).astype(np.float32)

        delta = np.zeros_like(water)
        for (dr, dc), pot in zip(dirs, potentials):
            flow = (pot * scale).astype(np.float32)
            delta -= flow
            delta += np.roll(flow, shift=(dr, dc), axis=(0, 1))
        return delta


# ──────────────────────────────────────────────────────────────────
#  CACHED LOADERS AND RUNS
# ──────────────────────────────────────────────────────────────────

@st.cache_data(ttl=3600, show_spinner=False)
def load_weather(city_name: str) -> Dict:
    cfg = CITIES[city_name]
    return WeatherProvider().fetch(cfg["lat"], cfg["lon"], cfg["timezone"])


@st.cache_data(ttl=3600, show_spinner=False)
def load_hydrology(city_name: str) -> Dict:
    cfg = CITIES[city_name]
    return HydrologyProvider().fetch(cfg["lat"], cfg["lon"])


@st.cache_data(show_spinner=False)
def load_elevation(city_name: str) -> np.ndarray:
    return ElevationProvider().fetch(city_name, CITIES[city_name])


@st.cache_resource(show_spinner=False)
def _engine(city_name: str) -> FloodSimulationEngine:
    capacity, _, _ = build_drainage_grid(city_name)
    return FloodSimulationEngine(load_elevation(city_name), capacity)


@st.cache_data(show_spinner=False)
def run_baseline_simulation(city_name: str) -> np.ndarray:
    weather = load_weather(city_name)
    hydro = load_hydrology(city_name)
    return _engine(city_name).run(weather["hourly_precip_mm"],
                                  hydro["river_discharge_m3s"])


@st.cache_data(show_spinner=False)
def run_scenario_simulation(city_name: str, rain_mult: float,
                            design_storm_mm_h: float, storm_duration_h: int,
                            drain_clog_frac: float, river_surge: float) -> np.ndarray:
    """Scenario run off the same cached API inputs — no new network calls."""
    if (rain_mult == 1.0 and design_storm_mm_h == 0.0 and
            drain_clog_frac == 0.0 and river_surge == 1.0):
        return run_baseline_simulation(city_name)
    weather = load_weather(city_name)
    hydro = load_hydrology(city_name)
    return _engine(city_name).run(
        weather["hourly_precip_mm"], hydro["river_discharge_m3s"],
        rain_mult=rain_mult, design_storm_mm_h=design_storm_mm_h,
        storm_duration_h=storm_duration_h, drain_clog_frac=drain_clog_frac,
        river_surge_mult=river_surge,
    )


# ──────────────────────────────────────────────────────────────────
#  SEVERITY  (always from simulated depth in mm, never from rainfall)
# ──────────────────────────────────────────────────────────────────

SEVERITY_LABELS = ("Minimal", "Mild", "Significant", "Severe")


def severity_at_depth_mm(depth_mm: float) -> Tuple[int, str]:
    if depth_mm < DEPTH_MILD_MM:
        return 0, SEVERITY_LABELS[0]
    if depth_mm < DEPTH_SIGNIFICANT_MM:
        return 1, SEVERITY_LABELS[1]
    if depth_mm < DEPTH_SEVERE_MM:
        return 2, SEVERITY_LABELS[2]
    return 3, SEVERITY_LABELS[3]


def color_for_depth_mm(depth_mm: float) -> List[int]:
    """Every cell is always drawn, so the grid stays visible over the city."""
    code, _ = severity_at_depth_mm(depth_mm)
    return [COLOR_MINIMAL, COLOR_MILD, COLOR_SIGNIFICANT, COLOR_SEVERE][code]


def compute_kpis(depth_mm: np.ndarray, pop_density: np.ndarray) -> Dict:
    flooded = depth_mm >= FLOODED_AREA_THRESHOLD_MM
    return {
        "peak_depth_mm": float(depth_mm.max()),
        "flooded_km2": float(flooded.sum() * CELL_SIZE_KM ** 2),
        "severe_cells": int((depth_mm >= CRITICAL_DEPTH_MM).sum()),
        "impacted_pop": int((flooded * pop_density * CELL_SIZE_KM ** 2).sum()),
    }


# ──────────────────────────────────────────────────────────────────
#  MAP
# ──────────────────────────────────────────────────────────────────

def _cell_polygon(i: int, j: int, cfg: Dict, g: int) -> List[List[float]]:
    dlat = CELL_SIZE_KM / 111.0
    dlon = CELL_SIZE_KM / (111.0 * math.cos(math.radians(cfg["lat"])))
    lat_c = cfg["lat"] + (i - g / 2) * dlat
    lon_c = cfg["lon"] + (j - g / 2) * dlon
    hlat, hlon = dlat / 2, dlon / 2
    return [
        [lon_c - hlon, lat_c - hlat], [lon_c + hlon, lat_c - hlat],
        [lon_c + hlon, lat_c + hlat], [lon_c - hlon, lat_c + hlat],
        [lon_c - hlon, lat_c - hlat],
    ]


@st.cache_data(show_spinner=False)
def static_map_columns(city_name: str) -> pd.DataFrame:
    """
    The half of the map frame that never changes: geometry, taluk, drainage,
    elevation, river flag, population. Built once per city and reused on every
    rerun, so dragging a slider no longer recomputes 144 polygons and 144
    formatted strings that were identical the frame before.
    """
    cfg = CITIES[city_name]
    elevation = load_elevation(city_name)
    drainage_mm_h, taluk_labels, _ = build_drainage_grid(city_name)
    pop_density = build_population_grid(city_name)
    river_mask = river_ingress_mask(elevation)
    g = GRID_SIZE

    rows = []
    for i in range(g):
        for j in range(g):
            rows.append({
                "polygon": _cell_polygon(i, j, cfg, g),
                "grid_id": f"G{i:02d}-{j:02d}",
                "taluk": str(taluk_labels[i, j]),
                "drain_mm_h": f"{float(drainage_mm_h[i, j]):.1f}",
                "elev_m": f"{float(elevation[i, j]):.0f}",
                "river": "Yes" if river_mask[i, j] else "No",
                "population": f"{int(pop_density[i, j] * CELL_SIZE_KM ** 2):,}",
                "line_color": COLOR_GRID_LINE,
            })
    return pd.DataFrame(rows)


_SEVERITY_COLORS = [COLOR_MINIMAL, COLOR_MILD, COLOR_SIGNIFICANT, COLOR_SEVERE]
_SEVERITY_UPPER = [s.upper() for s in SEVERITY_LABELS]


@st.cache_data(show_spinner=False)
def static_map_records(city_name: str) -> List[Dict]:
    return static_map_columns(city_name).to_dict("records")


def build_map_frame(city_name: str, depth_m: np.ndarray,
                    rain_this_hour_mm: float, hour: int) -> List[Dict]:
    """Attach this hour's depth, severity and colour to the cached static records."""
    records = static_map_records(city_name)
    depth_mm = (depth_m.flatten() * 1000.0)
    codes = np.digitize(depth_mm, [DEPTH_MILD_MM, DEPTH_SIGNIFICANT_MM, DEPTH_SEVERE_MM])
    rain_str = f"{rain_this_hour_mm:.1f}"
    hour_str = str(hour)

    out = []
    for idx, r in enumerate(records):
        c = codes[idx]
        nr = dict(r)
        nr["depth_mm"] = f"{depth_mm[idx]:.0f}"
        nr["severity"] = _SEVERITY_UPPER[c]
        nr["fill_color"] = _SEVERITY_COLORS[c]
        nr["rain_mm_h"] = rain_str
        nr["hour"] = hour_str
        out.append(nr)
    return out


def render_map(data: List[Dict], cfg: Dict, height: int = 620) -> None:
    layer = pdk.Layer(
        "PolygonLayer", data=data,
        get_polygon="polygon", get_fill_color="fill_color",
        get_line_color="line_color", get_line_width=40,
        line_width_min_pixels=1, stroked=True, filled=True,
        pickable=True, auto_highlight=True,
    )
    deck = pdk.Deck(
        layers=[layer],
        initial_view_state=pdk.ViewState(latitude=cfg["lat"], longitude=cfg["lon"],
                                         zoom=10.7, pitch=0, bearing=0),
        tooltip={"html": (
            "<div style='font-size:12px;line-height:1.5'>"
            "<b>{grid_id}</b> · {taluk} · hour {hour}<br/>"
            "Simulated depth: <b>{depth_mm} mm</b><br/>"
            "Severity: <b>{severity}</b><br/>"
            "<span style='color:#9aa'>Rainfall input: {rain_mm_h} mm/h</span><br/>"
            "<span style='color:#9aa'>Drainage capacity: {drain_mm_h} mm/h</span><br/>"
            "<span style='color:#9aa'>Elevation: {elev_m} m · river cell: {river}</span><br/>"
            "<span style='color:#9aa'>Modelled population: {population}</span></div>"),
            "style": {"backgroundColor": "#0a0a0a", "color": "#f5f5f5",
                      "border": "1px solid #262626", "borderRadius": "4px"}},
        map_style=MAP_STYLE,
    )
    # A stable key lets Streamlit reuse the existing deck.gl component instead
    # of tearing down and re-initialising WebGL on every rerun. This is the
    # single biggest source of the perceived lag when dragging a slider.
    kwargs = dict(stretch(st.pydeck_chart))
    if _accepts(st.pydeck_chart, "key"):
        kwargs["key"] = "flood_map"
    try:
        st.pydeck_chart(deck, height=height, **kwargs)
    except TypeError:
        st.pydeck_chart(deck, **kwargs)


def render_legend() -> None:
    st.markdown(
        """
        <div class="legend-bar">
          <span class="legend-head">Simulated flood depth</span>
          <span class="legend-item"><i class="sw sw-blue"></i>&lt; 150 mm · Minimal</span>
          <span class="legend-item"><i class="sw sw-yellow"></i>150–199 mm · Mild</span>
          <span class="legend-item"><i class="sw sw-orange"></i>200–249 mm · Significant</span>
          <span class="legend-item"><i class="sw sw-red"></i>&ge; 250 mm · Severe</span>
        </div>
        """, unsafe_allow_html=True)


# ──────────────────────────────────────────────────────────────────
#  DEMOS & STATE
# ──────────────────────────────────────────────────────────────────

DEMOS = {
    "Very Heavy Rainfall": {
        "design_storm_mm_h": 42.0, "storm_duration_h": 10,
        "drain_clog": 10, "river_surge": 1.6,
        "note": "42 mm/h design storm for 10 h — a cloudburst, not the live forecast.",
    },
    "Severe Drainage Clogging": {
        "design_storm_mm_h": 22.0, "storm_duration_h": 14,
        "drain_clog": 85, "river_surge": 1.2,
        "note": "A moderate 22 mm/h storm the drains would normally cope with, "
                "against 85% blocked drains.",
    },
}


def _apply_demo(name: str) -> None:
    """
    Write demo values straight into the slider widget keys.

    Safe because every caller is a button rendered ABOVE the sliders, so the
    assignment happens before those widgets are instantiated on this run.
    Streamlit then renders the sliders at the new values with no extra rerun.
    """
    st.session_state.active_demo = name
    if name == "None":
        st.session_state.update(design_storm=0.0, rain_mult=1.0,
                                storm_dur=SIM_HOURS, drain_clog=0, river_surge=1.0)
        return
    d = DEMOS[name]
    st.session_state.update(
        design_storm=d["design_storm_mm_h"], storm_dur=d["storm_duration_h"],
        drain_clog=d["drain_clog"], river_surge=d["river_surge"], rain_mult=1.0)


def _init_state() -> None:
    defaults = {
        "app_mode": "FORECAST",
        "hour": 1,
        "playing": False,
        "rain_mult": 1.0,
        "design_storm": 0.0,
        "storm_dur": SIM_HOURS,
        "drain_clog": 0,
        "river_surge": 1.0,
        "active_demo": "None",
    }
    for key, val in defaults.items():
        st.session_state.setdefault(key, val)


PLAY_DELAY_S = 0.35

CSS = """
<style>
.stApp { background:#000; color:#f5f5f5; }
.block-container { padding:0.6rem 1.1rem 0.4rem; max-width:100%; }
header[data-testid="stHeader"] { background:transparent; height:0; }
#MainMenu, footer { visibility:hidden; }

.fs-title { font-size:19px; font-weight:800; letter-spacing:.07em; color:#fff; }
.fs-sub   { font-size:11px; color:#7d7d7d; margin-top:1px; }
.fs-city  { font-size:12px; color:#c9c9c9; font-weight:600; letter-spacing:.05em; }
.h-sec    { font-size:11px; font-weight:700; letter-spacing:.09em;
            text-transform:uppercase; color:#6f6f6f; margin:0 0 7px; }

.panel { background:#0a0a0a; border:1px solid #1e1e1e; border-radius:5px;
         padding:11px 12px; margin-bottom:9px; }
.row { display:flex; justify-content:space-between; gap:8px;
       font-size:12.5px; margin:5px 0; }
.row .k { color:#9c9c9c; }
.row .v { color:#fafafa; font-weight:600; text-align:right; }
.row .v.sm { font-size:11px; font-weight:500; color:#c9c9c9; }
.hint { font-size:10.5px; color:#6a6a6a; line-height:1.45; margin-top:8px; }

.pill { display:inline-flex; align-items:center; gap:6px; font-size:10px;
        font-weight:700; letter-spacing:.07em; padding:4px 9px;
        border-radius:3px; border:1px solid #262626; background:#0a0a0a; }
.p-live { color:#4ade80; border-color:#14532d; }
.p-fall { color:#fbbf24; border-color:#713f12; }
.p-part { color:#60a5fa; border-color:#1e3a8a; }
.dot { width:6px; height:6px; border-radius:50%; display:inline-block; }
.d-live{background:#4ade80;} .d-fall{background:#fbbf24;} .d-part{background:#60a5fa;}

.legend-bar { display:flex; flex-wrap:wrap; align-items:center; gap:14px;
              background:#0a0a0a; border:1px solid #1e1e1e; border-radius:5px;
              padding:7px 12px; margin-top:7px; }
.legend-head { font-size:10px; text-transform:uppercase; letter-spacing:.09em; color:#6f6f6f; }
.legend-item { display:inline-flex; align-items:center; gap:6px; font-size:11.5px; color:#d4d4d4; }
.sw { width:11px; height:11px; border-radius:2px; display:inline-block; }
.sw-blue{background:rgba(59,130,246,.6);border:1px solid rgba(59,130,246,.9);}
.sw-yellow{background:rgba(234,179,8,.7);border:1px solid rgba(234,179,8,.95);}
.sw-orange{background:rgba(249,115,22,.75);border:1px solid rgba(249,115,22,1);}
.sw-red{background:rgba(239,68,68,.8);border:1px solid rgba(239,68,68,1);}

.hourbox { font-size:12.5px; font-weight:700; color:#fff; letter-spacing:.04em;
           text-align:center; padding-top:5px; }
.kpi { display:flex; justify-content:space-between; font-size:12.5px; margin:5px 0; }
.kpi .k { color:#9c9c9c; } .kpi .v { font-weight:700; color:#fff; }

/* ── Prevent Streamlit deployment stale-element opacity flickering ─ */
[data-stale="true"],
div[data-stale="true"],
.st-emotion-cache-1wivap2[data-stale="true"],
div[data-testid="stAppViewContainer"] [data-stale="true"],
div[data-testid="stElementContainer"][data-stale="true"],
div[data-testid="stElementContainer"],
.element-container,
.element-container[data-stale="true"] {
  opacity: 1 !important;
  transition: none !important;
  filter: none !important;
}
div[data-testid="stAppViewContainer"],
div[data-testid="stMain"],
div[data-testid="stMainBlockContainer"],
div[data-testid="stVerticalBlock"],
div[data-testid="stHorizontalBlock"],
div[data-testid="stColumn"],
div[data-testid="column"] {
  opacity: 1 !important;
}
div[data-testid="stStatusWidget"] {
  display: none !important;
  visibility: hidden !important;
}

div[data-testid="stSlider"] label p { font-size:11.5px; color:#9c9c9c; }

/* ── Buttons & Mode selector: equal, aligned, consistent styling ─── */
.stButton button {
  background:#0a0a0a; border:1px solid #1e1e1e; color:#d4d4d4;
  border-radius:4px; font-size:11.5px; padding:4px 8px;
  height:34px; transition:all .14s ease;
}
.stButton button:hover {
  border-color:#2563eb; color:#fff; background:#0d1b33;
}

/* Active mode button (primary) */
.stButton button[kind="primary"],
.stButton button[data-testid="stBaseButton-primary"] {
  background:#132a4d !important;
  border:1px solid #2563eb !important;
  color:#bfdbfe !important;
  font-weight:700 !important;
  letter-spacing:.08em;
  height:34px !important;
}

/* Inactive mode button (secondary) */
.stButton button[kind="secondary"],
.stButton button[data-testid="stBaseButton-secondary"] {
  background:#0a0a0a !important;
  border:1px solid #1e1e1e !important;
  color:#8f8f8f !important;
  font-weight:600 !important;
  letter-spacing:.08em;
  height:34px !important;
}
.stButton button[kind="secondary"]:hover,
.stButton button[data-testid="stBaseButton-secondary"]:hover {
  border-color:#3a3a3a !important;
  background:#111 !important;
  color:#d4d4d4 !important;
}
</style>
"""


# ──────────────────────────────────────────────────────────────────
#  APP
# ──────────────────────────────────────────────────────────────────

CITY = "Bengaluru"   # single supported city


PLAYBACK_STEP = "hour"  # session-state key the fragment advances


# run_every is read once per FULL script execution — the line below re-runs
# each time main() runs top to bottom, so it always sees the current value of
# st.session_state.playing and rebuilds the fragment with the matching timer.
# Internal ticks driven by run_every do not re-execute this decorator line,
# only playback()'s body, so the timer stays fixed between full reruns.
#
# An earlier version tried to self-loop with time.sleep() + a manual
# st.rerun(scope="fragment") call. That raises
# StreamlitInvalidLayoutContextError: a manual fragment-scoped rerun is only
# legal from *inside* an already-fragment-scoped execution, and the very
# first tick after clicking Play is not one. run_every sidesteps this
# entirely — Streamlit owns the timer, so every tick it produces is already
# a valid fragment rerun, and it is None (fully off, zero background work)
# whenever playback isn't running. run_every is only re-read when this
# decorator line itself re-executes, which happens on a full script run —
# see _toggle_playing() below for how the Play/Pause click forces exactly
# one of those, without moving the button out of its current position.
@st.fragment(run_every=PLAY_DELAY_S if st.session_state.get("playing") else None)
def playback(city: str, cfg: Dict, baseline: np.ndarray, active: np.ndarray,
             scenario_mode: bool, precip: List[float], drain_meta: Dict,
             pop_density: np.ndarray, rail_slot, map_slot) -> None:
    """
    Everything that changes hour-to-hour during Play, isolated in its own
    fragment. Only this function re-executes on each tick — not main() — so
    the CSS block, header and rail controls are never re-sent while playback
    runs.
    """
    # Advance BEFORE the hour slider widget is created below
    if st.session_state.playing:
        cur = int(st.session_state.get(PLAYBACK_STEP, 1))
        st.session_state[PLAYBACK_STEP] = 1 if cur >= SIM_HOURS else cur + 1

    hour = int(st.session_state.hour)
    hour = max(1, min(SIM_HOURS, hour))
    depth_m = active[hour]
    depth_mm = depth_m * 1000.0

    if scenario_mode and float(st.session_state.design_storm) > 0:
        rain_this_hour = (float(st.session_state.design_storm)
                          if hour - 1 < int(st.session_state.storm_dur) else 0.0)
    else:
        idx = max(0, hour - 1)
        mult = float(st.session_state.rain_mult) if scenario_mode else 1.0
        rain_this_hour = (float(precip[idx]) * mult) if idx < len(precip) else 0.0

    # ---------- MAP ----------
    with map_slot:
        frame = build_map_frame(city, depth_m, rain_this_hour, hour)
        render_map(frame, cfg)
        render_legend()

        c_play, c_slider, c_hour = columns([0.9, 6.4, 1.1], align="center")
        with c_play:
            st.button("Pause" if st.session_state.playing else "Play",
                      on_click=_toggle_playing, **stretch(st.button))
        with c_slider:
            st.slider("Forecast hour", 1, SIM_HOURS, key="hour",
                      label_visibility="collapsed")
        with c_hour:
            st.markdown(f'<div class="hourbox">Hour {hour} / {SIM_HOURS}</div>',
                        unsafe_allow_html=True)

    # ---------- COMPACT READOUT ----------
    kpis = compute_kpis(depth_mm, pop_density)
    base_kpis = compute_kpis(baseline[hour] * 1000.0, pop_density)

    with rail_slot:
        block = '<div class="panel"><div class="h-sec">Simulated at this hour</div>'
        block += ('<div class="kpi"><span class="k">Peak depth</span>'
                  f'<span class="v">{kpis["peak_depth_mm"]:.0f} mm</span></div>')
        block += ('<div class="kpi"><span class="k">Flooded area</span>'
                  f'<span class="v">{kpis["flooded_km2"]:.0f} km²</span></div>')
        block += ('<div class="kpi"><span class="k">Severe cells</span>'
                  f'<span class="v">{kpis["severe_cells"]}</span></div>')
        if scenario_mode:
            delta = kpis["peak_depth_mm"] - base_kpis["peak_depth_mm"]
            colour = "#f87171" if delta > 0 else "#4ade80" if delta < 0 else "#8f8f8f"
            block += ('<div class="kpi"><span class="k">vs forecast</span>'
                      f'<span class="v" style="color:{colour}">{delta:+.0f} mm</span></div>')
        block += "</div>"
        st.markdown(block, unsafe_allow_html=True)

        src = "Karnataka taluk sheet" if drain_meta["dataset_backed"] else "built-in default"
        clog = int(st.session_state.drain_clog) if scenario_mode else 0
        effective = drain_meta["mean_capacity_mm_h"] * (1 - clog / 100.0)
        pairs = [("Capacity (mean)", f"{drain_meta['mean_capacity_mm_h']:.1f} mm/h")]
        if scenario_mode and clog:
            pairs.append(("Clogging", f"{clog}%"))
            pairs.append(("Effective", f"{effective:.1f} mm/h"))
        pairs.append(("Status", "Clogged" if clog >= 50 else
                      "Reduced" if clog > 0 else "Nominal"))
        if drain_meta["density"]:
            pairs.append(("Drainage density", f"~{drain_meta['density']} km/km²"))
            pairs.append(("Mean slope", f"~{drain_meta['slope_pct']}%"))
        pairs.append(("Source", src))

        dblock = '<div class="panel"><div class="h-sec">Drainage</div>'
        for k, v in pairs:
            dblock += (f'<div class="row"><span class="k">{k}</span>'
                       f'<span class="v sm">{v}</span></div>')
        dblock += "</div>"
        st.markdown(dblock, unsafe_allow_html=True)


def _toggle_playing() -> None:
    st.session_state.playing = not st.session_state.playing
    st.rerun()


def _set_mode(mode: str) -> None:
    st.session_state.app_mode = mode





def render_3d_map(rain_now_mm_h: float, river_q_m3s: float,
                  rain_scenario_mm_h: float, river_scenario: float,
                  scenario_mode: bool) -> None:
    """
    Renders the FLOWSHIELD 3D Digital Twin.

    Architecture: Same-Origin Static Serving through Streamlit (Option 1 & 4)
    Streamlit directly serves the compiled React/Three.js bundle from flowshield/static/3d
    under /app/static/3d/index.html.

    Benefits:
    - 100% same-origin with Streamlit (no cross-origin iframe blocking)
    - Zero external process requirement (no separate Vite server needed)
    - Live weather parameters passed directly on URL query string (instant mount)
    - Robust 750px responsive height matching the Streamlit dashboard grid
    """
    effective_rain = rain_scenario_mm_h if scenario_mode else rain_now_mm_h
    effective_river = river_scenario if scenario_mode else river_q_m3s

    map_url = f"/app/static/3d/index.html?rain={effective_rain:.1f}&river={effective_river:.1f}&loc=shibuya"

    # Embed same-origin iframe directly
    components.iframe(map_url, height=750, scrolling=False)

    # Info bar below the 3D map
    st.markdown(
        f"""
        <div style="background:#0a0a0a;border:1px solid #1e1e1e;border-radius:5px;
                    padding:10px 14px;margin-top:6px;font-size:11.5px;color:#6f6f6f;">
          <b style="color:#9c9c9c;">3D Digital Twin</b> &nbsp;·&nbsp;
          React / Three.js engine &nbsp;·&nbsp;
          Unified Static Architecture (Same-Origin) &nbsp;·&nbsp;
          Rainfall <b style="color:#d4d4d4;">{effective_rain:.1f} mm/h</b>
          &nbsp;·&nbsp; River <b style="color:#d4d4d4;">{effective_river:.0f} m³/s</b>
          &nbsp;·&nbsp; Interactive 3D: orbit (drag), inspect cells (click), deploy sandbags.
        </div>
        """,
        unsafe_allow_html=True,
    )


def main() -> None:
    st.set_page_config(page_title="FLOWSHIELD", page_icon="▣",
                       layout="wide", initial_sidebar_state="collapsed")
    _init_state()
    st.markdown(CSS, unsafe_allow_html=True)

    city = CITY
    cfg = CITIES[city]

    weather = load_weather(city)
    hydro = load_hydrology(city)
    drainage_mm_h, taluk_labels, drain_meta = build_drainage_grid(city)
    pop_density = build_population_grid(city)

    w_live = "Synthetic" not in weather["source"]
    h_live = "Synthetic" not in hydro["source"]
    if w_live and h_live:
        pill_text, pill_cls, dot_cls = "LIVE DATA", "p-live", "d-live"
    elif not w_live and not h_live:
        pill_text, pill_cls, dot_cls = "SYNTHETIC FALLBACK", "p-fall", "d-fall"
    else:
        pill_text, pill_cls, dot_cls = "PARTIAL FALLBACK", "p-part", "d-part"

    scenario_mode = st.session_state.app_mode == "SCENARIO"

    # ── Header ────────────────────────────────────────────────────
    hcol1, hcol2 = columns([7, 2.4], align="center")
    with hcol1:
        st.markdown('<div class="fs-title">FLOWSHIELD</div>'
                    '<div class="fs-sub">Flood Simulation &amp; Early Warning '
                    '&nbsp;·&nbsp; <span class="fs-city">Bengaluru</span></div>',
                    unsafe_allow_html=True)
    with hcol2:
        # Data-status pill is a Forecast-mode concept; Scenario output is
        # modelled, so showing a live/fallback badge there would be misleading.
        if not scenario_mode:
            st.markdown(f'<div class="pill {pill_cls}">'
                        f'<span class="dot {dot_cls}"></span>{pill_text}</div>',
                        unsafe_allow_html=True)

    precip = weather["hourly_precip_mm"]
    river_q = float(hydro["river_discharge_m3s"])

    # ── Tabs: 2D Forecast Map  |  3D Digital Twin ─────────────────
    tab2d, tab3d = st.tabs(["🗺️  2D Forecast Map", "🏙️  3D Digital Twin"])

    with tab2d:
        # ── Layout: narrow control rail beside a dominant map ─────────
        rail, mapcol = columns([1.35, 5.4], gap="medium")

        # ---------- CONTROL RAIL ----------
        with rail:
            col_f, col_s = columns([1, 1], gap="small")
            with col_f:
                st.button(
                    "FORECAST",
                    key="btn_mode_forecast",
                    type="primary" if not scenario_mode else "secondary",
                    on_click=_set_mode,
                    args=("FORECAST",),
                    **stretch(st.button),
                )
            with col_s:
                st.button(
                    "SCENARIO",
                    key="btn_mode_scenario",
                    type="primary" if scenario_mode else "secondary",
                    on_click=_set_mode,
                    args=("SCENARIO",),
                    **stretch(st.button),
                )

        with rail:
            if not scenario_mode:
                rain_now = float(precip[0]) if precip else 0.0
                rain_next = float(precip[1]) if len(precip) > 1 else 0.0
                rain_6 = float(sum(precip[:6]))
                rain_total = float(sum(precip[:SIM_HOURS]))
                body = '<div class="panel"><div class="h-sec">Forecast rainfall</div>'
                for k, v in [("Now", f"{rain_now:.1f} mm/h"),
                             ("Next hour", f"{rain_next:.1f} mm/h"),
                             ("Next 6 h", f"{rain_6:.0f} mm"),
                             (f"Next {SIM_HOURS} h", f"{rain_total:.0f} mm"),
                             ("River inflow", f"{river_q:,.0f} m³/s")]:
                    body += (f'<div class="row"><span class="k">{k}</span>'
                             f'<span class="v">{v}</span></div>')
                body += "</div>"
                st.markdown(body, unsafe_allow_html=True)
            else:
                # Demo and reset buttons sit ABOVE the sliders on purpose: they
                # write the slider keys, which is only legal before those widgets
                # are instantiated. This is what lets them work without a rerun.
                st.markdown('<div class="h-sec" style="margin-top:8px;">Demo scenarios</div>',
                            unsafe_allow_html=True)
                d1, d2 = columns([1, 1])
                with d1:
                    if st.button("Heavy rain", **stretch(st.button)):
                        _apply_demo("Very Heavy Rainfall")
                with d2:
                    if st.button("Clogged drains", **stretch(st.button)):
                        _apply_demo("Severe Drainage Clogging")
                if st.button("Reset to forecast", **stretch(st.button)):
                    _apply_demo("None")

                st.markdown('<div class="h-sec">Scenario controls</div>',
                            unsafe_allow_html=True)
                st.slider("Design storm (mm/h) — 0 uses the forecast",
                          0.0, 80.0, step=1.0, key="design_storm")
                if float(st.session_state.design_storm) == 0.0:
                    st.slider("Forecast rainfall (×)", 0.0, 5.0, step=0.1, key="rain_mult")
                st.slider("Storm duration (hours)", 1, SIM_HOURS, key="storm_dur")
                st.slider("Drainage clogging (%)", 0, 100, step=5, key="drain_clog")
                st.slider("River inflow surge (×)", 0.5, 5.0, step=0.1, key="river_surge")

        # ── Precompute active simulation (fast cached lookup) ─────────
        try:
            baseline = run_baseline_simulation(city)
            if scenario_mode:
                active = run_scenario_simulation(
                    city, float(st.session_state.rain_mult),
                    float(st.session_state.design_storm),
                    int(st.session_state.storm_dur),
                    int(st.session_state.drain_clog) / 100.0,
                    float(st.session_state.river_surge))
            else:
                active = baseline
        except Exception as exc:
            st.error("The flood simulation could not be completed. Try reloading.")
            st.caption(f"Technical detail: {type(exc).__name__}: {exc}")
            return

        rail_slot = rail.container()
        map_slot = mapcol.container()

        playback(city, cfg, baseline, active, scenario_mode, precip, drain_meta, pop_density, rail_slot, map_slot)

    # ── 3D Digital Twin tab ───────────────────────────────────────
    with tab3d:
        # Build effective rainfall for the 3D map:
        #   Forecast mode  → use the first forecast hour
        #   Scenario mode  → apply the scenario multiplier / design storm
        rain_now_val = float(precip[0]) if precip else 0.0
        if scenario_mode:
            if float(st.session_state.design_storm) > 0:
                rain_3d = float(st.session_state.design_storm)
            else:
                rain_3d = rain_now_val * float(st.session_state.rain_mult)
            river_3d = river_q * float(st.session_state.river_surge)
        else:
            rain_3d = rain_now_val
            river_3d = river_q

        render_3d_map(
            rain_now_mm_h=rain_now_val,
            river_q_m3s=river_q,
            rain_scenario_mm_h=rain_3d,
            river_scenario=river_3d,
            scenario_mode=scenario_mode,
        )


if __name__ == "__main__":
    main()