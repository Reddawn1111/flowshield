import os
import sys

# Ensure flowshield directory is on sys.path
_ROOT = os.path.dirname(os.path.abspath(__file__))
_FLOWSHIELD_DIR = os.path.join(_ROOT, "flowshield")
if _FLOWSHIELD_DIR not in sys.path:
    sys.path.insert(0, _FLOWSHIELD_DIR)

from flowshield.app import main

if __name__ == "__main__":
    main()
