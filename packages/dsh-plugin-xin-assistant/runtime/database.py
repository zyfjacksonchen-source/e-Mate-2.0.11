"""Bundled Tongxin CLI data-layer compatibility symbols.

The full Tongxin package can replace this directory at the same path. This
module exists so remote packages that import ``database`` / ``DATABASE`` have
a stable, bundled compatibility surface inside EcoreX releases.
"""

from __future__ import annotations

import os
from pathlib import Path


DATABASE = os.environ.get("ECOREX_TONGXIN_DATABASE") or str(
    Path(os.environ.get("ECOREX_STATE_DIR", Path.home() / ".ecorex")) / "tongxin.sqlite3"
)
database = DATABASE
Database = DATABASE
