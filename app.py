import os
import sys
import runpy

_ROOT = os.path.dirname(os.path.abspath(__file__))
_FLOWSHIELD_DIR = os.path.join(_ROOT, "flowshield")

# Add both repo root and flowshield folder to sys.path
for _path in [_ROOT, _FLOWSHIELD_DIR]:
    if _path not in sys.path:
        sys.path.insert(0, _path)

# Execute the core FlowShield application
_TARGET = os.path.join(_FLOWSHIELD_DIR, "app.py")
runpy.run_path(_TARGET, run_name="__main__")
