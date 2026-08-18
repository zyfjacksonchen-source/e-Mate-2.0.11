"""Compatibility package that exposes the bundled Tongxin data layer.

Python imports a ``models/`` package before a sibling ``models.py`` file. EcoreX
keeps this package as a stable release marker, so delegate it to the full
bundled ``models.py`` implementation instead of shadowing it.
"""

from __future__ import annotations

from pathlib import Path

_MODELS_FILE = Path(__file__).resolve().parent.parent / "models.py"

if _MODELS_FILE.is_file():
    _code = compile(_MODELS_FILE.read_text(encoding="utf-8"), str(_MODELS_FILE), "exec")
    globals()["__file__"] = str(_MODELS_FILE)
    exec(_code, globals())
else:
    try:
        from database import DATABASE, database
    except Exception:
        DATABASE = ""
        database = ""
    Database = DATABASE

__all__ = [name for name in globals() if not name.startswith("_")]
