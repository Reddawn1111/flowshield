# -*- coding: utf-8 -*-
"""
Location Search Autocomplete Component Wrapper for FLOWSHIELD
Provides a while-typing dynamic dropdown menu attached directly under the search bar.
"""

import os
from typing import Dict, Optional
import streamlit.components.v1 as components
from streamlit.runtime.scriptrunner import get_script_run_ctx
from streamlit.runtime import Runtime

_COMPONENT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "location_search_component")
_component_instance = None


def get_component():
    global _component_instance
    if _component_instance is None:
        _component_instance = components.declare_component(
            "location_autocomplete",
            path=_COMPONENT_PATH
        )
    ctx = get_script_run_ctx()
    if ctx is not None:
        try:
            Runtime.instance().component_registry.register_component(_component_instance)
        except Exception:
            pass
    return _component_instance


def render_location_search(current_city: str = "", key: str = "global_location_search") -> Optional[Dict]:
    """
    Renders an interactive while-typing autocomplete search bar with attached dropdown.
    Returns selected location dict:
      {'name': str, 'latitude': float, 'longitude': float, 'country': str, 'admin1': str, 'elevation': float, 'timezone': str}
    or None if no new selection.
    """
    func = get_component()
    return func(current_city=current_city, key=key)
