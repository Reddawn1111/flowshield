# -*- coding: utf-8 -*-
"""
Live Location & Predictive Alert Streamlit Component Wrapper
Bridges browser Geolocation API and Desktop Notification API to FLOWSHIELD.
"""

import os
from typing import Dict, Optional
import streamlit.components.v1 as components
from streamlit.runtime.scriptrunner import get_script_run_ctx
from streamlit.runtime import Runtime

_COMPONENT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "live_location_component")
_component_instance = None


def get_live_location_component():
    global _component_instance
    if _component_instance is None:
        _component_instance = components.declare_component(
            "live_location_tracker",
            path=_COMPONENT_PATH,
        )
    ctx = get_script_run_ctx()
    if ctx is not None:
        try:
            Runtime.instance().component_registry.register_component(_component_instance)
        except Exception:
            pass
    return _component_instance


def render_live_location_tracker(
    active_city: str,
    verdict: Optional[Dict] = None,
    should_notify: bool = False,
    key: str = "live_location_tracker",
) -> Optional[Dict]:
    """
    Renders the live geolocation bar and notification listener.
    Returns:
      {
        'latitude': float,
        'longitude': float,
        'accuracy': float,
        'permission': 'granted' | 'denied' | 'prompt' | 'unavailable',
        'scenario': str,
        'notifications_enabled': bool,
      }
    """
    func = get_live_location_component()
    return func(
        active_city=active_city,
        verdict=verdict or {},
        should_notify=should_notify,
        key=key,
    )
