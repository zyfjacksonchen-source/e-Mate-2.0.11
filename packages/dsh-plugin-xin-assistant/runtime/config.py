"""Safe runtime config shim for the Tongxin read-only CLI package."""

from __future__ import annotations

import os
from pathlib import Path


_RUNTIME_ENV = {}


def _env(name, default=""):
    return os.environ.get(name) or _RUNTIME_ENV.get(name) or default


DATABASE = _env("XIN_AGENT_DATABASE") or _env("DATABASE") or str(Path(__file__).resolve().parent / "data" / "xhs_report.db")
SECRET_KEY = _env("SECRET_KEY", "xin-agent-read-only-cli")

MPI_CONNECT_TIMEOUT = int(_env("MPI_CONNECT_TIMEOUT", "5") or 5)
MPI_READ_TIMEOUT = int(_env("MPI_READ_TIMEOUT", "20") or 20)
MPI_REPORT_WORKERS = int(_env("MPI_REPORT_WORKERS", "4") or 4)

XHS_BASE_URL = _env("XHS_BASE_URL", "https://adapi.xiaohongshu.com/api/open")
XHS_TOKEN_URL = _env("XHS_TOKEN_URL", "https://adapi.xiaohongshu.com/api/open/oauth2/access_token")
XHS_REFRESH_URL = _env("XHS_REFRESH_URL", "https://adapi.xiaohongshu.com/api/open/oauth2/refresh_token")
XHS_AUTH_CODE = _env("XHS_AUTH_CODE")
XIN_AGENT_MPI_APP_ID = _env("XIN_AGENT_MPI_APP_ID")
XIN_AGENT_MPI_SECRET = _env("XIN_AGENT_MPI_SECRET")
XIN_AGENT_MPI_USER_ID = _env("XIN_AGENT_MPI_USER_ID")
XIN_AGENT_MPI_REDIRECT_URI = _env("XIN_AGENT_MPI_REDIRECT_URI")
XIN_AGENT_MPI_ACCESS_TOKEN = _env("XIN_AGENT_MPI_ACCESS_TOKEN")
XIN_AGENT_MPI_ACCESS_EXPIRES_AT = _env("XIN_AGENT_MPI_ACCESS_EXPIRES_AT")
XIN_AGENT_MPI_APP_ID_2 = _env("XIN_AGENT_MPI_APP_ID_2")
XIN_AGENT_MPI_SECRET_2 = _env("XIN_AGENT_MPI_SECRET_2")
XIN_AGENT_MPI_USER_ID_2 = _env("XIN_AGENT_MPI_USER_ID_2")
XIN_AGENT_MPI_REDIRECT_URI_2 = _env("XIN_AGENT_MPI_REDIRECT_URI_2")
XIN_AGENT_MPI_ACCESS_TOKEN_2 = _env("XIN_AGENT_MPI_ACCESS_TOKEN_2")
XIN_AGENT_MPI_ACCESS_EXPIRES_AT_2 = _env("XIN_AGENT_MPI_ACCESS_EXPIRES_AT_2")
XIN_AGENT_MPI_APP_ID_3 = _env("XIN_AGENT_MPI_APP_ID_3")
XIN_AGENT_MPI_SECRET_3 = _env("XIN_AGENT_MPI_SECRET_3")
XIN_AGENT_MPI_USER_ID_3 = _env("XIN_AGENT_MPI_USER_ID_3")
XIN_AGENT_MPI_REDIRECT_URI_3 = _env("XIN_AGENT_MPI_REDIRECT_URI_3")
XIN_AGENT_MPI_ACCESS_TOKEN_3 = _env("XIN_AGENT_MPI_ACCESS_TOKEN_3")
XIN_AGENT_MPI_ACCESS_EXPIRES_AT_3 = _env("XIN_AGENT_MPI_ACCESS_EXPIRES_AT_3")
XHS_APP_ID = XIN_AGENT_MPI_APP_ID or _env("XHS_APP_ID")
XHS_SECRET = XIN_AGENT_MPI_SECRET or ("" if XIN_AGENT_MPI_ACCESS_TOKEN else _env("XHS_SECRET"))
XHS_USER_ID = XIN_AGENT_MPI_USER_ID or _env("XHS_USER_ID")
XHS_APP_ID_2 = XIN_AGENT_MPI_APP_ID_2 or _env("XHS_APP_ID_2")
XHS_SECRET_2 = XIN_AGENT_MPI_SECRET_2 or ("" if XIN_AGENT_MPI_ACCESS_TOKEN_2 else _env("XHS_SECRET_2"))
XHS_USER_ID_2 = XIN_AGENT_MPI_USER_ID_2 or _env("XHS_USER_ID_2")
XHS_APP_ID_3 = XIN_AGENT_MPI_APP_ID_3 or _env("XHS_APP_ID_3")
XHS_SECRET_3 = XIN_AGENT_MPI_SECRET_3 or ("" if XIN_AGENT_MPI_ACCESS_TOKEN_3 else _env("XHS_SECRET_3"))
XHS_USER_ID_3 = XIN_AGENT_MPI_USER_ID_3 or _env("XHS_USER_ID_3")
XHS_REDIRECT_URI = _env("XHS_REDIRECT_URI") or XIN_AGENT_MPI_REDIRECT_URI

XHS_OFFLINE_REPORT_URLS = {
    "account": f"{XHS_BASE_URL}/jg/data/report/offline/account",
    "campaign": f"{XHS_BASE_URL}/jg/data/report/offline/campaign",
    "unit": f"{XHS_BASE_URL}/jg/data/report/offline/unit",
    "creativity": f"{XHS_BASE_URL}/jg/data/report/offline/creativity",
    "note": f"{XHS_BASE_URL}/jg/data/report/offline/note",
}
XHS_REALTIME_REPORT_URLS = {"account": f"{XHS_BASE_URL}/jg/data/report/realtime/account"}
XHS_WIND_OFFLINE_REPORT_URLS = {
    "account": f"{XHS_BASE_URL}/wind/data/report/offline/account",
    "spu": f"{XHS_BASE_URL}/wind/data/report/offline/spu",
    "creativity": f"{XHS_BASE_URL}/wind/data/report/offline/creativity",
}
XHS_WIND_REALTIME_REPORT_URLS = {"account": f"{XHS_BASE_URL}/wind/data/report/realtime/account"}
XHS_EASY_PROMOTION_URL = f"{XHS_BASE_URL}/jg/easy/promotion/list"
XHS_EASY_PLAN_URL = f"{XHS_BASE_URL}/jg/easy/plan/list"
XHS_EASY_NOTE_URL = f"{XHS_BASE_URL}/jg/easy/note/list"
XHS_EASY_REALTIME_URL = f"{XHS_BASE_URL}/jg/easy/data/realtime"

BILI_BASE_URL = _env("BILI_BASE_URL", "https://cm.bilibili.com")
BILI_ADP_VERSION = _env("BILI_ADP_VERSION", "6")
BILI_CLIENT_ID = _env("BILI_CLIENT_ID") or _env("XIN_AGENT_BILI_CLIENT_ID")
BILI_CLIENT_SECRET = _env("BILI_CLIENT_SECRET") or _env("XIN_AGENT_BILI_CLIENT_SECRET")
BILI_REDIRECT_URI = _env("BILI_REDIRECT_URI") or _env("XIN_AGENT_BILI_REDIRECT_URI")
BILI_ACCESS_TOKEN = _env("BILI_ACCESS_TOKEN") or _env("XIN_AGENT_BILI_ACCESS_TOKEN")
BILI_TOKEN_URL = _env("BILI_TOKEN_URL", "https://cm.bilibili.com/open_api/oauth2/access_token")
BILI_REFRESH_URL = _env("BILI_REFRESH_URL", "https://cm.bilibili.com/open_api/oauth2/refresh_token")

ALIPAY_GATEWAY_URL = _env("ALIPAY_GATEWAY_URL", "https://openapi.alipay.com/gateway.do")
ALIPAY_APP_ID = _env("ALIPAY_APP_ID") or _env("XIN_AGENT_ALIPAY_APP_ID")
ALIPAY_PRIVATE_KEY = _env("ALIPAY_PRIVATE_KEY") or _env("XIN_AGENT_ALIPAY_PRIVATE_KEY")
ALIPAY_APP_AUTH_TOKEN = _env("ALIPAY_APP_AUTH_TOKEN") or _env("XIN_AGENT_ALIPAY_APP_AUTH_TOKEN")
ALIPAY_BIZ_TOKEN = _env("ALIPAY_BIZ_TOKEN") or _env("XIN_AGENT_ALIPAY_BIZ_TOKEN")
ALIPAY_PID = _env("ALIPAY_PID") or _env("XIN_AGENT_ALIPAY_PID")
ALIPAY_PRINCIPAL_TAG = _env("ALIPAY_PRINCIPAL_TAG") or _env("XIN_AGENT_ALIPAY_PRINCIPAL_TAG")
ALIPAY_SIGN_TYPE = _env("ALIPAY_SIGN_TYPE", "RSA2")
ALIPAY_API_VERSION = _env("ALIPAY_API_VERSION", "1.0")
ALIPAY_PAGE_SIZE = int(_env("ALIPAY_PAGE_SIZE", "100") or 100)
ALIPAY_REPORT_MODE = _env("ALIPAY_REPORT_MODE", "agent")
ALIPAY_DEFAULT_BIZ_SCENE = _env("ALIPAY_DEFAULT_BIZ_SCENE", "SEARCH")
ALIPAY_DEFAULT_SCENE_TYPE = _env("ALIPAY_DEFAULT_SCENE_TYPE", "")
