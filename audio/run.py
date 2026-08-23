"""
ProjectDVC — Root launcher.
Always run the app from here:  python run.py
Never run core/main.py directly — the package imports depend on this
file's directory being the Python working root.
"""
import sys
from pathlib import Path

# Make sure the project root is always first on the path
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.main import main
if __name__ == "__main__":
    main()