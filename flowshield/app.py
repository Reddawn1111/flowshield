# -*- coding: utf-8 -*-
"""
FLOWSHIELD — Global Flood Simulation, Early Warning & Hotspot Mapping
Map-first interface | Python + Streamlit + PyDeck + React 3D Digital Twin
Supports ANY location in the world + Sentinel-1 SAR Floodpy Historical Hotspot Archive
"""

import csv
import json
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

from location_service import GLOBAL_PRESETS, create_city_config, search_locations
from location_search_widget import render_location_search
from historical_flood_data import (
    GRID_SIZE,
    get_available_historical_events,
    get_city_hotspots,
    get_historical_event,
    HISTORICAL_EVENTS,
)
from live_warning_service import (
    evaluate_24h_flood_forecast,
    map_coordinates_to_grid,
    reverse_geocode_locationiq,
    AlertDeduplicator,
)
from live_location_widget import render_live_location_tracker

# ──────────────────────────────────────────────────────────────────
#  CONSTANTS
# ──────────────────────────────────────────────────────────────────

CELL_SIZE_KM = 1.0        # each cell ~1 km^2
SIM_HOURS = 24            # exactly 24 forecast hours

# ── Flood depth thresholds, in MILLIMETRES of simulated surface water ──
DEPTH_MILD_MM = 150.0
DEPTH_SIGNIFICANT_MM = 200.0
DEPTH_SEVERE_MM = 250.0

FLOODED_AREA_THRESHOLD_MM = DEPTH_MILD_MM
CRITICAL_DEPTH_MM = DEPTH_SEVERE_MM

# Map fill colours [R, G, B, A]
COLOR_MINIMAL     = [59, 130, 246, 60]
COLOR_MILD        = [234, 179, 8, 125]
COLOR_SIGNIFICANT = [249, 115, 22, 160]
COLOR_SEVERE      = [239, 68, 68, 190]
COLOR_GRID_LINE   = [120, 140, 170, 90]

# Hotspot visualization colours (Floodpy SAR recurrence)
COLOR_HOTSPOT_LOW  = [56, 189, 248, 70]    # light cyan/blue
COLOR_HOTSPOT_MOD  = [245, 158, 11, 160]   # amber
COLOR_HOTSPOT_HIGH = [225, 29, 72, 200]    # deep crimson
COLOR_SATELLITE_OBS = [168, 85, 247, 215]  # purple radar observed

MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"

DRAINAGE_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "karnataka_taluk_drainage.csv")

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

DRAIN_K_MM_H = 6.0
DRAIN_SLOPE_GAIN = 0.03
SUBTALUK_VARIATION = 0.20


@st.cache_data(show_spinner=False)
def load_drainage_dataset() -> Tuple[Dict[str, Dict], str]:
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
                    "capacity_cumecs": num("drain_capacity_cumecs"),
                    "zone": (rec.get("zone") or "").strip(),
                }
        return rows, f"loaded {len(rows)} taluks"
    except Exception as exc:
        return {}, f"unreadable ({type(exc).__name__})"


def capacity_from_dataset(density: float, slope_pct: float) -> float:
    return DRAIN_K_MM_H * density * (1.0 + DRAIN_SLOPE_GAIN * slope_pct)


def sector_of(i: int, j: int, g: int) -> str:
    ci = cj = (g - 1) / 2.0
    di, dj = i - ci, j - cj
    if abs(di) <= g * 0.17 and abs(dj) <= g * 0.17:
        return "centre"
    if abs(di) >= abs(dj):
        return "north" if di > 0 else "south"
    return "east" if dj > 0 else "west"


def build_drainage_grid(cfg: Dict, elevation: np.ndarray) -> Tuple[np.ndarray, np.ndarray, Dict]:
    city_name = cfg["name"]
    dataset, status = load_drainage_dataset()
    g = GRID_SIZE
    rng = np.random.default_rng(seed=abs(hash(city_name)) % 9999)

    capacity = np.zeros((g, g), dtype=np.float32)
    labels = np.empty((g, g), dtype=object)

    used_rows: Dict[str, Dict] = {}
    missing: List[str] = []
    taluks_map = cfg.get("taluks", {})

    for i in range(g):
        for j in range(g):
            sector = sector_of(i, j, g)
            taluk = taluks_map.get(sector, f"{city_name} {sector.title()}")
            row = dataset.get(taluk)
            if row and row.get("density") and row.get("slope_pct") is not None:
                used_rows[taluk] = row
            labels[i, j] = taluk

    if used_rows:
        # Case A: Empirical local government records (e.g. Karnataka taluk sheet)
        for i in range(g):
            for j in range(g):
                taluk = labels[i, j]
                row = used_rows.get(taluk)
                if row and row.get("density") and row.get("slope_pct") is not None:
                    base = capacity_from_dataset(row["density"], row["slope_pct"])
                else:
                    base = cfg.get("fallback_drainage_mm_h", 10.6)
                capacity[i, j] = base

        spread = rng.uniform(1.0 - SUBTALUK_VARIATION, 1.0 + SUBTALUK_VARIATION, (g, g))
        capacity = (capacity * spread).astype(np.float32)
        method_name = "Karnataka Taluk Drainage Dataset (Field Records)"
        is_dataset = True
    else:
        # Case B: Topographic Hydraulic Gradient & ASCE/CPHEEO Civil Design Model
        pop_base = cfg.get("pop_density_base", 8000)
        urban_base = float(np.clip(9.0 + 7.0 * (pop_base / 14000.0), 9.0, 16.0))

        gy, gx = np.gradient(elevation, CELL_SIZE_KM * 1000.0)
        slope_pct = np.sqrt(gx**2 + gy**2) * 100.0
        slope_gain = 1.0 + 0.04 * np.clip(slope_pct, 0.0, 15.0)

        pad_elev = np.pad(elevation, 1, mode="edge")
        for i in range(g):
            for j in range(g):
                surround = pad_elev[i:i+3, j:j+3]
                depression = max(0.0, float(surround.mean() - elevation[i, j]))
                sink_penalty = max(0.68, 1.0 - 0.07 * depression)

                elev_m = float(elevation[i, j])
                coastal_penalty = 0.85 if elev_m < 8.0 else 1.0

                capacity[i, j] = urban_base * slope_gain[i, j] * sink_penalty * coastal_penalty

        spread = rng.uniform(0.92, 1.08, (g, g))
        capacity = (capacity * spread).astype(np.float32)
        method_name = "Physical Terrain Gradient + ASCE/CPHEEO Urban Benchmark"
        is_dataset = False

    meta = {
        "status": status,
        "dataset_backed": is_dataset,
        "method": method_name,
        "taluks": sorted({str(x) for x in labels.flatten().tolist()}),
        "missing": missing,
        "mean_capacity_mm_h": float(capacity.mean()),
        "density": next((r["density"] for r in used_rows.values()), None),
        "slope_pct": next((r["slope_pct"] for r in used_rows.values()), None),
        "basin": next((r["basin"] for r in used_rows.values()), ""),
    }
    return capacity, labels, meta


def build_population_grid(cfg: Dict) -> np.ndarray:
    g = GRID_SIZE
    rng = np.random.default_rng(seed=abs(hash(cfg["name"] + "pop")) % 9999)
    cx = cy = g // 2
    ii, jj = np.mgrid[0:g, 0:g]
    dist = np.sqrt((ii - cx) ** 2 + (jj - cy) ** 2)
    base_pop = cfg.get("pop_density_base", 8000)
    pop = (base_pop * np.exp(-dist / (g * 0.4))).astype(np.float32)
    pop += rng.uniform(-500, 1500, (g, g)).astype(np.float32)
    return np.clip(pop, 400, base_pop * 2.2)


# ──────────────────────────────────────────────────────────────────
#  GLOBAL DATA PROVIDERS
# ──────────────────────────────────────────────────────────────────

class WeatherProvider:
    """Hourly precipitation from Open-Meteo for any latitude/longitude globally."""

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
        rng = np.random.default_rng(seed=int(abs(lat * lon * 100)) % 9999)
        base = rng.uniform(0.5, 2.5, SIM_HOURS)
        diurnal = np.array([
            0.2, 0.1, 0.1, 0.1, 0.2, 0.4, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.5,
            3.0, 3.5, 3.8, 3.5, 3.0, 2.5, 2.0, 1.5, 1.0, 0.7, 0.5, 0.4,
        ])[:SIM_HOURS]
        start_hour = datetime.now(timezone.utc).hour
        diurnal = np.roll(diurnal, -start_hour % len(diurnal))
        return {
            "hourly_precip_mm": (base * diurnal).tolist(),
            "source": f"Synthetic fallback ({reason or 'offline'})",
            "window_start_local": "—",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }


class HydrologyProvider:
    """River discharge from Open-Meteo GloFAS flood API worldwide."""

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
                raise ValueError("no discharge at this coordinate")
            return {"river_discharge_m3s": float(value),
                    "source": "GloFAS / Open-Meteo (live)"}
        except Exception as exc:
            rng = np.random.default_rng(int(abs(lat + lon) * 100) % 9999)
            return {"river_discharge_m3s": float(rng.uniform(40, 200)),
                    "source": f"Synthetic fallback ({type(exc).__name__})"}


class ElevationProvider:
    """Dynamic DEM generated from real base altitude and terrain characteristics."""

    def fetch(self, cfg: Dict) -> np.ndarray:
        terrain = cfg.get("terrain", "undulating")
        base_elev = float(cfg.get("elevation_m", 50.0))
        rng = np.random.default_rng(
            int(abs(cfg["lat"] * cfg["lon"] * 100)) % 9999)
        g = GRID_SIZE
        if terrain in ("undulating", "coastal_estuary"):
            x = np.linspace(0, 2 * math.pi, g)
            xx, yy = np.meshgrid(x, x)
            dem = (base_elev + 25 * np.sin(xx) + 18 * np.cos(yy * 0.7)
                   + 8 * np.sin(xx * 1.3 + yy) + rng.uniform(-3, 3, (g, g)))
        elif terrain in ("lowland_delta", "lowland_coastal", "coastal_flat"):
            x = np.linspace(0, math.pi, g)
            xx, yy = np.meshgrid(x, x)
            dem = (base_elev + 4 * np.sin(xx * 0.6) + 3 * np.cos(yy * 0.6)
                   + rng.uniform(-1, 1, (g, g)))
        else:
            dem = base_elev + rng.uniform(-4, 4, (g, g))
        return np.maximum(dem, 0.5).astype(np.float32)


def river_ingress_mask(elevation: np.ndarray, percentile: float = 20.0) -> np.ndarray:
    flat = elevation.flatten()
    return (flat <= np.percentile(flat, percentile)).reshape(elevation.shape)


# ──────────────────────────────────────────────────────────────────
#  FLOOD SIMULATION ENGINE
# ──────────────────────────────────────────────────────────────────

class FloodSimulationEngine:
    """Grid-based hourly surface-water mass balance model."""

    RUNOFF_COEFFICIENT = 0.85
    RECESSION_RATE = 0.07
    CLOG_BLOCKS_RECESSION = 0.6
    LATERAL_ALPHA = 0.25
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
                    raw_mm = design_storm_mm_h
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
#  CACHED LOADERS & SIMULATIONS
# ──────────────────────────────────────────────────────────────────

@st.cache_data(ttl=1800, show_spinner=False)
def load_weather_cached(lat: float, lon: float, tz_name: str) -> Dict:
    return WeatherProvider().fetch(lat, lon, tz_name)


@st.cache_data(ttl=1800, show_spinner=False)
def load_hydrology_cached(lat: float, lon: float) -> Dict:
    return HydrologyProvider().fetch(lat, lon)


def get_city_models(cfg: Dict):
    elevation = ElevationProvider().fetch(cfg)
    drainage_mm_h, taluk_labels, drain_meta = build_drainage_grid(cfg, elevation)
    pop_density = build_population_grid(cfg)
    hotspots = get_city_hotspots(cfg["name"], elevation)
    return elevation, drainage_mm_h, taluk_labels, drain_meta, pop_density, hotspots


# ──────────────────────────────────────────────────────────────────
#  SEVERITY & COLOR
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


def compute_kpis(depth_mm: np.ndarray, pop_density: np.ndarray) -> Dict:
    flooded = depth_mm >= FLOODED_AREA_THRESHOLD_MM
    return {
        "peak_depth_mm": float(depth_mm.max()),
        "flooded_km2": float(flooded.sum() * CELL_SIZE_KM ** 2),
        "severe_cells": int((depth_mm >= CRITICAL_DEPTH_MM).sum()),
        "impacted_pop": int((flooded * pop_density * CELL_SIZE_KM ** 2).sum()),
    }


# ──────────────────────────────────────────────────────────────────
#  MAP GEOMETRY & FRAMES
# ──────────────────────────────────────────────────────────────────

def _cell_polygon(i: int, j: int, cfg: Dict, g: int) -> List[List[float]]:
    dlat = CELL_SIZE_KM / 111.0
    cos_lat = math.cos(math.radians(cfg["lat"]))
    dlon = CELL_SIZE_KM / (111.0 * (cos_lat if abs(cos_lat) > 0.05 else 0.05))
    lat_c = cfg["lat"] + (i - g / 2) * dlat
    lon_c = cfg["lon"] + (j - g / 2) * dlon
    hlat, hlon = dlat / 2, dlon / 2
    return [
        [lon_c - hlon, lat_c - hlat], [lon_c + hlon, lat_c - hlat],
        [lon_c + hlon, lat_c + hlat], [lon_c - hlon, lat_c + hlat],
        [lon_c - hlon, lat_c - hlat],
    ]


def static_map_records(cfg: Dict, elevation: np.ndarray, drainage_mm_h: np.ndarray,
                       taluk_labels: np.ndarray, pop_density: np.ndarray,
                       hotspots: np.ndarray) -> List[Dict]:
    g = GRID_SIZE
    river_mask = river_ingress_mask(elevation)
    rows = []
    for i in range(g):
        for j in range(g):
            h = hotspots[i, j]
            rows.append({
                "i": i,
                "j": j,
                "polygon": _cell_polygon(i, j, cfg, g),
                "grid_id": f"G{i:02d}-{j:02d}",
                "taluk": str(taluk_labels[i, j]),
                "locality": h["locality"],
                "hotspot_score": h["score"],
                "hotspot_tier": h["tier"],
                "hotspot_events": h["events_count"],
                "drain_mm_h": f"{float(drainage_mm_h[i, j]):.1f}",
                "elev_m": f"{float(elevation[i, j]):.0f}",
                "river": "Yes" if river_mask[i, j] else "No",
                "population": f"{int(pop_density[i, j] * CELL_SIZE_KM ** 2):,}",
                "line_color": COLOR_GRID_LINE,
            })
    return rows


_SEVERITY_COLORS = [COLOR_MINIMAL, COLOR_MILD, COLOR_SIGNIFICANT, COLOR_SEVERE]
_SEVERITY_UPPER = [s.upper() for s in SEVERITY_LABELS]


def build_map_frame(
    records: List[Dict],
    depth_m: np.ndarray,
    rain_this_hour_mm: float,
    hour: int,
    app_mode: str = "FORECAST",
    historical_submode: str = "EVENTS",
    active_historical_event: Optional[Dict] = None,
) -> List[Dict]:
    depth_mm = (depth_m.flatten() * 1000.0)
    codes = np.digitize(depth_mm, [DEPTH_MILD_MM, DEPTH_SIGNIFICANT_MM, DEPTH_SEVERE_MM])
    rain_str = f"{rain_this_hour_mm:.1f}"
    hour_str = str(hour)

    observed_set = set()
    if active_historical_event and app_mode == "HISTORICAL":
        observed_set = set(active_historical_event.get("observed_cells", []))

    out = []
    for idx, r in enumerate(records):
        nr = dict(r)
        c = codes[idx]
        nr["depth_mm"] = f"{depth_mm[idx]:.0f}"
        nr["severity"] = _SEVERITY_UPPER[c]
        nr["rain_mm_h"] = rain_str
        nr["hour"] = hour_str

        # Color routing by mode
        if app_mode == "HISTORICAL" and historical_submode == "HOTSPOTS":
            score = nr["hotspot_score"]
            if score >= 0.65:
                nr["fill_color"] = COLOR_HOTSPOT_HIGH
                nr["map_mode_badge"] = "HIGH-RISK HOTSPOT"
            elif score >= 0.35:
                nr["fill_color"] = COLOR_HOTSPOT_MOD
                nr["map_mode_badge"] = "MODERATE HOTSPOT"
            else:
                nr["fill_color"] = COLOR_HOTSPOT_LOW
                nr["map_mode_badge"] = "LOW RISK"
        elif app_mode == "HISTORICAL" and (r["i"], r["j"]) in observed_set:
            nr["fill_color"] = COLOR_SATELLITE_OBS
            nr["line_color"] = [255, 255, 255, 220]
            nr["map_mode_badge"] = "SATELLITE CONFIRMED INUNDATION (Sentinel-1)"
        else:
            nr["fill_color"] = _SEVERITY_COLORS[c]
            nr["map_mode_badge"] = _SEVERITY_UPPER[c]

        out.append(nr)
    return out


def render_map(data: List[Dict], cfg: Dict, app_mode: str, historical_submode: str,
               user_point: Optional[Dict] = None, height: int = 600) -> None:
    layer = pdk.Layer(
        "PolygonLayer", data=data,
        get_polygon="polygon", get_fill_color="fill_color",
        get_line_color="line_color", get_line_width=40,
        line_width_min_pixels=1, stroked=True, filled=True,
        pickable=True, auto_highlight=True,
    )
    layers = [layer]
    if user_point and "lat" in user_point and "lon" in user_point:
        user_color = user_point.get("color", [56, 189, 248, 240])
        user_layer = pdk.Layer(
            "ScatterplotLayer",
            data=[user_point],
            get_position=["lon", "lat"],
            get_color=user_color,
            get_radius=350,
            radius_min_pixels=7,
            radius_max_pixels=18,
            stroked=True,
            filled=True,
            line_width_min_pixels=2,
            get_line_color=[255, 255, 255, 255],
            pickable=True,
        )
        layers.append(user_layer)

    deck = pdk.Deck(
        layers=layers,
        initial_view_state=pdk.ViewState(
            latitude=cfg["lat"], longitude=cfg["lon"],
            zoom=10.7, pitch=0, bearing=0
        ),
        tooltip={"html": (
            "<div style='font-size:12px;line-height:1.55'>"
            "<b>{locality}</b> · <span style='color:#7dd3fc'>{grid_id}</span><br/>"
            "<span style='color:#facc15'>Status / Badge: {map_mode_badge}</span><br/>"
            "Simulated depth: <b>{depth_mm} mm</b> ({severity})<br/>"
            "<span style='color:#94a3b8'>Hotspot recurrence: <b>{hotspot_score:.0%}</b> ({hotspot_events} events)</span><br/>"
            "<span style='color:#94a3b8'>Rainfall: {rain_mm_h} mm/h · Drainage: {drain_mm_h} mm/h</span><br/>"
            "<span style='color:#94a3b8'>Elevation: {elev_m} m · River: {river} · Pop: {population}</span>"
            "</div>"),
            "style": {"backgroundColor": "#09090b", "color": "#f8fafc",
                      "border": "1px solid #27272a", "borderRadius": "4px"}},
        map_style=MAP_STYLE,
    )

    key = f"map_{cfg['lat']:.2f}_{cfg['lon']:.2f}_{app_mode}_{historical_submode}"
    kwargs = dict(stretch(st.pydeck_chart))
    if _accepts(st.pydeck_chart, "key"):
        kwargs["key"] = key
    try:
        st.pydeck_chart(deck, height=height, **kwargs)
    except TypeError:
        st.pydeck_chart(deck, **kwargs)


def render_legend(app_mode: str, historical_submode: str) -> None:
    if app_mode == "HISTORICAL" and historical_submode == "HOTSPOTS":
        st.markdown(
            """
            <div class="legend-bar">
              <span class="legend-head">Floodpy SAR Hotspot Recurrence</span>
              <span class="legend-item"><i class="sw sw-hot-low"></i>&lt; 35% · Low Risk</span>
              <span class="legend-item"><i class="sw sw-hot-mod"></i>35–65% · Moderate Hotspot</span>
              <span class="legend-item"><i class="sw sw-hot-high"></i>&gt; 65% · Severe Persistent Hotspot</span>
            </div>
            """, unsafe_allow_html=True)
    elif app_mode == "HISTORICAL" and historical_submode == "EVENTS":
        st.markdown(
            """
            <div class="legend-bar">
              <span class="legend-head">Satellite Observation & Hindcast</span>
              <span class="legend-item"><i class="sw sw-purple"></i>Sentinel-1 SAR Observed Flood Mask</span>
              <span class="legend-item"><i class="sw sw-blue"></i>&lt; 150 mm Minimal</span>
              <span class="legend-item"><i class="sw sw-yellow"></i>150–199 mm Mild</span>
              <span class="legend-item"><i class="sw sw-orange"></i>200–249 mm Significant</span>
              <span class="legend-item"><i class="sw sw-red"></i>&ge; 250 mm Severe</span>
            </div>
            """, unsafe_allow_html=True)
    else:
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
#  STATE & STYLING
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
        "note": "A moderate 22 mm/h storm against 85% blocked drains.",
    },
}


def _apply_demo(name: str) -> None:
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
        "city_name": "Bengaluru",
        "custom_cities": {},
        "hour": 1,
        "playing": False,
        "rain_mult": 1.0,
        "design_storm": 0.0,
        "storm_dur": SIM_HOURS,
        "drain_clog": 0,
        "river_surge": 1.0,
        "active_demo": "None",
        "historical_submode": "HOTSPOTS",
        "active_event_id": "blr_2022_09_05",
        "search_input": "",
        "alert_dedup": AlertDeduplicator(),
        "last_verdict": {},
        "should_notify": False,
        "live_geo": {},
    }
    for key, val in defaults.items():
        st.session_state.setdefault(key, val)


PLAY_DELAY_S = 0.35

CSS = """
<style>
.stApp { background:#030712; color:#f8fafc; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
.block-container { padding:0.5rem 1rem 0.4rem; max-width:100%; }
header[data-testid="stHeader"] { background:transparent; height:0; }
#MainMenu, footer { visibility:hidden; }

.fs-title { font-size:20px; font-weight:900; letter-spacing:.08em; color:#fff; display:inline-flex; align-items:center; gap:8px; }
.fs-sub   { font-size:11.5px; color:#94a3b8; margin-top:2px; }
.fs-city  { font-size:12.5px; color:#38bdf8; font-weight:700; }
.h-sec    { font-size:10.5px; font-weight:700; letter-spacing:.1em;
            text-transform:uppercase; color:#71717a; margin:0 0 6px; }

.panel { background:#09090b; border:1px solid #27272a; border-radius:4px;
         padding:10px 12px; margin-bottom:8px; }
.row { display:flex; justify-content:space-between; gap:8px;
       font-size:12px; margin:4px 0; }
.row .k { color:#a1a1aa; }
.row .v { color:#fafafa; font-weight:600; text-align:right; }
.row .v.sm { font-size:11px; font-weight:500; color:#d4d4d8; }

.pill { display:inline-flex; align-items:center; gap:6px; font-size:10px;
        font-weight:700; letter-spacing:.07em; padding:3px 8px;
        border-radius:4px; border:1px solid #27272a; background:#09090b; }
.p-live { color:#4ade80; border-color:#166534; }
.p-fall { color:#fbbf24; border-color:#854d0e; }
.p-part { color:#60a5fa; border-color:#1e40af; }
.dot { width:6px; height:6px; border-radius:50%; display:inline-block; }
.d-live{background:#4ade80;} .d-fall{background:#fbbf24;} .d-part{background:#60a5fa;}

.legend-bar { display:flex; flex-wrap:wrap; align-items:center; gap:12px;
              background:#09090b; border:1px solid #27272a; border-radius:4px;
              padding:6px 12px; margin-top:6px; }
.legend-head { font-size:10px; text-transform:uppercase; letter-spacing:.09em; color:#71717a; }
.legend-item { display:inline-flex; align-items:center; gap:6px; font-size:11px; color:#e2e8f0; }
.sw { width:11px; height:11px; border-radius:2px; display:inline-block; }
.sw-blue{background:rgba(59,130,246,.6);border:1px solid rgba(59,130,246,.9);}
.sw-yellow{background:rgba(234,179,8,.7);border:1px solid rgba(234,179,8,.95);}
.sw-orange{background:rgba(249,115,22,.75);border:1px solid rgba(249,115,22,1);}
.sw-red{background:rgba(239,68,68,.8);border:1px solid rgba(239,68,68,1);}
.sw-purple{background:rgba(168,85,247,.85);border:1px solid rgba(216,180,254,1);}
.sw-hot-low{background:rgba(56,189,248,.65);border:1px solid rgba(56,189,248,1);}
.sw-hot-mod{background:rgba(245,158,11,.75);border:1px solid rgba(245,158,11,1);}
.sw-hot-high{background:rgba(225,29,72,.85);border:1px solid rgba(225,29,72,1);}

.hourbox { font-size:12px; font-weight:700; color:#fff; letter-spacing:.04em;
           text-align:center; padding-top:6px; }
.kpi { display:flex; justify-content:space-between; font-size:12px; margin:4px 0; }
.kpi .k { color:#a1a1aa; } .kpi .v { font-weight:700; color:#fff; }

/* ── Prevent stale opacity flicker on rerun ─ */
[data-stale="true"],
div[data-stale="true"],
div[data-testid="stElementContainer"][data-stale="true"],
div[data-testid="stAppViewContainer"] [data-stale="true"] {
  opacity: 1 !important;
  transition: none !important;
  filter: none !important;
}

/* ── Geometric buttons ─ */
.stButton button {
  background:#09090b; border:1px solid #27272a; color:#d4d4d8;
  border-radius:4px; font-size:11px; padding:3px 6px;
  height:32px; transition:all .12s ease;
}
.stButton button:hover {
  border-color:#38bdf8; color:#fff; background:#0c4a6e;
}
.stButton button[kind="primary"],
.stButton button[data-testid="stBaseButton-primary"] {
  background:#0284c7 !important;
  border:1px solid #38bdf8 !important;
  color:#fff !important;
  font-weight:700 !important;
  letter-spacing:.06em;
  height:32px !important;
}
.stButton button[kind="secondary"],
.stButton button[data-testid="stBaseButton-secondary"] {
  background:#09090b !important;
  border:1px solid #27272a !important;
  color:#a1a1aa !important;
  font-weight:600 !important;
  height:32px !important;
}

/* Compact text input */
div[data-testid="stTextInput"] input {
  background:#09090b; color:#fff; border:1px solid #27272a;
  border-radius:4px; font-size:12px; height:34px; padding:4px 8px;
}
div[data-testid="stTextInput"] input:focus {
  border-color:#38bdf8;
}

/* Prominent Selectbox dropdown styling */
div[data-testid="stSelectbox"] div[data-baseweb="select"] {
  background-color:#09090b !important;
  border:1px solid #27272a !important;
  border-radius:4px !important;
  min-height:34px !important;
}
div[data-testid="stSelectbox"] div[data-baseweb="select"]:hover {
  border-color:#38bdf8 !important;
}
div[data-testid="stSelectbox"] div[data-baseweb="select"] * {
  color:#f8fafc !important;
  font-size:12px !important;
}
div[data-testid="stSelectbox"] svg {
  fill:#38bdf8 !important;
}

/* Geometric Tabs */
div[data-baseweb="tab-list"] {
  gap: 8px;
  background-color: transparent;
  border-bottom: 1px solid #27272a;
}
div[data-baseweb="tab"] {
  background-color: #09090b !important;
  border: 1px solid #27272a !important;
  border-bottom: none !important;
  border-radius: 4px 4px 0 0 !important;
  padding: 8px 16px !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  letter-spacing: 0.06em !important;
  color: #94a3b8 !important;
}
div[data-baseweb="tab"][aria-selected="true"] {
  background-color: #0c4a6e !important;
  border-color: #38bdf8 !important;
  color: #f8fafc !important;
}

/* ── Minimal Operations Alert UI (2D Only) ── */
.fs-alert-2d-box {
  background: #0a0a0a;
  border: 1px solid #ef4444;
  border-radius: 2px;
  padding: 10px 14px;
  margin: 6px 0 12px 0;
  font-family: monospace;
}
.fs-alert-2d-header {
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid #222222;
  padding-bottom: 6px;
  margin-bottom: 6px;
}
.fs-alert-2d-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  display: inline-block;
  flex-shrink: 0;
}
.fs-alert-2d-title {
  color: #ef4444;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  line-height: 1.2;
}
.fs-alert-2d-subtitle {
  color: #a1a1aa;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  line-height: 1.2;
}
.fs-alert-2d-area {
  margin-left: auto;
  color: #71717a;
  font-size: 10.5px;
  letter-spacing: 0.04em;
  font-family: monospace;
}
.fs-alert-2d-body {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  padding-top: 2px;
}
.fs-alert-2d-grid {
  color: #ffffff;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.fs-alert-2d-timing {
  color: #ef4444;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.safe-banner b { color: #34d399; }
</style>
"""


# ──────────────────────────────────────────────────────────────────
#  PLAYBACK FRAGMENT
# ──────────────────────────────────────────────────────────────────

PLAYBACK_STEP = "hour"


@st.fragment(run_every=PLAY_DELAY_S if st.session_state.get("playing") else None)
def playback(
    cfg: Dict,
    static_records: List[Dict],
    baseline: np.ndarray,
    active: np.ndarray,
    precip: List[float],
    drain_meta: Dict,
    pop_density: np.ndarray,
    app_mode: str,
    historical_submode: str,
    active_historical_event: Optional[Dict],
    user_point: Optional[Dict] = None,
    rail_slot = None,
    map_slot = None,
) -> None:
    if st.session_state.playing:
        cur = int(st.session_state.get(PLAYBACK_STEP, 1))
        st.session_state[PLAYBACK_STEP] = 1 if cur >= SIM_HOURS else cur + 1

    hour = int(st.session_state.hour)
    hour = max(1, min(SIM_HOURS, hour))
    depth_m = active[hour]
    depth_mm = depth_m * 1000.0

    scenario_mode = app_mode == "SCENARIO"

    if scenario_mode and float(st.session_state.design_storm) > 0:
        rain_this_hour = (float(st.session_state.design_storm)
                          if hour - 1 < int(st.session_state.storm_dur) else 0.0)
    else:
        idx = max(0, hour - 1)
        mult = float(st.session_state.rain_mult) if scenario_mode else 1.0
        rain_this_hour = (float(precip[idx]) * mult) if idx < len(precip) else 0.0

    # ---------- MAP ----------
    with map_slot:
        frame = build_map_frame(
            static_records, depth_m, rain_this_hour, hour,
            app_mode=app_mode,
            historical_submode=historical_submode,
            active_historical_event=active_historical_event,
        )
        render_map(frame, cfg, app_mode, historical_submode, user_point=user_point)
        render_legend(app_mode, historical_submode)

        # Controls under map
        if app_mode != "HISTORICAL" or historical_submode == "EVENTS":
            c_play, c_slider, c_hour = columns([0.9, 6.4, 1.1], align="center")
            with c_play:
                st.button("Pause" if st.session_state.playing else "Play",
                          on_click=_toggle_playing, **stretch(st.button))
            with c_slider:
                st.slider("Simulation hour", 1, SIM_HOURS, key="hour",
                          label_visibility="collapsed")
            with c_hour:
                st.markdown(f'<div class="hourbox">Hour {hour} / {SIM_HOURS}</div>',
                            unsafe_allow_html=True)
        else:
            st.caption("Showing static multi-temporal flood recurrence hotspots (Sentinel-1 SAR stack & topographic sink model).")

    # ---------- RAIL READOUT ----------
    kpis = compute_kpis(depth_mm, pop_density)
    base_kpis = compute_kpis(baseline[hour] * 1000.0, pop_density)

    with rail_slot:
        if app_mode == "HISTORICAL" and historical_submode == "HOTSPOTS":
            # Hotspot statistics
            high_count = sum(1 for r in static_records if r["hotspot_tier"] == "HIGH")
            mod_count = sum(1 for r in static_records if r["hotspot_tier"] == "MODERATE")
            low_count = sum(1 for r in static_records if r["hotspot_tier"] == "LOW")

            hblock = '<div class="panel"><div class="h-sec">Hotspot Vulnerability</div>'
            hblock += f'<div class="kpi"><span class="k">Severe Hotspots (&gt;65%)</span><span class="v" style="color:#f43f5e">{high_count} km²</span></div>'
            hblock += f'<div class="kpi"><span class="k">Moderate Hotspots</span><span class="v" style="color:#f59e0b">{mod_count} km²</span></div>'
            hblock += f'<div class="kpi"><span class="k">Low Risk / Resilient</span><span class="v" style="color:#38bdf8">{low_count} km²</span></div>'
            hblock += f'<div class="kpi"><span class="k">Primary Basin</span><span class="v">{drain_meta.get("basin") or cfg.get("terrain", "Urban")}</span></div>'
            hblock += "</div>"
            st.markdown(hblock, unsafe_allow_html=True)

            # Prominent hotspot locations
            high_localities = [r["locality"] for r in static_records if r["hotspot_tier"] == "HIGH"]
            high_localities = sorted(list(set(high_localities)))[:4]
            if high_localities:
                lblock = '<div class="panel"><div class="h-sec">Key Flood Hotspots</div>'
                for loc in high_localities:
                    lblock += f'<div class="row"><span class="k">▣ {loc}</span><span class="v sm" style="color:#f43f5e">Critical Sink</span></div>'
                lblock += "</div>"
                st.markdown(lblock, unsafe_allow_html=True)

        elif app_mode == "HISTORICAL" and active_historical_event:
            ev = active_historical_event
            eblock = '<div class="panel"><div class="h-sec">Satellite Observation</div>'
            eblock += f'<div class="kpi"><span class="k">Observed Flood</span><span class="v" style="color:#c084fc">{ev["observed_inundated_km2"]:.0f} km²</span></div>'
            eblock += f'<div class="kpi"><span class="k">Simulated Peak</span><span class="v">{kpis["peak_depth_mm"]:.0f} mm</span></div>'
            eblock += f'<div class="kpi"><span class="k">Sim Flooded Area</span><span class="v">{kpis["flooded_km2"]:.0f} km²</span></div>'
            eblock += f'<div class="kpi"><span class="k">Satellite Sensor</span><span class="v sm">{ev["satellite"]}</span></div>'
            eblock += "</div>"
            st.markdown(eblock, unsafe_allow_html=True)

        else:
            # Standard Forecast / Scenario readout
            block = '<div class="panel"><div class="h-sec">Simulated at this hour</div>'
            block += (f'<div class="kpi"><span class="k">Peak depth</span><span class="v">{kpis["peak_depth_mm"]:.0f} mm</span></div>')
            block += (f'<div class="kpi"><span class="k">Flooded area</span><span class="v">{kpis["flooded_km2"]:.0f} km²</span></div>')
            block += (f'<div class="kpi"><span class="k">Severe cells</span><span class="v">{kpis["severe_cells"]}</span></div>')
            if scenario_mode:
                delta = kpis["peak_depth_mm"] - base_kpis["peak_depth_mm"]
                colour = "#f87171" if delta > 0 else "#4ade80" if delta < 0 else "#8f8f8f"
                block += (f'<div class="kpi"><span class="k">vs forecast</span><span class="v" style="color:{colour}">{delta:+.0f} mm</span></div>')
            block += "</div>"
            st.markdown(block, unsafe_allow_html=True)

        # Drainage summary panel
        clog = int(st.session_state.drain_clog) if scenario_mode else 0
        effective = drain_meta["mean_capacity_mm_h"] * (1 - clog / 100.0)
        pairs = [
            ("Mean Capacity", f"{drain_meta['mean_capacity_mm_h']:.1f} mm/h"),
        ]
        if scenario_mode and clog:
            pairs.append(("Clogging", f"{clog}%"))
            pairs.append(("Effective", f"{effective:.1f} mm/h"))
        pairs.append(("Drain Status", "Clogged" if clog >= 50 else
                      "Reduced" if clog > 0 else "Nominal"))
        pairs.append(("Terrain / Base", f"{cfg.get('terrain', 'Undulating')} ({cfg.get('elevation_m', 50):.0f}m)"))
        pairs.append(("Data Source", "Karnataka Taluk CSV" if drain_meta["dataset_backed"] else "Terrain Gradient & ASCE"))

        dblock = '<div class="panel"><div class="h-sec">Drainage & Ground Model</div>'
        for k, v in pairs:
            dblock += (f'<div class="row"><span class="k">{k}</span>'
                       f'<span class="v sm">{v}</span></div>')
        dblock += "</div>"
        st.markdown(dblock, unsafe_allow_html=True)
        if not drain_meta["dataset_backed"]:
            st.caption(
                "**DRAINAGE MODELING**: Municipal drainage records are inaccessible for this area. "
                "FLOWSHIELD derives conveyance capacity from the **ASCE/CPHEEO urban design standard** "
                "(10–16 mm/h base), scaled by DEM hydraulic slope gradients, depression sink tailwater "
                "penalties, and coastal outfall head loss."
            )


def _toggle_playing() -> None:
    st.session_state.playing = not st.session_state.playing
    st.rerun()


def _set_mode(mode: str) -> None:
    st.session_state.app_mode = mode


def _set_city(city_name: str) -> None:
    st.session_state.city_name = city_name
    st.session_state.hour = 1
    st.session_state.playing = False


# ──────────────────────────────────────────────────────────────────
#  STREAMLIT CUSTOM COMPONENT: 3D FORECAST TWIN
# ──────────────────────────────────────────────────────────────────

def render_3d_map(rain_now_mm_h: float, river_q_m3s: float,
                  rain_scenario_mm_h: float, river_scenario: float,
                  scenario_mode: bool, city_cfg: Optional[Dict] = None) -> None:
    """
    Renders the FLOWSHIELD 3D Digital Twin.
    Streamlit directly serves the compiled React/Three.js bundle from flowshield/static/3d
    under /app/static/3d/index.html.
    """
    effective_rain = rain_scenario_mm_h if scenario_mode else rain_now_mm_h
    effective_river = river_scenario if scenario_mode else river_q_m3s

    loc_id = "shibuya"
    city_name = "Bengaluru"
    if city_cfg and "name" in city_cfg:
        city_name = city_cfg["name"]
        name_lower = city_name.lower()
        if "tokyo" in name_lower or "shibuya" in name_lower:
            loc_id = "shibuya"
        elif "new york" in name_lower or "manhattan" in name_lower:
            loc_id = "manhattan"
        elif "singapore" in name_lower:
            loc_id = "singapore"
        else:
            loc_id = "shibuya"

    map_url = f"/app/static/3d/index.html?rain={effective_rain:.1f}&river={effective_river:.1f}&loc={loc_id}&city={city_name}"

    # Embed same-origin iframe directly
    components.iframe(map_url, height=750, scrolling=False)

    # Info bar below the 3D map
    st.markdown(
        f"""
        <div style="background:#0a0a0a;border:1px solid #1e1e1e;border-radius:4px;
                    padding:10px 14px;margin-top:6px;font-size:11.5px;color:#6f6f6f;font-family:monospace;">
          <b style="color:#9c9c9c;">3D DIGITAL TWIN</b> &nbsp;·&nbsp;
          React / Three.js Engine &nbsp;·&nbsp;
          Location: <b style="color:#38bdf8;">{city_name.upper()}</b> &nbsp;·&nbsp;
          Rainfall: <b style="color:#d4d4d4;">{effective_rain:.1f} mm/h</b> &nbsp;·&nbsp;
          River: <b style="color:#d4d4d4;">{effective_river:.0f} m³/s</b> &nbsp;·&nbsp;
          Controls: Orbit (drag), Inspect (click), Deploy Sandbags
        </div>
        """,
        unsafe_allow_html=True,
    )


# ──────────────────────────────────────────────────────────────────
#  MAIN APPLICATION
# ──────────────────────────────────────────────────────────────────

def main() -> None:
    st.set_page_config(page_title="FLOWSHIELD", page_icon="▣",
                       layout="wide", initial_sidebar_state="collapsed")
    _init_state()
    st.markdown(CSS, unsafe_allow_html=True)

    # 1. Resolve active location
    city_name = st.session_state.city_name
    if city_name in GLOBAL_PRESETS:
        cfg = GLOBAL_PRESETS[city_name]
    elif city_name in st.session_state.custom_cities:
        cfg = st.session_state.custom_cities[city_name]
    else:
        cfg = GLOBAL_PRESETS["Bengaluru"]
        city_name = "Bengaluru"

    # 2. Fetch live data
    weather = load_weather_cached(cfg["lat"], cfg["lon"], cfg["timezone"])
    hydro = load_hydrology_cached(cfg["lat"], cfg["lon"])

    elevation, drainage_mm_h, taluk_labels, drain_meta, pop_density, hotspots = get_city_models(cfg)
    static_records = static_map_records(cfg, elevation, drainage_mm_h, taluk_labels, pop_density, hotspots)

    w_live = "Synthetic" not in weather["source"]
    h_live = "Synthetic" not in hydro["source"]
    if w_live and h_live:
        pill_text, pill_cls, dot_cls = "LIVE SENSORS", "p-live", "d-live"
    elif not w_live and not h_live:
        pill_text, pill_cls, dot_cls = "SYNTHETIC MODEL", "p-fall", "d-fall"
    else:
        pill_text, pill_cls, dot_cls = "HYBRID LIVE", "p-part", "d-part"

    precip = weather["hourly_precip_mm"]
    river_q = float(hydro["river_discharge_m3s"])
    scenario_mode = st.session_state.app_mode == "SCENARIO"
    historical_mode = st.session_state.app_mode == "HISTORICAL"

    # ── Header & Location Bar ─────────────────────────────────────
    hcol1, hcol2 = columns([7.2, 2.8], align="center")
    with hcol1:
        flag = f"{cfg.get('country', '')}"
        st.markdown(
            f'<div class="fs-title">FLOWSHIELD <span style="font-size:12px;font-weight:400;color:#64748b">GLOBAL</span></div>'
            f'<div class="fs-sub">Flood Simulation &amp; Early Warning &nbsp;·&nbsp; '
            f'<span class="fs-city">{cfg["name"]}, {flag}</span> &nbsp;·&nbsp; '
            f'<span style="color:#64748b">{cfg["lat"]:.2f}°, {cfg["lon"]:.2f}° · Elev: {cfg["elevation_m"]:.0f}m · {cfg["timezone"]}</span></div>',
            unsafe_allow_html=True,
        )
    with hcol2:
        st.markdown(f'<div style="text-align:right"><div class="pill {pill_cls}">'
                    f'<span class="dot {dot_cls}"></span>{pill_text}</div></div>',
                    unsafe_allow_html=True)

    # ── Interactive Location Search (While-You-Type Dropdown) ────
    loc_selection = render_location_search(current_city=cfg["name"], key="flowshield_search_bar")
    if loc_selection and isinstance(loc_selection, dict) and "name" in loc_selection:
        sel_name = loc_selection["name"]
        sel_lat = round(float(loc_selection.get("latitude", 0)), 4)
        sel_lon = round(float(loc_selection.get("longitude", 0)), 4)
        curr_lat = round(float(cfg.get("lat", 0)), 4)
        curr_lon = round(float(cfg.get("lon", 0)), 4)

        if (sel_name != cfg["name"]) or (sel_lat != curr_lat) or (sel_lon != curr_lon):
            if sel_name in GLOBAL_PRESETS and abs(GLOBAL_PRESETS[sel_name]["lat"] - sel_lat) < 0.05:
                _set_city(sel_name)
            else:
                new_cfg = create_city_config(loc_selection)
                st.session_state.custom_cities[new_cfg["name"]] = new_cfg
                _set_city(new_cfg["name"])
            st.rerun()

    # ── Tabs: 2D Forecast Map | 3D Digital Twin ────────────────────
    tab2d, tab3d = st.tabs(["2D FORECAST MAP", "3D DIGITAL TWIN"])

    with tab2d:
        # ── Predictive Simulation Baseline (for 2D Map & Alerts) ──────
        engine = FloodSimulationEngine(elevation, drainage_mm_h)
        baseline_active = engine.run(precip, river_q)

        # ── 2D Live Geolocation Bar & Predictive Warning Monitor ──────
        deduplicator: AlertDeduplicator = st.session_state.alert_dedup
        live_geo = render_live_location_tracker(
            active_city=cfg["name"],
            verdict=st.session_state.get("last_verdict", {}),
            should_notify=st.session_state.get("should_notify", False),
            key="flowshield_live_gps_tracker_2d",
        )
        st.session_state.should_notify = False

        scenario = live_geo.get("scenario", "LIVE") if live_geo else "LIVE"
        raw_lat = live_geo.get("latitude") if live_geo else None
        raw_lon = live_geo.get("longitude") if live_geo else None
        perm = live_geo.get("permission", "prompt") if live_geo else "prompt"

        user_point = None
        grid_info = None
        if scenario == "LIVE":
            if raw_lat is not None and raw_lon is not None and perm == "granted":
                user_lat = float(raw_lat)
                user_lon = float(raw_lon)
                iq_data = reverse_geocode_locationiq(user_lat, user_lon)
                grid_info = map_coordinates_to_grid(user_lat, user_lon, cfg, static_records, g=GRID_SIZE)
                locality_display = (iq_data.get("locality") if iq_data and iq_data.get("locality") else grid_info["locality"])
                grid_code = grid_info["grid_code"]

                if grid_info["is_in_grid"]:
                    depth_timeline = [float(baseline_active[t, grid_info["i"], grid_info["j"]] * 1000.0) for t in range(25)]
                    verdict = evaluate_24h_flood_forecast(
                        depth_timeline,
                        area_name=locality_display,
                        grid_code=grid_code,
                    )
                    user_point = {
                        "lat": user_lat,
                        "lon": user_lon,
                        "locality": locality_display,
                        "color": [239, 68, 68, 240] if verdict.get("is_alert") else [56, 189, 248, 240],
                        "grid_id": grid_code,
                        "map_mode_badge": "LIVE LOCATION PIN",
                        "depth_mm": f"{verdict.get('current_depth_mm', 0):.0f}",
                        "severity": "CRITICAL RISK" if verdict.get("is_alert") else "SAFE",
                        "hotspot_score": 0.0,
                        "hotspot_events": 0,
                        "rain_mm_h": 0.0,
                        "drain_mm_h": 0.0,
                        "elev_m": 0,
                        "river": "N/A",
                        "population": "Live User",
                    }
                else:
                    verdict = {
                        "is_alert": False,
                        "is_severe_expected": False,
                        "is_already_severe": False,
                        "forecast_available": False,
                        "hours_until_severe": None,
                        "current_status": "OUTSIDE BASIN",
                        "forecast_status": "OUTSIDE BASIN",
                        "current_depth_mm": 0.0,
                        "peak_depth_24h_mm": 0.0,
                        "headline": "LOCATION OUTSIDE MODEL GRID",
                        "time_text": f"{grid_info['distance_from_center_km']:.0f} km from center",
                        "message": f"Your GPS coordinates ({user_lat:.4f}, {user_lon:.4f}) are outside the active watershed grid ({cfg['name']}).",
                        "area_name": locality_display,
                        "grid_code": grid_code,
                    }
                    user_point = {
                        "lat": user_lat,
                        "lon": user_lon,
                        "locality": locality_display,
                        "color": [148, 163, 184, 200],
                        "grid_id": grid_code,
                        "map_mode_badge": "OUTSIDE BASIN",
                        "depth_mm": "0",
                        "severity": "OUTSIDE BASIN",
                        "hotspot_score": 0.0,
                        "hotspot_events": 0,
                        "rain_mm_h": 0.0,
                        "drain_mm_h": 0.0,
                        "elev_m": 0,
                        "river": "N/A",
                        "population": "Live User",
                    }
            else:
                grid_info = map_coordinates_to_grid(cfg["lat"], cfg["lon"], cfg, static_records, g=GRID_SIZE)
                depth_timeline = [float(baseline_active[t, grid_info["i"], grid_info["j"]] * 1000.0) for t in range(25)]
                verdict = evaluate_24h_flood_forecast(
                    depth_timeline,
                    area_name=f"{cfg['name']} Central ({grid_info['locality']})",
                    grid_code=grid_info["grid_code"],
                )
                user_point = None

        elif scenario == "SAFE":
            depth_timeline = [20.0] * 25
            grid_info = {"i": 0, "j": 0, "grid_code": "A01", "grid_id": "G00-00", "locality": "Area A", "is_in_grid": True}
            verdict = evaluate_24h_flood_forecast(depth_timeline, area_name=f"Area A - Green Zone ({cfg['name']})", grid_code="A01")
            user_point = {
                "lat": cfg["lat"],
                "lon": cfg["lon"],
                "color": [56, 189, 248, 240],
                "locality": "Area A",
                "grid_id": "A01",
                "map_mode_badge": "SIMULATED (SAFE)",
                "depth_mm": "20",
                "severity": "SAFE",
                "hotspot_score": 0.0,
                "hotspot_events": 0,
                "rain_mm_h": 0.0,
                "drain_mm_h": 0.0,
                "elev_m": 0,
                "river": "N/A",
                "population": "Test User",
            }

        elif scenario == "SEVERE_18":
            depth_timeline = [25.0] * 18 + [285.0] * 7
            grid_info = {"i": 0, "j": 11, "grid_code": "A12", "grid_id": "G00-11", "locality": "Lowland Basin", "is_in_grid": True}
            verdict = evaluate_24h_flood_forecast(depth_timeline, area_name=f"Lowland Basin Sector ({cfg['name']})", grid_code="A12")
            user_point = {
                "lat": cfg["lat"] + 0.012,
                "lon": cfg["lon"] + 0.012,
                "color": [239, 68, 68, 240],
                "locality": "Lowland Basin",
                "grid_id": "A12",
                "map_mode_badge": "PREDICTIVE SEVERE (18h)",
                "depth_mm": "25",
                "severity": "RED SEVERE WARNING",
                "hotspot_score": 0.0,
                "hotspot_events": 0,
                "rain_mm_h": 0.0,
                "drain_mm_h": 0.0,
                "elev_m": 0,
                "river": "N/A",
                "population": "Test User",
            }

        elif scenario == "SEVERE_30":
            timeline_35 = [35.0] * 35
            timeline_35[30] = 310.0
            grid_info = {"i": 1, "j": 4, "grid_code": "B05", "grid_id": "G01-04", "locality": "Distant Basin", "is_in_grid": True}
            verdict = evaluate_24h_flood_forecast(timeline_35, area_name=f"Distant Basin ({cfg['name']})", grid_code="B05")
            user_point = {
                "lat": cfg["lat"],
                "lon": cfg["lon"],
                "color": [56, 189, 248, 240],
                "locality": "Distant Basin",
                "grid_id": "B05",
                "map_mode_badge": "SIMULATED (>24h)",
                "depth_mm": "35",
                "severity": "SAFE (24h)",
                "hotspot_score": 0.0,
                "hotspot_events": 0,
                "rain_mm_h": 0.0,
                "drain_mm_h": 0.0,
                "elev_m": 0,
                "river": "N/A",
                "population": "Test User",
            }

        elif scenario == "ALREADY_SEVERE":
            depth_timeline = [275.0] * 25
            grid_info = {"i": 2, "j": 2, "grid_code": "C03", "grid_id": "G02-02", "locality": "Sector C", "is_in_grid": True}
            verdict = evaluate_24h_flood_forecast(depth_timeline, area_name=f"Submerged Sector C ({cfg['name']})", grid_code="C03")
            user_point = {
                "lat": cfg["lat"] - 0.008,
                "lon": cfg["lon"] - 0.008,
                "color": [239, 68, 68, 240],
                "locality": "Sector C",
                "grid_id": "C03",
                "map_mode_badge": "ACTIVE BREACH",
                "depth_mm": "275",
                "severity": "ACTIVE SEVERE",
                "hotspot_score": 0.0,
                "hotspot_events": 0,
                "rain_mm_h": 0.0,
                "drain_mm_h": 0.0,
                "elev_m": 0,
                "river": "N/A",
                "population": "Test User",
            }

        elif scenario == "MOVE_A_B":
            depth_timeline = [45.0] * 12 + [290.0] * 13
            grid_info = {"i": 1, "j": 7, "grid_code": "B08", "grid_id": "G01-07", "locality": "Area B", "is_in_grid": True}
            verdict = evaluate_24h_flood_forecast(depth_timeline, area_name=f"Relocated Area B - River Ingress ({cfg['name']})", grid_code="B08")
            user_point = {
                "lat": cfg["lat"] + 0.018,
                "lon": cfg["lon"] - 0.018,
                "color": [239, 68, 68, 240],
                "locality": "Area B",
                "grid_id": "B08",
                "map_mode_badge": "RELOCATED RISK",
                "depth_mm": "45",
                "severity": "RED SEVERE WARNING",
                "hotspot_score": 0.0,
                "hotspot_events": 0,
                "rain_mm_h": 0.0,
                "drain_mm_h": 0.0,
                "elev_m": 0,
                "river": "N/A",
                "population": "Test User",
            }

        elif scenario == "CLEARED":
            depth_timeline = [30.0] * 25
            grid_info = {"i": 3, "j": 3, "grid_code": "D04", "grid_id": "G03-03", "locality": "Cleared Ward", "is_in_grid": True}
            verdict = evaluate_24h_flood_forecast(depth_timeline, area_name=f"Cleared Ward ({cfg['name']})", grid_code="D04")
            user_point = {
                "lat": cfg["lat"],
                "lon": cfg["lon"],
                "color": [56, 189, 248, 240],
                "locality": "Cleared Ward",
                "grid_id": "D04",
                "map_mode_badge": "CLEARED",
                "depth_mm": "30",
                "severity": "SAFE",
                "hotspot_score": 0.0,
                "hotspot_events": 0,
                "rain_mm_h": 0.0,
                "drain_mm_h": 0.0,
                "elev_m": 0,
                "river": "N/A",
                "population": "Test User",
            }

        elif scenario == "DENIED":
            grid_info = map_coordinates_to_grid(cfg["lat"], cfg["lon"], cfg, static_records, g=GRID_SIZE)
            depth_timeline = [float(baseline_active[t, grid_info["i"], grid_info["j"]] * 1000.0) for t in range(25)]
            verdict = evaluate_24h_flood_forecast(
                depth_timeline,
                area_name=f"{cfg['name']} Central (Fallback)",
                grid_code=grid_info["grid_code"],
            )
            user_point = None

        elif scenario == "UNAVAILABLE":
            grid_info = None
            verdict = evaluate_24h_flood_forecast([], area_name=f"Remote Sector ({cfg['name']})", grid_code="N/A", forecast_available=False)
            user_point = None

        # Deduplicate notification
        should_notify, _ = deduplicator.should_notify(verdict)
        if should_notify:
            st.session_state.should_notify = True
        st.session_state.last_verdict = verdict

        # ── Exact-Grid RED SEVERE Flood Warning (2D Interface Only) ────
        # "If the user's grid is safe or no severe flood is expected within 24 hours, display nothing (no alert box)."
        if verdict.get("is_alert"):
            grid_label = verdict.get("grid_code") or (grid_info.get("grid_code") if grid_info else "A12")
            h_severe = verdict.get("hours_until_severe", 0)
            if h_severe == 0:
                timing_text = "RED SEVERE CONDITIONS ACTIVE"
            else:
                timing_text = f"RED SEVERE EXPECTED IN ~{h_severe} HOURS"
            area_text = verdict.get("area_name", "").upper()

            st.markdown(
                f"""
                <div class="fs-alert-2d-box">
                  <div class="fs-alert-2d-header">
                    <div class="fs-alert-2d-dot"></div>
                    <div>
                      <div class="fs-alert-2d-title">RED SEVERE</div>
                      <div class="fs-alert-2d-subtitle">FLOOD WARNING</div>
                    </div>
                    <div class="fs-alert-2d-area">{area_text}</div>
                  </div>
                  <div class="fs-alert-2d-body">
                    <div class="fs-alert-2d-grid">GRID {grid_label}</div>
                    <div class="fs-alert-2d-timing">{timing_text}</div>
                  </div>
                </div>
                """,
                unsafe_allow_html=True,
            )
        # ── Layout: Rail + Map ────────────────────────────────────────
        rail, mapcol = columns([1.4, 5.2], gap="medium")

        # ---------- MODE CONTROLS ----------
        with rail:
            col_f, col_s, col_h = columns([1, 1, 1], gap="small")
            with col_f:
                st.button(
                    "FORECAST",
                    key="btn_mode_forecast",
                    type="primary" if st.session_state.app_mode == "FORECAST" else "secondary",
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
            with col_h:
                st.button(
                    "HOTSPOTS",
                    key="btn_mode_historical",
                    type="primary" if historical_mode else "secondary",
                    on_click=_set_mode,
                    args=("HISTORICAL",),
                    **stretch(st.button),
                )

        active_historical_event = None
        engine = FloodSimulationEngine(elevation, drainage_mm_h)

        # ---------- MODE-SPECIFIC CONFIGURATION ----------
        with rail:
            if st.session_state.app_mode == "FORECAST":
                rain_now = float(precip[0]) if precip else 0.0
                rain_next = float(precip[1]) if len(precip) > 1 else 0.0
                rain_6 = float(sum(precip[:6]))
                rain_total = float(sum(precip[:SIM_HOURS]))
                body = '<div class="panel"><div class="h-sec">Live Meteorological Inputs</div>'
                for k, v in [("Rain now", f"{rain_now:.1f} mm/h"),
                             ("Next hour", f"{rain_next:.1f} mm/h"),
                             ("Next 6 h", f"{rain_6:.0f} mm"),
                             (f"Next {SIM_HOURS} h", f"{rain_total:.0f} mm"),
                             ("River discharge", f"{river_q:,.0f} m³/s")]:
                    body += (f'<div class="row"><span class="k">{k}</span>'
                             f'<span class="v">{v}</span></div>')
                body += "</div>"
                st.markdown(body, unsafe_allow_html=True)

                baseline = engine.run(precip, river_q)
                active = baseline

            elif scenario_mode:
                st.markdown('<div class="h-sec" style="margin-top:8px;">Demo Scenarios</div>',
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

                st.markdown('<div class="h-sec">Stress Controls</div>',
                            unsafe_allow_html=True)
                st.slider("Design storm (mm/h) — 0 uses forecast",
                          0.0, 80.0, step=1.0, key="design_storm")
                if float(st.session_state.design_storm) == 0.0:
                    st.slider("Forecast rainfall (×)", 0.0, 5.0, step=0.1, key="rain_mult")
                st.slider("Storm duration (hours)", 1, SIM_HOURS, key="storm_dur")
                st.slider("Drainage clogging (%)", 0, 100, step=5, key="drain_clog")
                st.slider("River surge (×)", 0.5, 5.0, step=0.1, key="river_surge")

                baseline = engine.run(precip, river_q)
                active = engine.run(
                    precip, river_q,
                    rain_mult=float(st.session_state.rain_mult),
                    design_storm_mm_h=float(st.session_state.design_storm),
                    storm_duration_h=int(st.session_state.storm_dur),
                    drain_clog_frac=int(st.session_state.drain_clog) / 100.0,
                    river_surge_mult=float(st.session_state.river_surge),
                )

            else:
                # HISTORICAL & HOTSPOTS MODE
                st.markdown('<div class="h-sec" style="margin-top:6px;">Analysis Layer</div>', unsafe_allow_html=True)
                s_col1, s_col2 = columns([1, 1])
                with s_col1:
                    if st.button("Hotspots Map",
                                 type="primary" if st.session_state.historical_submode == "HOTSPOTS" else "secondary",
                                 **stretch(st.button)):
                        st.session_state.historical_submode = "HOTSPOTS"
                        st.rerun()
                with s_col2:
                    if st.button("Past Storms",
                                 type="primary" if st.session_state.historical_submode == "EVENTS" else "secondary",
                                 **stretch(st.button)):
                        st.session_state.historical_submode = "EVENTS"
                        st.rerun()

                avail_events = get_available_historical_events(cfg["name"])
                if not avail_events:
                    avail_events = list(HISTORICAL_EVENTS.values())

                event_options = {ev["id"]: f"{ev['title']}" for ev in avail_events}
                if st.session_state.active_event_id not in event_options:
                    st.session_state.active_event_id = list(event_options.keys())[0]

                if st.session_state.historical_submode == "EVENTS":
                    sel_id = st.selectbox(
                        "Historical Storm",
                        options=list(event_options.keys()),
                        format_func=lambda x: event_options[x],
                        key="event_selector",
                    )
                    st.session_state.active_event_id = sel_id
                    active_historical_event = get_historical_event(sel_id)

                    if active_historical_event:
                        ev = active_historical_event
                        ebody = '<div class="panel"><div class="h-sec">Storm Event Profile</div>'
                        ebody += f'<div class="row"><span class="k">Date</span><span class="v sm">{ev["date_str"]}</span></div>'
                        ebody += f'<div class="row"><span class="k">24h Rain</span><span class="v">{ev["total_rain_24h_mm"]:.1f} mm</span></div>'
                        ebody += f'<div class="row"><span class="k">Peak Rate</span><span class="v">{ev["peak_hourly_rain_mm"]:.1f} mm/h</span></div>'
                        ebody += f'<div class="row"><span class="k">Validation</span><span class="v sm" style="color:#4ade80">{ev["ground_truth_accuracy"]}</span></div>'
                        ebody += "</div>"
                        st.markdown(ebody, unsafe_allow_html=True)
                        st.caption(ev["impact_summary"])

                        # Run simulation with historical rainfall profile
                        precip = ev["rain_profile_24h"]
                        active = engine.run(precip, river_q, river_surge_mult=ev.get("river_surge", 1.5))
                        baseline = active
                    else:
                        active = engine.run(precip, river_q)
                        baseline = active
                else:
                    st.caption(
                        "Empirical flood frequency calculated using multi-temporal Sentinel-1 SAR change detection "
                        "(Floodpy methodology) combined with topographic depression analysis."
                    )
                    active = engine.run(precip, river_q)
                    baseline = active

        rail_slot = rail.container()
        map_slot = mapcol.container()

        playback(
            cfg=cfg,
            static_records=static_records,
            baseline=baseline,
            active=active,
            precip=precip,
            drain_meta=drain_meta,
            pop_density=pop_density,
            app_mode=st.session_state.app_mode,
            historical_submode=st.session_state.historical_submode,
            active_historical_event=active_historical_event,
            user_point=user_point,
            rail_slot=rail_slot,
            map_slot=map_slot,
        )

    with tab3d:
        rain_now_val = float(precip[0]) if precip else 0.0
        if scenario_mode:
            rain_3d = float(st.session_state.design_storm) if float(st.session_state.design_storm) > 0.0 else rain_now_val * float(st.session_state.rain_mult)
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
            city_cfg=cfg,
        )


if __name__ == "__main__":
    main()