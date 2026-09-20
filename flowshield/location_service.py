# -*- coding: utf-8 -*-
"""
FLOWSHIELD — Global Location Service
Provides keyless geocoding, preset management, and dynamic city configuration
for any place in the world using the Open-Meteo Geocoding API.
"""

from typing import Dict, List, Optional
import requests
import streamlit as st

GEOCODING_API_URL = "https://geocoding-api.open-meteo.com/v1/search"

# Pre-configured global presets covering different hydrometeorological regimes
GLOBAL_PRESETS: Dict[str, Dict] = {
    "Bengaluru": {
        "name": "Bengaluru",
        "region": "Karnataka",
        "country": "India",
        "country_code": "IN",
        "lat": 12.9716,
        "lon": 77.5946,
        "elevation_m": 920.0,
        "timezone": "Asia/Kolkata",
        "terrain": "undulating",
        "pop_density_base": 12000,
        "fallback_drainage_mm_h": 10.6,
        "taluks": {
            "centre": "Bengaluru",
            "north": "Yelahanka",
            "east": "Krishnarajapura",
            "south": "Anekal",
            "west": "Kengeri",
        },
    },
    "Valencia": {
        "name": "Valencia",
        "region": "Valencian Community",
        "country": "Spain",
        "country_code": "ES",
        "lat": 39.4699,
        "lon": -0.3763,
        "elevation_m": 15.0,
        "timezone": "Europe/Madrid",
        "terrain": "lowland_coastal",
        "pop_density_base": 6000,
        "fallback_drainage_mm_h": 14.0,
        "taluks": {
            "centre": "Ciutat Vella",
            "north": "Poblats del Nord",
            "east": "Poblats Maritims",
            "south": "Poblats del Sud",
            "west": "Campanar",
        },
    },
    "Tokyo": {
        "name": "Tokyo",
        "region": "Tokyo",
        "country": "Japan",
        "country_code": "JP",
        "lat": 35.6895,
        "lon": 139.6917,
        "elevation_m": 44.0,
        "timezone": "Asia/Tokyo",
        "terrain": "undulating",
        "pop_density_base": 15000,
        "fallback_drainage_mm_h": 22.0,
        "taluks": {
            "centre": "Chiyoda",
            "north": "Taito",
            "east": "Koto",
            "south": "Minato",
            "west": "Shinjuku",
        },
    },
    "London": {
        "name": "London",
        "region": "Greater London",
        "country": "United Kingdom",
        "country_code": "GB",
        "lat": 51.5074,
        "lon": -0.1278,
        "elevation_m": 15.0,
        "timezone": "Europe/London",
        "terrain": "lowland_river",
        "pop_density_base": 5700,
        "fallback_drainage_mm_h": 16.5,
        "taluks": {
            "centre": "City of London",
            "north": "Camden",
            "east": "Tower Hamlets",
            "south": "Southwark",
            "west": "Westminster",
        },
    },
    "New York": {
        "name": "New York",
        "region": "New York",
        "country": "United States",
        "country_code": "US",
        "lat": 40.7128,
        "lon": -74.0060,
        "elevation_m": 10.0,
        "timezone": "America/New_York",
        "terrain": "coastal_estuary",
        "pop_density_base": 11000,
        "fallback_drainage_mm_h": 18.0,
        "taluks": {
            "centre": "Manhattan",
            "north": "The Bronx",
            "east": "Queens",
            "south": "Staten Island",
            "west": "Jersey City",
        },
    },
    "Jakarta": {
        "name": "Jakarta",
        "region": "Special Capital Region of Jakarta",
        "country": "Indonesia",
        "country_code": "ID",
        "lat": -6.2088,
        "lon": 106.8456,
        "elevation_m": 8.0,
        "timezone": "Asia/Jakarta",
        "terrain": "lowland_delta",
        "pop_density_base": 14500,
        "fallback_drainage_mm_h": 9.5,
        "taluks": {
            "centre": "Central Jakarta",
            "north": "North Jakarta",
            "east": "East Jakarta",
            "south": "South Jakarta",
            "west": "West Jakarta",
        },
    },
    "Dubai": {
        "name": "Dubai",
        "region": "Dubai",
        "country": "United Arab Emirates",
        "country_code": "AE",
        "lat": 25.2048,
        "lon": 55.2708,
        "elevation_m": 5.0,
        "timezone": "Asia/Dubai",
        "terrain": "coastal_flat",
        "pop_density_base": 4200,
        "fallback_drainage_mm_h": 8.0,
        "taluks": {
            "centre": "Downtown Dubai",
            "north": "Deira",
            "east": "Nad Al Sheba",
            "south": "Jebel Ali",
            "west": "Jumeirah",
        },
    },
    "Mumbai": {
        "name": "Mumbai",
        "region": "Maharashtra",
        "country": "India",
        "country_code": "IN",
        "lat": 19.0760,
        "lon": 72.8777,
        "elevation_m": 14.0,
        "timezone": "Asia/Kolkata",
        "terrain": "coastal_peninsula",
        "pop_density_base": 21000,
        "fallback_drainage_mm_h": 11.5,
        "taluks": {
            "centre": "Dadar",
            "north": "Andheri",
            "east": "Kurla",
            "south": "Colaba",
            "west": "Bandra",
        },
    },
    "Paris": {
        "name": "Paris",
        "region": "Île-de-France",
        "country": "France",
        "country_code": "FR",
        "lat": 48.8566,
        "lon": 2.3522,
        "elevation_m": 35.0,
        "timezone": "Europe/Paris",
        "terrain": "lowland_river",
        "pop_density_base": 20000,
        "fallback_drainage_mm_h": 17.0,
        "taluks": {
            "centre": "1st Arrondissement",
            "north": "Montmartre",
            "east": "Bastille",
            "south": "Montparnasse",
            "west": "Passy",
        },
    },
    "Singapore": {
        "name": "Singapore",
        "region": "Central Singapore",
        "country": "Singapore",
        "country_code": "SG",
        "lat": 1.3521,
        "lon": 103.8198,
        "elevation_m": 15.0,
        "timezone": "Asia/Singapore",
        "terrain": "coastal_estuary",
        "pop_density_base": 12500,
        "fallback_drainage_mm_h": 24.0,
        "taluks": {
            "centre": "Marina Bay",
            "north": "Woodlands",
            "east": "Tampines",
            "south": "Sentosa",
            "west": "Jurong",
        },
    },
    "Bangkok": {
        "name": "Bangkok",
        "region": "Bangkok",
        "country": "Thailand",
        "country_code": "TH",
        "lat": 13.7563,
        "lon": 100.5018,
        "elevation_m": 2.0,
        "timezone": "Asia/Bangkok",
        "terrain": "lowland_delta",
        "pop_density_base": 14000,
        "fallback_drainage_mm_h": 9.0,
        "taluks": {
            "centre": "Phra Nakhon",
            "north": "Chatuchak",
            "east": "Bang Kapi",
            "south": "Bang Khun Thian",
            "west": "Thon Buri",
        },
    },
    "Sydney": {
        "name": "Sydney",
        "region": "New South Wales",
        "country": "Australia",
        "country_code": "AU",
        "lat": -33.8688,
        "lon": 151.2093,
        "elevation_m": 19.0,
        "timezone": "Australia/Sydney",
        "terrain": "coastal_estuary",
        "pop_density_base": 5200,
        "fallback_drainage_mm_h": 18.0,
        "taluks": {
            "centre": "Sydney CBD",
            "north": "North Sydney",
            "east": "Bondi",
            "south": "Mascot",
            "west": "Parramatta",
        },
    },
    "Rio de Janeiro": {
        "name": "Rio de Janeiro",
        "region": "Rio de Janeiro",
        "country": "Brazil",
        "country_code": "BR",
        "lat": -22.9068,
        "lon": -43.1729,
        "elevation_m": 12.0,
        "timezone": "America/Sao_Paulo",
        "terrain": "coastal_estuary",
        "pop_density_base": 9000,
        "fallback_drainage_mm_h": 12.0,
        "taluks": {
            "centre": "Centro",
            "north": "Tijuca",
            "east": "Copacabana",
            "south": "Ipanema",
            "west": "Barra da Tijuca",
        },
    },
    "Cairo": {
        "name": "Cairo",
        "region": "Cairo",
        "country": "Egypt",
        "country_code": "EG",
        "lat": 30.0444,
        "lon": 31.2357,
        "elevation_m": 23.0,
        "timezone": "Africa/Cairo",
        "terrain": "lowland_river",
        "pop_density_base": 19000,
        "fallback_drainage_mm_h": 10.0,
        "taluks": {
            "centre": "Tahrir",
            "north": "Shubra",
            "east": "Nasr City",
            "south": "Maadi",
            "west": "Giza",
        },
    },
}


@st.cache_data(ttl=86400, show_spinner=False)
def search_locations(query: str, limit: int = 5) -> List[Dict]:
    """
    Search any place name globally using the Open-Meteo Geocoding API.
    Returns a list of structured location candidates.
    """
    query = (query or "").strip()
    if len(query) < 2:
        return []

    try:
        resp = requests.get(
            GEOCODING_API_URL,
            params={"name": query, "count": limit, "language": "en", "format": "json"},
            timeout=6,
        )
        resp.raise_for_status()
        data = resp.json()
        results = data.get("results", [])
        clean_results = []
        for r in results:
            clean_results.append({
                "id": r.get("id"),
                "name": r.get("name", "Unknown"),
                "latitude": float(r.get("latitude", 0.0)),
                "longitude": float(r.get("longitude", 0.0)),
                "elevation": float(r.get("elevation") or 10.0),
                "timezone": r.get("timezone", "UTC"),
                "country": r.get("country", ""),
                "country_code": r.get("country_code", ""),
                "admin1": r.get("admin1", ""),
                "population": int(r.get("population") or 50000),
            })
        return clean_results
    except Exception:
        return []


def create_city_config(place: Dict) -> Dict:
    """
    Convert a geocoded location result into a full FLOWSHIELD city config.
    """
    name = place.get("name", "Custom Location")
    lat = float(place.get("latitude", 0.0))
    lon = float(place.get("longitude", 0.0))
    elev = float(place.get("elevation") or 15.0)
    tz = place.get("timezone") or "UTC"
    pop = int(place.get("population") or 100000)
    region = place.get("admin1") or place.get("country") or ""
    country = place.get("country") or ""

    # Estimate representative baseline population density per km^2
    if pop > 5_000_000:
        pop_density = 14000
    elif pop > 1_000_000:
        pop_density = 9000
    elif pop > 200_000:
        pop_density = 5000
    else:
        pop_density = 2500

    # Determine drainage benchmark based on elevation and terrain
    if elev < 10.0:
        fallback_drain = 11.0  # low gradient coastal/delta
        terrain = "lowland_coastal"
    elif elev > 500.0:
        fallback_drain = 13.5  # upland / steep slopes
        terrain = "undulating"
    else:
        fallback_drain = 15.0
        terrain = "undulating"

    # Directional sector naming for the 12x12 grid
    short_name = name.split()[0]
    taluks = {
        "centre": f"{short_name} Central",
        "north": f"{short_name} North",
        "east": f"{short_name} East",
        "south": f"{short_name} South",
        "west": f"{short_name} West",
    }

    # Special check: If in Karnataka, use the taluk drainage dataset if matched
    if "karnataka" in region.lower() or "bengaluru" in name.lower() or "bangalore" in name.lower():
        fallback_drain = 10.6

    return {
        "name": name,
        "region": region,
        "country": country,
        "country_code": place.get("country_code", ""),
        "lat": lat,
        "lon": lon,
        "elevation_m": elev,
        "timezone": tz,
        "terrain": terrain,
        "pop_density_base": pop_density,
        "fallback_drainage_mm_h": fallback_drain,
        "taluks": taluks,
    }
