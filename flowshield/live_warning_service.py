# -*- coding: utf-8 -*-
"""
FLOWSHIELD Live Location & Predictive Flood Warning Service
Continuously monitors user coordinates, maps them to the hydrodynamic grid,
evaluates 24-hour flood inundation timelines, and triggers proactive RED SEVERE warnings.
"""

import math
import os
import time
from typing import Dict, List, Optional, Tuple
import requests

# ── Flood Depth Thresholds (in mm) ──
DEPTH_MILD_MM = 150.0
DEPTH_SIGNIFICANT_MM = 200.0
DEPTH_SEVERE_MM = 250.0  # 0.25 m = RED SEVERE

# ── LocationIQ Configuration ──
LOCATIONIQ_TOKEN = os.environ.get("LOCATIONIQ_TOKEN", "pk.4bb34f8a1d3e50f9694002fffd1415b3")
LOCATIONIQ_REVERSE_URL = "https://us1.locationiq.com/v1/reverse"


def reverse_geocode_locationiq(lat: float, lon: float, token: str = LOCATIONIQ_TOKEN) -> Optional[Dict]:
    """
    Reverse geocodes latitude/longitude into a human-readable area name using LocationIQ.
    Returns structured location metadata or None if request fails.
    """
    if not token or lat is None or lon is None:
        return None

    try:
        resp = requests.get(
            LOCATIONIQ_REVERSE_URL,
            params={
                "key": token,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "format": "json",
                "addressdetails": 1,
                "zoom": 16,
            },
            timeout=4,
        )
        if resp.status_code != 200:
            return None

        data = resp.json()
        address = data.get("address", {})
        
        # Determine the most specific neighborhood/area name
        locality = (
            address.get("neighbourhood")
            or address.get("suburb")
            or address.get("residential")
            or address.get("road")
            or address.get("city_district")
            or address.get("city")
            or "Current Area"
        )
        city = address.get("city") or address.get("town") or address.get("county") or ""
        state = address.get("state") or ""
        country = address.get("country") or ""

        return {
            "display_name": data.get("display_name", ""),
            "locality": locality,
            "city": city,
            "state": state,
            "country": country,
            "raw_address": address,
        }
    except Exception:
        return None


def map_coordinates_to_grid(
    lat: float,
    lon: float,
    city_cfg: Dict,
    records: List[Dict],
    g: int = 12,
    cell_km: float = 1.0,
) -> Dict:
    """
    Maps GPS latitude/longitude to a discrete simulation grid cell (i, j).
    Returns cell identifiers, locality, taluk, and whether the coordinates fall inside the active watershed.
    """
    city_lat = float(city_cfg.get("lat", 0.0))
    city_lon = float(city_cfg.get("lon", 0.0))

    dlat = cell_km / 111.0
    cos_lat = math.cos(math.radians(city_lat))
    dlon = cell_km / (111.0 * (cos_lat if abs(cos_lat) > 0.05 else 0.05))

    # Grid indices
    i_float = (lat - city_lat) / dlat + g / 2.0
    j_float = (lon - city_lon) / dlon + g / 2.0

    i = int(round(i_float))
    j = int(round(j_float))

    # Calculate distance from center in kilometers
    dist_km = math.sqrt(((lat - city_lat) * 111.0) ** 2 + ((lon - city_lon) * 111.0 * cos_lat) ** 2)
    is_in_grid = (0 <= i < g) and (0 <= j < g)

    # Clamp indices to nearest valid cell for fallback query
    clamped_i = max(0, min(g - 1, i))
    clamped_j = max(0, min(g - 1, j))

    matched_record = None
    if records:
        for r in records:
            if r.get("i") == clamped_i and r.get("j") == clamped_j:
                matched_record = r
                break

    grid_code = f"{chr(65 + clamped_i)}{clamped_j + 1:02d}"
    grid_id = f"G{clamped_i:02d}-{clamped_j:02d}"
    locality = matched_record.get("locality", f"Sector {grid_id}") if matched_record else f"Sector {grid_id}"
    taluk = matched_record.get("taluk", city_cfg.get("name", "Urban")) if matched_record else city_cfg.get("name", "Urban")

    return {
        "i": clamped_i,
        "j": clamped_j,
        "raw_i": i,
        "raw_j": j,
        "grid_id": grid_id,
        "grid_code": grid_code,
        "locality": locality,
        "taluk": taluk,
        "is_in_grid": is_in_grid,
        "distance_from_center_km": dist_km,
        "city_name": city_cfg.get("name", "Unknown"),
    }


def evaluate_24h_flood_forecast(
    depth_timeline_mm: List[float],
    area_name: str = "Your Area",
    grid_code: str = "",
    forecast_available: bool = True,
) -> Dict:
    """
    Core Predictive Flood Evaluation Rule.
    
    Examines the 24-hour flood forecast timeline (depth_timeline_mm[0..24]):
    - Is this location expected to reach RED SEVERE flood conditions (>= 250 mm)
      at any point within the next 24 hours?
    
    The alert triggers when:
      forecasted RED SEVERE time > now (within next 24 hours)
      OR
      area is currently already in RED SEVERE conditions.
    
    Returns structured prediction verdict with countdown, status, and advisory.
    """
    if not forecast_available or not depth_timeline_mm or len(depth_timeline_mm) == 0:
        return {
            "is_alert": False,
            "is_severe_expected": False,
            "is_already_severe": False,
            "forecast_available": False,
            "hours_until_severe": None,
            "current_status": "UNAVAILABLE",
            "forecast_status": "UNAVAILABLE",
            "current_depth_mm": 0.0,
            "peak_depth_24h_mm": 0.0,
            "headline": "FORECAST UNAVAILABLE",
            "time_text": "Unavailable",
            "message": f"Predictive flood model is unavailable for {area_name}. No speculative warning generated.",
            "area_name": area_name,
            "grid_code": grid_code,
        }

    # Current depth at t = 0
    current_depth_mm = float(depth_timeline_mm[0])

    # Determine Current Status
    if current_depth_mm >= DEPTH_SEVERE_MM:
        current_status = "RED SEVERE"
    elif current_depth_mm >= DEPTH_SIGNIFICANT_MM:
        current_status = "WARNING"
    elif current_depth_mm >= DEPTH_MILD_MM:
        current_status = "WATCH"
    else:
        current_status = "SAFE"

    # Evaluate Next 24-Hour Forecast Timeline (t = 1 to 24)
    # Check if RED SEVERE is expected within the 24-hour window
    forecast_horizon_24 = depth_timeline_mm[1:25]
    severe_indices = [
        t + 1 for t, d in enumerate(forecast_horizon_24) if float(d) >= DEPTH_SEVERE_MM
    ]

    is_already_severe = (current_status == "RED SEVERE")
    has_future_severe = len(severe_indices) > 0

    peak_24h_mm = max([float(d) for d in depth_timeline_mm[:25]])

    if is_already_severe:
        # Immediate Severe Breach Active
        is_alert = True
        is_severe_expected = True
        hours_until_severe = 0
        forecast_status = "RED SEVERE"
        headline = "RED SEVERE FLOOD WARNING — ACTIVE INUNDATION"
        time_text = "CURRENTLY ACTIVE"
        message = (
            f"Your current area ({area_name}) is experiencing severe inundation "
            f"({current_depth_mm:.0f} mm surface water). Evacuate ground levels immediately."
        )
    elif has_future_severe:
        # Proactive Predictive Warning: Safe or Warning now, but Severe expected within 24h
        t_first_severe = severe_indices[0]
        is_alert = True
        is_severe_expected = True
        hours_until_severe = t_first_severe
        forecast_status = "RED SEVERE"
        headline = "RED SEVERE FLOOD WARNING"
        time_text = f"~{t_first_severe} hours from now"
        message = (
            f"Your current area ({area_name}) is forecast to reach severe flood conditions "
            f"within the next 24 hours (estimated in ~{t_first_severe}h). "
            f"Peak depth is expected to reach {peak_24h_mm:.0f} mm."
        )
    else:
        # No severe conditions expected within the 24-hour window
        is_alert = False
        is_severe_expected = False
        hours_until_severe = None
        
        # Forecast status for non-severe peak
        if peak_24h_mm >= DEPTH_SIGNIFICANT_MM:
            forecast_status = "WARNING"
        elif peak_24h_mm >= DEPTH_MILD_MM:
            forecast_status = "WATCH"
        else:
            forecast_status = "SAFE"

        headline = "NO IMMINENT SEVERE FLOODING"
        time_text = "No severe flood predicted in next 24h"
        message = (
            f"Current area ({area_name}) remains within manageable thresholds for the next 24 hours. "
            f"Peak depth: {peak_24h_mm:.0f} mm."
        )

    return {
        "is_alert": is_alert,
        "is_severe_expected": is_severe_expected,
        "is_already_severe": is_already_severe,
        "forecast_available": True,
        "hours_until_severe": hours_until_severe,
        "current_status": current_status,
        "forecast_status": forecast_status,
        "current_depth_mm": current_depth_mm,
        "peak_depth_24h_mm": peak_24h_mm,
        "headline": headline,
        "time_text": time_text,
        "message": message,
        "area_name": area_name,
        "grid_code": grid_code,
    }


class AlertDeduplicator:
    """
    Prevents repeated / duplicate alert notifications on every frame or script re-run.
    Only allows firing a new notification when the forecast status, area, or critical timing meaningfully changes.
    """

    def __init__(self):
        self.last_signature: Optional[str] = None
        self.last_notified_timestamp: float = 0.0

    def should_notify(self, verdict: Dict, min_interval_seconds: float = 180.0) -> Tuple[bool, str]:
        """
        Evaluates whether a new browser or system notification should be dispatched.
        Returns (should_notify: bool, signature: str).
        """
        if not verdict.get("is_alert"):
            # If no alert, reset signature so future alerts trigger cleanly
            self.last_signature = None
            return False, "NO_ALERT"

        grid = verdict.get("grid_code", "")
        area = verdict.get("area_name", "")
        hours = verdict.get("hours_until_severe", 0)
        curr_status = verdict.get("current_status", "")
        fore_status = verdict.get("forecast_status", "")
        peak_bucket = int(verdict.get("peak_depth_24h_mm", 0) / 50) * 50

        # Unique signature identifying this specific warning state
        signature = f"{grid}:{area}:{curr_status}:{fore_status}:H{hours}:P{peak_bucket}"
        now = time.time()

        if signature != self.last_signature:
            # Meaningful change: new area, changed severity, or changed arrival time
            self.last_signature = signature
            self.last_notified_timestamp = now
            return True, signature

        if (now - self.last_notified_timestamp) > min_interval_seconds:
            # Periodic reminder for sustained severe danger
            self.last_notified_timestamp = now
            return True, signature

        # Duplicate render - do not notify
        return False, signature
