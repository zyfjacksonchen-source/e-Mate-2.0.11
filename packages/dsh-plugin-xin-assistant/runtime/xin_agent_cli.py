"""Read-only JSON CLI wrapper stubs for Xin agent integrations."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import threading
import time
import warnings
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Sequence

warnings.filterwarnings("ignore", message=r"SECRET_KEY .*", category=UserWarning, module=r"config")
import models
from xin_assistant.services import ownership as ownership_service


def _models_database_path() -> Path:
    database = str(getattr(models, "DATABASE", "") or "").strip()
    if not database:
        try:
            import models_init_

            database = str(getattr(models_init_, "DATABASE", "") or "").strip()
        except Exception:
            database = ""
    if not database:
        try:
            import config

            database = str(getattr(config, "DATABASE", "") or "").strip()
        except Exception:
            database = ""
    if not database:
        database = str(Path(__file__).resolve().parent / "data" / "xhs_report.db")
    try:
        models.DATABASE = database
    except Exception:
        pass
    return Path(database).resolve()


DATE_FORMAT = "%Y-%m-%d"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?$")
SENSITIVE_NAME_RE = r"(?:access[-_]token|refresh[-_]token|api[-_]key|client[-_]secret|token|secret|password|cookies?)"
MPI_PLATFORMS = ("xhs", "bili", "alipay")
DEFAULT_MPI_PLATFORM = "xhs"
XHS_CHANNELS = ("spotlight", "chengfeng")
DEFAULT_XHS_CHANNEL = "spotlight"
XHS_REALTIME_CHANNELS = ("all", "spotlight", "chengfeng")
DEFAULT_XHS_REALTIME_CHANNEL = "all"
DEFAULT_AUTH_REFRESH_THRESHOLD_SECONDS = 12 * 3600
REFRESH_TOKEN_WARNING_SECONDS = 7 * 24 * 3600
TOKEN_REFRESH_LOCK_STALE_SECONDS = 10 * 60
TOKEN_REFRESH_LOCK_WAIT_SECONDS = 30
SYNC_TABLES = (
    "users",
    "projects",
    "sub_accounts",
    "tasks",
    "task_checklists",
    "task_collaborators",
    "task_relations",
    "task_activity_log",
    "task_note_performance",
    "task_note_performance_daily",
    "daily_consumption",
    "project_knowledge",
    "project_handovers",
    "sub_account_handovers",
)
SYNC_TIMESTAMP_COLUMNS = (
    "updated_at",
    "fetched_at",
    "superseded_at",
    "created_at",
    "resigned_at",
    "archived_at",
    "handover_time",
    "date",
    "report_date",
)
SYNC_EXCLUDED_COLUMNS = {
    "password_hash",
    "access_token",
    "refresh_token",
    "client_secret",
    "secret",
    "token_hash",
    "raw_json",
    "markdown_content",
    "llmwiki_json",
    "wiki_pages_json",
}
SYNC_FINGERPRINT_COLUMNS = {
    "users": ("id", "username", "role", "real_name", "department", "status", "resigned_at", "created_by", "created_at"),
    "projects": ("id", "project_name", "advertiser_name", "sales_name", "operator_id", "group_name", "platform", "media", "operation_mode", "created_at"),
    "sub_accounts": ("id", "project_id", "account_id", "account_name", "account_type", "media", "external_account_id", "created_at"),
    "tasks": ("id", "title", "project_id", "creator_id", "assignee_id", "status", "category", "is_archived", "updated_at", "created_at"),
    "task_checklists": ("id", "task_id", "title", "done", "sort_order", "created_at"),
    "task_collaborators": ("id", "task_id", "user_id", "role", "created_at"),
    "task_relations": ("id", "task_id_a", "task_id_b", "relation_type", "created_at"),
    "project_knowledge": ("id", "project_id", "source_type", "source_name", "status", "updated_at", "created_at"),
    "project_handovers": (
        "id", "project_id", "from_operator_id", "to_operator_id", "handover_time",
        "to_target_type", "start_date", "end_date", "superseded_by", "superseded_at", "created_at",
    ),
    "sub_account_handovers": (
        "id", "sub_account_id", "project_id", "from_project_id", "from_operator_id", "to_operator_id",
        "handover_time", "to_target_type", "start_date", "end_date", "superseded_by", "superseded_at", "created_at",
    ),
}
XHS_CHANNEL_LABELS = {"spotlight": "聚光", "chengfeng": "乘风"}
XHS_REALTIME_CHANNEL_LABELS = {**XHS_CHANNEL_LABELS, "all": "三端口合计"}
ROLE_CHOICES = ("admin", "super_admin", "supervisor", "operator", "content_operator", "report_admin")
ADMIN_ROLES = {"admin", "super_admin"}
FULL_ACCOUNT_PULL_ROLES = {"admin", "super_admin", "supervisor"}
ALL_MEDIA_SCOPE = ("xhs", "bili", "alipay")


def _runtime_config_value(name: str, default: str = "") -> str:
    env_value = os.environ.get(name)
    if env_value not in (None, ""):
        return str(env_value)
    try:
        import config

        value = getattr(config, name, "")
    except Exception:
        value = ""
    return str(value if value not in (None, "") else default)


def _parse_bool(value: Any, default: bool = False) -> bool:
    if value in (None, ""):
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def _parse_media_scope(value: Any) -> tuple[str, ...]:
    seen: set[str] = set()
    scope: list[str] = []
    for item in re.split(r"[\s,，;；]+", str(value or "")):
        text = item.strip().lower()
        if not text:
            continue
        if text in {"xiaohongshu", "xhs", "小红书", "聚光", "乘风"}:
            media = "xhs"
        elif text in {"bili", "bilibili", "哔哩", "b站"}:
            media = "bili"
        elif text in {"alipay", "支付宝"}:
            media = "alipay"
        else:
            continue
        if media not in seen:
            scope.append(media)
            seen.add(media)
    return tuple(scope)


def _infer_media_scope(role: str, department: str = "") -> tuple[str, ...]:
    if role in ADMIN_ROLES:
        return ALL_MEDIA_SCOPE
    text = str(department or "").lower()
    if role == "supervisor":
        inferred: list[str] = []
        if any(marker in text for marker in ("bili", "哔", "b站")):
            inferred.append("bili")
        if any(marker in text for marker in ("alipay", "支付宝")):
            inferred.append("alipay")
        if any(marker in text for marker in ("xhs", "小红书", "聚光", "乘风", "投放", "运营")) or not inferred:
            inferred.insert(0, "xhs")
        return tuple(dict.fromkeys(inferred))
    return ALL_MEDIA_SCOPE


def default_cli_role() -> str:
    role = _runtime_config_value("XIN_AGENT_AUTH_ROLE", "admin").strip()
    return role if role in ROLE_CHOICES else "admin"


def auth_context(args: argparse.Namespace | None = None) -> dict[str, Any]:
    role = str(getattr(args, "role", "") or default_cli_role()).strip()
    if role not in ROLE_CHOICES:
        role = "admin"
    department = _runtime_config_value("XIN_AGENT_AUTH_DEPARTMENT", "").strip()
    user_id = _runtime_config_value("XIN_AGENT_AUTH_USER_ID", "").strip()
    username = _runtime_config_value("XIN_AGENT_AUTH_USERNAME", "").strip()
    real_name = _runtime_config_value("XIN_AGENT_AUTH_REAL_NAME", "").strip()
    configured_scope = _parse_media_scope(_runtime_config_value("XIN_AGENT_AUTH_MEDIA_SCOPE", ""))
    media_scope = configured_scope or _infer_media_scope(role, department)
    configured_full = _runtime_config_value("XIN_AGENT_FULL_ACCOUNT_PULL_ALLOWED", "")
    full_allowed = role in FULL_ACCOUNT_PULL_ROLES
    if configured_full != "":
        full_allowed = full_allowed and _parse_bool(configured_full)
    return {
        "role": role,
        "user_id": user_id,
        "username": username,
        "real_name": real_name,
        "department": department,
        "media_scope": media_scope,
        "full_account_pull_allowed": full_allowed,
    }


def add_role_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--role", choices=ROLE_CHOICES, default=default_cli_role())


class CliError(Exception):
    """CLI error that should be rendered as a JSON envelope."""

    def __init__(
        self,
        code: str,
        message: str,
        exit_code: int = 2,
        meta: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code
        self.meta = meta


class JsonArgumentParser(argparse.ArgumentParser):
    """ArgumentParser variant that raises CliError instead of writing usage."""

    def error(self, message: str) -> None:
        raise CliError("invalid_argument", message, 2)

    def exit(self, status: int = 0, message: str | None = None) -> None:
        if status:
            raise CliError("invalid_argument", message or "invalid argument", 2)
        raise SystemExit(status)

    def print_help(self, file: Any | None = None) -> None:
        raise CliError("invalid_argument", "help output is not available; use schema", 2)


def safe_message(message: object) -> str:
    """Return a message safe for JSON error output."""
    text = str(message)
    patterns = [
        (r"(?i)(Authorization\s*:\s*)([^\s;]+(?:\s+[^\s;]+)?)", r"\1[redacted]"),
        (r"(?i)(Access-Token\s*:\s*)(\S+)", r"\1[redacted]"),
        (r"(?i)(access-token\s*:\s*)(\S+)", r"\1[redacted]"),
        (r"(?i)(Cookies?\s*:\s*)([^\s;]+(?:;\s*[^\s;]+)*)", r"\1[redacted]"),
        (rf"(?i)\b({SENSITIVE_NAME_RE}\s*:\s*)([^\s,;]+)", r"\1[redacted]"),
        (rf"(?i)--{SENSITIVE_NAME_RE}\s+\S+", "--[redacted] [redacted]"),
        (rf"(?i)\b({SENSITIVE_NAME_RE}=)([^\s&;]+)", r"\1[redacted]"),
        (r"(?i)([\"']authorization[\"']\s*:\s*[\"'])([^\"']+)([\"'])", r"\1[redacted]\3"),
        (rf"(?i)([\"']{SENSITIVE_NAME_RE}[\"']\s*:\s*[\"'])([^\"']+)([\"'])", r"\1[redacted]\3"),
    ]
    for pattern, replacement in patterns:
        text = re.sub(pattern, replacement, text)
    return text


def success_envelope(data: Any, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "ok": True,
        "data": data,
        "meta": meta or {},
        "error": None,
    }


def sanitize_meta(value: Any) -> Any:
    if isinstance(value, str):
        return safe_message(value)
    if isinstance(value, dict):
        return {key: sanitize_meta(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_meta(item) for item in value]
    return value


def error_envelope(error: CliError, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "ok": False,
        "data": None,
        "meta": sanitize_meta(meta or {}),
        "error": {
            "code": error.code,
            "message": safe_message(error.message),
        },
    }


def print_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def render_table(rows: Sequence[dict[str, Any]]) -> str:
    if not rows:
        return ""
    headers = list(rows[0].keys())
    widths = {
        header: max(len(str(header)), *(len(str(row.get(header, ""))) for row in rows))
        for header in headers
    }
    lines = ["\t".join(header.ljust(widths[header]) for header in headers)]
    for row in rows:
        lines.append("\t".join(str(row.get(header, "")).ljust(widths[header]) for header in headers))
    return "\n".join(lines)


def schema_data() -> dict[str, Any]:
    return {
        "name": "xin-agent-cli",
        "default_format": "json",
        "read_only": True,
        "mcp": "not_used",
        "integration": "enterprise_agent_direct_cli",
        "mpi": {
            "enabled": True,
            "mode": "read_only_auto_refresh",
            "default_source": "mpi_for_metrics_cache_for_resolution",
            "source_of_truth": "mpi",
            "cache_role": "resolution_and_snapshot_only",
            "writes": False,
            "token_refresh": True,
            "token_refresh_scope": "xhs_oauth_only",
            "platforms": list(MPI_PLATFORMS),
            "default_platform": DEFAULT_MPI_PLATFORM,
            "xhs_channels": list(XHS_CHANNELS),
            "default_xhs_channel": DEFAULT_XHS_CHANNEL,
            "realtime_xhs_channels": list(XHS_REALTIME_CHANNELS),
            "realtime_default_xhs_channel": DEFAULT_XHS_REALTIME_CHANNEL,
            "realtime_default_scope": "local_juguang+medical_juguang+chengfeng",
            "allowed_commands": [
                "auth status --platform xhs",
                "auth refresh --platform xhs --all --threshold-seconds --force",
                "account list --source mpi --platform xhs --xhs-channel spotlight --full --account-id --search",
                "account list --source mpi --platform xhs --xhs-channel chengfeng --full --account-id --search",
                "account list --source mpi --platform bili --full",
                "account list --source mpi --platform alipay --full",
                "project list --source mpi --platform xhs --xhs-channel spotlight --account-id --search",
                "project list --source mpi --platform xhs --xhs-channel chengfeng --account-id --search",
                "report summary --source mpi --platform xhs --xhs-channel spotlight --account-id --account-ids --start-date --end-date --concurrency",
                "report summary --source mpi --platform xhs --xhs-channel chengfeng --account-id --account-ids --start-date --end-date --concurrency",
                "note detail --source mpi --platform xhs --xhs-channel spotlight --account-id --start-date --end-date",
                "note detail --source mpi --platform xhs --xhs-channel chengfeng --account-id --start-date --end-date",
                "report summary --source mpi --platform bili --account-id --start-date --end-date",
                "report summary --source mpi --platform alipay --account-id --start-date --end-date",
                "realtime summary --xhs-channel all --project-id --account-id --search",
                "realtime summary --xhs-channel spotlight --project-id --account-id --search",
                "realtime summary --xhs-channel chengfeng --project-id --account-id --search",
            ],
            "requires_existing_valid_token": False,
            "requires_refresh_credential": True,
        },
        "commands": [
            {"name": "schema", "description": "Describe the CLI JSON schema."},
            {"name": "auth status", "description": "Inspect dedicated CLI auth token health without exposing credentials."},
            {"name": "auth refresh", "description": "Refresh dedicated CLI XHS tokens before expiry."},
            {"name": "report summary", "description": "Read cached project/date report aggregates."},
            {"name": "note detail", "description": "Read cached note performance details."},
            {"name": "account list", "description": "List cached accounts and sub-accounts."},
            {"name": "project list", "description": "List cached projects."},
            {"name": "project detail", "description": "Read a full cached project OA snapshot."},
            {"name": "task list", "description": "List cached OA tasks with super-admin visibility."},
            {"name": "task detail", "description": "Read a full cached OA task snapshot."},
            {"name": "user list", "description": "List cached OA users without credential fields."},
            {"name": "snapshot", "description": "Read one bundled cache snapshot for enterprise agent context."},
            {"name": "realtime summary", "description": "Resolve cached XHS accounts and read MPI realtime summary."},
            {"name": "sync state", "description": "Return cache watermarks and fingerprints for agent sync."},
            {"name": "sync changes", "description": "Return recent cache changes since a timestamp."},
        ],
    "oa": {
            "enabled": True,
            "read_only": True,
            "scope": "super_admin_cache",
            "agent_auth": "delegated",
            "commands": [
                "project list --source cache --search --account-id",
                "project detail --project-id --start-date --end-date",
                "account list --source cache --search --project-id --account-id",
                "task list --project-id --status --category --include-archived",
                "task detail --task-id",
                "realtime summary --search --project-id --account-id",
                "user list --include-resigned",
                "sync state",
                "sync changes --since",
                "sync changes --since --tables",
                "snapshot --project-id --start-date --end-date",
                "note detail --project-id --task-id --start-date --end-date",
                "report summary --project-id --task-id --start-date --end-date",
            ],
        },
    }


def valid_date(value: str) -> str:
    if not DATE_RE.fullmatch(value):
        raise argparse.ArgumentTypeError("date must use YYYY-MM-DD format")
    try:
        datetime.strptime(value, DATE_FORMAT)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("date must use YYYY-MM-DD format") from exc
    return value


def valid_timestamp(value: str) -> str:
    text = value.strip()
    if not TIMESTAMP_RE.fullmatch(text):
        raise argparse.ArgumentTypeError("timestamp must use YYYY-MM-DD or YYYY-MM-DD HH:MM:SS format")
    if DATE_RE.fullmatch(text):
        return f"{text} 00:00:00"
    normalized = text.replace("T", " ")
    try:
        datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S")
    except ValueError as exc:
        raise argparse.ArgumentTypeError("timestamp must use YYYY-MM-DD or YYYY-MM-DD HH:MM:SS format") from exc
    return normalized


def parse_limit(value: str) -> int:
    try:
        limit = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("limit must be an integer") from exc
    if limit < 1 or limit > 500:
        raise argparse.ArgumentTypeError("limit must be between 1 and 500")
    return limit


def parse_offset(value: str) -> int:
    try:
        offset = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("offset must be an integer") from exc
    if offset < 0:
        raise argparse.ArgumentTypeError("offset must be >= 0")
    return offset


def parse_nonnegative_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("value must be an integer") from exc
    if parsed < 0:
        raise argparse.ArgumentTypeError("value must be >= 0")
    return parsed


def parse_optional_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("value must be an integer") from exc
    if parsed < 1:
        raise argparse.ArgumentTypeError("value must be >= 1")
    return parsed


def parse_sync_tables(value: str) -> tuple[str, ...]:
    requested = []
    seen = set()
    for part in str(value or "").split(","):
        table = part.strip()
        if not table or table in seen:
            continue
        requested.append(table)
        seen.add(table)
    if not requested:
        raise argparse.ArgumentTypeError("tables must be a comma-separated list")
    invalid = [table for table in requested if table not in SYNC_TABLES]
    if invalid:
        valid = ", ".join(SYNC_TABLES)
        raise argparse.ArgumentTypeError(
            f"unsupported table(s): {', '.join(invalid)}; valid tables: {valid}"
        )
    return tuple(requested)


def validate_date_range(start_date: str, end_date: str) -> None:
    if start_date > end_date:
        raise CliError("invalid_argument", "start-date must be <= end-date", 2)


def iter_date_strings(start_date: str, end_date: str) -> list[str]:
    start = datetime.strptime(start_date, DATE_FORMAT).date()
    end = datetime.strptime(end_date, DATE_FORMAT).date()
    days: list[str] = []
    current = start
    while current <= end:
        days.append(current.isoformat())
        current += timedelta(days=1)
    return days


def parse_account_id(value: str | None) -> int:
    text = str(value or "").strip()
    if not text.isdigit():
        raise CliError("invalid_argument", "account-id must be a numeric advertiser ID", 2)
    return int(text)


def parse_account_id_list(*values: str | None) -> list[str]:
    account_ids: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not value:
            continue
        for part in re.split(r"[\s,，;；]+", str(value)):
            account_id = part.strip()
            if not account_id:
                continue
            if not account_id.isdigit():
                raise CliError("invalid_argument", "account ids must be numeric advertiser IDs", 2)
            if account_id not in seen:
                account_ids.append(account_id)
                seen.add(account_id)
    return account_ids


def report_batch_concurrency(args: argparse.Namespace, account_count: int) -> int:
    if account_count <= 0:
        return 1
    configured = getattr(args, "concurrency", None)
    if configured is None:
        try:
            configured = int(_runtime_config_value("MPI_REPORT_WORKERS", "6") or 6)
        except ValueError:
            configured = 6
    return max(1, min(int(configured or 1), account_count, 12))


def is_xhs_cached_account(account: dict[str, Any]) -> bool:
    combined = " ".join(str(account.get(key) or "") for key in ("media", "platform")).lower()
    non_xhs_markers = ("bili", "哔哩", "b站", "支付宝", "alipay")
    return not any(marker in combined for marker in non_xhs_markers)


def _now_iso_with_timezone() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def not_implemented_stub(_args: argparse.Namespace) -> dict[str, Any]:
    raise CliError("invalid_argument", "Command is not implemented in Task 1", 2)


class MpiReadOnlyAdapter:
    _write_guard_lock = threading.RLock()
    _write_guard_depth = 0
    _token_refresh_write_depth = 0
    _token_refresh_lock_depths: dict[str, int] = {}
    _write_guard_original_save_token: Any | None = None
    _write_guard_original_save_advertisers: Any | None = None

    class _WriteGuard:
        def __enter__(self) -> None:
            cls = MpiReadOnlyAdapter
            with cls._write_guard_lock:
                if cls._write_guard_depth == 0:
                    cls._write_guard_original_save_token = models.save_token
                    cls._write_guard_original_save_advertisers = models.save_advertisers

                    def guarded_save_token(*args: Any, **kwargs: Any) -> Any:
                        if cls._token_refresh_write_depth > 0 and cls._write_guard_original_save_token is not None:
                            return cls._write_guard_original_save_token(*args, **kwargs)
                        raise CliError("permission_denied", "MPI read-only mode cannot write tokens outside OAuth refresh", 1)

                    def guarded_save_advertisers(*_args: Any, **_kwargs: Any) -> None:
                        if cls._token_refresh_write_depth > 0:
                            return None
                        raise CliError("permission_denied", "MPI read-only mode cannot write advertiser caches", 1)

                    models.save_token = guarded_save_token
                    models.save_advertisers = guarded_save_advertisers
                cls._write_guard_depth += 1

        def __exit__(self, _exc_type: Any, _exc: Any, _traceback: Any) -> None:
            cls = MpiReadOnlyAdapter
            with cls._write_guard_lock:
                if cls._write_guard_depth <= 0:
                    return
                cls._write_guard_depth -= 1
                if cls._write_guard_depth == 0:
                    if cls._write_guard_original_save_token is not None:
                        models.save_token = cls._write_guard_original_save_token
                    if cls._write_guard_original_save_advertisers is not None:
                        models.save_advertisers = cls._write_guard_original_save_advertisers
                    cls._write_guard_original_save_token = None
                    cls._write_guard_original_save_advertisers = None

    class _AllowTokenRefreshWrite:
        def __enter__(self) -> None:
            cls = MpiReadOnlyAdapter
            with cls._write_guard_lock:
                cls._token_refresh_write_depth += 1

        def __exit__(self, _exc_type: Any, _exc: Any, _traceback: Any) -> None:
            cls = MpiReadOnlyAdapter
            with cls._write_guard_lock:
                if cls._token_refresh_write_depth > 0:
                    cls._token_refresh_write_depth -= 1

    class _TokenRefreshFileLock:
        def __init__(self, app_id: str) -> None:
            digest = hashlib.sha256(str(app_id or "default").encode("utf-8")).hexdigest()[:16]
            lock_dir = _models_database_path().parent / ".locks"
            self.lock_path = lock_dir / f"xin-agent-xhs-token-{digest}.lock"
            self.fd: int | None = None
            self.lock_key = str(self.lock_path)
            self.reentered = False

        def __enter__(self) -> None:
            cls = MpiReadOnlyAdapter
            with cls._write_guard_lock:
                depth = cls._token_refresh_lock_depths.get(self.lock_key, 0)
                if depth > 0:
                    cls._token_refresh_lock_depths[self.lock_key] = depth + 1
                    self.reentered = True
                    return
            self.lock_path.parent.mkdir(parents=True, exist_ok=True)
            deadline = time.time() + TOKEN_REFRESH_LOCK_WAIT_SECONDS
            while True:
                try:
                    self.fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                    os.write(self.fd, f"{os.getpid()} {time.time()}".encode("utf-8"))
                    with cls._write_guard_lock:
                        cls._token_refresh_lock_depths[self.lock_key] = 1
                    return
                except FileExistsError:
                    try:
                        age = time.time() - self.lock_path.stat().st_mtime
                        if age > TOKEN_REFRESH_LOCK_STALE_SECONDS:
                            self.lock_path.unlink(missing_ok=True)
                            continue
                    except FileNotFoundError:
                        continue
                    if time.time() >= deadline:
                        raise CliError("mpi_unavailable", "token refresh is already running for this app_id", 1)
                    time.sleep(0.5)

        def __exit__(self, _exc_type: Any, _exc: Any, _traceback: Any) -> None:
            cls = MpiReadOnlyAdapter
            with cls._write_guard_lock:
                depth = cls._token_refresh_lock_depths.get(self.lock_key, 0)
                if depth > 1:
                    cls._token_refresh_lock_depths[self.lock_key] = depth - 1
                    return
                cls._token_refresh_lock_depths.pop(self.lock_key, None)
            if self.reentered:
                return
            if self.fd is not None:
                try:
                    os.close(self.fd)
                finally:
                    self.fd = None
            try:
                self.lock_path.unlink(missing_ok=True)
            except OSError:
                pass

    @staticmethod
    def _classify_xhs_port(app_id: str, redirect_uri: str = "", slot: int | None = None) -> tuple[str, str]:
        text = str(redirect_uri or "").lower()
        app_id_text = str(app_id or "").lower()
        if "chengfeng" in text:
            return "chengfeng", "乘风小红书"
        if "medical" in text:
            return "medical_juguang", "医美小红书"
        if "local" in text:
            return "local_juguang", "本土小红书"
        if "chengfeng" in app_id_text or "wind" in app_id_text:
            return "chengfeng", "乘风小红书"
        if "medical" in app_id_text:
            return "medical_juguang", "医美小红书"
        known_app_port_map = {
            "9700": ("local_juguang", "本土小红书"),
            "9704": ("medical_juguang", "医美小红书"),
            "9703": ("chengfeng", "乘风小红书"),
        }
        if str(app_id or "") in known_app_port_map:
            return known_app_port_map[str(app_id or "")]
        if slot == 3:
            return "chengfeng", "乘风小红书"
        return "local_juguang", "本土小红书"

    def _xhs_client_configs(self) -> list[dict[str, Any]]:
        import config

        env_configs = [
            (1, os.environ.get("XIN_AGENT_MPI_APP_ID"), os.environ.get("XIN_AGENT_MPI_SECRET"), os.environ.get("XIN_AGENT_MPI_USER_ID"), os.environ.get("XIN_AGENT_MPI_REDIRECT_URI"), os.environ.get("XIN_AGENT_MPI_ACCESS_TOKEN")),
            (2, os.environ.get("XIN_AGENT_MPI_APP_ID_2"), os.environ.get("XIN_AGENT_MPI_SECRET_2"), os.environ.get("XIN_AGENT_MPI_USER_ID_2"), os.environ.get("XIN_AGENT_MPI_REDIRECT_URI_2"), os.environ.get("XIN_AGENT_MPI_ACCESS_TOKEN_2")),
            (3, os.environ.get("XIN_AGENT_MPI_APP_ID_3"), os.environ.get("XIN_AGENT_MPI_SECRET_3"), os.environ.get("XIN_AGENT_MPI_USER_ID_3"), os.environ.get("XIN_AGENT_MPI_REDIRECT_URI_3"), os.environ.get("XIN_AGENT_MPI_ACCESS_TOKEN_3")),
        ]
        has_agent_config = any(app_id or secret or user_id or redirect_uri or access_token for _, app_id, secret, user_id, redirect_uri, access_token in env_configs)
        if has_agent_config:
            raw_configs = env_configs
        else:
            raw_configs = [
                (1, config.XHS_APP_ID, config.XHS_SECRET, config.XHS_USER_ID, getattr(config, "XHS_REDIRECT_URI", ""), getattr(config, "XIN_AGENT_MPI_ACCESS_TOKEN", "")),
                (2, config.XHS_APP_ID_2, config.XHS_SECRET_2, config.XHS_USER_ID_2, "", getattr(config, "XIN_AGENT_MPI_ACCESS_TOKEN_2", "")),
                (3, config.XHS_APP_ID_3, config.XHS_SECRET_3, config.XHS_USER_ID_3, "", getattr(config, "XIN_AGENT_MPI_ACCESS_TOKEN_3", "")),
            ]
        configs: list[dict[str, Any]] = []
        for slot, app_id, secret, user_id, redirect_uri, access_token in raw_configs:
            app_id_text = str(app_id or "").strip()
            secret_text = str(secret or "").strip()
            access_token_text = str(access_token or "").strip()
            port, port_label = self._classify_xhs_port(app_id_text, str(redirect_uri or ""), slot)
            configs.append({
                "slot": slot,
                "app_id": app_id_text,
                "secret_configured": bool(secret_text),
                "secret": secret_text,
                "access_token_configured": bool(access_token_text),
                "user_id_configured": bool(str(user_id or "").strip()),
                "user_id": str(user_id or "").strip(),
                "redirect_uri_configured": bool(str(redirect_uri or "").strip()),
                "redirect_uri": str(redirect_uri or "").strip(),
                "port": port,
                "port_label": port_label,
                "configured": bool(app_id_text and (secret_text or access_token_text)),
            })
        return configs

    def _load_clients(self) -> list[Any]:
        import mpi

        agent_clients = []
        configs = self._xhs_client_configs()
        for cfg in configs:
            if cfg["configured"]:
                client = mpi.XhsApiClient(app_id=cfg["app_id"], secret=cfg["secret"], user_id=cfg["user_id"] or "")
                if not cfg["user_id"]:
                    client.user_id = ""
                client._xin_agent_port = cfg["port"]
                client._xin_agent_port_label = cfg["port_label"]
                client._xin_agent_port_slot = cfg["slot"]
                agent_clients.append(client)
        if agent_clients:
            return agent_clients
        clients = []
        if not any(cfg["configured"] for cfg in configs):
            client = mpi.XhsApiClient()
            client._xin_agent_port = "local_juguang"
            client._xin_agent_port_label = "本土小红书"
            client._xin_agent_port_slot = 1
            clients.append(client)
        return clients

    def _table_columns(self, conn: sqlite3.Connection, table: str) -> set[str]:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}

    def _read_only_env_token(self, app_id: str) -> dict[str, Any] | None:
        import config

        def runtime_value(name: str) -> str:
            return str(os.environ.get(name) or getattr(config, name, "") or "").strip()

        suffixes = ("", "_2", "_3")
        app_id_text = str(app_id or "").strip()
        for suffix in suffixes:
            env_app_id = runtime_value(f"XIN_AGENT_MPI_APP_ID{suffix}")
            env_token = runtime_value(f"XIN_AGENT_MPI_ACCESS_TOKEN{suffix}")
            if not env_token:
                continue
            if app_id_text and env_app_id and env_app_id != app_id_text:
                continue
            expires_at = runtime_value(f"XIN_AGENT_MPI_ACCESS_EXPIRES_AT{suffix}")
            if not expires_at:
                expires_at = runtime_value(f"XIN_AGENT_MPI_TOKEN_EXPIRES_AT{suffix}")
            return {
                "access_token": env_token,
                "refresh_token": "",
                "expires_at": expires_at,
                "refresh_expires_at": "",
                "app_id": env_app_id or app_id_text,
                "updated_at": None,
            }
        return None

    def _read_only_token(self, app_id: str, allow_legacy_empty: bool = True) -> dict[str, Any] | None:
        env_token = self._read_only_env_token(app_id)
        if env_token:
            return env_token
        database = _models_database_path()
        if not database.exists():
            return None
        conn = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            columns = self._table_columns(conn, "oauth_tokens")
            if not {"access_token", "expires_at"}.issubset(columns):
                return None
            if "app_id" in columns:
                row = conn.execute(
                    "SELECT * FROM oauth_tokens WHERE app_id=? ORDER BY id DESC LIMIT 1",
                    (app_id,),
                ).fetchone()
                if row is None and allow_legacy_empty:
                    row = conn.execute(
                        "SELECT * FROM oauth_tokens WHERE app_id=? ORDER BY id DESC LIMIT 1",
                        ("",),
                    ).fetchone()
            elif allow_legacy_empty:
                row = conn.execute("SELECT * FROM oauth_tokens ORDER BY id DESC LIMIT 1").fetchone()
            else:
                row = None
            return dict(row) if row else None
        finally:
            conn.close()

    @staticmethod
    def _seconds_until(value: Any) -> int | None:
        if not value:
            return None
        try:
            return int((datetime.fromisoformat(str(value)) - datetime.now()).total_seconds())
        except (TypeError, ValueError):
            return None

    def _xhs_auth_status_row(self, cfg: dict[str, Any], threshold_seconds: int = DEFAULT_AUTH_REFRESH_THRESHOLD_SECONDS) -> dict[str, Any]:
        app_id = str(cfg.get("app_id") or "")
        token_info = self._read_only_token(app_id, allow_legacy_empty=False) if app_id else None
        access_remaining = self._seconds_until((token_info or {}).get("expires_at"))
        refresh_remaining = self._seconds_until((token_info or {}).get("refresh_expires_at"))
        has_refresh_token = bool((token_info or {}).get("refresh_token"))
        if not cfg.get("configured"):
            access_status = "not_configured"
        elif not token_info or not token_info.get("access_token"):
            access_status = "missing"
        elif access_remaining is None:
            access_status = "invalid_expiry"
        elif access_remaining <= 0:
            access_status = "expired"
        elif access_remaining <= threshold_seconds:
            access_status = "refresh_soon"
        else:
            access_status = "valid"

        if not cfg.get("configured"):
            refresh_status = "not_configured"
        elif not has_refresh_token:
            refresh_status = "missing"
        elif refresh_remaining is None:
            refresh_status = "unknown"
        elif refresh_remaining <= 0:
            refresh_status = "expired"
        elif refresh_remaining <= REFRESH_TOKEN_WARNING_SECONDS:
            refresh_status = "refresh_auth_soon"
        else:
            refresh_status = "valid"

        return {
            "slot": cfg.get("slot"),
            "app_id": app_id,
            "port": cfg.get("port"),
            "port_label": cfg.get("port_label"),
            "configured": bool(cfg.get("configured")),
            "secret_configured": bool(cfg.get("secret_configured")),
            "user_id_configured": bool(cfg.get("user_id_configured")),
            "redirect_uri_configured": bool(cfg.get("redirect_uri_configured")),
            "has_access_token": bool((token_info or {}).get("access_token")),
            "access_expires_at": (token_info or {}).get("expires_at"),
            "access_remaining_seconds": access_remaining,
            "access_status": access_status,
            "has_refresh_token": has_refresh_token,
            "refresh_expires_at": (token_info or {}).get("refresh_expires_at") or None,
            "refresh_remaining_seconds": refresh_remaining,
            "refresh_status": refresh_status,
            "updated_at": (token_info or {}).get("updated_at"),
        }

    def auth_status_xhs(self, threshold_seconds: int = DEFAULT_AUTH_REFRESH_THRESHOLD_SECONDS) -> list[dict[str, Any]]:
        return [self._xhs_auth_status_row(cfg, threshold_seconds) for cfg in self._xhs_client_configs()]

    def auth_refresh_xhs(
        self,
        all_ports: bool = False,
        app_id: str | None = None,
        threshold_seconds: int = DEFAULT_AUTH_REFRESH_THRESHOLD_SECONDS,
        force: bool = False,
    ) -> list[dict[str, Any]]:
        import mpi

        configs = self._xhs_client_configs()
        if app_id:
            configs = [cfg for cfg in configs if str(cfg.get("app_id") or "") == str(app_id)]
            if not configs:
                raise CliError("invalid_argument", "app-id is not configured for XHS auth refresh", 2)
        elif not all_ports:
            raise CliError("invalid_argument", "auth refresh requires --all or --app-id", 2)

        rows: list[dict[str, Any]] = []
        for cfg in configs:
            before = self._xhs_auth_status_row(cfg, threshold_seconds)
            row = dict(before)
            row["refresh_action"] = "skipped"
            row["refresh_message"] = ""
            if not cfg.get("configured"):
                row["refresh_message"] = "app_id/app credential not configured"
                rows.append(row)
                continue
            if not row.get("has_refresh_token"):
                row["refresh_message"] = "missing refresh_token; reauthorization required"
                rows.append(row)
                continue
            should_refresh = force or row["access_status"] in {"missing", "invalid_expiry", "expired", "refresh_soon"}
            if not should_refresh:
                row["refresh_message"] = "access token still valid beyond threshold"
                rows.append(row)
                continue
            client = mpi.XhsApiClient(app_id=cfg["app_id"], secret=cfg["secret"], user_id=cfg["user_id"] or "")
            if not cfg["user_id"]:
                client.user_id = ""
            self._prepare_read_only_client(client)
            try:
                client.refresh_access_token()
                after = self._xhs_auth_status_row(cfg, threshold_seconds)
                row.update({
                    "refresh_action": "refreshed",
                    "refresh_message": "ok",
                    "access_expires_at": after.get("access_expires_at"),
                    "access_remaining_seconds": after.get("access_remaining_seconds"),
                    "access_status": after.get("access_status"),
                    "refresh_expires_at": after.get("refresh_expires_at"),
                    "refresh_remaining_seconds": after.get("refresh_remaining_seconds"),
                    "refresh_status": after.get("refresh_status"),
                    "updated_at": after.get("updated_at"),
                })
            except CliError as exc:
                row["refresh_action"] = "failed"
                row["refresh_message"] = safe_message(exc.message)
            except Exception as exc:
                row["refresh_action"] = "failed"
                row["refresh_message"] = safe_message(exc)
            rows.append(row)
        return rows

    def _read_only_clients(self) -> list[Any]:
        clients = self._load_clients()
        for client in clients:
            self._prepare_read_only_client(client)
            client.ensure_token()
        return clients

    def _client_port(self, client: Any) -> str:
        port = str(getattr(client, "_xin_agent_port", "") or "").strip()
        if port:
            return port
        app_id = str(getattr(client, "app_id", "") or "")
        return self._classify_xhs_port(app_id)[0]

    def _read_only_clients_for_ports(self, ports: Sequence[str]) -> list[Any]:
        allowed = {str(port) for port in ports}
        return [client for client in self._read_only_clients() if self._client_port(client) in allowed]

    def _xhs_listing_clients(self) -> list[Any]:
        clients = self._read_only_clients()
        local_clients = [client for client in clients if self._client_port(client) == "local_juguang"]
        if local_clients:
            return local_clients
        non_chengfeng_clients = [client for client in clients if self._client_port(client) != "chengfeng"]
        return non_chengfeng_clients or clients

    def _validate_read_only_token(self, token_info: dict[str, Any] | None) -> dict[str, Any]:
        if not token_info or not isinstance(token_info.get("access_token"), str) or not token_info.get("access_token"):
            raise CliError("permission_denied", "MPI read-only mode requires an existing valid token", 1)
        expires_at = token_info.get("expires_at")
        if not isinstance(expires_at, str) or not expires_at:
            raise CliError("permission_denied", "MPI read-only mode requires a valid token expiry", 1)
        try:
            if datetime.fromisoformat(expires_at) <= datetime.now():
                raise CliError("permission_denied", "MPI read-only mode requires a refreshed valid token", 1)
        except TypeError as exc:
            raise CliError("permission_denied", "MPI read-only mode requires a valid token expiry", 1) from exc
        except ValueError as exc:
            raise CliError("permission_denied", "MPI read-only mode requires a valid token expiry", 1) from exc
        return token_info

    def _token_is_current(self, token_info: dict[str, Any] | None) -> bool:
        if not token_info or not token_info.get("access_token"):
            return False
        expires_at = token_info.get("expires_at")
        if not isinstance(expires_at, str) or not expires_at:
            return False
        try:
            return datetime.fromisoformat(expires_at) > datetime.now()
        except (TypeError, ValueError):
            return False

    def _refresh_xhs_client_token(self, client: Any, refresh_callable: Any) -> dict[str, Any]:
        try:
            app_id = str(getattr(client, "app_id", "") or "")
            with self._TokenRefreshFileLock(app_id):
                with self._WriteGuard():
                    with self._AllowTokenRefreshWrite():
                        refresh_callable()
        except CliError:
            raise
        except Exception as exc:
            raise CliError("mpi_unavailable", safe_message(exc), 1) from exc
        token_info = self._read_only_token(str(getattr(client, "app_id", "") or ""))
        return self._validate_read_only_token(token_info)

    def _ensure_xhs_token(self, client: Any, token_info: dict[str, Any] | None) -> dict[str, Any]:
        if self._token_is_current(token_info):
            return self._validate_read_only_token(token_info)
        if not token_info:
            raise CliError("permission_denied", "MPI read-only mode requires an existing token or refresh token", 1)
        if not token_info.get("refresh_token"):
            raise CliError("permission_denied", "MPI read-only mode requires an existing refresh token", 1)
        refresh_access_token = getattr(client, "refresh_access_token", None)
        if not callable(refresh_access_token):
            raise CliError("permission_denied", "MPI read-only mode cannot refresh token with this client", 1)
        return self._refresh_xhs_client_token(client, refresh_access_token)

    def _prepare_read_only_client(self, client: Any) -> None:
        cached_token: dict[str, Any] | None = None
        native_refresh_access_token = getattr(client, "refresh_access_token", None)
        native_do_refresh_access_token = getattr(client, "_do_refresh_access_token", None)

        def read_only_ensure_token() -> dict[str, Any]:
            nonlocal cached_token
            try:
                token_info = self._read_only_token(str(getattr(client, "app_id", "") or ""))
            except Exception as exc:
                raise CliError("permission_denied", "MPI read-only mode requires an existing valid token", 1) from exc
            token_info = self._ensure_xhs_token(client, token_info)
            cached_token = token_info
            return token_info

        def read_only_access_token() -> str:
            token_info = cached_token or read_only_ensure_token()
            return str(token_info["access_token"])

        def refresh_access_token() -> dict[str, Any]:
            nonlocal cached_token
            if not callable(native_refresh_access_token):
                raise CliError("permission_denied", "MPI read-only mode cannot refresh token with this client", 1)
            cached_token = self._refresh_xhs_client_token(client, native_refresh_access_token)
            return cached_token

        def do_refresh_access_token() -> dict[str, Any]:
            nonlocal cached_token
            if not callable(native_do_refresh_access_token):
                raise CliError("permission_denied", "MPI read-only mode cannot refresh token with this client", 1)
            cached_token = self._refresh_xhs_client_token(client, native_do_refresh_access_token)
            return cached_token

        def deny_refresh(*_args: Any, **_kwargs: Any) -> None:
            raise CliError("permission_denied", "MPI read-only mode cannot perform authorization or advertiser cache refresh", 1)

        try:
            client.ensure_token = read_only_ensure_token
            client._get_access_token = read_only_access_token
            if callable(native_refresh_access_token):
                client.refresh_access_token = refresh_access_token
            if callable(native_do_refresh_access_token):
                client._do_refresh_access_token = do_refresh_access_token
        except Exception as exc:
            raise CliError("permission_denied", "MPI read-only mode cannot install token guard", 1) from exc
        for name in ("get_token_by_auth_code", "refresh_advertiser_list"):
            if hasattr(client, name):
                try:
                    setattr(client, name, deny_refresh)
                except Exception as exc:
                    raise CliError("permission_denied", "MPI read-only mode cannot install write guard", 1) from exc

    def _read_only_bili_token(self) -> dict[str, Any] | None:
        import config

        bili_client_id = str(
            os.environ.get("XIN_AGENT_BILI_CLIENT_ID")
            or getattr(config, "XIN_AGENT_BILI_CLIENT_ID", "")
            or getattr(config, "BILI_CLIENT_ID", "")
            or ""
        ).strip()
        if bili_client_id:
            token_info = self._read_only_token(bili_client_id, allow_legacy_empty=False)
            if token_info:
                return token_info
        env_token = str(
            os.environ.get("XIN_AGENT_BILI_ACCESS_TOKEN")
            or getattr(config, "XIN_AGENT_BILI_ACCESS_TOKEN", "")
            or getattr(config, "BILI_ACCESS_TOKEN", "")
            or ""
        ).strip()
        if env_token:
            return {
                "access_token": env_token,
                "expires_at": "2999-01-01T00:00:00",
                "app_id": bili_client_id,
            }
        return None

    def _load_bili_client(self) -> Any:
        import config
        import mpi

        client_id = str(
            os.environ.get("XIN_AGENT_BILI_CLIENT_ID")
            or getattr(config, "XIN_AGENT_BILI_CLIENT_ID", "")
            or ""
        ).strip()
        return mpi.BiliApiClient(app_id=client_id or None)

    def _prepare_bili_read_only_client(self, client: Any) -> None:
        cached_token: dict[str, Any] | None = None

        def read_only_ensure_token() -> dict[str, Any]:
            nonlocal cached_token
            try:
                token_info = self._validate_read_only_token(self._read_only_bili_token())
            except CliError:
                raise
            except Exception as exc:
                raise CliError("permission_denied", "MPI read-only mode requires an existing valid token", 1) from exc
            cached_token = token_info
            try:
                client.access_token = str(token_info["access_token"])
            except Exception:
                pass
            return token_info

        def read_only_access_token() -> str:
            token_info = cached_token or read_only_ensure_token()
            return str(token_info["access_token"])

        def deny_refresh(*_args: Any, **_kwargs: Any) -> None:
            raise CliError("permission_denied", "MPI read-only mode cannot refresh or write tokens", 1)

        try:
            client._get_access_token = read_only_access_token
        except Exception as exc:
            raise CliError("permission_denied", "MPI read-only mode cannot install token guard", 1) from exc
        for name in ("refresh_access_token", "get_token_by_auth_code"):
            if hasattr(client, name):
                try:
                    setattr(client, name, deny_refresh)
                except Exception as exc:
                    raise CliError("permission_denied", "MPI read-only mode cannot install write guard", 1) from exc
        read_only_ensure_token()

    def _bili_read_only_client(self) -> Any:
        client = self._load_bili_client()
        self._prepare_bili_read_only_client(client)
        return client

    def _read_only_alipay_token(self) -> dict[str, Any] | None:
        import config

        app_id = str(
            os.environ.get("XIN_AGENT_ALIPAY_APP_ID")
            or getattr(config, "XIN_AGENT_ALIPAY_APP_ID", "")
            or getattr(config, "ALIPAY_APP_ID", "")
            or ""
        ).strip()
        env_token = str(
            os.environ.get("XIN_AGENT_ALIPAY_APP_AUTH_TOKEN")
            or getattr(config, "XIN_AGENT_ALIPAY_APP_AUTH_TOKEN", "")
            or getattr(config, "ALIPAY_APP_AUTH_TOKEN", "")
            or ""
        ).strip()
        if env_token:
            return {
                "access_token": env_token,
                "expires_at": "2999-01-01T00:00:00",
                "app_id": app_id,
            }
        if app_id:
            return self._read_only_token(app_id, allow_legacy_empty=False)
        return None

    def _load_alipay_client(self) -> Any:
        import config
        import mpi

        app_id = str(os.environ.get("XIN_AGENT_ALIPAY_APP_ID") or getattr(config, "XIN_AGENT_ALIPAY_APP_ID", "") or "").strip()
        private_key = str(os.environ.get("XIN_AGENT_ALIPAY_PRIVATE_KEY") or getattr(config, "XIN_AGENT_ALIPAY_PRIVATE_KEY", "") or getattr(config, "ALIPAY_PRIVATE_KEY", "") or "").strip()
        app_auth_token = str(os.environ.get("XIN_AGENT_ALIPAY_APP_AUTH_TOKEN") or getattr(config, "XIN_AGENT_ALIPAY_APP_AUTH_TOKEN", "") or getattr(config, "ALIPAY_APP_AUTH_TOKEN", "") or "").strip()
        biz_token = str(os.environ.get("XIN_AGENT_ALIPAY_BIZ_TOKEN") or getattr(config, "XIN_AGENT_ALIPAY_BIZ_TOKEN", "") or getattr(config, "ALIPAY_BIZ_TOKEN", "") or "").strip()
        alipay_pid = str(os.environ.get("XIN_AGENT_ALIPAY_PID") or getattr(config, "XIN_AGENT_ALIPAY_PID", "") or getattr(config, "ALIPAY_PID", "") or "").strip()
        principal_tag = str(os.environ.get("XIN_AGENT_ALIPAY_PRINCIPAL_TAG") or getattr(config, "XIN_AGENT_ALIPAY_PRINCIPAL_TAG", "") or getattr(config, "ALIPAY_PRINCIPAL_TAG", "") or "").strip()
        return mpi.AlipayApiClient(
            app_id=app_id or None,
            private_key=private_key or None,
            app_auth_token=app_auth_token or None,
            biz_token=biz_token or None,
            alipay_pid=alipay_pid or None,
            principal_tag=principal_tag or None,
        )

    def _prepare_alipay_read_only_client(self, client: Any) -> None:
        cached_token: dict[str, Any] | None = None

        def read_only_token() -> str:
            nonlocal cached_token
            if cached_token is None:
                try:
                    cached_token = self._validate_read_only_token(self._read_only_alipay_token())
                except CliError:
                    raise
                except Exception as exc:
                    raise CliError("permission_denied", "MPI read-only mode requires an existing valid token", 1) from exc
            token = str(cached_token["access_token"])
            try:
                client.app_auth_token = token
            except Exception:
                pass
            return token

        def deny_refresh(*_args: Any, **_kwargs: Any) -> None:
            raise CliError("permission_denied", "MPI read-only mode cannot refresh or write tokens", 1)

        try:
            client._get_app_auth_token = read_only_token
        except Exception as exc:
            raise CliError("permission_denied", "MPI read-only mode cannot install token guard", 1) from exc
        for name in ("get_token_by_auth_code",):
            if hasattr(client, name):
                try:
                    setattr(client, name, deny_refresh)
                except Exception as exc:
                    raise CliError("permission_denied", "MPI read-only mode cannot install write guard", 1) from exc
        read_only_token()

    def _alipay_read_only_client(self) -> Any:
        client = self._load_alipay_client()
        self._prepare_alipay_read_only_client(client)
        return client

    @staticmethod
    def _account_id(item: dict[str, Any]) -> str:
        return str(
            item.get("advertiser_id")
            or item.get("virtual_seller_id")
            or item.get("brand_user_id")
            or ""
        ).strip()

    @staticmethod
    def _xhs_channel_fields(xhs_channel: str) -> dict[str, str]:
        return {
            "platform": "xhs",
            "xhs_channel": xhs_channel,
            "xhs_channel_label": XHS_CHANNEL_LABELS.get(xhs_channel, xhs_channel),
        }

    @staticmethod
    def _account_name(item: dict[str, Any]) -> str:
        return str(
            item.get("advertiser_name")
            or item.get("virtual_seller_name")
            or item.get("brand_user_name")
            or item.get("company_name")
            or ""
        ).strip()

    @staticmethod
    def _project_id(item: dict[str, Any]) -> str:
        return str(
            item.get("spu_id")
            or item.get("spuId")
            or item.get("main_spu_id")
            or item.get("campaign_id")
            or item.get("campaignId")
            or item.get("id")
            or ""
        ).strip()

    @staticmethod
    def _project_name(item: dict[str, Any]) -> str:
        return str(
            item.get("spu_name")
            or item.get("spuName")
            or item.get("campaign_name")
            or item.get("campaignName")
            or item.get("name")
            or item.get("brand_name")
            or ""
        ).strip()

    @staticmethod
    def _first_present_metric(item: dict[str, Any], keys: Sequence[str]) -> Any:
        for key in keys:
            if key in item and item[key] is not None and item[key] != "":
                return item[key]
        return 0

    @staticmethod
    def _row_matches_text(row: dict[str, Any], search: str | None, fields: Sequence[str]) -> bool:
        if not search:
            return True
        needle = search.lower()
        return any(needle in str(row.get(field) or "").lower() for field in fields)

    @staticmethod
    def _is_xhs_permission_error(exc: Exception) -> bool:
        message = safe_message(exc)
        has_xhs_permission_marker = any(
            marker in message
            for marker in (
                "400001",
                "410019",
                "410023",
                "410026",
                "access_token错误",
                "没有该账号权限",
                "没有该接口权限",
                "不在代理商管辖范围",
            )
        )
        if isinstance(exc, CliError) and exc.code == "permission_denied":
            return has_xhs_permission_marker
        return has_xhs_permission_marker

    def list_accounts(
        self,
        limit: int,
        offset: int,
        platform: str = DEFAULT_MPI_PLATFORM,
        xhs_channel: str = DEFAULT_XHS_CHANNEL,
        account_id: str | None = None,
        search: str | None = None,
    ) -> list[dict[str, Any]]:
        if (account_id or search) and platform != "xhs":
            raise CliError("invalid_argument", "--account-id/--search for MPI account list is only supported on platform xhs", 2)
        if platform == "bili":
            return self.list_bili_accounts(limit, offset)
        if platform == "alipay":
            return self.list_alipay_accounts(limit, offset)
        try:
            rows: list[dict[str, Any]] = []
            permission_errors: list[str] = []
            for client in self._xhs_listing_clients():
                try:
                    with self._WriteGuard():
                        items = client.fetch_all_sub_account_details()
                except Exception as exc:
                    if self._is_xhs_permission_error(exc):
                        permission_errors.append(f"{getattr(client, 'app_id', '')}:{safe_message(exc)}")
                        continue
                    raise
                for item in items:
                    resolved_account_id = self._account_id(item)
                    if not resolved_account_id:
                        continue
                    rows.append({
                        **self._xhs_channel_fields(xhs_channel),
                        "account_id": resolved_account_id,
                        "account_name": self._account_name(item),
                        "company_name": str(item.get("company_name") or ""),
                        "app_id": str(getattr(client, "app_id", "")),
                        "source": "mpi",
                        "bound_in_backend": False,
                    })
            if account_id:
                rows = [row for row in rows if str(row.get("account_id") or "") == str(account_id)]
            if search:
                rows = [
                    row
                    for row in rows
                    if self._row_matches_text(row, search, ("account_id", "account_name", "company_name"))
                ]
            if not rows and permission_errors:
                raise CliError("permission_denied", "XHS account list permission denied: " + "; ".join(permission_errors), 1)
            return rows[offset:offset + limit]
        except CliError:
            raise
        except Exception as exc:
            if self._is_xhs_permission_error(exc):
                raise CliError("permission_denied", safe_message(exc), 1) from exc
            raise CliError("internal_error", safe_message(exc), 1) from exc

    def list_projects(
        self,
        account_id: str | None,
        limit: int,
        offset: int,
        start_date: str | None = None,
        end_date: str | None = None,
        platform: str = DEFAULT_MPI_PLATFORM,
        xhs_channel: str = DEFAULT_XHS_CHANNEL,
        search: str | None = None,
    ) -> list[dict[str, Any]]:
        if platform == "bili":
            raise CliError("invalid_argument", "project list --source mpi --platform bili is not supported", 2)
        if platform == "alipay":
            raise CliError("invalid_argument", "project list --source mpi --platform alipay is not supported", 2)
        if not account_id:
            raise CliError("invalid_argument", "account-id is required when project list uses --source mpi", 2)
        advertiser_id = parse_account_id(account_id)
        try:
            rows: list[dict[str, Any]] = []
            permission_errors: list[str] = []
            for client in self._xhs_listing_clients():
                fetch_spu_list = getattr(client, "fetch_spu_list", None)
                try:
                    with self._WriteGuard():
                        if fetch_spu_list is not None:
                            items = fetch_spu_list(
                                advertiser_id,
                                keyword=search,
                                page_size=min(max(limit + offset, 1), 100),
                                max_pages=5,
                                can_bind=None,
                            )
                        else:
                            if not start_date or not end_date:
                                raise CliError("invalid_argument", "start-date and end-date are required for MPI campaign fallback", 2)
                            items = client.fetch_offline_report(
                                advertiser_id=advertiser_id,
                                start_date=start_date,
                                end_date=end_date,
                                level="campaign",
                            )
                except CliError as exc:
                    if self._is_xhs_permission_error(exc):
                        permission_errors.append(f"{getattr(client, 'app_id', '')}:{safe_message(exc)}")
                        continue
                    raise
                except Exception as exc:
                    if self._is_xhs_permission_error(exc):
                        permission_errors.append(f"{getattr(client, 'app_id', '')}:{safe_message(exc)}")
                        continue
                    raise
                for item in items:
                    project_id = self._project_id(item)
                    if not project_id:
                        continue
                    rows.append({
                        **self._xhs_channel_fields(xhs_channel),
                        "project_id": project_id,
                        "project_name": self._project_name(item),
                        "brand_name": str(item.get("brand_name") or ""),
                        "source_account_id": str(account_id),
                        "app_id": str(getattr(client, "app_id", "")),
                        "source": "mpi",
                        "bound_in_backend": False,
                    })
                    if search and not self._row_matches_text(rows[-1], search, ("project_id", "project_name", "brand_name")):
                        rows.pop()
                if len(rows) >= offset + limit:
                    break
            return rows[offset:offset + limit]
        except CliError:
            raise
        except Exception as exc:
            raise CliError("internal_error", safe_message(exc), 1) from exc

    def report_summary(self, args: argparse.Namespace) -> list[dict[str, Any]]:
        account_id = str(getattr(args, "account_id", "") or "").strip()
        if not account_id:
            raise CliError("invalid_argument", "account-id is required when report summary uses --source mpi", 2)
        if getattr(args, "platform", DEFAULT_MPI_PLATFORM) == "bili":
            return self.report_bili_summary(args)
        if getattr(args, "platform", DEFAULT_MPI_PLATFORM) == "alipay":
            return self.report_alipay_summary(args)
        if getattr(args, "xhs_channel", DEFAULT_XHS_CHANNEL) == "chengfeng":
            return self.report_chengfeng_summary(args)
        advertiser_id = parse_account_id(account_id)
        try:
            rows: list[dict[str, Any]] = []
            permission_errors: list[str] = []
            for client in self._read_only_clients():
                try:
                    with self._WriteGuard():
                        standard_items = client.fetch_offline_report(
                            advertiser_id=advertiser_id,
                            start_date=args.start_date,
                            end_date=args.end_date,
                            level="account",
                        )
                        easy_items = self._fetch_easy_xhs_summary_items(
                            client,
                            advertiser_id,
                            args.start_date,
                            args.end_date,
                        )
                except Exception as exc:
                    if self._is_xhs_permission_error(exc):
                        permission_errors.append(f"{getattr(client, 'app_id', '')}:{safe_message(exc)}")
                        continue
                    raise
                rows.extend(self._xhs_spotlight_summary_rows(
                    standard_items,
                    easy_items,
                    account_id,
                    str(getattr(client, "app_id", "")),
                    args.start_date,
                ))
                if len(rows) >= args.offset + args.limit:
                    break
            if not rows and permission_errors:
                raise CliError("permission_denied", "XHS report summary permission denied: " + "; ".join(permission_errors), 1)
            return rows[args.offset:args.offset + args.limit]
        except CliError:
            raise
        except Exception as exc:
            raise CliError("internal_error", safe_message(exc), 1) from exc

    def _fetch_easy_xhs_summary_items(self, client: Any, advertiser_id: int, start_date: str, end_date: str) -> list[dict[str, Any]]:
        fetch_easy_plan = getattr(client, "fetch_easy_plan_report", None)
        if callable(fetch_easy_plan):
            try:
                items = fetch_easy_plan(
                    advertiser_id=advertiser_id,
                    start_date=start_date,
                    end_date=end_date,
                )
                if items:
                    return [item for item in items if isinstance(item, dict)]
            except CliError:
                raise
            except Exception as exc:
                if not self._is_xhs_permission_error(exc):
                    raise
        fetch_easy_promotion = getattr(client, "fetch_easy_promotion_report", None)
        if callable(fetch_easy_promotion):
            try:
                items = fetch_easy_promotion(
                    advertiser_id=advertiser_id,
                    start_date=start_date,
                    end_date=end_date,
                )
                return [item for item in (items or []) if isinstance(item, dict)]
            except CliError:
                raise
            except Exception as exc:
                if not self._is_xhs_permission_error(exc):
                    raise
        return []

    def _xhs_spotlight_summary_rows(
        self,
        standard_items: Sequence[dict[str, Any]],
        easy_items: Sequence[dict[str, Any]],
        account_id: str,
        app_id: str,
        fallback_date: str,
    ) -> list[dict[str, Any]]:
        rows_by_date: dict[str, dict[str, Any]] = {}

        def metric(item: dict[str, Any], keys: Sequence[str]) -> float:
            value = self._first_present_metric(item, keys)
            try:
                return float(value or 0)
            except (TypeError, ValueError):
                return 0.0

        def row_for(item: dict[str, Any]) -> dict[str, Any]:
            report_date = str(item.get("time") or item.get("date") or item.get("report_date") or fallback_date)
            return rows_by_date.setdefault(report_date, {
                **self._xhs_channel_fields("spotlight"),
                "account_id": account_id,
                "report_date": report_date,
                "cost": 0.0,
                "cost_standard": 0.0,
                "cost_simple": 0.0,
                "impression": 0,
                "click": 0,
                "source": "mpi",
                "app_id": app_id,
            })

        for item in standard_items or []:
            if not isinstance(item, dict):
                continue
            row = row_for(item)
            cost = metric(item, ("fee", "cost", "cost_total"))
            row["cost_standard"] = round(row["cost_standard"] + cost, 2)
            row["cost"] = round(row["cost"] + cost, 2)
            row["impression"] += int(metric(item, ("impression", "show_count")))
            row["click"] += int(metric(item, ("click", "click_count")))

        for item in easy_items or []:
            if not isinstance(item, dict):
                continue
            row = row_for(item)
            cost = metric(item, ("fee", "cost", "cost_total"))
            row["cost_simple"] = round(row["cost_simple"] + cost, 2)
            row["cost"] = round(row["cost"] + cost, 2)
            row["impression"] += int(metric(item, ("impression", "show_count")))
            row["click"] += int(metric(item, ("click", "click_count")))

        return list(rows_by_date.values())

    def _number_metric(self, item: dict[str, Any], keys: Sequence[str]) -> float:
        value = self._first_present_metric(item, keys)
        try:
            return float(str(value or 0).replace("%", ""))
        except (TypeError, ValueError):
            return 0.0

    def _xhs_note_detail_rows(
        self,
        items: Sequence[dict[str, Any]],
        account_id: str,
        app_id: str,
        xhs_channel: str,
        fallback_start_date: str,
        fallback_end_date: str,
    ) -> list[dict[str, Any]]:
        rows_by_note: dict[str, dict[str, Any]] = {}

        for item in items or []:
            if not isinstance(item, dict):
                continue
            note_id = str(
                item.get("note_id")
                or item.get("noteId")
                or item.get("material_id")
                or item.get("materialId")
                or ""
            ).strip()
            note_title = str(
                item.get("note_title")
                or item.get("note_name")
                or item.get("noteName")
                or item.get("material_name")
                or item.get("materialName")
                or ""
            ).strip()
            if not note_id and not note_title:
                continue
            key = note_id.lower() if note_id else note_title.lower()
            row = rows_by_note.setdefault(key, {
                **self._xhs_channel_fields(xhs_channel),
                "account_id": account_id,
                "note_id": note_id,
                "note_title": note_title,
                "note_jump_url": str(item.get("note_jump_url") or item.get("note_url") or item.get("url") or ""),
                "note_image": str(item.get("note_image") or item.get("image") or ""),
                "cost": 0.0,
                "impression": 0,
                "click": 0,
                "interaction": 0,
                "message_consult": 0,
                "i_user_num": 0,
                "ti_user_num": 0,
                "report_start_date": str(item.get("time") or item.get("date") or fallback_start_date),
                "report_end_date": str(item.get("time") or item.get("date") or fallback_end_date),
                "date_basis": "mpi.offline_report.time",
                "source_table": "mpi_xhs_offline_report_note",
                "source": "mpi",
                "app_id": app_id,
            })
            if note_id and not row.get("note_id"):
                row["note_id"] = note_id
            if note_title and not row.get("note_title"):
                row["note_title"] = note_title
            if not row.get("note_jump_url"):
                row["note_jump_url"] = str(item.get("note_jump_url") or item.get("note_url") or item.get("url") or "")
            if not row.get("note_image"):
                row["note_image"] = str(item.get("note_image") or item.get("image") or "")

            report_date = str(item.get("time") or item.get("date") or fallback_start_date)
            row["report_start_date"] = min(str(row["report_start_date"]), report_date)
            row["report_end_date"] = max(str(row["report_end_date"]), report_date)
            row["cost"] = round(float(row["cost"]) + self._number_metric(item, ("fee", "cost", "cost_total")), 2)
            row["impression"] += int(self._number_metric(item, ("impression", "show_count")))
            row["click"] += int(self._number_metric(item, ("click", "click_count")))
            row["interaction"] += int(self._number_metric(item, ("interaction",)))
            row["message_consult"] += int(self._number_metric(item, ("message_consult", "messageConsult")))
            row["i_user_num"] += int(self._number_metric(item, ("i_user_num", "iUserNum")))
            row["ti_user_num"] += int(self._number_metric(item, ("ti_user_num", "tiUserNum")))

        rows = list(rows_by_note.values())
        for row in rows:
            row["ctr"] = round(row["click"] / row["impression"], 6) if row["impression"] else 0
        rows.sort(key=lambda row: (-float(row.get("cost") or 0), str(row.get("note_id") or "")))
        return rows

    def note_detail(self, args: argparse.Namespace) -> list[dict[str, Any]]:
        account_id = str(getattr(args, "account_id", "") or "").strip()
        if not account_id:
            raise CliError("invalid_argument", "account-id is required when note detail uses --source mpi", 2)
        if getattr(args, "platform", DEFAULT_MPI_PLATFORM) != "xhs":
            raise CliError("invalid_argument", "note detail --source mpi currently supports --platform xhs only", 2)
        advertiser_id = parse_account_id(account_id)
        xhs_channel = getattr(args, "xhs_channel", DEFAULT_XHS_CHANNEL)
        try:
            rows: list[dict[str, Any]] = []
            supported = False
            permission_errors: list[str] = []
            clients = (
                self._read_only_clients_for_ports(("chengfeng",))
                if xhs_channel == "chengfeng"
                else self._read_only_clients()
            )
            for client in clients:
                try:
                    with self._WriteGuard():
                        if xhs_channel == "chengfeng":
                            fetch_chengfeng = getattr(client, "fetch_chengfeng_offline_report", None)
                            if not callable(fetch_chengfeng):
                                continue
                            supported = True
                            items = fetch_chengfeng(
                                advertiser_id=advertiser_id,
                                start_date=args.start_date,
                                end_date=args.end_date,
                                level="note",
                            )
                        else:
                            supported = True
                            items = client.fetch_offline_report(
                                advertiser_id=advertiser_id,
                                start_date=args.start_date,
                                end_date=args.end_date,
                                level="note",
                            )
                except Exception as exc:
                    if self._is_xhs_permission_error(exc):
                        permission_errors.append(f"{getattr(client, 'app_id', '')}:{safe_message(exc)}")
                        continue
                    raise
                rows.extend(self._xhs_note_detail_rows(
                    items,
                    account_id,
                    str(getattr(client, "app_id", "")),
                    xhs_channel,
                    args.start_date,
                    args.end_date,
                ))
                if rows:
                    break
            if xhs_channel == "chengfeng" and not supported:
                raise CliError("invalid_argument", "chengfeng offline note report is not supported by configured MPI clients", 2)
            rows.sort(key=lambda row: (-float(row.get("cost") or 0), str(row.get("note_id") or "")))
            return rows[args.offset:args.offset + args.limit]
        except CliError:
            raise
        except Exception as exc:
            raise CliError("internal_error", safe_message(exc), 1) from exc

    def realtime_summary(
        self,
        accounts: Sequence[dict[str, Any]],
        limit: int,
        offset: int,
        xhs_channel: str = DEFAULT_XHS_REALTIME_CHANNEL,
    ) -> list[dict[str, Any]]:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        import config

        target_accounts = list(accounts)[offset:offset + limit]
        if not target_accounts:
            return []
        clients = self._read_only_clients()
        if not clients:
            raise CliError("permission_denied", "MPI read-only mode requires an existing valid token", 1)

        def metric(item: dict[str, Any], keys: Sequence[str]) -> float:
            value = self._first_present_metric(item, keys)
            try:
                return float(value or 0)
            except (TypeError, ValueError):
                return 0.0

        def add_metrics(row: dict[str, Any], item: dict[str, Any], bucket: str) -> None:
            cost = metric(item, ("fee", "cost", "cost_total"))
            row[bucket] = round(float(row.get(bucket) or 0) + cost, 2)
            row["cost"] = round(float(row.get("cost") or 0) + cost, 2)
            row["impression"] = int(row.get("impression") or 0) + int(metric(item, ("impression", "show_count")))
            row["click"] = int(row.get("click") or 0) + int(metric(item, ("click", "click_count")))
            row["message_consult"] = int(row.get("message_consult") or 0) + int(metric(item, ("messageConsult", "message_consult")))
            row["interaction"] = int(row.get("interaction") or 0) + int(metric(item, ("interaction",)))

        app_port_map: dict[str, tuple[str, str]] = {}
        for cfg in self._xhs_client_configs():
            if cfg.get("app_id"):
                app_port_map[str(cfg["app_id"])] = (str(cfg["port"]), str(cfg["port_label"]))

        def client_port(client: Any) -> tuple[str, str]:
            app_id = str(getattr(client, "app_id", "") or "")
            app_id_lower = app_id.lower()
            if app_id in app_port_map:
                return app_port_map[app_id]
            if "chengfeng" in app_id_lower:
                return "chengfeng", "乘风小红书"
            if "medical" in app_id_lower:
                return "medical_juguang", "医美小红书"
            return "local_juguang", "本土小红书"

        client_entries = [(client, *client_port(client)) for client in clients]

        def port_selected(port: str) -> bool:
            if xhs_channel == "all":
                return True
            if xhs_channel == "chengfeng":
                return port == "chengfeng"
            return port != "chengfeng"

        def fetch_one(account: dict[str, Any]) -> dict[str, Any]:
            account_id = str(account.get("account_id") or "").strip()
            base_row = {
                "platform": "xhs",
                "xhs_channel": xhs_channel,
                "xhs_channel_label": XHS_REALTIME_CHANNEL_LABELS.get(xhs_channel, xhs_channel),
                "account_id": account_id,
                "account_name": account.get("account_name") or "",
                "sub_account_id": account.get("sub_account_id"),
                "project_id": account.get("project_id"),
                "project_name": account.get("project_name") or "",
                "operator_name": account.get("operator_name") or "",
                "report_date": datetime.now().date().isoformat(),
                "cost": 0.0,
                "cost_standard": 0.0,
                "cost_simple": 0.0,
                "impression": 0,
                "click": 0,
                "interaction": 0,
                "message_consult": 0,
                "source": "mpi_realtime",
                "source_table": None,
                "date_basis": "realtime_today",
                "status": "not_found",
                "error": "",
                "standard_item_count": 0,
                "easy_item_count": 0,
                "source_item_count": 0,
                "source_ports": [],
                "port_statuses": [],
            }
            try:
                advertiser_id = parse_account_id(account_id)
            except CliError as exc:
                row = dict(base_row)
                row["status"] = "invalid_account_id"
                row["error"] = exc.message
                return row
            errors: list[str] = []
            row = dict(base_row)
            app_ids: list[str] = []
            selected_any = False
            saw_empty = False
            for client, port, port_label in client_entries:
                if not port_selected(port):
                    continue
                selected_any = True
                app_id = str(getattr(client, "app_id", ""))
                if app_id:
                    app_ids.append(app_id)
                port_row = {
                    "port": port,
                    "port_label": port_label,
                    "app_id": app_id,
                    "status": "not_found",
                    "cost": 0.0,
                    "standard_item_count": 0,
                    "easy_item_count": 0,
                    "source_item_count": 0,
                    "error": "",
                }
                try:
                    if port == "chengfeng":
                        fetch_chengfeng = getattr(client, "fetch_chengfeng_realtime_report", None)
                        if not callable(fetch_chengfeng):
                            port_row["status"] = "unsupported"
                            row["port_statuses"].append(port_row)
                            continue
                        before_cost = float(row.get("cost") or 0)
                        standard_items = client.fetch_chengfeng_realtime_report(advertiser_id)
                        easy_items: list[dict[str, Any]] = []
                    else:
                        before_cost = float(row.get("cost") or 0)
                        standard_items = client.fetch_realtime_report(advertiser_id)
                        fetch_easy = getattr(client, "fetch_easy_realtime_report", None)
                        easy_items = fetch_easy(advertiser_id) if callable(fetch_easy) else []
                    standard_rows = [item for item in (standard_items or []) if isinstance(item, dict)]
                    easy_rows = [item for item in (easy_items or []) if isinstance(item, dict)]
                    port_row["standard_item_count"] = len(standard_rows)
                    port_row["easy_item_count"] = len(easy_rows)
                    port_row["source_item_count"] = len(standard_rows) + len(easy_rows)
                    row["standard_item_count"] += len(standard_rows)
                    row["easy_item_count"] += len(easy_rows)
                    row["source_item_count"] += len(standard_rows) + len(easy_rows)
                    for item in standard_rows:
                        add_metrics(row, item, "cost_standard")
                    for item in easy_rows:
                        add_metrics(row, item, "cost_simple")
                    port_row["cost"] = round(float(row.get("cost") or 0) - before_cost, 2)
                    port_row["status"] = "ok" if port_row["source_item_count"] else "empty"
                    if port_row["source_item_count"]:
                        row["source_ports"].append(port)
                    else:
                        saw_empty = True
                    row["port_statuses"].append(port_row)
                except CliError:
                    raise
                except Exception as exc:
                    if self._is_xhs_permission_error(exc):
                        message = safe_message(exc)
                        errors.append(f"{app_id}:{message}")
                        port_row["status"] = "permission_denied"
                        port_row["error"] = message
                        row["port_statuses"].append(port_row)
                        continue
                    message = safe_message(exc)
                    port_row["status"] = "error"
                    port_row["error"] = message
                    row["port_statuses"].append(port_row)
                    errors.append(f"{app_id}:{message}")
                    continue
            row["app_id"] = ",".join(app_ids)
            if row["source_item_count"]:
                row["status"] = "ok"
            elif saw_empty:
                row["status"] = "empty"
            elif errors:
                row["status"] = "permission_denied"
                row["error"] = "; ".join(errors[:3])
            elif selected_any:
                row["status"] = "not_found"
            else:
                row["status"] = "not_configured"
            return row

        rows: list[dict[str, Any]] = []
        max_workers = max(1, min(4, len(target_accounts)))
        with self._WriteGuard():
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {executor.submit(fetch_one, account): account for account in target_accounts}
                for future in as_completed(futures):
                    rows.append(future.result())
        rows.sort(key=lambda row: (str(row.get("project_name") or ""), str(row.get("account_id") or "")))
        return rows

    def list_bili_accounts(self, limit: int, offset: int) -> list[dict[str, Any]]:
        try:
            client = self._bili_read_only_client()
            with self._WriteGuard():
                items = client.list_agent_accounts()
            rows: list[dict[str, Any]] = []
            for item in items:
                account_id = str(item.get("account_id") or item.get("advertiser_id") or "").strip()
                if not account_id:
                    continue
                rows.append({
                    "platform": "bili",
                    "account_id": account_id,
                    "account_name": str(item.get("account_name") or item.get("name") or item.get("advertiser_name") or ""),
                    "account_role": item.get("account_role"),
                    "source": "mpi",
                    "bound_in_backend": False,
                })
            return rows[offset:offset + limit]
        except CliError:
            raise
        except Exception as exc:
            raise CliError("mpi_unavailable", safe_message(exc), 1) from exc

    def list_alipay_accounts(self, limit: int, offset: int) -> list[dict[str, Any]]:
        try:
            client = self._alipay_read_only_client()
            with self._WriteGuard():
                items = client.list_agent_accounts()
            rows: list[dict[str, Any]] = []
            for item in items:
                principal_tag = str(item.get("principal_tag") or item.get("principalTag") or "").strip()
                account_id = str(item.get("account_id") or item.get("principal_id") or item.get("alipay_oid") or principal_tag or "").strip()
                if not account_id and not principal_tag:
                    continue
                rows.append({
                    "platform": "alipay",
                    "account_id": principal_tag or account_id,
                    "principal_tag": principal_tag,
                    "account_name": str(item.get("account_name") or item.get("principal_name") or item.get("alipay_account") or account_id or ""),
                    "status": item.get("status"),
                    "status_name": item.get("status_name"),
                    "source": "mpi",
                    "bound_in_backend": False,
                })
            return rows[offset:offset + limit]
        except CliError:
            raise
        except Exception as exc:
            raise CliError("mpi_unavailable", safe_message(exc), 1) from exc

    @staticmethod
    def _bili_nested_value(item: dict[str, Any], group: str, *keys: str) -> Any:
        nested = item.get(group)
        if isinstance(nested, dict):
            for key in keys:
                if nested.get(key) not in (None, ""):
                    return nested.get(key)
        for key in keys:
            if item.get(key) not in (None, ""):
                return item.get(key)
        return None

    @staticmethod
    def _bili_int(value: Any) -> int:
        try:
            return int(float(value or 0))
        except (TypeError, ValueError):
            return 0

    def _bili_report_row(self, item: dict[str, Any], account_id: str, fallback_day: str) -> dict[str, Any]:
        report_date = str(self._bili_nested_value(item, "dimensions", "date", "date_time") or fallback_day)
        if " " in report_date:
            report_date = report_date.split(" ", 1)[0]
        charged_cost_milli = self._bili_int(self._bili_nested_value(item, "metrics", "charged_cost_milli"))
        show_count = self._bili_int(self._bili_nested_value(item, "metrics", "show_count"))
        click_count = self._bili_int(self._bili_nested_value(item, "metrics", "click_count"))
        return {
            "platform": "bili",
            "account_id": account_id,
            "report_date": report_date,
            "cost": charged_cost_milli / 100000,
            "charged_cost_milli": charged_cost_milli,
            "impression": show_count,
            "show_count": show_count,
            "click": click_count,
            "click_count": click_count,
            "source": "mpi",
        }

    def report_bili_summary(self, args: argparse.Namespace) -> list[dict[str, Any]]:
        account_id_text = str(getattr(args, "account_id", "") or "").strip()
        account_id = parse_account_id(account_id_text)
        try:
            client = self._bili_read_only_client()
            rows: list[dict[str, Any]] = []
            for day in iter_date_strings(args.start_date, args.end_date):
                with self._WriteGuard():
                    response = client.fetch_custom_report_response(
                        day,
                        day,
                        dimensions=["date_time", "account_id"],
                        metrics=["show_count", "click_count", "charged_cost_milli"],
                        filters=[],
                        account_id=account_id,
                        page=1,
                        size=min(args.limit, 100),
                    )
                items = response.get("rows", []) if isinstance(response, dict) else []
                for item in items:
                    if isinstance(item, dict):
                        rows.append(self._bili_report_row(item, account_id_text, day))
            return rows[args.offset:args.offset + args.limit]
        except CliError:
            raise
        except Exception as exc:
            raise CliError("mpi_unavailable", safe_message(exc), 1) from exc

    def report_alipay_summary(self, args: argparse.Namespace) -> list[dict[str, Any]]:
        principal_tag = str(getattr(args, "account_id", "") or "").strip()
        if not principal_tag:
            raise CliError("invalid_argument", "account-id is required when report summary uses --source mpi", 2)
        try:
            import mpi

            client = self._alipay_read_only_client()
            rows: list[dict[str, Any]] = []
            with self._WriteGuard():
                items = client.fetch_report_rows(
                    args.start_date,
                    args.end_date,
                    principal_tag=principal_tag,
                    level="account",
                )
            for item in items:
                if not isinstance(item, dict):
                    continue
                row = mpi._alipay_flatten_report_row(item, {"account_id": principal_tag}, fallback_principal_tag=principal_tag)
                rows.append({
                    "platform": "alipay",
                    "account_id": principal_tag,
                    "principal_tag": principal_tag,
                    "report_date": str(row.get("time") or row.get("biz_date") or args.start_date),
                    "cost": float(row.get("cost_total") or row.get("cost") or 0),
                    "impression": int(float(row.get("impression") or 0)),
                    "click": int(float(row.get("click") or 0)),
                    "conv_result": int(float(row.get("conv_result") or 0)),
                    "source": "mpi",
                    "app_id": str(getattr(client, "app_id", "")),
                })
            return rows[args.offset:args.offset + args.limit]
        except CliError:
            raise
        except Exception as exc:
            raise CliError("mpi_unavailable", safe_message(exc), 1) from exc

    def list_chengfeng_projects(
        self,
        account_id: str | None,
        limit: int,
        offset: int,
        start_date: str | None,
        end_date: str | None,
    ) -> list[dict[str, Any]]:
        if not account_id:
            raise CliError("invalid_argument", "account-id is required when project list uses --source mpi", 2)
        if not start_date or not end_date:
            raise CliError("invalid_argument", "start-date and end-date are required for chengfeng project list", 2)
        advertiser_id = parse_account_id(account_id)
        try:
            rows: list[dict[str, Any]] = []
            supported = False
            permission_errors: list[str] = []
            for client in self._read_only_clients_for_ports(("chengfeng",)):
                fetch_chengfeng = getattr(client, "fetch_chengfeng_offline_report", None)
                if not callable(fetch_chengfeng):
                    continue
                supported = True
                try:
                    with self._WriteGuard():
                        items = fetch_chengfeng(
                            advertiser_id=advertiser_id,
                            start_date=start_date,
                            end_date=end_date,
                            level="spu",
                        )
                except Exception as exc:
                    if self._is_xhs_permission_error(exc):
                        permission_errors.append(f"{getattr(client, 'app_id', '')}:{safe_message(exc)}")
                        continue
                    raise
                for item in items:
                    project_id = self._project_id(item)
                    if not project_id:
                        continue
                    rows.append({
                        **self._xhs_channel_fields("chengfeng"),
                        "project_id": project_id,
                        "project_name": self._project_name(item),
                        "brand_name": str(item.get("brand_name") or ""),
                        "source_account_id": str(account_id),
                        "app_id": str(getattr(client, "app_id", "")),
                        "source": "mpi",
                        "bound_in_backend": False,
                    })
                if len(rows) >= offset + limit:
                    break
            if not supported:
                raise CliError("invalid_argument", "chengfeng offline report is not supported by configured MPI clients", 2)
            return rows[offset:offset + limit]
        except CliError:
            raise
        except Exception as exc:
            raise CliError("internal_error", safe_message(exc), 1) from exc

    def report_chengfeng_summary(self, args: argparse.Namespace) -> list[dict[str, Any]]:
        account_id = str(getattr(args, "account_id", "") or "").strip()
        if not account_id:
            raise CliError("invalid_argument", "account-id is required when report summary uses --source mpi", 2)
        advertiser_id = parse_account_id(account_id)
        try:
            rows: list[dict[str, Any]] = []
            supported = False
            permission_errors: list[str] = []
            for client in self._read_only_clients_for_ports(("chengfeng",)):
                fetch_chengfeng = getattr(client, "fetch_chengfeng_offline_report", None)
                if not callable(fetch_chengfeng):
                    continue
                supported = True
                try:
                    with self._WriteGuard():
                        items = fetch_chengfeng(
                            advertiser_id=advertiser_id,
                            start_date=args.start_date,
                            end_date=args.end_date,
                            level="account",
                        )
                except Exception as exc:
                    if self._is_xhs_permission_error(exc):
                        permission_errors.append(f"{getattr(client, 'app_id', '')}:{safe_message(exc)}")
                        continue
                    raise
                for item in items:
                    cost = self._first_present_metric(item, ("fee", "cost", "cost_total"))
                    impression = self._first_present_metric(item, ("impression", "show_count"))
                    click = self._first_present_metric(item, ("click", "click_count"))
                    rows.append({
                        **self._xhs_channel_fields("chengfeng"),
                        "account_id": account_id,
                        "report_date": str(item.get("time") or item.get("date") or args.start_date),
                        "cost": float(cost or 0),
                        "impression": int(float(impression or 0)),
                        "click": int(float(click or 0)),
                        "source": "mpi",
                        "app_id": str(getattr(client, "app_id", "")),
                    })
                if len(rows) >= args.offset + args.limit:
                    break
            if not supported:
                raise CliError("invalid_argument", "chengfeng offline report is not supported by configured MPI clients", 2)
            return rows[args.offset:args.offset + args.limit]
        except CliError:
            raise
        except Exception as exc:
            raise CliError("internal_error", safe_message(exc), 1) from exc


class XinAgentReadService:
    EMBEDDED_CACHE_TABLE_COLUMNS = {
        "users": [
            "id", "username", "role", "real_name", "department", "status", "created_at",
        ],
        "projects": [
            "id", "project_name", "advertiser_name", "sales_name", "need_content",
            "marketing_goal", "group_name", "platform", "media", "doc_links",
            "card_fields", "card_order", "operation_mode", "operator_id", "created_at",
        ],
        "sub_accounts": [
            "id", "project_id", "account_id", "account_name", "account_type",
            "company_name", "virtual_seller_id", "media", "external_account_id", "created_at",
        ],
        "daily_consumption": [
            "id", "sub_account_id", "date", "cost_simple", "cost_standard", "cost_square",
            "cost_total", "impression", "click", "interaction", "leads", "message_consult",
            "valid_leads",
        ],
        "project_handovers": [
            "id", "project_id", "from_operator_id", "to_operator_id", "handover_time",
            "to_target_type", "to_operator_label", "start_date", "end_date",
            "superseded_by", "superseded_at", "created_at",
        ],
        "sub_account_handovers": [
            "id", "sub_account_id", "project_id", "from_project_id", "from_operator_id", "to_operator_id",
            "handover_time", "to_target_type", "to_operator_label", "start_date", "end_date",
            "superseded_by", "superseded_at", "created_at",
        ],
    }

    def __init__(self) -> None:
        self._cache_status = "unknown"
        self._cache_database_exists: bool | None = None
        self._ownership_schema_available = False
        self._project_ownership_schema_available = False
        self._sub_account_ownership_schema_available = False

    def cache_status_meta(self) -> dict[str, Any]:
        if self._cache_database_exists is None:
            return {}
        return {
            "cache_status": self._cache_status,
            "cache_database_exists": self._cache_database_exists,
        }

    def _read_only_db(self) -> sqlite3.Connection:
        database = _models_database_path()
        if not database.exists():
            self._cache_database_exists = False
            conn = sqlite3.connect(":memory:")
            conn.row_factory = sqlite3.Row
            if self._load_embedded_cache_snapshot(conn):
                self._cache_status = "embedded"
            else:
                self._cache_status = "missing"
            self._ownership_schema_available = self._detect_ownership_schema(conn)
            return conn
        self._cache_status = "ok"
        self._cache_database_exists = True
        conn = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        self._ownership_schema_available = self._detect_ownership_schema(conn)
        return conn

    def _detect_ownership_schema(self, conn: sqlite3.Connection) -> bool:
        base_required = {
            "projects": {"id", "operator_id", "operation_mode"},
            "sub_accounts": {"id", "project_id"},
        }
        project_required = {
            "project_handovers": {
                "id", "project_id", "from_operator_id", "to_operator_id",
                "handover_time", "to_target_type", "start_date", "end_date", "superseded_by",
            },
        }
        sub_account_required = {
            "sub_account_handovers": {
                "id", "sub_account_id", "project_id", "from_project_id",
                "to_operator_id", "handover_time",
                "to_target_type", "start_date", "end_date", "superseded_by",
            },
        }
        try:
            base_available = all(
                self._table_exists(conn, table)
                and columns.issubset(self._table_columns(conn, table))
                for table, columns in base_required.items()
            )
            self._project_ownership_schema_available = base_available and all(
                self._table_exists(conn, table)
                and columns.issubset(self._table_columns(conn, table))
                for table, columns in project_required.items()
            )
            self._sub_account_ownership_schema_available = (
                self._project_ownership_schema_available
                and all(
                    self._table_exists(conn, table)
                    and columns.issubset(self._table_columns(conn, table))
                    for table, columns in sub_account_required.items()
                )
            )
            return self._sub_account_ownership_schema_available
        except sqlite3.Error:
            self._project_ownership_schema_available = False
            self._sub_account_ownership_schema_available = False
            return False

    def _load_embedded_cache_snapshot(self, conn: sqlite3.Connection) -> bool:
        try:
            import config

            snapshot = getattr(config, "XIN_AGENT_CACHE_SNAPSHOT", None)
        except Exception:
            return False
        if not isinstance(snapshot, dict):
            return False
        tables = snapshot.get("tables")
        if not isinstance(tables, dict):
            return False
        loaded = False
        self._create_embedded_cache_tables(conn)
        for table, rows in tables.items():
            if table not in self.EMBEDDED_CACHE_TABLE_COLUMNS or not isinstance(rows, list):
                continue
            inserted = self._insert_embedded_rows(conn, table, rows)
            loaded = loaded or inserted > 0
        conn.commit()
        return loaded

    def _create_embedded_cache_tables(self, conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT,
                role TEXT,
                real_name TEXT,
                department TEXT,
                status TEXT,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY,
                project_name TEXT,
                advertiser_name TEXT,
                sales_name TEXT,
                need_content TEXT,
                marketing_goal TEXT,
                group_name TEXT,
                platform TEXT,
                media TEXT,
                doc_links TEXT,
                card_fields TEXT,
                card_order INTEGER,
                operation_mode TEXT,
                operator_id INTEGER,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS sub_accounts (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                account_id TEXT,
                account_name TEXT,
                account_type TEXT,
                company_name TEXT,
                virtual_seller_id TEXT,
                media TEXT,
                external_account_id TEXT,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS daily_consumption (
                id INTEGER PRIMARY KEY,
                sub_account_id INTEGER,
                date TEXT,
                cost_simple REAL,
                cost_standard REAL,
                cost_square REAL,
                cost_total REAL,
                impression INTEGER,
                click INTEGER,
                interaction INTEGER,
                leads INTEGER,
                message_consult INTEGER,
                valid_leads INTEGER
            );
            CREATE TABLE IF NOT EXISTS project_handovers (
                id INTEGER PRIMARY KEY,
                project_id INTEGER,
                from_operator_id INTEGER,
                to_operator_id INTEGER,
                handover_time TEXT,
                to_target_type TEXT,
                to_operator_label TEXT,
                start_date TEXT,
                end_date TEXT,
                superseded_by INTEGER,
                superseded_at TEXT,
                created_at TEXT
            );
            CREATE TABLE IF NOT EXISTS sub_account_handovers (
                id INTEGER PRIMARY KEY,
                sub_account_id INTEGER,
                project_id INTEGER,
                from_project_id INTEGER,
                from_operator_id INTEGER,
                to_operator_id INTEGER,
                handover_time TEXT,
                to_target_type TEXT,
                to_operator_label TEXT,
                start_date TEXT,
                end_date TEXT,
                superseded_by INTEGER,
                superseded_at TEXT,
                created_at TEXT
            );
            """
        )

    def _insert_embedded_rows(self, conn: sqlite3.Connection, table: str, rows: list[Any]) -> int:
        columns = self.EMBEDDED_CACHE_TABLE_COLUMNS[table]
        placeholders = ", ".join("?" for _ in columns)
        column_sql = ", ".join(columns)
        inserted = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            values = [row.get(column) for column in columns]
            conn.execute(
                f"INSERT OR REPLACE INTO {table} ({column_sql}) VALUES ({placeholders})",
                values,
            )
            inserted += 1
        return inserted

    def _table_columns(self, conn: sqlite3.Connection, table: str) -> set[str]:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}

    def _table_column_names(self, conn: sqlite3.Connection, table: str) -> list[str]:
        return [row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]

    def _table_exists(self, conn: sqlite3.Connection, table: str) -> bool:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        ).fetchone()
        return row is not None

    def _sum_column(self, columns: set[str], table_alias: str, column: str) -> str:
        if column in columns:
            return f"SUM(COALESCE({table_alias}.{column}, 0))"
        return "0"

    def _has_tables(self, conn: sqlite3.Connection, tables: Sequence[str]) -> bool:
        existing = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (%s)" % ",".join("?" for _ in tables),
                tuple(tables),
            ).fetchall()
        }
        return all(table in existing for table in tables)

    def _select_column(
        self,
        columns: set[str],
        table_alias: str,
        column: str,
        alias: str | None = None,
        default: str = "''",
    ) -> str:
        output_name = alias or column
        if column in columns:
            return f"{table_alias}.{column} AS {output_name}"
        return f"{default} AS {output_name}"

    def _safe_sync_columns(self, columns: Sequence[str]) -> list[str]:
        return [
            column
            for column in columns
            if column not in SYNC_EXCLUDED_COLUMNS and not re.search(SENSITIVE_NAME_RE, column, re.IGNORECASE)
        ]

    def _sync_table_state(self, conn: sqlite3.Connection, table: str, columns: set[str]) -> dict[str, Any]:
        row_count = int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        state: dict[str, Any] = {"exists": True, "row_count": row_count}
        for column in SYNC_TIMESTAMP_COLUMNS:
            if column in columns:
                state[f"max_{column}"] = conn.execute(f"SELECT MAX({column}) FROM {table}").fetchone()[0]
        fingerprint_columns = [column for column in SYNC_FINGERPRINT_COLUMNS.get(table, ()) if column in columns]
        if fingerprint_columns:
            hasher = hashlib.sha256()
            order_column = "id" if "id" in columns else "rowid"
            column_sql = ", ".join(fingerprint_columns)
            fingerprint_rows = conn.execute(
                f"SELECT {column_sql} FROM {table} ORDER BY {order_column} LIMIT 50000"
            ).fetchall()
            for row in fingerprint_rows:
                hasher.update(json.dumps(dict(row), ensure_ascii=False, sort_keys=True, default=str).encode("utf-8"))
                hasher.update(b"\n")
            state["fingerprint"] = hasher.hexdigest()
            state["fingerprint_row_cap"] = 50000
            state["fingerprint_truncated"] = row_count > 50000
        return state

    def _sync_changed_at_expr(self, columns: set[str]) -> str:
        present = [column for column in SYNC_TIMESTAMP_COLUMNS if column in columns]
        if not present:
            return "''"
        if len(present) == 1:
            return f"COALESCE({present[0]}, '')"
        return "MAX(%s)" % ", ".join(f"COALESCE({column}, '')" for column in present)

    def _project_visibility_filter(
        self,
        project_columns: set[str],
        role_context: dict[str, Any] | None,
        project_alias: str = "p",
        user_alias: str = "u",
    ) -> tuple[list[str], list[Any]]:
        context = role_context or auth_context()
        role = str(context.get("role") or "admin")
        if role in ADMIN_ROLES or role == "report_admin":
            return [], []
        clauses: list[str] = []
        params: list[Any] = []
        if role == "supervisor":
            department = str(context.get("department") or "").strip()
            if not department:
                return ["1=0"], []
            if self._ownership_schema_available:
                ownership_clause, ownership_params = ownership_service.project_visibility_clause(
                    "date('now','localtime')",
                    department=department,
                    project_alias=project_alias,
                )
                clauses.append(ownership_clause or "1=0")
                params.extend(ownership_params)
            elif self._project_ownership_schema_available:
                target_expr = ownership_service.project_target_expr(
                    "date('now','localtime')", project_alias=project_alias
                )
                operator_expr = ownership_service.project_operator_expr(
                    "date('now','localtime')", project_alias=project_alias
                )
                clauses.append(
                    f"{target_expr} != ? AND {operator_expr} IN "
                    "(SELECT id FROM users WHERE department = ?)"
                )
                params.extend([ownership_service.HANDOVER_TARGET_SELF, department])
            else:
                clauses.append(f"{project_alias}.operator_id IN (SELECT id FROM users WHERE department = ?)")
                params.append(department)
            media_scope = tuple(context.get("media_scope") or ())
            if media_scope and set(media_scope) != set(ALL_MEDIA_SCOPE):
                media_terms: list[str] = []
                for media in media_scope:
                    markers = {
                        "xhs": ("xhs", "小红书", "聚光", "乘风"),
                        "bili": ("bili", "哔哩", "b站"),
                        "alipay": ("alipay", "支付宝"),
                    }.get(media, ())
                    for column in ("media", "platform"):
                        if column not in project_columns:
                            continue
                        for marker in markers:
                            media_terms.append(f"LOWER(COALESCE({project_alias}.{column}, '')) LIKE ?")
                            params.append(f"%{marker.lower()}%")
                if media_terms:
                    clauses.append("(" + " OR ".join(media_terms) + ")")
            return clauses, params
        if role in {"operator", "content_operator"}:
            raw_user_id = context.get("user_id")
            if raw_user_id in (None, ""):
                return ["1=0"], []
            try:
                user_id = int(raw_user_id)
            except (TypeError, ValueError):
                user_id = str(raw_user_id).strip()
            if user_id in (None, ""):
                return ["1=0"], []
            if self._ownership_schema_available:
                ownership_clause, ownership_params = ownership_service.project_visibility_clause(
                    "date('now','localtime')",
                    operator_id=user_id,
                    project_alias=project_alias,
                )
                clauses.append(ownership_clause or "1=0")
                params.extend(ownership_params)
            elif self._project_ownership_schema_available:
                target_expr = ownership_service.project_target_expr(
                    "date('now','localtime')", project_alias=project_alias
                )
                operator_expr = ownership_service.project_operator_expr(
                    "date('now','localtime')", project_alias=project_alias
                )
                clauses.append(f"{target_expr} != ? AND {operator_expr} = ?")
                params.extend([ownership_service.HANDOVER_TARGET_SELF, user_id])
            else:
                clauses.append(f"{project_alias}.operator_id = ?")
                params.append(user_id)
            return clauses, params
        return ["1=0"], []

    def _sub_account_visibility_filter(
        self,
        role_context: dict[str, Any] | None,
        date_expr: str,
    ) -> tuple[list[str], list[Any]]:
        context = role_context or auth_context()
        role = str(context.get("role") or "admin")
        if role in ADMIN_ROLES or role == "report_admin":
            return [], []
        if role == "supervisor":
            department = str(context.get("department") or "").strip()
            if not department:
                return ["1=0"], []
            if self._ownership_schema_available:
                clauses, params, _operator_expr = ownership_service.effective_operator_filter(
                    date_expr,
                    department=department,
                )
                return clauses, params
            if self._project_ownership_schema_available:
                target_expr = ownership_service.project_target_expr(date_expr)
                operator_expr = ownership_service.project_operator_expr(date_expr)
                return [
                    f"{target_expr} != ?",
                    f"{operator_expr} IN (SELECT id FROM users WHERE department = ?)",
                ], [ownership_service.HANDOVER_TARGET_SELF, department]
            return ["p.operator_id IN (SELECT id FROM users WHERE department = ?)"], [department]
        if role in {"operator", "content_operator"}:
            raw_user_id = context.get("user_id")
            if raw_user_id in (None, ""):
                return ["1=0"], []
            try:
                user_id = int(raw_user_id)
            except (TypeError, ValueError):
                user_id = str(raw_user_id).strip()
            if user_id in (None, ""):
                return ["1=0"], []
            if self._ownership_schema_available:
                clauses, params, _operator_expr = ownership_service.effective_operator_filter(
                    date_expr,
                    operator_id=user_id,
                )
                return clauses, params
            if self._project_ownership_schema_available:
                target_expr = ownership_service.project_target_expr(date_expr)
                operator_expr = ownership_service.project_operator_expr(date_expr)
                return [f"{target_expr} != ?", f"{operator_expr} = ?"], [
                    ownership_service.HANDOVER_TARGET_SELF,
                    user_id,
                ]
            return ["p.operator_id = ?"], [user_id]
        return ["1=0"], []

    def _project_owner_expr(self, date_expr: str = "date('now','localtime')") -> str:
        if not self._project_ownership_schema_available:
            return "p.operator_id"
        target_expr = ownership_service.project_target_expr(date_expr)
        operator_expr = ownership_service.project_operator_expr(date_expr)
        return (
            f"CASE WHEN {target_expr}='{ownership_service.HANDOVER_TARGET_SELF}' "
            f"THEN NULL ELSE {operator_expr} END"
        )

    def _sub_account_owner_expr(self, date_expr: str = "date('now','localtime')") -> str:
        if self._sub_account_ownership_schema_available:
            target_expr = ownership_service.sub_account_target_expr(date_expr)
            operator_expr = ownership_service.sub_account_operator_expr(date_expr)
        elif self._project_ownership_schema_available:
            target_expr = ownership_service.project_target_expr(date_expr)
            operator_expr = ownership_service.project_operator_expr(date_expr)
        else:
            return "p.operator_id"
        return (
            f"CASE WHEN {target_expr}='{ownership_service.HANDOVER_TARGET_SELF}' "
            f"THEN NULL ELSE {operator_expr} END"
        )

    def _project_target_expr(self, date_expr: str = "date('now','localtime')") -> str:
        if not self._project_ownership_schema_available:
            return f"'{ownership_service.HANDOVER_TARGET_OPERATOR}'"
        return ownership_service.project_target_expr(date_expr)

    def _sub_account_target_expr(self, date_expr: str = "date('now','localtime')") -> str:
        if self._sub_account_ownership_schema_available:
            return ownership_service.sub_account_target_expr(date_expr)
        if self._project_ownership_schema_available:
            return ownership_service.project_target_expr(date_expr)
        return f"'{ownership_service.HANDOVER_TARGET_OPERATOR}'"

    def _project_context_matches(self, row: dict[str, Any], search: str | None) -> bool:
        if not search:
            return False
        needle = search.lower()
        project_text = " ".join(
            str(row.get(key) or "")
            for key in (
                "project_name",
                "advertiser_name",
                "sales_name",
                "group_name",
                "platform",
                "media",
                "operator_name",
            )
        ).lower()
        return needle in project_text

    def _matched_accounts_for_project(
        self,
        conn: sqlite3.Connection,
        project_id: Any,
        sub_columns: set[str],
        search: str | None,
        account_id: str | None,
        *,
        include_all_project_accounts: bool,
        role_context: dict[str, Any] | None = None,
        limit: int = 50,
    ) -> tuple[list[dict[str, Any]], int]:
        if project_id is None:
            return [], 0
        account_exprs = [
            "sa.id AS sub_account_id",
            "sa.account_id",
            "sa.account_name",
            "sa.account_type",
            self._select_column(sub_columns, "sa", "company_name"),
            self._select_column(sub_columns, "sa", "virtual_seller_id"),
            self._select_column(sub_columns, "sa", "media"),
            self._select_column(sub_columns, "sa", "external_account_id"),
        ]
        account_where = ["sa.project_id = ?"]
        account_params: list[Any] = [project_id]
        visibility_clauses, visibility_params = self._sub_account_visibility_filter(
            role_context,
            "date('now','localtime')",
        )
        account_where.extend(visibility_clauses)
        account_params.extend(visibility_params)
        if account_id:
            account_terms = ["sa.account_id = ?"]
            account_params.append(account_id)
            if "external_account_id" in sub_columns:
                account_terms.append("sa.external_account_id = ?")
                account_params.append(account_id)
            if "virtual_seller_id" in sub_columns:
                account_terms.append("sa.virtual_seller_id = ?")
                account_params.append(account_id)
            account_where.append("(" + " OR ".join(account_terms) + ")")
        elif search and not include_all_project_accounts:
            like = f"%{search}%"
            account_terms = ["sa.account_id LIKE ?", "sa.account_name LIKE ?"]
            account_params.extend([like, like])
            for column in ("company_name", "virtual_seller_id", "external_account_id", "media"):
                if column in sub_columns:
                    account_terms.append(f"sa.{column} LIKE ?")
                    account_params.append(like)
            account_where.append("(" + " OR ".join(account_terms) + ")")
        elif not include_all_project_accounts:
            return [], 0
        where_sql = " AND ".join(account_where)
        total = int(
            conn.execute(
                f"""SELECT COUNT(*)
                    FROM sub_accounts sa
                    JOIN projects p ON p.id = sa.project_id
                    WHERE {where_sql}""",
                account_params,
            ).fetchone()[0]
        )
        account_rows = conn.execute(
            f"""SELECT {", ".join(account_exprs)}
                FROM sub_accounts sa
                JOIN projects p ON p.id = sa.project_id
                WHERE {where_sql}
                ORDER BY sa.id
                LIMIT ?""",
            [*account_params, limit],
        ).fetchall()
        return [dict(item) for item in account_rows], total

    def list_cache_projects(
        self,
        limit: int,
        offset: int,
        search: str | None = None,
        account_id: str | None = None,
        role_context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        conn = self._read_only_db()
        try:
            if not self._has_tables(conn, ("projects", "users", "sub_accounts")):
                return []
            project_columns = self._table_columns(conn, "projects")
            sub_columns = self._table_columns(conn, "sub_accounts")
            where: list[str] = []
            params: list[Any] = []
            visibility_clauses, visibility_params = self._project_visibility_filter(
                project_columns,
                role_context,
            )
            where.extend(visibility_clauses)
            params.extend(visibility_params)
            account_visibility_clauses, account_visibility_params = self._sub_account_visibility_filter(
                role_context,
                "date('now','localtime')",
            )
            account_visibility_sql = " AND ".join(account_visibility_clauses) if account_visibility_clauses else "1=1"
            project_owner_expr = self._project_owner_expr()
            project_target_expr = self._project_target_expr()
            if account_id:
                account_terms = ["sa.account_id = ?"]
                params.append(account_id)
                if "external_account_id" in sub_columns:
                    account_terms.append("sa.external_account_id = ?")
                    params.append(account_id)
                if "virtual_seller_id" in sub_columns:
                    account_terms.append("sa.virtual_seller_id = ?")
                    params.append(account_id)
                where.append("(" + " OR ".join(account_terms) + ")")
            if search:
                like = f"%{search}%"
                search_terms = [
                    "p.project_name LIKE ?",
                    "u.real_name LIKE ?",
                    "sa.account_id LIKE ?",
                    "sa.account_name LIKE ?",
                ]
                params.extend([like, like, like, like])
                for column in ("advertiser_name", "sales_name", "group_name", "media", "platform"):
                    if column in project_columns:
                        search_terms.append(f"p.{column} LIKE ?")
                        params.append(like)
                for column in ("company_name", "virtual_seller_id", "external_account_id", "media"):
                    if column in sub_columns:
                        search_terms.append(f"sa.{column} LIKE ?")
                        params.append(like)
                where.append("(" + " OR ".join(search_terms) + ")")
            where_clause = "WHERE " + " AND ".join(where) if where else ""
            params.extend([limit, offset])
            rows = conn.execute(
                f"""SELECT
                       p.id AS project_id,
                       p.project_name,
                       {self._select_column(project_columns, 'p', 'advertiser_name')},
                       {self._select_column(project_columns, 'p', 'sales_name')},
                       {self._select_column(project_columns, 'p', 'need_content')},
                       {self._select_column(project_columns, 'p', 'marketing_goal')},
                       {self._select_column(project_columns, 'p', 'group_name')},
                       {self._select_column(project_columns, 'p', 'platform')},
                       {self._select_column(project_columns, 'p', 'media')},
                       {self._select_column(project_columns, 'p', 'doc_links')},
                       {self._select_column(project_columns, 'p', 'card_fields')},
                       {self._select_column(project_columns, 'p', 'card_order', default='0')},
                       {self._select_column(project_columns, 'p', 'operation_mode')},
                       {self._select_column(project_columns, 'p', 'created_at')},
                       {project_owner_expr} AS operator_id,
                       {project_target_expr} AS current_target_type,
                       u.real_name AS operator_name,
                       u.department,
                       u.role AS operator_role,
                       COUNT(DISTINCT CASE WHEN {account_visibility_sql} THEN sa.id END) AS account_count
                   FROM projects p
                   LEFT JOIN users u ON {project_owner_expr} = u.id
                   LEFT JOIN sub_accounts sa ON sa.project_id = p.id
                   {where_clause}
                   GROUP BY p.id
                   ORDER BY p.id
                   LIMIT ? OFFSET ?""",
                [*account_visibility_params, *params],
            ).fetchall()
            result_rows = [dict(row) for row in rows]
            if result_rows and (search or account_id):
                for row in result_rows:
                    include_all_project_accounts = self._project_context_matches(row, search) and not account_id
                    matched_accounts, matched_accounts_total = self._matched_accounts_for_project(
                        conn,
                        row.get("project_id"),
                        sub_columns,
                        search,
                        account_id,
                        include_all_project_accounts=include_all_project_accounts,
                        role_context=role_context,
                    )
                    row["matched_account_count"] = matched_accounts_total
                    row["matched_accounts_total"] = matched_accounts_total
                    row["matched_accounts_returned"] = len(matched_accounts)
                    row["matched_accounts_limit"] = 50
                    row["matched_accounts_has_more"] = matched_accounts_total > len(matched_accounts)
                    row["matched_accounts"] = matched_accounts
                    row["match_scope"] = "project_and_accounts" if include_all_project_accounts else "accounts"
                    row["search_resolution"] = "project_with_matched_accounts"
            return result_rows
        except sqlite3.Error as exc:
            raise CliError("internal_error", "cache query failed", 1) from exc
        finally:
            conn.close()

    def project_detail_cache(
        self,
        project_id: int,
        start_date: str | None,
        end_date: str | None,
        limit: int,
        offset: int,
        role_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        conn = self._read_only_db()
        try:
            if not self._has_tables(conn, ("projects", "users", "sub_accounts")):
                return {}
            project_columns = self._table_columns(conn, "projects")
            visibility_clauses, visibility_params = self._project_visibility_filter(project_columns, role_context)
            where = ["p.id = ?", *visibility_clauses]
            params: list[Any] = [project_id, *visibility_params]
            project_owner_expr = self._project_owner_expr()
            project_target_expr = self._project_target_expr()
            project_row = conn.execute(
                f"""SELECT
                       p.id AS project_id,
                       p.project_name,
                       {self._select_column(project_columns, 'p', 'advertiser_name')},
                       {self._select_column(project_columns, 'p', 'sales_name')},
                       {self._select_column(project_columns, 'p', 'need_content')},
                       {self._select_column(project_columns, 'p', 'marketing_goal')},
                       {self._select_column(project_columns, 'p', 'group_name')},
                       {self._select_column(project_columns, 'p', 'platform')},
                       {self._select_column(project_columns, 'p', 'media')},
                       {self._select_column(project_columns, 'p', 'doc_links')},
                       {self._select_column(project_columns, 'p', 'card_fields')},
                       {self._select_column(project_columns, 'p', 'card_order', default='0')},
                       {self._select_column(project_columns, 'p', 'operation_mode')},
                       {self._select_column(project_columns, 'p', 'created_at')},
                       {project_owner_expr} AS operator_id,
                       {project_target_expr} AS current_target_type,
                       u.real_name AS operator_name,
                       u.department,
                       u.role AS operator_role
                   FROM projects p
                   LEFT JOIN users u ON {project_owner_expr} = u.id
                   WHERE {' AND '.join(where)}""",
                params,
            ).fetchone()
            if not project_row:
                return {}
            sub_columns = self._table_columns(conn, "sub_accounts")
            account_visibility_clauses, account_visibility_params = self._sub_account_visibility_filter(
                role_context,
                "date('now','localtime')",
            )
            account_where = ["sa.project_id = ?", *account_visibility_clauses]
            account_rows = conn.execute(
                f"""SELECT
                       sa.id AS sub_account_id,
                       sa.account_id,
                       sa.account_name,
                       sa.account_type,
                       {self._select_column(sub_columns, 'sa', 'industry')},
                       {self._select_column(sub_columns, 'sa', 'company_name')},
                       {self._select_column(sub_columns, 'sa', 'virtual_seller_id')},
                       {self._select_column(sub_columns, 'sa', 'media')},
                       {self._select_column(sub_columns, 'sa', 'external_account_id')},
                       {self._select_column(sub_columns, 'sa', 'created_at')}
                   FROM sub_accounts sa
                   JOIN projects p ON p.id = sa.project_id
                   WHERE {' AND '.join(account_where)}
                   ORDER BY sa.id
                   LIMIT ? OFFSET ?""",
                [project_id, *account_visibility_params, limit, offset],
            ).fetchall()
            task_summary: list[dict[str, Any]] = []
            if self._has_tables(conn, ("tasks",)):
                task_summary = [
                    dict(row)
                    for row in conn.execute(
                        """SELECT
                               COALESCE(status, '') AS status,
                               COALESCE(category, '') AS category,
                               COUNT(*) AS task_count,
                               SUM(COALESCE(note_count, 0)) AS note_count,
                               SUM(COALESCE(pending_count, 0)) AS pending_count
                           FROM tasks
                           WHERE project_id = ?
                           GROUP BY COALESCE(status, ''), COALESCE(category, '')
                           ORDER BY task_count DESC""",
                        (project_id,),
                    ).fetchall()
                ]
            knowledge: list[dict[str, Any]] = []
            if self._has_tables(conn, ("project_knowledge",)):
                knowledge = [
                    dict(row)
                    for row in conn.execute(
                        """SELECT id, source_type, source_name, source_url, file_path,
                                  markdown_path, wiki_root, schema_path, status, error,
                                  created_by, created_at, updated_at,
                                  substr(markdown_content, 1, 4000) AS markdown_content_preview
                           FROM project_knowledge
                           WHERE project_id = ?
                           ORDER BY id DESC
                           LIMIT 20""",
                        (project_id,),
                    ).fetchall()
                ]
        except sqlite3.Error as exc:
            raise CliError("internal_error", "cache query failed", 1) from exc
        finally:
            conn.close()

        report_summary = []
        note_detail = []
        if start_date and end_date:
            report_summary = self.report_summary_cache(start_date, end_date, project_id, None, limit, 0, role_context=role_context)
            note_detail = self.note_detail_cache(start_date, end_date, project_id, None, None, limit, 0, role_context=role_context)
        return {
            "project": dict(project_row),
            "accounts": [dict(row) for row in account_rows],
            "task_summary": task_summary,
            "report_summary": report_summary,
            "note_detail": note_detail,
            "knowledge": knowledge,
            "paging": {"limit": limit, "offset": offset},
        }

    def list_cache_accounts(
        self,
        limit: int,
        offset: int,
        project_id: int | None = None,
        account_id: str | None = None,
        search: str | None = None,
        role_context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        conn = self._read_only_db()
        try:
            if not self._has_tables(conn, ("projects", "users", "sub_accounts")):
                return []
            project_columns = self._table_columns(conn, "projects")
            sub_columns = self._table_columns(conn, "sub_accounts")
            where: list[str] = []
            params: list[Any] = []
            visibility_clauses, visibility_params = self._sub_account_visibility_filter(
                role_context,
                "date('now','localtime')",
            )
            where.extend(visibility_clauses)
            params.extend(visibility_params)
            if project_id is not None:
                where.append("p.id = ?")
                params.append(project_id)
            if account_id:
                account_terms = ["sa.account_id = ?"]
                params.append(account_id)
                if "external_account_id" in sub_columns:
                    account_terms.append("sa.external_account_id = ?")
                    params.append(account_id)
                if "virtual_seller_id" in sub_columns:
                    account_terms.append("sa.virtual_seller_id = ?")
                    params.append(account_id)
                where.append("(" + " OR ".join(account_terms) + ")")
            if search:
                like = f"%{search}%"
                search_terms = [
                    "p.project_name LIKE ?",
                    "u.real_name LIKE ?",
                    "sa.account_id LIKE ?",
                    "sa.account_name LIKE ?",
                ]
                params.extend([like, like, like, like])
                for column in ("advertiser_name", "sales_name", "group_name", "media", "platform"):
                    if column in project_columns:
                        search_terms.append(f"p.{column} LIKE ?")
                        params.append(like)
                for column in ("company_name", "virtual_seller_id", "external_account_id", "media"):
                    if column in sub_columns:
                        search_terms.append(f"sa.{column} LIKE ?")
                        params.append(like)
                where.append("(" + " OR ".join(search_terms) + ")")
            where_clause = "WHERE " + " AND ".join(where) if where else ""
            optional_exprs = [
                self._select_column(sub_columns, "sa", "company_name"),
                self._select_column(sub_columns, "sa", "virtual_seller_id"),
                self._select_column(sub_columns, "sa", "media"),
                self._select_column(sub_columns, "sa", "external_account_id"),
            ]
            account_owner_expr = self._sub_account_owner_expr()
            account_target_expr = self._sub_account_target_expr()
            params.extend([limit, offset])
            rows = conn.execute(
                f"""SELECT
                       sa.id AS sub_account_id,
                       sa.account_id,
                       sa.account_name,
                       sa.account_type,
                       {", ".join(optional_exprs)},
                       p.id AS project_id,
                       p.project_name,
                       p.platform,
                       {account_owner_expr} AS operator_id,
                       {account_target_expr} AS current_target_type,
                       u.real_name AS operator_name
                   FROM sub_accounts sa
                   JOIN projects p ON sa.project_id = p.id
                   LEFT JOIN users u ON {account_owner_expr} = u.id
                   {where_clause}
                   ORDER BY sa.id
                   LIMIT ? OFFSET ?""",
                params,
            ).fetchall()
            return [dict(row) for row in rows]
        except sqlite3.Error as exc:
            raise CliError("internal_error", "cache query failed", 1) from exc
        finally:
            conn.close()

    def list_cache_tasks(
        self,
        limit: int,
        offset: int,
        task_id: int | None = None,
        project_id: int | None = None,
        status: str | None = None,
        category: str | None = None,
        assignee: str | None = None,
        search: str | None = None,
        include_archived: bool = False,
        role_context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        conn = self._read_only_db()
        try:
            if not self._has_tables(conn, ("tasks", "projects", "users")):
                return []
            task_columns = self._table_columns(conn, "tasks")
            project_columns = self._table_columns(conn, "projects")
            where = []
            params: list[Any] = []
            if task_id is not None:
                where.append("t.id = ?")
                params.append(task_id)
            if project_id is not None:
                where.append("t.project_id = ?")
                params.append(project_id)
            if status:
                where.append("t.status = ?")
                params.append(status)
            if category and "category" in task_columns:
                where.append("t.category = ?")
                params.append(category)
            if assignee:
                where.append("a.real_name LIKE ?")
                params.append(f"%{assignee}%")
            if search:
                where.append("(t.title LIKE ? OR t.description LIKE ?)")
                params.extend([f"%{search}%", f"%{search}%"])
            if not include_archived and "is_archived" in task_columns:
                where.append("COALESCE(t.is_archived, 0) = 0")
            visibility_clauses, visibility_params = self._project_visibility_filter(project_columns, role_context, user_alias="op")
            where.extend(visibility_clauses)
            params.extend(visibility_params)
            where_clause = " AND ".join(where) if where else "1=1"
            params.extend([limit, offset])
            checklist_cte = (
                """checklist_counts AS (
                        SELECT task_id,
                               SUM(CASE WHEN done=1 THEN 1 ELSE 0 END) AS checklist_done,
                               COUNT(*) AS checklist_total
                        FROM task_checklists
                        GROUP BY task_id
                    )"""
                if self._has_tables(conn, ("task_checklists",))
                else """checklist_counts AS (
                        SELECT NULL AS task_id, 0 AS checklist_done, 0 AS checklist_total WHERE 0
                    )"""
            )
            note_cte = (
                """note_counts AS (
                        SELECT task_id,
                               COUNT(*) AS synced_note_count,
                               ROUND(SUM(COALESCE(cost, 0)), 2) AS note_cost,
                               SUM(COALESCE(impression, 0)) AS note_impression,
                               SUM(COALESCE(click, 0)) AS note_click,
                               SUM(COALESCE(message_consult, 0)) AS note_message_consult
                        FROM task_note_performance
                        GROUP BY task_id
                    )"""
                if self._has_tables(conn, ("task_note_performance",))
                else """note_counts AS (
                        SELECT NULL AS task_id, 0 AS synced_note_count, 0 AS note_cost,
                               0 AS note_impression, 0 AS note_click, 0 AS note_message_consult WHERE 0
                    )"""
            )
            rows = conn.execute(
                f"""WITH subtask_counts AS (
                        SELECT parent_id, COUNT(*) AS subtask_count
                        FROM tasks
                        WHERE parent_id IS NOT NULL
                        GROUP BY parent_id
                    ), {checklist_cte}, {note_cte}
                    SELECT t.id AS task_id,
                           t.title,
                           t.description,
                           t.project_id,
                           p.project_name,
                           t.creator_id,
                           c.real_name AS creator_name,
                           t.assignee_id,
                           a.real_name AS assignee_name,
                           t.type,
                           t.status,
                           t.priority,
                           t.start_date,
                           t.due_date,
                           t.estimated_hours,
                           t.actual_hours,
                           t.note_count,
                           {self._select_column(task_columns, 't', 'quantity', default='0')},
                           {self._select_column(task_columns, 't', 'pending_count', default='0')},
                           {self._select_column(task_columns, 't', 'category')},
                           {self._select_column(task_columns, 't', 'source')},
                           {self._select_column(task_columns, 't', 'remark')},
                           {self._select_column(task_columns, 't', 'doc_links')},
                           {self._select_column(task_columns, 't', 'is_archived', default='0')},
                           {self._select_column(task_columns, 't', 'archived_at', default='NULL')},
                           {self._select_column(task_columns, 't', 'parent_id', default='NULL')},
                           {self._select_column(task_columns, 't', 'note_id')},
                           {self._select_column(task_columns, 't', 'note_url')},
                           {self._select_column(task_columns, 't', 'created_at')},
                           {self._select_column(task_columns, 't', 'updated_at')},
                           COALESCE(sc.subtask_count, 0) AS subtask_count,
                           COALESCE(cc.checklist_done, 0) AS checklist_done,
                           COALESCE(cc.checklist_total, 0) AS checklist_total,
                           COALESCE(nc.synced_note_count, 0) AS synced_note_count,
                           COALESCE(nc.note_cost, 0) AS note_cost,
                           COALESCE(nc.note_impression, 0) AS note_impression,
                           COALESCE(nc.note_click, 0) AS note_click,
                           COALESCE(nc.note_message_consult, 0) AS note_message_consult
                    FROM tasks t
                    LEFT JOIN projects p ON t.project_id = p.id
                    LEFT JOIN users op ON p.operator_id = op.id
                    LEFT JOIN users c ON t.creator_id = c.id
                    LEFT JOIN users a ON t.assignee_id = a.id
                    LEFT JOIN subtask_counts sc ON sc.parent_id = t.id
                    LEFT JOIN checklist_counts cc ON cc.task_id = t.id
                    LEFT JOIN note_counts nc ON nc.task_id = t.id
                    WHERE {where_clause}
                    ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
                             t.due_date ASC,
                             CASE t.priority WHEN '高' THEN 1 WHEN '中' THEN 2 ELSE 3 END,
                             t.created_at DESC
                    LIMIT ? OFFSET ?""",
                params,
            ).fetchall()
            result_rows = [dict(row) for row in rows]
            if result_rows and search and self._has_tables(conn, ("sub_accounts",)):
                sub_columns = self._table_columns(conn, "sub_accounts")
                for row in result_rows:
                    include_all_project_accounts = self._project_context_matches(row, search)
                    matched_accounts, matched_accounts_total = self._matched_accounts_for_project(
                        conn,
                        row.get("project_id"),
                        sub_columns,
                        search,
                        None,
                        include_all_project_accounts=include_all_project_accounts,
                    )
                    row["matched_account_count"] = matched_accounts_total
                    row["matched_accounts_total"] = matched_accounts_total
                    row["matched_accounts_returned"] = len(matched_accounts)
                    row["matched_accounts_limit"] = 50
                    row["matched_accounts_has_more"] = matched_accounts_total > len(matched_accounts)
                    row["matched_accounts"] = matched_accounts
                    row["match_scope"] = "project_and_accounts" if include_all_project_accounts else "accounts"
            return result_rows
        except sqlite3.Error as exc:
            raise CliError("internal_error", "cache query failed", 1) from exc
        finally:
            conn.close()

    def task_detail_cache(self, task_id: int, limit: int, offset: int, role_context: dict[str, Any] | None = None) -> dict[str, Any]:
        conn = self._read_only_db()
        try:
            if not self._has_tables(conn, ("tasks", "projects", "users")):
                return {}
            task_rows = self.list_cache_tasks(limit=1, offset=0, task_id=task_id, include_archived=True, role_context=role_context)
            task = task_rows[0] if task_rows else None
            if not task:
                return {}
            checklist = []
            if self._has_tables(conn, ("task_checklists",)):
                checklist = [
                    dict(row)
                    for row in conn.execute(
                        "SELECT id, task_id, title, done, sort_order, created_at FROM task_checklists WHERE task_id=? ORDER BY sort_order, id",
                        (task_id,),
                    ).fetchall()
                ]
            collaborators = []
            if self._has_tables(conn, ("task_collaborators", "users")):
                collaborators = [
                    dict(row)
                    for row in conn.execute(
                        """SELECT tc.id, tc.task_id, tc.user_id, u.real_name, tc.role, tc.created_at
                           FROM task_collaborators tc
                           LEFT JOIN users u ON tc.user_id = u.id
                           WHERE tc.task_id=?
                           ORDER BY tc.id""",
                        (task_id,),
                    ).fetchall()
                ]
            relations = []
            if self._has_tables(conn, ("task_relations",)):
                relations = [
                    dict(row)
                    for row in conn.execute(
                        """SELECT id, task_id_a, task_id_b, relation_type, created_at
                           FROM task_relations
                           WHERE task_id_a=? OR task_id_b=?
                           ORDER BY id""",
                        (task_id, task_id),
                    ).fetchall()
                ]
            activity = []
            if self._has_tables(conn, ("task_activity_log", "users")):
                activity = [
                    dict(row)
                    for row in conn.execute(
                        """SELECT tal.id, tal.task_id, tal.user_id, u.real_name, tal.action,
                                  tal.old_value, tal.new_value, tal.created_at
                           FROM task_activity_log tal
                           LEFT JOIN users u ON tal.user_id = u.id
                           WHERE tal.task_id=?
                           ORDER BY tal.id DESC
                           LIMIT ? OFFSET ?""",
                        (task_id, limit, offset),
                    ).fetchall()
                ]
            note_performance = []
            if self._has_tables(conn, ("task_note_performance",)):
                note_performance = [
                    dict(row)
                    for row in conn.execute(
                        """SELECT id, task_id, note_id, note_title, note_image, note_jump_url,
                                  impression, interaction, cost, ctr, message_consult, click,
                                  sync_status, sync_message, fetched_at
                           FROM task_note_performance
                           WHERE task_id=?
                           ORDER BY cost DESC, id
                           LIMIT ? OFFSET ?""",
                        (task_id, limit, offset),
                    ).fetchall()
                ]
            return {
                "task": task,
                "checklist": checklist,
                "collaborators": collaborators,
                "relations": relations,
                "activity": activity,
                "note_performance": note_performance,
                "paging": {"limit": limit, "offset": offset},
            }
        except sqlite3.Error as exc:
            raise CliError("internal_error", "cache query failed", 1) from exc
        finally:
            conn.close()

    def list_cache_users(
        self,
        limit: int,
        offset: int,
        user_role: str | None = None,
        department: str | None = None,
        status: str | None = None,
        include_resigned: bool = False,
        search: str | None = None,
    ) -> list[dict[str, Any]]:
        conn = self._read_only_db()
        try:
            if not self._has_tables(conn, ("users",)):
                return []
            user_columns = self._table_columns(conn, "users")
            where = []
            params: list[Any] = []
            if user_role:
                where.append("u.role = ?")
                params.append(user_role)
            if department:
                if "department" not in user_columns:
                    return []
                where.append("u.department = ?")
                params.append(department)
            if status:
                if "status" not in user_columns:
                    return []
                where.append("u.status = ?")
                params.append(status)
            elif not include_resigned and "status" in user_columns:
                where.append("COALESCE(u.status, 'active') != 'resigned'")
            if search:
                search_columns = ["u.username"]
                if "real_name" in user_columns:
                    search_columns.append("u.real_name")
                if "department" in user_columns:
                    search_columns.append("u.department")
                where.append("(" + " OR ".join(f"{column} LIKE ?" for column in search_columns) + ")")
                params.extend([f"%{search}%"] * len(search_columns))
            where_clause = " AND ".join(where) if where else "1=1"
            creator_join = "LEFT JOIN users cu ON u.created_by = cu.id" if "created_by" in user_columns else "LEFT JOIN users cu ON 0"
            creator_name_expr = "cu.real_name" if "real_name" in user_columns else "''"
            params.extend([limit, offset])
            rows = conn.execute(
                f"""SELECT
                       u.id AS user_id,
                       u.username,
                       u.role,
                       {self._select_column(user_columns, 'u', 'real_name')},
                       {self._select_column(user_columns, 'u', 'department')},
                       {self._select_column(user_columns, 'u', 'status', default="'active'")},
                       {self._select_column(user_columns, 'u', 'resigned_at', default='NULL')},
                       {self._select_column(user_columns, 'u', 'created_by', default='NULL')},
                       {creator_name_expr} AS creator_name,
                       {self._select_column(user_columns, 'u', 'created_at')}
                   FROM users u
                   {creator_join}
                   WHERE {where_clause}
                   ORDER BY u.id
                   LIMIT ? OFFSET ?""",
                params,
            ).fetchall()
            return [dict(row) for row in rows]
        except sqlite3.Error as exc:
            raise CliError("internal_error", "cache query failed", 1) from exc
        finally:
            conn.close()

    def sync_state_cache(self) -> dict[str, Any]:
        conn = self._read_only_db()
        try:
            tables: dict[str, Any] = {}
            for table in SYNC_TABLES:
                if not self._table_exists(conn, table):
                    tables[table] = {"exists": False, "row_count": 0}
                    continue
                columns = self._table_columns(conn, table)
                tables[table] = self._sync_table_state(conn, table, columns)
            return {
                "generated_at": _now_iso_with_timezone(),
                "tables": tables,
                "delete_detection": "compare row_count/fingerprint between sync state calls; sync changes lists timestamped inserts and updates",
            }
        except sqlite3.Error as exc:
            raise CliError("internal_error", "cache query failed", 1) from exc
        finally:
            conn.close()

    def sync_changes_cache(
        self,
        since: str,
        limit: int,
        offset: int,
        tables: Sequence[str] | None = None,
    ) -> dict[str, Any]:
        conn = self._read_only_db()
        try:
            table_changes: dict[str, Any] = {}
            total_returned = 0
            target_tables = tuple(tables or SYNC_TABLES)
            for table in target_tables:
                if not self._table_exists(conn, table):
                    table_changes[table] = {"exists": False, "rows": []}
                    continue
                column_names = self._table_column_names(conn, table)
                columns = set(column_names)
                timestamp_columns = [column for column in SYNC_TIMESTAMP_COLUMNS if column in columns]
                if not timestamp_columns:
                    table_changes[table] = {"exists": True, "rows": [], "skipped_reason": "no timestamp column"}
                    continue
                safe_columns = self._safe_sync_columns(column_names)
                select_exprs = [column for column in safe_columns]
                if "markdown_content" in columns:
                    select_exprs.append("substr(markdown_content, 1, 1000) AS markdown_content_preview")
                if not select_exprs:
                    select_exprs.append("rowid AS rowid")
                changed_at_expr = self._sync_changed_at_expr(columns)
                where_clause = " OR ".join(f"COALESCE(datetime({column}), {column}, '') >= ?" for column in timestamp_columns)
                params: list[Any] = [since] * len(timestamp_columns)
                params.extend([limit, offset])
                rows = conn.execute(
                    f"""SELECT {", ".join(select_exprs)}, {changed_at_expr} AS changed_at
                       FROM {table}
                       WHERE {where_clause}
                       ORDER BY changed_at DESC, rowid DESC
                       LIMIT ? OFFSET ?""",
                    params,
                ).fetchall()
                result_rows = [dict(row) for row in rows]
                total_returned += len(result_rows)
                table_changes[table] = {
                    "exists": True,
                    "timestamp_columns": timestamp_columns,
                    "rows": result_rows,
                }
            return {
                "since": since,
                "tables_requested": list(target_tables),
                "limit_per_table": limit,
                "offset_per_table": offset,
                "total_returned": total_returned,
                "tables": table_changes,
                "delete_detection": "physical deletes are visible through sync state row_count/fingerprint changes",
            }
        except sqlite3.Error as exc:
            raise CliError("internal_error", "cache query failed", 1) from exc
        finally:
            conn.close()

    def report_summary_cache(
        self,
        start_date: str,
        end_date: str,
        project_id: int | None,
        operator: str | None,
        limit: int,
        offset: int,
        account_id: str | None = None,
        role_context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        where = ["dc.date >= ?", "dc.date <= ?"]
        params: list[Any] = [start_date, end_date]
        if project_id is not None:
            where.append("p.id = ?")
            params.append(project_id)
        if operator:
            where.append("u.real_name LIKE ?")
            params.append(f"%{operator}%")
        conn = self._read_only_db()
        try:
            if not self._has_tables(conn, ("daily_consumption", "sub_accounts", "projects", "users")):
                return []
            project_columns = self._table_columns(conn, "projects")
            dc_columns = self._table_columns(conn, "daily_consumption")
            sub_columns = self._table_columns(conn, "sub_accounts")
            visibility_clauses, visibility_params = self._sub_account_visibility_filter(
                role_context,
                "dc.date",
            )
            where.extend(visibility_clauses)
            params.extend(visibility_params)
            if account_id:
                account_terms = ["sa.account_id = ?"]
                params.append(account_id)
                if "external_account_id" in sub_columns:
                    account_terms.append("sa.external_account_id = ?")
                    params.append(account_id)
                if "virtual_seller_id" in sub_columns:
                    account_terms.append("sa.virtual_seller_id = ?")
                    params.append(account_id)
                where.append("(" + " OR ".join(account_terms) + ")")
            params.extend([limit, offset])
            has_users = self._has_tables(conn, ("users",))
            if operator and not has_users:
                return []
            report_owner_expr = self._sub_account_owner_expr("dc.date")
            user_join = (
                f"LEFT JOIN users u ON {report_owner_expr} = u.id"
                if has_users else "LEFT JOIN (SELECT NULL AS id, NULL AS real_name) u ON 0"
            )
            cost_expr = (
                "SUM(COALESCE(dc.cost_total, 0))"
                if "cost_total" in dc_columns
                else "SUM(COALESCE(dc.cost_simple, 0) + COALESCE(dc.cost_standard, 0) + COALESCE(dc.cost_square, 0))"
            )
            rows = conn.execute(
                f"""SELECT
                       dc.date AS report_date,
                       p.id AS project_id,
                       p.project_name,
                       COUNT(DISTINCT sa.id) AS account_count,
                       ROUND({cost_expr}, 2) AS cost,
                       ROUND({self._sum_column(dc_columns, 'dc', 'cost_simple')}, 2) AS cost_simple,
                       ROUND({self._sum_column(dc_columns, 'dc', 'cost_standard')}, 2) AS cost_standard,
                       ROUND({self._sum_column(dc_columns, 'dc', 'cost_square')}, 2) AS cost_square,
                       {self._sum_column(dc_columns, 'dc', 'impression')} AS impression,
                       {self._sum_column(dc_columns, 'dc', 'click')} AS click,
                       {self._sum_column(dc_columns, 'dc', 'interaction')} AS interaction,
                       {self._sum_column(dc_columns, 'dc', 'leads')} AS leads,
                       {self._sum_column(dc_columns, 'dc', 'message_consult')} AS message_consult,
                       {self._sum_column(dc_columns, 'dc', 'valid_leads')} AS valid_leads,
                       'daily_consumption' AS source_table,
                       'daily_consumption.date' AS date_basis
                   FROM daily_consumption dc
                   JOIN sub_accounts sa ON dc.sub_account_id = sa.id
                   JOIN projects p ON sa.project_id = p.id
                   {user_join}
                   WHERE {' AND '.join(where)}
                   GROUP BY dc.date, p.id
                   ORDER BY dc.date DESC, p.id
                   LIMIT ? OFFSET ?""",
                params,
            ).fetchall()
            return [dict(row) for row in rows]
        except sqlite3.Error as exc:
            raise CliError("internal_error", "cache query failed", 1) from exc
        finally:
            conn.close()

    def _task_note_summary_legacy_cache(
        self,
        conn: sqlite3.Connection,
        task_id: int,
        start_date: str,
        end_date: str,
        project_id: int | None,
        operator: str | None,
        limit: int,
        offset: int,
        role_context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        if not self._has_tables(conn, ("tasks", "task_note_performance")):
            return []
        has_projects = self._has_tables(conn, ("projects",))
        has_users = self._has_tables(conn, ("users",))
        if project_id is not None and not has_projects:
            return []
        if operator and not has_users:
            return []
        project_columns = self._table_columns(conn, "projects") if has_projects else set()
        tnp_columns = self._table_columns(conn, "task_note_performance")
        project_join = (
            "LEFT JOIN projects p ON t.project_id = p.id"
            if has_projects else "LEFT JOIN (SELECT NULL AS id, NULL AS project_name) p ON 0"
        )
        operator_project_join = (
            "LEFT JOIN users op ON p.operator_id = op.id"
            if has_projects else "LEFT JOIN (SELECT NULL AS id, NULL AS department) op ON 0"
        )
        user_join = (
            "LEFT JOIN users u ON t.assignee_id = u.id"
            if has_users else "LEFT JOIN (SELECT NULL AS id, NULL AS real_name) u ON 0"
        )
        where = ["t.id = ?"]
        params: list[Any] = [start_date, end_date, task_id]
        if project_id is not None:
            where.append("p.id = ?")
            params.append(project_id)
        if operator:
            where.append("u.real_name LIKE ?")
            params.append(f"%{operator}%")
        if has_projects:
            visibility_clauses, visibility_params = self._project_visibility_filter(project_columns, role_context, user_alias="op")
            where.extend(visibility_clauses)
            params.extend(visibility_params)
        params.extend([limit, offset])
        fetched_expr = "MAX(tnp.fetched_at)" if "fetched_at" in tnp_columns else "NULL"
        rows = conn.execute(
            f"""SELECT
                   t.id AS task_id,
                   COUNT(DISTINCT tnp.note_id) AS note_count,
                   ROUND(SUM(COALESCE(tnp.cost, 0)), 2) AS cost,
                   {self._sum_column(tnp_columns, 'tnp', 'impression')} AS impression,
                   {self._sum_column(tnp_columns, 'tnp', 'click')} AS click,
                   {self._sum_column(tnp_columns, 'tnp', 'interaction')} AS interaction,
                   {self._sum_column(tnp_columns, 'tnp', 'message_consult')} AS message_consult,
                   NULL AS report_start_date,
                   NULL AS report_end_date,
                   {fetched_expr} AS max_fetched_at,
                   ? AS requested_start_date,
                   ? AS requested_end_date,
                   'legacy_snapshot_no_report_date' AS date_basis,
                   'task_note_performance' AS source_table
               FROM task_note_performance tnp
               JOIN tasks t ON tnp.task_id = t.id
               {project_join}
               {operator_project_join}
               {user_join}
               WHERE {' AND '.join(where)}
               GROUP BY t.id
               LIMIT ? OFFSET ?""",
            params,
        ).fetchall()
        return [dict(row) for row in rows]

    def task_note_summary_cache(
        self,
        task_id: int,
        start_date: str,
        end_date: str,
        project_id: int | None,
        operator: str | None,
        limit: int,
        offset: int,
        role_context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        where = ["t.id = ?", "npd.report_date >= ?", "npd.report_date <= ?"]
        params: list[Any] = [task_id, start_date, end_date]
        if project_id is not None:
            where.append("p.id = ?")
            params.append(project_id)
        if operator:
            where.append("u.real_name LIKE ?")
            params.append(f"%{operator}%")
        conn = self._read_only_db()
        try:
            if not self._has_tables(conn, ("tasks", "task_note_performance_daily")):
                return self._task_note_summary_legacy_cache(conn, task_id, start_date, end_date, project_id, operator, limit, offset, role_context)
            has_projects = self._has_tables(conn, ("projects",))
            has_users = self._has_tables(conn, ("users",))
            if project_id is not None and not has_projects:
                return []
            if operator and not has_users:
                return []
            if has_projects:
                project_columns = self._table_columns(conn, "projects")
                visibility_clauses, visibility_params = self._project_visibility_filter(project_columns, role_context, user_alias="op")
                where.extend(visibility_clauses)
                params.extend(visibility_params)
            params.extend([limit, offset])
            project_join = (
                "LEFT JOIN projects p ON t.project_id = p.id"
                if has_projects else "LEFT JOIN (SELECT NULL AS id, NULL AS project_name) p ON 0"
            )
            operator_project_join = (
                "LEFT JOIN users op ON p.operator_id = op.id"
                if has_projects else "LEFT JOIN (SELECT NULL AS id, NULL AS department) op ON 0"
            )
            user_join = (
                "LEFT JOIN users u ON t.assignee_id = u.id"
                if has_users else "LEFT JOIN (SELECT NULL AS id, NULL AS real_name) u ON 0"
            )
            rows = conn.execute(
                f"""SELECT
                       t.id AS task_id,
                       COUNT(DISTINCT npd.note_id) AS note_count,
                       ROUND(SUM(COALESCE(npd.cost, 0)), 2) AS cost,
                       SUM(COALESCE(npd.impression, 0)) AS impression,
                       SUM(COALESCE(npd.click, 0)) AS click,
                       SUM(COALESCE(npd.interaction, 0)) AS interaction,
                       SUM(COALESCE(npd.message_consult, 0)) AS message_consult,
                       MIN(npd.report_date) AS report_start_date,
                       MAX(npd.report_date) AS report_end_date,
                       MAX(npd.fetched_at) AS max_fetched_at,
                       'task_note_performance_daily.report_date' AS date_basis,
                       'task_note_performance_daily' AS source_table
                   FROM task_note_performance_daily npd
                   JOIN tasks t ON npd.task_id = t.id
                   {project_join}
                   {operator_project_join}
                   {user_join}
                   WHERE {' AND '.join(where)}
                   GROUP BY t.id
                   LIMIT ? OFFSET ?""",
                params,
            ).fetchall()
            result_rows = [dict(row) for row in rows]
            if not result_rows:
                return self._task_note_summary_legacy_cache(conn, task_id, start_date, end_date, project_id, operator, limit, offset, role_context)
            return result_rows
        except sqlite3.Error as exc:
            raise CliError("internal_error", "cache query failed", 1) from exc
        finally:
            conn.close()

    def _note_detail_legacy_cache(
        self,
        conn: sqlite3.Connection,
        start_date: str,
        end_date: str,
        project_id: int | None,
        task_id: int | None,
        operator: str | None,
        limit: int,
        offset: int,
        role_context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        if not self._has_tables(conn, ("tasks", "task_note_performance")):
            return []
        has_projects = self._has_tables(conn, ("projects",))
        has_users = self._has_tables(conn, ("users",))
        if project_id is not None and not has_projects:
            return []
        if operator and not has_users:
            return []
        project_columns = self._table_columns(conn, "projects") if has_projects else set()
        tnp_columns = self._table_columns(conn, "task_note_performance")
        project_join = (
            "LEFT JOIN projects p ON t.project_id = p.id"
            if has_projects else "LEFT JOIN (SELECT NULL AS id, NULL AS project_name) p ON 0"
        )
        operator_project_join = (
            "LEFT JOIN users op ON p.operator_id = op.id"
            if has_projects else "LEFT JOIN (SELECT NULL AS id, NULL AS department) op ON 0"
        )
        user_join = (
            "LEFT JOIN users u ON t.assignee_id = u.id"
            if has_users else "LEFT JOIN (SELECT NULL AS id, NULL AS real_name) u ON 0"
        )
        where: list[str] = []
        params: list[Any] = [start_date, end_date]
        if project_id is not None:
            where.append("p.id = ?")
            params.append(project_id)
        if task_id is not None:
            where.append("t.id = ?")
            params.append(task_id)
        if operator:
            where.append("u.real_name LIKE ?")
            params.append(f"%{operator}%")
        if has_projects:
            visibility_clauses, visibility_params = self._project_visibility_filter(project_columns, role_context, user_alias="op")
            where.extend(visibility_clauses)
            params.extend(visibility_params)
        where_clause = " AND ".join(where) if where else "1=1"
        params.extend([limit, offset])
        fetched_expr = "MAX(tnp.fetched_at)" if "fetched_at" in tnp_columns else "NULL"
        rows = conn.execute(
            f"""SELECT
                   MIN(tnp.id) AS id,
                   tnp.task_id,
                   t.title AS task_title,
                   lower(tnp.note_id) AS note_id,
                   MAX(COALESCE(tnp.note_title, '')) AS note_title,
                   {self._sum_column(tnp_columns, 'tnp', 'impression')} AS impression,
                   {self._sum_column(tnp_columns, 'tnp', 'interaction')} AS interaction,
                   ROUND(SUM(COALESCE(tnp.cost, 0)), 2) AS cost,
                   CASE WHEN {self._sum_column(tnp_columns, 'tnp', 'impression')} > 0
                        THEN ROUND({self._sum_column(tnp_columns, 'tnp', 'click')} * 1.0 / {self._sum_column(tnp_columns, 'tnp', 'impression')}, 6)
                        ELSE 0 END AS ctr,
                   {self._sum_column(tnp_columns, 'tnp', 'message_consult')} AS message_consult,
                   {self._sum_column(tnp_columns, 'tnp', 'click')} AS click,
                   {fetched_expr} AS fetched_at,
                   NULL AS report_start_date,
                   NULL AS report_end_date,
                   ? AS requested_start_date,
                   ? AS requested_end_date,
                   'legacy_snapshot_no_report_date' AS date_basis,
                   'task_note_performance' AS source_table,
                   t.assignee_id,
                   u.real_name AS operator_name,
                   p.id AS project_id,
                   p.project_name
               FROM task_note_performance tnp
               JOIN tasks t ON tnp.task_id = t.id
               {user_join}
               {project_join}
               {operator_project_join}
               WHERE {where_clause}
               GROUP BY tnp.task_id, lower(tnp.note_id)
               ORDER BY cost DESC, id
               LIMIT ? OFFSET ?""",
            params,
        ).fetchall()
        return [dict(row) for row in rows]

    def note_detail_cache(
        self,
        start_date: str,
        end_date: str,
        project_id: int | None,
        task_id: int | None,
        operator: str | None,
        limit: int,
        offset: int,
        role_context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        daily_where = ["npd.report_date >= ?", "npd.report_date <= ?"]
        params: list[Any] = [start_date, end_date]
        if project_id is not None:
            daily_where.append("p.id = ?")
            params.append(project_id)
        if task_id is not None:
            daily_where.append("t.id = ?")
            params.append(task_id)
        if operator:
            daily_where.append("u.real_name LIKE ?")
            params.append(f"%{operator}%")
        conn = self._read_only_db()
        try:
            if not self._has_tables(conn, ("tasks", "task_note_performance_daily")):
                return self._note_detail_legacy_cache(conn, start_date, end_date, project_id, task_id, operator, limit, offset, role_context)
            has_projects = self._has_tables(conn, ("projects",))
            has_users = self._has_tables(conn, ("users",))
            if project_id is not None and not has_projects:
                return []
            if operator and not has_users:
                return []
            if has_projects:
                project_columns = self._table_columns(conn, "projects")
                visibility_clauses, visibility_params = self._project_visibility_filter(project_columns, role_context, user_alias="op")
                daily_where.extend(visibility_clauses)
                params.extend(visibility_params)
            params.extend([limit, offset])
            project_join = (
                "LEFT JOIN projects p ON t.project_id = p.id"
                if has_projects else "LEFT JOIN (SELECT NULL AS id, NULL AS project_name) p ON 0"
            )
            operator_project_join = (
                "LEFT JOIN users op ON p.operator_id = op.id"
                if has_projects else "LEFT JOIN (SELECT NULL AS id, NULL AS department) op ON 0"
            )
            user_join = (
                "LEFT JOIN users u ON t.assignee_id = u.id"
                if has_users else "LEFT JOIN (SELECT NULL AS id, NULL AS real_name) u ON 0"
            )
            rows = conn.execute(
                f"""SELECT
                       MIN(npd.id) AS id,
                       npd.task_id,
                       t.title AS task_title,
                       npd.note_id,
                       MAX(COALESCE(npd.note_title, '')) AS note_title,
                       SUM(COALESCE(npd.impression, 0)) AS impression,
                       SUM(COALESCE(npd.interaction, 0)) AS interaction,
                       ROUND(SUM(COALESCE(npd.cost, 0)), 2) AS cost,
                       CASE WHEN SUM(COALESCE(npd.impression, 0)) > 0
                            THEN ROUND(SUM(COALESCE(npd.click, 0)) * 1.0 / SUM(COALESCE(npd.impression, 0)), 6)
                            ELSE 0 END AS ctr,
                       SUM(COALESCE(npd.message_consult, 0)) AS message_consult,
                       SUM(COALESCE(npd.click, 0)) AS click,
                       MAX(npd.fetched_at) AS fetched_at,
                       MIN(npd.report_date) AS report_start_date,
                       MAX(npd.report_date) AS report_end_date,
                       'task_note_performance_daily.report_date' AS date_basis,
                       'task_note_performance_daily' AS source_table,
                       t.assignee_id,
                       u.real_name AS operator_name,
                       p.id AS project_id,
                       p.project_name
                   FROM task_note_performance_daily npd
                   JOIN tasks t ON npd.task_id = t.id
                   {user_join}
                   {project_join}
                   {operator_project_join}
                   WHERE {' AND '.join(daily_where)}
                   GROUP BY npd.task_id, lower(npd.note_id)
                   ORDER BY cost DESC, id
                   LIMIT ? OFFSET ?""",
                params,
            ).fetchall()
            result_rows = [dict(row) for row in rows]
            if not result_rows:
                return self._note_detail_legacy_cache(conn, start_date, end_date, project_id, task_id, operator, limit, offset, role_context)
            return result_rows
        except sqlite3.Error as exc:
            raise CliError("internal_error", "cache query failed", 1) from exc
        finally:
            conn.close()


def run_schema(_args: argparse.Namespace) -> dict[str, Any]:
    return success_envelope(schema_data())


def run_auth_status(args: argparse.Namespace) -> dict[str, Any]:
    meta = {
        "source": "auth",
        "platform": args.platform,
        "role": args.role,
        "threshold_seconds": args.threshold_seconds,
    }
    if args.platform != "xhs":
        raise CliError("invalid_argument", "auth status currently supports --platform xhs only", 2, meta)
    rows = MpiReadOnlyAdapter().auth_status_xhs(args.threshold_seconds)
    return success_envelope(rows, meta)


def run_auth_refresh(args: argparse.Namespace) -> dict[str, Any]:
    meta = {
        "source": "auth",
        "platform": args.platform,
        "role": args.role,
        "threshold_seconds": args.threshold_seconds,
        "force": bool(args.force),
    }
    if args.platform != "xhs":
        raise CliError("invalid_argument", "auth refresh currently supports --platform xhs only", 2, meta)
    if args.app_id:
        meta["app_id"] = args.app_id
    if args.all:
        meta["all"] = True
    rows = MpiReadOnlyAdapter().auth_refresh_xhs(
        all_ports=bool(args.all),
        app_id=args.app_id,
        threshold_seconds=args.threshold_seconds,
        force=bool(args.force),
    )
    return success_envelope(rows, meta)


def list_meta(args: argparse.Namespace) -> dict[str, Any]:
    context = auth_context(args)
    meta = {
        "source": args.source,
        "role": args.role,
        "auth_role": context["role"],
        "limit": args.limit,
        "offset": args.offset,
        "source_of_truth": "mpi" if getattr(args, "source", None) == "mpi" else "cache_snapshot",
    }
    if getattr(args, "source", None) == "mpi":
        platform = getattr(args, "platform", DEFAULT_MPI_PLATFORM)
        meta["platform"] = platform
        if platform == "xhs":
            meta["xhs_channel"] = getattr(args, "xhs_channel", DEFAULT_XHS_CHANNEL)
    return meta


def cache_meta(args: argparse.Namespace) -> dict[str, Any]:
    context = auth_context(args)
    meta: dict[str, Any] = {
        "source": "cache",
        "role": args.role,
        "auth_role": context["role"],
        "source_of_truth": "cache_snapshot",
    }
    if hasattr(args, "limit"):
        meta["limit"] = args.limit
    if hasattr(args, "offset"):
        meta["offset"] = args.offset
    return meta


def mark_cache_fallback(meta: dict[str, Any], reason: str, error: CliError | None = None) -> None:
    meta["requested_source"] = meta.get("source", "mpi")
    meta["effective_source"] = "cache"
    meta["source"] = "mpi"
    meta["source_of_truth"] = "mpi"
    meta["cache_is_authoritative"] = False
    meta["fallback_source"] = "cache"
    meta["fallback_reason"] = reason
    if error is not None:
        meta["fallback_error_code"] = error.code
        meta["fallback_error_message"] = safe_message(error.message)


def raise_offline_report_unavailable(meta: dict[str, Any], reason: str, error: CliError | None = None) -> None:
    meta["effective_source"] = "none"
    meta["source_of_truth"] = "mpi"
    meta["cache_is_authoritative"] = False
    meta["offline_report_required"] = True
    meta["offline_report_status"] = "unavailable"
    meta["fallback_source"] = "cache"
    meta["fallback_status"] = "empty"
    meta["fallback_data_len"] = 0
    meta["fallback_reason"] = reason
    meta["offline_failure_reason"] = reason
    if error is not None:
        meta["offline_error_code"] = error.code
        meta["offline_error_message"] = safe_message(error.message)
    raise CliError(
        "offline_report_unavailable",
        "MPI offline report returned no usable spend rows and the cache fallback is empty; realtime data was not used.",
        1,
        meta,
    )


def require_full_account_pull(args: argparse.Namespace, platform: str, meta: dict[str, Any], action: str) -> None:
    context = auth_context(args)
    media_scope = tuple(context.get("media_scope") or ())
    meta["full_account_pull"] = True
    meta["full_account_policy"] = "admin_supervisor_only"
    meta["media_scope"] = list(media_scope)
    if not context.get("full_account_pull_allowed"):
        raise CliError(
            "permission_denied",
            f"{action} requires admin or supervisor role in Tongxin auth context",
            1,
            meta,
        )
    if platform not in media_scope:
        raise CliError(
            "permission_denied",
            f"{action} is outside the authenticated media scope",
            1,
            meta,
        )


def ensure_mpi_account_read_allowed(
    args: argparse.Namespace,
    platform: str,
    account_ids: Sequence[str],
    meta: dict[str, Any],
    action: str,
) -> None:
    context = auth_context(args)
    media_scope = tuple(context.get("media_scope") or ())
    if context.get("full_account_pull_allowed"):
        if platform not in media_scope:
            raise CliError("permission_denied", f"{action} is outside the authenticated media scope", 1, meta)
        meta["account_read_policy"] = "full_account_role"
        return
    service = XinAgentReadService()
    missing: list[str] = []
    for account_id in account_ids:
        rows = service.list_cache_accounts(
            limit=1,
            offset=0,
            account_id=account_id,
            role_context=context,
        )
        if not rows:
            missing.append(str(account_id))
    meta.update(service.cache_status_meta())
    if missing:
        meta["account_read_policy"] = "visible_cache_accounts_only"
        meta["denied_account_ids"] = missing[:20]
        raise CliError(
            "permission_denied",
            f"{action} requires the account to be visible in Tongxin or an admin/supervisor full-account role",
            1,
            meta,
        )
    meta["account_read_policy"] = "visible_cache_accounts_only"


def role_visibility_meta(args: argparse.Namespace) -> dict[str, Any]:
    context = auth_context(args)
    return {
        "visibility_role": context["role"],
        "visibility_user_id": context["user_id"] or None,
        "visibility_department": context["department"] or None,
        "media_scope": list(context["media_scope"]),
        "full_account_pull_allowed": bool(context["full_account_pull_allowed"]),
    }


def is_interface_permission_denied(error: CliError) -> bool:
    if error.code != "permission_denied":
        return False
    message = safe_message(error.message)
    return any(
        marker in message
        for marker in (
            "XHS",
            "接口权限",
            "没有该接口权限",
            "没有该账号权限",
            "不在代理商管辖范围",
            "cli interface permission",
        )
    )


def summarize_report_rows(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    total_cost = 0.0
    for row in rows:
        try:
            total_cost += float(row.get("cost") or row.get("cost_total") or 0)
        except (TypeError, ValueError):
            continue
    return {
        "data_len": len(rows),
        "cost": round(total_cost, 2),
    }


def fetch_mpi_report_summary_with_cache_fallback(
    adapter: MpiReadOnlyAdapter,
    _service: XinAgentReadService,
    args: argparse.Namespace,
    account_id: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    account_args = argparse.Namespace(**vars(args))
    account_args.account_id = account_id
    status: dict[str, Any] = {
        "account_id": account_id,
        "status": "pending",
        "source": "mpi",
        "effective_source": "mpi",
        "source_of_truth": "mpi",
        "fallback_source": "none",
        "fallback_status": "disabled_non_authoritative",
        "data_len": 0,
        "cost": 0.0,
    }
    try:
        data = adapter.report_summary(account_args)
        if data:
            status.update({"status": "ok", "source": "mpi"})
            status.update(summarize_report_rows(data))
            return data, status
        status.update({
            "status": "unavailable",
            "source": "none",
            "effective_source": "none",
            "fallback_status": "disabled_non_authoritative",
            "reason": "mpi_offline_empty",
        })
        return [], status
    except CliError as exc:
        if not is_interface_permission_denied(exc):
            raise
        status.update({
            "status": "unavailable",
            "source": "none",
            "effective_source": "none",
            "fallback_status": "disabled_non_authoritative",
            "reason": "mpi_permission_denied",
            "error_code": exc.code,
            "error_message": safe_message(exc.message),
        })
        return [], status


def annotate_report_batch_meta(meta: dict[str, Any], account_statuses: Sequence[dict[str, Any]], rows: Sequence[dict[str, Any]]) -> None:
    success_statuses = [row for row in account_statuses if row.get("status") == "ok"]
    failed_statuses = [row for row in account_statuses if row.get("status") == "unavailable"]
    cache_fallback_statuses = [row for row in account_statuses if row.get("status") == "cache_fallback"]
    meta["batch"] = True
    meta["limit_scope"] = "per_account"
    meta["requested_account_count"] = len(account_statuses)
    meta["success_count"] = len(success_statuses)
    meta["failed_count"] = len(failed_statuses)
    meta["cache_fallback_count"] = len(cache_fallback_statuses)
    meta["cache_fallback_policy"] = "disabled_for_mpi_fact_source"
    meta["successful_account_ids"] = [str(row.get("account_id") or "") for row in success_statuses]
    meta["failed_account_ids"] = [str(row.get("account_id") or "") for row in failed_statuses]
    meta["account_statuses"] = list(account_statuses)
    summary = summarize_report_rows(rows)
    meta["successful_data_len"] = summary["data_len"]
    meta["successful_total_cost"] = summary["cost"]
    meta["total_is_partial"] = bool(failed_statuses)
    if failed_statuses and success_statuses:
        meta["batch_status"] = "partial"
    elif failed_statuses:
        meta["batch_status"] = "failed"
    elif cache_fallback_statuses:
        meta["batch_status"] = "complete_with_cache_fallback"
    else:
        meta["batch_status"] = "complete"


def validate_platform_options(args: argparse.Namespace) -> None:
    if not hasattr(args, "source"):
        return
    platform_provided = getattr(args, "platform", None) is not None
    xhs_channel_provided = getattr(args, "xhs_channel", None) is not None
    if getattr(args, "source", None) != "mpi":
        if platform_provided:
            raise CliError("invalid_argument", "--platform is only supported with --source mpi", 2)
        if xhs_channel_provided:
            raise CliError("invalid_argument", "--xhs-channel is only supported with --source mpi", 2)
        return

    platform = getattr(args, "platform", None) or DEFAULT_MPI_PLATFORM
    if platform not in MPI_PLATFORMS:
        choices = "', '".join(MPI_PLATFORMS)
        raise CliError(
            "invalid_argument",
            f"argument --platform: invalid choice: '{platform}' (choose from '{choices}')",
            2,
        )
    args.platform = platform

    xhs_channel = getattr(args, "xhs_channel", None) or DEFAULT_XHS_CHANNEL
    if xhs_channel not in XHS_CHANNELS:
        choices = "', '".join(XHS_CHANNELS)
        raise CliError(
            "invalid_argument",
            f"argument --xhs-channel: invalid choice: '{xhs_channel}' (choose from '{choices}')",
            2,
        )
    args.xhs_channel = xhs_channel


def run_report_summary(args: argparse.Namespace) -> dict[str, Any]:
    meta = list_meta(args)
    meta.update(role_visibility_meta(args))
    try:
        validate_date_range(args.start_date, args.end_date)
    except CliError as exc:
        if not exc.meta:
            exc.meta = meta
        raise
    service = XinAgentReadService()
    if args.source == "mpi":
        account_ids = parse_account_id_list(
            getattr(args, "account_id", None),
            getattr(args, "account_ids", None),
        )
        if account_ids:
            if len(account_ids) == 1:
                meta["account_id"] = account_ids[0]
            else:
                meta["account_ids"] = account_ids
        else:
            raise CliError(
                "invalid_argument",
                "account-id or account-ids is required when report summary uses --source mpi; use --source cache for cached project totals.",
                2,
                meta,
            )
        ensure_mpi_account_read_allowed(
            args,
            getattr(args, "platform", DEFAULT_MPI_PLATFORM),
            account_ids,
            meta,
            "MPI report summary",
        )
        adapter = MpiReadOnlyAdapter()
        if len(account_ids) > 1:
            from concurrent.futures import ThreadPoolExecutor, as_completed

            started_at = time.perf_counter()
            max_workers = report_batch_concurrency(args, len(account_ids))
            meta["concurrency"] = max_workers
            rows_by_index: list[list[dict[str, Any]]] = [[] for _ in account_ids]
            statuses_by_index: list[dict[str, Any] | None] = [None for _ in account_ids]

            def fetch_one(index: int, account_id: str) -> tuple[int, list[dict[str, Any]], dict[str, Any]]:
                try:
                    account_rows, account_status = fetch_mpi_report_summary_with_cache_fallback(
                        MpiReadOnlyAdapter(),
                        service,
                        args,
                        account_id,
                    )
                except CliError as exc:
                    if exc.code == "invalid_argument":
                        raise
                    account_rows = []
                    account_status = {
                        "account_id": account_id,
                        "status": "unavailable",
                        "source": "none",
                        "effective_source": "none",
                        "source_of_truth": "mpi",
                        "fallback_source": "none",
                        "fallback_status": "disabled_non_authoritative",
                        "data_len": 0,
                        "cost": 0.0,
                        "reason": exc.code,
                        "error_code": exc.code,
                        "error_message": safe_message(exc.message),
                    }
                return index, account_rows, account_status

            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {
                    executor.submit(fetch_one, index, account_id): index
                    for index, account_id in enumerate(account_ids)
                }
                for future in as_completed(futures):
                    index, account_rows, account_status = future.result()
                    rows_by_index[index] = account_rows
                    statuses_by_index[index] = account_status

            rows: list[dict[str, Any]] = []
            for account_rows in rows_by_index:
                rows.extend(account_rows)
            account_statuses = [
                status if status is not None else {
                    "account_id": account_ids[index],
                    "status": "unavailable",
                    "source": "none",
                    "effective_source": "none",
                    "source_of_truth": "mpi",
                    "fallback_source": "none",
                    "fallback_status": "disabled_non_authoritative",
                    "data_len": 0,
                    "cost": 0.0,
                    "reason": "worker_not_completed",
                }
                for index, status in enumerate(statuses_by_index)
            ]
            meta["duration_ms"] = int((time.perf_counter() - started_at) * 1000)
            annotate_report_batch_meta(meta, account_statuses, rows)
            if rows:
                return success_envelope(rows, meta)
            raise_offline_report_unavailable(meta, "batch_all_accounts_unavailable")
        try:
            args.account_id = account_ids[0]
            data = adapter.report_summary(args)
            if data:
                return success_envelope(data, meta)
            raise_offline_report_unavailable(meta, "mpi_offline_empty")
        except CliError as exc:
            if is_interface_permission_denied(exc):
                raise_offline_report_unavailable(meta, "mpi_permission_denied", exc)
            if not exc.meta:
                exc.meta = meta
            raise
    if args.task_id is not None:
        meta["summary_type"] = "task_note"
        meta["audit"] = {
            "source_table": "task_note_performance_daily",
            "fallback_source_table": "task_note_performance",
            "date_basis": "task_note_performance_daily.report_date",
            "fallback_date_basis": "legacy_snapshot_no_report_date",
            "operator_filter": "task_assignee_name",
        }
        meta["task_id"] = args.task_id
        if args.project_id is not None:
            meta["project_id"] = args.project_id
        if args.operator:
            meta["operator"] = args.operator
        data = service.task_note_summary_cache(
            args.task_id,
            args.start_date,
            args.end_date,
            args.project_id,
            args.operator,
            args.limit,
            args.offset,
            role_context=auth_context(args),
        )
    else:
        meta["summary_type"] = "project_daily"
        meta["audit"] = {
            "source_table": "daily_consumption",
            "date_basis": "daily_consumption.date",
            "operator_filter": "project_operator_name",
        }
        if args.project_id is not None:
            meta["project_id"] = args.project_id
        if args.operator:
            meta["operator"] = args.operator
        data = service.report_summary_cache(
            args.start_date,
            args.end_date,
            args.project_id,
            args.operator,
            args.limit,
            args.offset,
            role_context=auth_context(args),
        )
    meta.update(service.cache_status_meta())
    return success_envelope(data, meta)


def run_note_detail(args: argparse.Namespace) -> dict[str, Any]:
    meta = list_meta(args)
    meta.update(role_visibility_meta(args))
    try:
        validate_date_range(args.start_date, args.end_date)
    except CliError as exc:
        if not exc.meta:
            exc.meta = meta
        raise
    if args.source == "mpi":
        if getattr(args, "account_id", None):
            meta["account_id"] = args.account_id
        else:
            raise CliError("invalid_argument", "account-id is required when note detail uses --source mpi", 2, meta)
        ensure_mpi_account_read_allowed(
            args,
            getattr(args, "platform", DEFAULT_MPI_PLATFORM),
            [str(args.account_id)],
            meta,
            "MPI note detail",
        )
        try:
            return success_envelope(MpiReadOnlyAdapter().note_detail(args), meta)
        except CliError as exc:
            if not exc.meta:
                exc.meta = meta
            raise
    if args.project_id is not None:
        meta["project_id"] = args.project_id
    if args.task_id is not None:
        meta["task_id"] = args.task_id
    if args.operator:
        meta["operator"] = args.operator
    service = XinAgentReadService()
    data = service.note_detail_cache(
        args.start_date,
        args.end_date,
        args.project_id,
        args.task_id,
        args.operator,
        args.limit,
        args.offset,
        role_context=auth_context(args),
    )
    meta.update(service.cache_status_meta())
    return success_envelope(data, meta)


def run_project_list(args: argparse.Namespace) -> dict[str, Any]:
    meta = list_meta(args)
    meta.update(role_visibility_meta(args))
    if getattr(args, "search", None):
        meta["search"] = args.search
    if getattr(args, "account_id", None):
        meta["account_id"] = args.account_id
    if args.source == "mpi":
        platform = getattr(args, "platform", DEFAULT_MPI_PLATFORM)
        require_full_account_pull(args, platform, meta, "MPI unbound project discovery")
        if getattr(args, "account_id", None):
            meta["account_id"] = args.account_id
        if getattr(args, "start_date", None):
            meta["start_date"] = args.start_date
        if getattr(args, "end_date", None):
            meta["end_date"] = args.end_date
        if getattr(args, "start_date", None) and getattr(args, "end_date", None):
            try:
                validate_date_range(args.start_date, args.end_date)
            except CliError as exc:
                if not exc.meta:
                    exc.meta = meta
                raise
        try:
            data = MpiReadOnlyAdapter().list_projects(
                args.account_id,
                args.limit,
                args.offset,
                getattr(args, "start_date", None),
                getattr(args, "end_date", None),
                platform,
                getattr(args, "xhs_channel", DEFAULT_XHS_CHANNEL),
                getattr(args, "search", None),
            )
        except CliError as exc:
            if not exc.meta:
                exc.meta = meta
            raise
        return success_envelope(data, meta)
    service = XinAgentReadService()
    data = service.list_cache_projects(
        args.limit,
        args.offset,
        search=getattr(args, "search", None),
        account_id=getattr(args, "account_id", None),
        role_context=auth_context(args),
    )
    meta.update(service.cache_status_meta())
    return success_envelope(data, meta)


def run_project_detail(args: argparse.Namespace) -> dict[str, Any]:
    meta = cache_meta(args)
    meta["project_id"] = args.project_id
    if bool(args.start_date) != bool(args.end_date):
        raise CliError("invalid_argument", "start-date and end-date must be provided together", 2, meta)
    if args.start_date and args.end_date:
        try:
            validate_date_range(args.start_date, args.end_date)
        except CliError as exc:
            if not exc.meta:
                exc.meta = meta
            raise
        meta["start_date"] = args.start_date
        meta["end_date"] = args.end_date
    service = XinAgentReadService()
    data = service.project_detail_cache(
        args.project_id,
        args.start_date,
        args.end_date,
        args.limit,
        args.offset,
        role_context=auth_context(args),
    )
    meta.update(service.cache_status_meta())
    return success_envelope(data, meta)


def run_task_list(args: argparse.Namespace) -> dict[str, Any]:
    meta = cache_meta(args)
    if args.project_id is not None:
        meta["project_id"] = args.project_id
    if args.status:
        meta["status"] = args.status
    if args.category:
        meta["category"] = args.category
    if args.assignee:
        meta["assignee"] = args.assignee
    if args.search:
        meta["search"] = args.search
    if args.include_archived:
        meta["include_archived"] = True
    service = XinAgentReadService()
    data = service.list_cache_tasks(
        args.limit,
        args.offset,
        project_id=args.project_id,
        status=args.status,
        category=args.category,
        assignee=args.assignee,
        search=args.search,
        include_archived=args.include_archived,
        role_context=auth_context(args),
    )
    meta.update(service.cache_status_meta())
    return success_envelope(data, meta)


def run_task_detail(args: argparse.Namespace) -> dict[str, Any]:
    meta = cache_meta(args)
    meta["task_id"] = args.task_id
    service = XinAgentReadService()
    data = service.task_detail_cache(args.task_id, args.limit, args.offset, role_context=auth_context(args))
    meta.update(service.cache_status_meta())
    return success_envelope(data, meta)


def run_user_list(args: argparse.Namespace) -> dict[str, Any]:
    meta = cache_meta(args)
    if args.user_role:
        meta["user_role"] = args.user_role
    if args.department:
        meta["department"] = args.department
    if args.status:
        meta["status"] = args.status
    if args.include_resigned:
        meta["include_resigned"] = True
    if args.search:
        meta["search"] = args.search
    service = XinAgentReadService()
    data = service.list_cache_users(
        args.limit,
        args.offset,
        user_role=args.user_role,
        department=args.department,
        status=args.status,
        include_resigned=args.include_resigned,
        search=args.search,
    )
    meta.update(service.cache_status_meta())
    return success_envelope(data, meta)


def run_snapshot(args: argparse.Namespace) -> dict[str, Any]:
    meta = cache_meta(args)
    try:
        validate_date_range(args.start_date, args.end_date)
    except CliError as exc:
        if not exc.meta:
            exc.meta = meta
        raise
    if args.project_id is not None:
        meta["project_id"] = args.project_id
    if args.task_id is not None:
        meta["task_id"] = args.task_id
    if args.operator:
        meta["operator"] = args.operator
    if args.status:
        meta["status"] = args.status
    if args.category:
        meta["category"] = args.category
    if args.include_archived:
        meta["include_archived"] = True
    meta["start_date"] = args.start_date
    meta["end_date"] = args.end_date

    service = XinAgentReadService()
    project_detail = None
    projects = []
    if args.project_id is not None:
        project_detail = service.project_detail_cache(
            args.project_id,
            None,
            None,
            args.limit,
            args.offset,
            role_context=auth_context(args),
        )
    else:
        projects = service.list_cache_projects(args.limit, args.offset, role_context=auth_context(args))

    task_detail = None
    task_report_summary = []
    if args.task_id is not None:
        task_detail = service.task_detail_cache(args.task_id, args.limit, args.offset, role_context=auth_context(args))
        task_report_summary = service.task_note_summary_cache(
            args.task_id,
            args.start_date,
            args.end_date,
            args.project_id,
            args.operator,
            args.limit,
            args.offset,
            role_context=auth_context(args),
        )

    data = {
        "generated_at": _now_iso_with_timezone(),
        "date_range": {"start_date": args.start_date, "end_date": args.end_date},
        "filters": {
            "project_id": args.project_id,
            "task_id": args.task_id,
            "operator": args.operator,
            "status": args.status,
            "category": args.category,
            "include_archived": bool(args.include_archived),
        },
        "paging": {"limit": args.limit, "offset": args.offset},
        "projects": projects,
        "project_detail": project_detail,
        "tasks": service.list_cache_tasks(
            args.limit,
            args.offset,
            project_id=args.project_id,
            status=args.status,
            category=args.category,
            assignee=args.operator,
            include_archived=args.include_archived,
            role_context=auth_context(args),
        ),
        "task_detail": task_detail,
        "report_summary": service.report_summary_cache(
            args.start_date,
            args.end_date,
            args.project_id,
            args.operator,
            args.limit,
            args.offset,
            role_context=auth_context(args),
        ),
        "task_report_summary": task_report_summary,
        "note_detail": service.note_detail_cache(
            args.start_date,
            args.end_date,
            args.project_id,
            args.task_id,
            args.operator,
            args.limit,
            args.offset,
            role_context=auth_context(args),
        ),
        "audit": {
            "projects": {"source_table": "projects/sub_accounts", "date_basis": "none/context_only"},
            "project_detail": {"source_table": "projects/sub_accounts", "date_basis": "none/context_only"},
            "tasks": {"source_table": "tasks", "date_basis": "none/context_only"},
            "report_summary": {
                "source_table": "daily_consumption",
                "date_basis": "daily_consumption.date",
                "operator_filter": "project_operator_name",
            },
            "task_report_summary": {
                "source_table": "task_note_performance_daily",
                "fallback_source_table": "task_note_performance",
                "date_basis": "task_note_performance_daily.report_date",
                "fallback_date_basis": "legacy_snapshot_no_report_date",
                "operator_filter": "task_assignee_name",
            },
            "note_detail": {
                "source_table": "task_note_performance_daily",
                "fallback_source_table": "task_note_performance",
                "date_basis": "task_note_performance_daily.report_date",
                "fallback_date_basis": "legacy_snapshot_no_report_date",
                "operator_filter": "task_assignee_name",
            },
        },
    }
    meta.update(service.cache_status_meta())
    return success_envelope(data, meta)


def run_realtime_summary(args: argparse.Namespace) -> dict[str, Any]:
    context = auth_context(args)
    meta = {
        "source": "mpi_realtime",
        "account_resolution": "cache",
        "role": args.role,
        "auth_role": context["role"],
        "source_of_truth": "mpi_realtime",
        "limit": args.limit,
        "offset": args.offset,
        "xhs_channel": args.xhs_channel,
        "xhs_port_scope": "local_juguang+medical_juguang+chengfeng" if args.xhs_channel == "all" else args.xhs_channel,
    }
    meta.update(role_visibility_meta(args))
    if args.project_id is not None:
        meta["project_id"] = args.project_id
    if args.account_id:
        meta["account_id"] = args.account_id
    if args.search:
        meta["search"] = args.search

    service = XinAgentReadService()
    resolved_accounts = service.list_cache_accounts(
        args.limit,
        args.offset,
        project_id=args.project_id,
        account_id=args.account_id,
        search=args.search,
        role_context=context,
    )
    meta.update(service.cache_status_meta())
    all_resolved_accounts = resolved_accounts
    resolved_accounts = [account for account in all_resolved_accounts if is_xhs_cached_account(account)]
    excluded_non_xhs_account_count = len(all_resolved_accounts) - len(resolved_accounts)
    if not resolved_accounts and args.account_id:
        require_full_account_pull(args, "xhs", meta, "MPI realtime unbound account resolution")
        mpi_accounts = MpiReadOnlyAdapter().list_accounts(
            limit=1,
            offset=0,
            platform="xhs",
            xhs_channel="spotlight",
            account_id=args.account_id,
            search=None,
        )
        if mpi_accounts:
            meta["account_resolution"] = "mpi_account_list"
            all_resolved_accounts = mpi_accounts
            resolved_accounts = [
                {
                    "account_id": item.get("account_id"),
                    "account_name": item.get("account_name") or "",
                    "project_id": None,
                    "project_name": "",
                    "operator_name": "",
                    "source": "mpi",
                    "bound_in_backend": False,
                }
                for item in mpi_accounts
            ]
            excluded_non_xhs_account_count = 0
    if not resolved_accounts:
        resolution_status = "unsupported_platform" if all_resolved_accounts else "not_found"
        resolution_message = (
            "Cached accounts matched, but none are supported by XHS realtime summary."
            if all_resolved_accounts
            else "No cached sub-accounts matched the provided project/account/search filters."
        )
        return success_envelope(
            {
                "generated_at": _now_iso_with_timezone(),
                "report_date": datetime.now().date().isoformat(),
                "resolution": {
                    "status": resolution_status,
                    "message": resolution_message,
                    "matched_account_count": len(all_resolved_accounts),
                    "xhs_account_count": len(resolved_accounts),
                    "excluded_non_xhs_account_count": excluded_non_xhs_account_count,
                    "filters": {
                        "project_id": args.project_id,
                        "account_id": args.account_id,
                        "search": args.search,
                    },
                },
                "resolved_accounts": [],
                "items": [],
                "total_cost": 0.0,
                "audit": {
                    "account_resolution_table": "sub_accounts/projects",
                    "metric_source": "mpi_realtime",
                    "source_of_truth": "mpi_realtime",
                    "date_basis": "realtime_today",
                    "xhs_port_scope": meta["xhs_port_scope"],
                    "write_mode": "read_only_no_cache_write",
                },
            },
            meta,
        )

    items = MpiReadOnlyAdapter().realtime_summary(
        resolved_accounts,
        limit=len(resolved_accounts),
        offset=0,
        xhs_channel=args.xhs_channel,
    )
    total_cost = round(sum(float(item.get("cost") or 0) for item in items if item.get("status") == "ok"), 2)
    return success_envelope(
        {
            "generated_at": _now_iso_with_timezone(),
            "report_date": datetime.now().date().isoformat(),
            "resolution": {
                "status": "ok",
                "matched_account_count": len(all_resolved_accounts),
                "xhs_account_count": len(resolved_accounts),
                "excluded_non_xhs_account_count": excluded_non_xhs_account_count,
                "filters": {
                    "project_id": args.project_id,
                    "account_id": args.account_id,
                    "search": args.search,
                },
            },
            "resolved_accounts": resolved_accounts,
            "items": items,
            "total_cost": total_cost,
            "audit": {
                "account_resolution_table": "sub_accounts/projects",
                "metric_source": "mpi_realtime",
                "source_of_truth": "mpi_realtime",
                "date_basis": "realtime_today",
                "xhs_port_scope": meta["xhs_port_scope"],
                "write_mode": "read_only_no_cache_write",
            },
        },
        meta,
    )


def run_sync_state(args: argparse.Namespace) -> dict[str, Any]:
    meta = {"source": "cache", "role": args.role}
    service = XinAgentReadService()
    data = service.sync_state_cache()
    meta.update(service.cache_status_meta())
    return success_envelope(data, meta)


def run_sync_changes(args: argparse.Namespace) -> dict[str, Any]:
    meta = cache_meta(args)
    meta["since"] = args.since
    tables = getattr(args, "tables", None)
    if tables:
        meta["tables"] = list(tables)
    service = XinAgentReadService()
    data = service.sync_changes_cache(args.since, args.limit, args.offset, tables=tables)
    meta.update(service.cache_status_meta())
    return success_envelope(data, meta)


def run_account_list(args: argparse.Namespace) -> dict[str, Any]:
    meta = list_meta(args)
    meta.update(role_visibility_meta(args))
    if getattr(args, "project_id", None) is not None:
        meta["project_id"] = args.project_id
    if getattr(args, "account_id", None):
        meta["account_id"] = args.account_id
    if getattr(args, "search", None):
        meta["search"] = args.search
    if args.source == "mpi":
        platform = getattr(args, "platform", DEFAULT_MPI_PLATFORM)
        require_full_account_pull(args, platform, meta, "MPI full account list")
        if getattr(args, "project_id", None) is not None:
            raise CliError("invalid_argument", "--project-id is not supported with account list --source mpi; use --source cache", 2, meta)
        try:
            data = MpiReadOnlyAdapter().list_accounts(
                args.limit,
                args.offset,
                platform,
                getattr(args, "xhs_channel", DEFAULT_XHS_CHANNEL),
                getattr(args, "account_id", None),
                getattr(args, "search", None),
            )
            return success_envelope(data, meta)
        except CliError as exc:
            if not exc.meta:
                exc.meta = meta
            raise
    service = XinAgentReadService()
    data = service.list_cache_accounts(
        args.limit,
        args.offset,
        project_id=getattr(args, "project_id", None),
        account_id=getattr(args, "account_id", None),
        search=getattr(args, "search", None),
        role_context=auth_context(args),
    )
    meta.update(service.cache_status_meta())
    return success_envelope(data, meta)


def add_common_list_options(parser: argparse.ArgumentParser) -> None:
    add_role_argument(parser)
    parser.add_argument("--format", choices=("json", "table"), default="json")
    parser.add_argument("--limit", type=parse_limit, default=100)
    parser.add_argument("--offset", type=parse_offset, default=0)
    parser.add_argument("--source", choices=("cache", "mpi"), default="cache")
    parser.add_argument("--platform")
    parser.add_argument("--xhs-channel")


def add_cache_output_options(parser: argparse.ArgumentParser, *, with_paging: bool = True) -> None:
    add_role_argument(parser)
    parser.add_argument("--format", choices=("json", "table"), default="json")
    if with_paging:
        parser.add_argument("--limit", type=parse_limit, default=100)
        parser.add_argument("--offset", type=parse_offset, default=0)


def add_cache_query_options(parser: argparse.ArgumentParser, *, with_paging: bool = True) -> None:
    add_role_argument(parser)
    if with_paging:
        parser.add_argument("--limit", type=parse_limit, default=100)
        parser.add_argument("--offset", type=parse_offset, default=0)


def build_parser() -> JsonArgumentParser:
    parser = JsonArgumentParser(prog="xin-agent-cli", add_help=True)
    subparsers = parser.add_subparsers(parser_class=JsonArgumentParser, dest="command", required=True)

    schema_parser = subparsers.add_parser("schema")
    schema_parser.set_defaults(handler=run_schema)

    auth_parser = subparsers.add_parser("auth")
    auth_subparsers = auth_parser.add_subparsers(parser_class=JsonArgumentParser, dest="auth_command", required=True)
    auth_status = auth_subparsers.add_parser("status")
    add_role_argument(auth_status)
    auth_status.add_argument("--format", choices=("json", "table"), default="json")
    auth_status.add_argument("--platform", choices=("xhs",), default="xhs")
    auth_status.add_argument("--threshold-seconds", type=parse_nonnegative_int, default=DEFAULT_AUTH_REFRESH_THRESHOLD_SECONDS)
    auth_status.set_defaults(handler=run_auth_status)

    auth_refresh = auth_subparsers.add_parser("refresh")
    add_role_argument(auth_refresh)
    auth_refresh.add_argument("--format", choices=("json", "table"), default="json")
    auth_refresh.add_argument("--platform", choices=("xhs",), default="xhs")
    auth_refresh.add_argument("--all", action="store_true")
    auth_refresh.add_argument("--app-id")
    auth_refresh.add_argument("--threshold-seconds", type=parse_nonnegative_int, default=DEFAULT_AUTH_REFRESH_THRESHOLD_SECONDS)
    auth_refresh.add_argument("--force", action="store_true")
    auth_refresh.set_defaults(handler=run_auth_refresh)

    report_parser = subparsers.add_parser("report")
    report_subparsers = report_parser.add_subparsers(parser_class=JsonArgumentParser, dest="report_command", required=True)
    report_summary = report_subparsers.add_parser("summary")
    add_common_list_options(report_summary)
    report_summary.add_argument("--start-date", required=True, type=valid_date)
    report_summary.add_argument("--end-date", required=True, type=valid_date)
    report_summary.add_argument("--project-id", type=parse_optional_int)
    report_summary.add_argument("--task-id", type=parse_optional_int)
    report_summary.add_argument("--account-id")
    report_summary.add_argument("--account-ids")
    report_summary.add_argument("--operator")
    report_summary.add_argument("--concurrency", type=parse_limit, default=None)
    report_summary.set_defaults(handler=run_report_summary)

    note_parser = subparsers.add_parser("note")
    note_subparsers = note_parser.add_subparsers(parser_class=JsonArgumentParser, dest="note_command", required=True)
    note_detail = note_subparsers.add_parser("detail")
    add_role_argument(note_detail)
    note_detail.add_argument("--format", choices=("json", "table"), default="json")
    note_detail.add_argument("--limit", type=parse_limit, default=100)
    note_detail.add_argument("--offset", type=parse_offset, default=0)
    note_detail.add_argument("--source", choices=("cache", "mpi"), default="cache")
    note_detail.add_argument("--start-date", required=True, type=valid_date)
    note_detail.add_argument("--end-date", required=True, type=valid_date)
    note_detail.add_argument("--project-id", type=parse_optional_int)
    note_detail.add_argument("--task-id", type=parse_optional_int)
    note_detail.add_argument("--account-id")
    note_detail.add_argument("--operator")
    note_detail.add_argument("--platform")
    note_detail.add_argument("--xhs-channel")
    note_detail.set_defaults(handler=run_note_detail)

    account_parser = subparsers.add_parser("account")
    account_subparsers = account_parser.add_subparsers(parser_class=JsonArgumentParser, dest="account_command", required=True)
    account_list = account_subparsers.add_parser("list")
    add_common_list_options(account_list)
    account_list.add_argument("--project-id", type=parse_optional_int)
    account_list.add_argument("--account-id")
    account_list.add_argument("--search")
    account_list.add_argument("--full", "--all-accounts", dest="full_account_pull", action="store_true")
    account_list.set_defaults(handler=run_account_list)

    project_parser = subparsers.add_parser("project")
    project_subparsers = project_parser.add_subparsers(parser_class=JsonArgumentParser, dest="project_command", required=True)
    project_list = project_subparsers.add_parser("list")
    add_common_list_options(project_list)
    project_list.add_argument("--account-id")
    project_list.add_argument("--search")
    project_list.add_argument("--start-date", type=valid_date)
    project_list.add_argument("--end-date", type=valid_date)
    project_list.set_defaults(handler=run_project_list)

    project_detail = project_subparsers.add_parser("detail")
    add_cache_output_options(project_detail)
    project_detail.add_argument("--project-id", required=True, type=parse_optional_int)
    project_detail.add_argument("--start-date", type=valid_date)
    project_detail.add_argument("--end-date", type=valid_date)
    project_detail.set_defaults(handler=run_project_detail)

    task_parser = subparsers.add_parser("task")
    task_subparsers = task_parser.add_subparsers(parser_class=JsonArgumentParser, dest="task_command", required=True)
    task_list = task_subparsers.add_parser("list")
    add_cache_output_options(task_list)
    task_list.add_argument("--project-id", type=parse_optional_int)
    task_list.add_argument("--status")
    task_list.add_argument("--category")
    task_list.add_argument("--assignee")
    task_list.add_argument("--search")
    task_list.add_argument("--include-archived", action="store_true")
    task_list.set_defaults(handler=run_task_list)

    task_detail = task_subparsers.add_parser("detail")
    add_cache_output_options(task_detail)
    task_detail.add_argument("--task-id", required=True, type=parse_optional_int)
    task_detail.set_defaults(handler=run_task_detail)

    user_parser = subparsers.add_parser("user")
    user_subparsers = user_parser.add_subparsers(parser_class=JsonArgumentParser, dest="user_command", required=True)
    user_list = user_subparsers.add_parser("list")
    add_cache_output_options(user_list)
    user_list.add_argument("--user-role")
    user_list.add_argument("--department")
    user_list.add_argument("--status")
    user_list.add_argument("--include-resigned", action="store_true")
    user_list.add_argument("--search")
    user_list.set_defaults(handler=run_user_list)

    snapshot_parser = subparsers.add_parser("snapshot")
    add_cache_query_options(snapshot_parser)
    snapshot_parser.add_argument("--start-date", required=True, type=valid_date)
    snapshot_parser.add_argument("--end-date", required=True, type=valid_date)
    snapshot_parser.add_argument("--project-id", type=parse_optional_int)
    snapshot_parser.add_argument("--task-id", type=parse_optional_int)
    snapshot_parser.add_argument("--operator")
    snapshot_parser.add_argument("--status")
    snapshot_parser.add_argument("--category")
    snapshot_parser.add_argument("--include-archived", action="store_true")
    snapshot_parser.set_defaults(handler=run_snapshot)

    realtime_parser = subparsers.add_parser("realtime")
    realtime_subparsers = realtime_parser.add_subparsers(parser_class=JsonArgumentParser, dest="realtime_command", required=True)
    realtime_summary = realtime_subparsers.add_parser("summary")
    add_cache_query_options(realtime_summary)
    realtime_summary.add_argument("--project-id", type=parse_optional_int)
    realtime_summary.add_argument("--account-id")
    realtime_summary.add_argument("--search")
    realtime_summary.add_argument("--xhs-channel", choices=XHS_REALTIME_CHANNELS, default=DEFAULT_XHS_REALTIME_CHANNEL)
    realtime_summary.set_defaults(handler=run_realtime_summary)

    sync_parser = subparsers.add_parser("sync")
    sync_subparsers = sync_parser.add_subparsers(parser_class=JsonArgumentParser, dest="sync_command", required=True)
    sync_state = sync_subparsers.add_parser("state")
    add_cache_output_options(sync_state, with_paging=False)
    sync_state.set_defaults(handler=run_sync_state)

    sync_changes = sync_subparsers.add_parser("changes")
    add_cache_output_options(sync_changes)
    sync_changes.add_argument("--since", required=True, type=valid_timestamp)
    sync_changes.add_argument("--tables", type=parse_sync_tables)
    sync_changes.set_defaults(handler=run_sync_changes)

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(list(argv) if argv is not None else None)
        validate_platform_options(args)
        payload = args.handler(args)
    except CliError as exc:
        print_json(error_envelope(exc, exc.meta))
        return exc.exit_code
    except Exception as exc:
        print_json(error_envelope(CliError("internal_error", str(exc), 1)))
        return 1

    if getattr(args, "format", "json") == "table" and payload.get("ok") and isinstance(payload.get("data"), list):
        print(render_table(payload.get("data") or []))
    else:
        print_json(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
