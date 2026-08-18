"""Compatibility exports for remote CLI packages.

Some remote bundles load a lightweight data-layer initializer instead of the
full models module. Keep DATABASE available as a stable contract for
xin_agent_cli.py.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any


def _resolve_database() -> str:
    try:
        import config

        configured = str(getattr(config, "DATABASE", "") or "").strip()
        if configured:
            return configured
    except Exception:
        pass
    env_value = str(os.environ.get("XIN_AGENT_DATABASE") or os.environ.get("DATABASE") or "").strip()
    if env_value:
        return env_value
    return str(Path(__file__).resolve().parent / "data" / "xhs_report.db")


DATABASE = _resolve_database()
database = DATABASE
Database = DATABASE

try:
    import models as _models

    if not getattr(_models, "DATABASE", None):
        _models.DATABASE = DATABASE
    if not getattr(_models, "database", None):
        _models.database = DATABASE
    if not getattr(_models, "Database", None):
        _models.Database = DATABASE
    init_db: Any = getattr(_models, "init_db", None)
    get_db: Any = getattr(_models, "get_db", None)
except Exception:
    init_db = None
    get_db = None
