"""小红书 Marketing API (MPI) 对接模块"""

import requests
import logging
import json
import threading
import csv
import io
import re
import base64
import time as sleep_time
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
import config
import models
from bili_column_defs import BILI_ALL_COLUMNS
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT = (config.MPI_CONNECT_TIMEOUT, config.MPI_READ_TIMEOUT)


class AlipayApiError(Exception):
    """支付宝网关业务错误，保留错误码供前端和诊断接口判断。"""

    def __init__(self, message, code="", sub_code="", sub_msg="", method="", body=None):
        super().__init__(message)
        self.code = str(code or "")
        self.sub_code = str(sub_code or "")
        self.sub_msg = str(sub_msg or "")
        self.method = str(method or "")
        self.body = body if isinstance(body, dict) else {}

    def to_dict(self):
        return {
            "message": str(self),
            "code": self.code,
            "sub_code": self.sub_code,
            "sub_msg": self.sub_msg,
            "method": self.method,
        }

BILI_ASYNC_REPORT_CREATE_PATH = "/v3/asynchronous-reports/create"
BILI_ASYNC_REPORT_STATUS_PATH = "/v3/asynchronous-reports/search"
BILI_ASYNC_REPORT_POLL_INTERVAL_SECONDS = 60
BILI_ASYNC_REPORT_MAX_POLLS = 12

OFFLINE_METRIC_COLUMNS = [
    "fee", "impression", "click", "ctr", "acp", "cpm",
    "interaction", "like", "collect", "comment", "follow", "share",
    "leads", "valid_leads", "message_consult", "message_consult_cpl",
    "msg_leads_num", "msg_leads_cost", "initiative_message", "initiative_message_cpl",
    "action_button_click", "action_button_ctr",
    "search_cmt_click", "search_cmt_click_cvr",
    "total_order_num_7d", "total_order_num_7d_cost", "total_order_gmv_7d", "total_order_roi_7d",
    "goods_order", "goods_order_price", "rgmv", "roi",
    "i_user_num", "i_user_price", "ti_user_num", "ti_user_price",
    "phone_call_cnt", "msg_leads_form_submit_num",
]

WIND_REALTIME_METRIC_COLUMNS = [
    "fee", "impression", "click", "ctr", "acp", "cpm",
    "like", "comment", "collect", "follow", "share", "interaction", "cpi",
    "action_button_click", "action_button_ctr", "screenshot", "pic_save",
    "search_cmt_click", "search_cmt_click_cvr", "search_cmt_after_read_avg", "search_cmt_after_read",
    "reserve_pv", "live_subscribe_cnt", "live_subscribe_cnt_cost",
    "live_watch_cnt", "live_watch_cnt_cost", "live_watch_duration_avg", "live_follow_cnt",
    "live_5s_watch_cnt", "live_5s_watch_cnt_cost", "live_cmt_cnt",
    "live_30s_watch_cnt", "live_30s_watch_cnt_cost",
    "goods_view_num", "goods_view_num_cost", "goods_add_cart_num", "goods_add_cart_num_cost",
    "total_order_num_7d", "total_order_num_7d_cost", "total_order_gmv_7d", "total_order_roi_7d",
    "deal_order_num_7d", "deal_order_num_7d_cost", "deal_order_gmv_7d", "deal_order_roi_7d",
    "live_direct_purchase_order_num_24h", "live_direct_purchase_order_num_24h_cost",
    "live_direct_purchase_order_gmv_24h", "live_direct_purchase_order_roi_24h",
    "live_direct_deal_order_num_24h", "live_direct_deal_order_num_24h_cost",
    "live_direct_deal_order_gmv_24h", "live_direct_deal_order_roi_24h",
    "new_seller_goods_view_num", "new_seller_deal_order_num_7d", "new_seller_deal_order_gmv_7d",
]

WIND_OFFLINE_METRIC_COLUMNS = [
    "fee", "impression", "click", "ctr", "acp", "cpm",
    "like", "comment", "collect", "follow", "share", "interaction", "cpi",
    "action_button_click", "action_button_ctr", "screenshot", "pic_save",
    "search_cmt_click", "search_cmt_click_cvr", "search_cmt_after_read_avg", "search_cmt_after_read",
    "reserve_pv", "live_subscribe_cnt", "live_subscribe_cnt_cost",
    "live_watch_cnt", "live_watch_cnt_cost", "live_watch_duration_avg", "live_follow_cnt",
    "live_5s_watch_cnt", "live_5s_watch_cnt_cost", "live_cmt_cnt",
    "live_30s_watch_cnt", "live_30s_watch_cnt_cost",
    "goods_view_num", "goods_view_num_cost", "goods_add_cart_num", "goods_add_cart_num_cost",
    "total_order_num_7d", "total_order_num_7d_cost", "total_order_gmv_7d", "total_order_roi_7d",
    "deal_order_num_7d", "deal_order_num_7d_cost", "deal_order_gmv_7d", "deal_order_roi_7d",
    "live_direct_purchase_order_num_24h", "live_direct_purchase_order_num_24h_cost",
    "live_direct_purchase_order_gmv_24h", "live_direct_purchase_order_roi_24h",
    "live_direct_deal_order_num_24h", "live_direct_deal_order_num_24h_cost",
    "live_direct_deal_order_gmv_24h", "live_direct_deal_order_roi_24h",
    "new_seller_goods_view_num", "new_seller_deal_order_num_7d", "new_seller_deal_order_gmv_7d",
]

# 余额查询用的 adv->vsid 映射缓存（30分钟TTL）
_vsid_cache = {"mapping": {}, "fetched_at": 0}

# token刷新锁（按app_id粒度，防止并发刷新同一端口）
_token_refresh_locks = {}
_token_refresh_global_lock = threading.Lock()
_client_advertiser_status = {}


def _get_token_lock(app_id):
    with _token_refresh_global_lock:
        if app_id not in _token_refresh_locks:
            _token_refresh_locks[app_id] = threading.Lock()
        return _token_refresh_locks[app_id]


def _to_advertiser_id(account_id):
    """将 account_id 转为 API 所需的 int，非纯数字 ID 返回 None 并打印警告。"""
    aid = str(account_id).strip()
    try:
        return int(aid)
    except (ValueError, TypeError):
        logger.warning("account_id '%s' 不是纯数字，无法调用 MPI API，跳过", aid)
        return None


def _safe_float(val):
    """安全转换为float，转换失败返回0"""
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


def _metric_value(item, *keys):
    for key in keys:
        if key in item and item.get(key) not in (None, ""):
            return item.get(key)
    return 0


class XhsApiPermissionError(Exception):
    pass


class XhsApiAuthError(Exception):
    """Access token / port routing error that should try another MPI port first."""

    def __init__(self, message, code="", data=None):
        super().__init__(message)
        self.code = str(code or "")
        self.data = data if isinstance(data, dict) else {}


_TOKEN_REFRESH_FAILURE_COOLDOWN_SECONDS = 30 * 60
_token_refresh_failures = {}


def _token_refresh_failure(app_id):
    return _token_refresh_failures.get(str(app_id or ""))


def _record_token_refresh_failure(app_id, error):
    _token_refresh_failures[str(app_id or "")] = {
        "at": sleep_time.time(),
        "error": str(error),
    }


def _clear_token_refresh_failure(app_id):
    _token_refresh_failures.pop(str(app_id or ""), None)


def _raise_if_refresh_in_cooldown(app_id):
    failure = _token_refresh_failure(app_id)
    if not failure:
        return
    elapsed = sleep_time.time() - float(failure.get("at") or 0)
    if elapsed < _TOKEN_REFRESH_FAILURE_COOLDOWN_SECONDS:
        remaining = int(_TOKEN_REFRESH_FAILURE_COOLDOWN_SECONDS - elapsed)
        raise Exception(f"Token刷新冷却中，{remaining}s后重试；上次失败: {failure.get('error')}")
    _clear_token_refresh_failure(app_id)


class XhsApiClient:
    """小红书聚光 API 客户端，支持多端口"""

    def __init__(self, app_id=None, secret=None, user_id=None):
        self.base_url = config.XHS_BASE_URL
        self.app_id = app_id or config.XHS_APP_ID
        self.secret = secret or config.XHS_SECRET
        self.user_id = user_id or config.XHS_USER_ID

    def _get_access_token(self):
        token_info = models.get_token(app_id=self.app_id)
        if not token_info or not token_info.get("access_token"):
            token_info = models.get_token(app_id="")
        if not token_info or not token_info.get("access_token"):
            raise Exception("未找到OAuth Token，请先完成授权")
        return token_info["access_token"]

    def _headers(self):
        return {"Content-Type": "application/json", "Access-Token": self._get_access_token()}

    def _auth_headers(self):
        """带 Access-Token 的请求头（部分接口用小写 key）"""
        return {"Content-Type": "application/json", "access-token": self._get_access_token()}

    @staticmethod
    def _check_response(resp, context=""):
        """检查HTTP响应状态码，非2xx抛出异常"""
        if resp.status_code != 200:
            raise Exception(f"API请求失败{(' - ' + context) if context else ''}: HTTP {resp.status_code}")

    @staticmethod
    def _retry_request(method, url, max_retries=3, **kwargs):
        """带指数退避的HTTP请求重试"""
        kwargs.setdefault("timeout", 30)
        for attempt in range(max_retries):
            try:
                resp = method(url, **kwargs)
                return resp
            except requests.exceptions.ConnectionError as e:
                if attempt == max_retries - 1:
                    raise
                wait = 2 ** attempt
                logger.warning("请求失败，%d秒后重试 (%d/%d): %s", wait, attempt + 1, max_retries, e)
                import time
                time.sleep(wait)

    # ---- OAuth ----

    def get_token_by_auth_code(self, auth_code=None):
        """用 auth_code 换取 access_token"""
        code = auth_code or config.XHS_AUTH_CODE
        resp = requests.post(
            config.XHS_TOKEN_URL,
            json={
                "app_id": self.app_id,
                "secret": self.secret,
                "auth_code": code,
            },
            headers={"Content-Type": "application/json"},
            timeout=_REQUEST_TIMEOUT,
        )
        self._check_response(resp, "get_token")
        data = resp.json()
        logger.info("get_token response app_id=%s code=%s", self.app_id, data.get("code"))

        if data.get("code") != 0:
            raise Exception(f"获取Token失败: {data.get('msg', data)}")

        result = data["data"]
        # 提取token字段（可能在不同位置）
        access_token = result.get("access_token", "")
        refresh_token = result.get("refresh_token", "")
        expires_in = result.get("expires_in", result.get("access_token_expires_in", 86400))
        refresh_token_expires_in = result.get("refresh_token_expires_in")

        if not access_token:
            raise Exception("Token响应中未找到access_token")

        models.save_token(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=expires_in,
            app_id=self.app_id,
            refresh_token_expires_in=refresh_token_expires_in,
        )

        # 缓存广告主列表
        advertisers = result.get("approval_advertisers", [])
        if advertisers:
            models.save_advertisers(advertisers)
            logger.info("已缓存 %d 个广告主", len(advertisers))

        return result

    def refresh_access_token(self):
        """刷新 access_token（线程安全，按端口加锁）"""
        with _get_token_lock(self.app_id):
            _raise_if_refresh_in_cooldown(self.app_id)
            try:
                result = self._do_refresh_access_token()
            except Exception as exc:
                _record_token_refresh_failure(self.app_id, exc)
                raise
            _clear_token_refresh_failure(self.app_id)
            return result

    def _do_refresh_access_token(self):
        """实际执行token刷新（调用方已持有锁）"""
        refresh_token = models.get_refresh_token(app_id=self.app_id)
        if not refresh_token:
            refresh_token = models.get_refresh_token(app_id="")
        if not refresh_token:
            raise Exception("无refresh_token，请重新授权")

        resp = requests.post(
            config.XHS_REFRESH_URL,
            json={
                "app_id": self.app_id,
                "secret": self.secret,
                "refresh_token": refresh_token,
            },
            headers={"Content-Type": "application/json"},
            timeout=_REQUEST_TIMEOUT,
        )
        self._check_response(resp, "refresh_token")
        data = resp.json()
        logger.info("refresh_token response app_id=%s code=%s", self.app_id, data.get("code"))

        if data.get("code") != 0:
            raise Exception(f"刷新Token失败: {data.get('msg', data)}")

        result = data["data"]
        access_token = result.get("access_token", "")
        new_refresh = result.get("refresh_token", "")
        expires_in = result.get("expires_in", result.get("access_token_expires_in", 86400))
        refresh_token_expires_in = result.get("refresh_token_expires_in")

        if access_token:
            models.save_token(
                access_token=access_token,
                refresh_token=new_refresh or refresh_token,
                expires_in=expires_in,
                app_id=self.app_id,
                refresh_token_expires_in=refresh_token_expires_in,
            )

        # 更新广告主列表
        advertisers = result.get("approval_advertisers", [])
        if advertisers:
            models.save_advertisers(advertisers)
            logger.info("已更新 %d 个广告主缓存", len(advertisers))

        return result

    def ensure_token(self):
        """确保有有效的 token"""
        token_info = models.get_token(app_id=self.app_id)
        # fallback: 兼容旧数据中 app_id 为空的记录
        if not token_info or not token_info.get("access_token"):
            token_info = models.get_token(app_id="")
        if not token_info or not token_info.get("access_token"):
            raise Exception("未找到Token，请先授权")

        if token_info.get("expires_at"):
            try:
                expires = datetime.fromisoformat(token_info["expires_at"])
                if expires > datetime.now():
                    return token_info
            except (ValueError, TypeError):
                pass

        # 尝试刷新
        self.refresh_access_token()
        return models.get_token(app_id=self.app_id)

    @staticmethod
    def _response_code(data):
        return str((data or {}).get("code", ""))

    def _should_retry_after_refresh(self, data, context=""):
        code = self._response_code(data)
        if code == "401":
            return True
        if code == "410019":
            msg = (data or {}).get("msg") or (data or {}).get("message") or data
            raise XhsApiAuthError(f"{context}端口或Access-Token不可用: {msg}", code=code, data=data)
        return False

    def _refresh_and_retry(self, url, payload, headers_func, context, parse_json=True):
        try:
            self.refresh_access_token()
        except Exception as exc:
            raise XhsApiAuthError(f"{context}刷新Token失败: {exc}", code="refresh_failed") from exc
        resp = requests.post(url, json=payload, headers=headers_func(), timeout=_REQUEST_TIMEOUT)
        return self._parse_json_response(resp) if parse_json else resp.json()

    def _post_with_retries(self, url, payload, headers, context, attempts=2):
        last_exc = None
        for attempt in range(max(1, attempts)):
            try:
                return requests.post(url, json=payload, headers=headers, timeout=_REQUEST_TIMEOUT)
            except requests.RequestException as exc:
                last_exc = exc
                if attempt + 1 >= attempts:
                    break
                logger.warning("%s请求失败，准备重试 %d/%d: %s", context, attempt + 1, attempts - 1, exc)
                sleep_time.sleep(0.4 * (attempt + 1))
        raise last_exc

    # ---- 广告主/账户 ----

    def fetch_sub_account_page(self, page=1, page_size=500, virtual_seller_id=None):
        """拉取代理商子账号列表（/api/open/jg/account/sub/page）"""
        self.ensure_token()
        url = f"{config.XHS_BASE_URL}/jg/account/sub/page"
        payload = {
            "user_id": self.user_id,
            "page": page,
            "page_size": page_size,
        }
        if virtual_seller_id:
            payload["virtual_seller_id"] = virtual_seller_id

        resp = requests.post(url, json=payload, headers=self._auth_headers(), timeout=_REQUEST_TIMEOUT)
        data = resp.json()
        if self._should_retry_after_refresh(data, "子账号列表"):
            data = self._refresh_and_retry(url, payload, self._auth_headers, "子账号列表", parse_json=False)
        if data.get("code") in (410023, 410026):
            raise XhsApiPermissionError(data.get("msg") or "子账号列表无权限")
        if data.get("code") != 0 and not data.get("success"):
            raise Exception(f"拉取子账号列表失败: {data}")
        result = data.get("data", {})
        return result.get("sub_accounts", [])

    def fetch_all_sub_account_details(self):
        """拉取所有子账号详情（分页）"""
        all_items = []
        page = 1
        while True:
            items = self.fetch_sub_account_page(page=page, page_size=500)
            if not items:
                break
            all_items.extend(items)
            if len(items) < 500:
                break
            page += 1
        logger.info("拉取子账号详情: 共 %d 条", len(all_items))
        return all_items

    def fetch_spu_list(self, advertiser_id, keyword=None, page_size=100, max_pages=5, can_bind=True):
        """拉取广告主可用 SPU 列表（/api/open/jg/spu/list）"""
        self.ensure_token()
        url = f"{config.XHS_BASE_URL}/jg/spu/list"
        all_items = []
        page = 1
        while page <= max_pages:
            payload = {
                "advertiser_id": int(advertiser_id),
                "page": page,
                "page_size": page_size,
            }
            if keyword:
                payload["keyword"] = keyword
            if can_bind is not None:
                payload["can_bind"] = bool(can_bind)

            # SPU selection is on the interactive note workflow path; keep this
            # shorter than heavy report pulls so the chat UI can fall back fast.
            resp = requests.post(
                url,
                json=payload,
                headers=self._auth_headers(),
                timeout=(config.MPI_CONNECT_TIMEOUT, min(config.MPI_READ_TIMEOUT, 8)),
            )
            data = self._parse_json_response(resp)
            if data.get("code") not in (0, None) and not data.get("success"):
                raise Exception(f"SPU列表拉取失败: {data.get('msg') or data.get('message') or data}")
            result = data.get("data", {}) or {}
            raw_items = (
                result.get("spu_list")
                or result.get("spus")
                or result.get("spu")
                or result.get("spu_infos")
                or result.get("spuInfos")
                or result.get("data_list")
                or result.get("list")
                or result.get("records")
                or []
            )
            if isinstance(raw_items, dict):
                raw_items = raw_items.get("list") or raw_items.get("records") or []
            if not isinstance(raw_items, list):
                raw_items = []
            all_items.extend(raw_items)

            total = result.get("total_count") or result.get("total") or result.get("totalCount")
            if len(raw_items) < page_size:
                break
            if total and len(all_items) >= int(total):
                break
            page += 1

        logger.info("spu list adv=%s 返回 %d 条", advertiser_id, len(all_items))
        return all_items

    def refresh_advertiser_list(self):
        """刷新广告主列表（合并 approval_advertisers + 子账号列表）"""
        result = self.refresh_access_token()
        advertisers = result.get("approval_advertisers", [])

        # 额外拉取子账号列表，确保所有可搜索的账号都在数据库中
        try:
            sub_accounts = self.fetch_all_sub_account_details()
            logger.info("拉取子账号详情: 共 %d 条", len(sub_accounts))

            # 合并去重：用 advertiser_id 作为唯一标识
            merged = {}
            for adv in advertisers:
                aid = adv.get("advertiser_id")
                if aid:
                    merged[str(aid)] = {
                        "advertiser_id": aid,
                        "advertiser_name": adv.get("advertiser_name", ""),
                    }

            for sub in sub_accounts:
                # 子账号接口字段不稳定：优先使用可拉报表的 advertiser_id，缺失时再回退到 virtual_seller_id。
                aid = sub.get("advertiser_id") or sub.get("virtual_seller_id")
                aid = sub.get("advertiser_id") or sub.get("virtual_seller_id")
                name = (
                    sub.get("advertiser_name", "")
                    or sub.get("virtual_seller_name", "")
                    or sub.get("name", "")
                    or sub.get("brand_user_name", "")
                    or sub.get("company_name", "")
                )
                if aid:
                    merged[str(aid)] = {
                        "advertiser_id": aid,
                        "advertiser_name": name,
                    }

            models.save_advertisers(list(merged.values()))
            logger.info("已合并保存 %d 个可搜索账号", len(merged))
        except Exception as e:
            logger.warning("拉取子账号列表失败，仅使用 approval_advertisers: %s", e)
            if advertisers:
                models.save_advertisers(advertisers)

        return list(merged.values()) if "merged" in locals() else advertisers

    # ---- 报表拉取 ----

    @staticmethod
    def _parse_json_response(resp):
        """Parse JSON from API response, fixing XHS API quirks like repeated leading null/true/false."""
        try:
            return resp.json()
        except Exception:
            raw = (resp.text or "").strip()
            while True:
                for prefix in ("null", "true", "false"):
                    if raw.startswith(prefix):
                        raw = raw[len(prefix):].strip()
                        break
                else:
                    break
            try:
                return json.loads(raw)
            except Exception:
                decoder = json.JSONDecoder()
                for idx, char in enumerate(raw):
                    if char in "[{":
                        return decoder.raw_decode(raw[idx:])[0]
                raise


    def fetch_offline_report(self, advertiser_id, start_date, end_date=None,
                             level="account", filters=None, split_columns=None, columns=None):
        """
        拉取离线报表，支持多层级和维度细分
        advertiser_id: int 广告主ID
        start_date: str YYYY-MM-DD
        end_date: str YYYY-MM-DD（默认等于start_date）
        level: str "account"|"campaign"|"unit"|"creativity"|"keyword"
        filters: dict 筛选条件（marketing_strategy, bidding_strategy等）
        split_columns: list[str] 维度细分字段
        """
        self.ensure_token()
        if not end_date:
            end_date = start_date

        url = config.XHS_OFFLINE_REPORT_URLS.get(level, config.XHS_OFFLINE_REPORT_URLS["account"])
        all_items = []
        page = 1
        page_size = 1000

        while True:
            payload = {
                "advertiser_id": advertiser_id,
                "start_date": start_date,
                "end_date": end_date,
                "page": page,
                "page_size": page_size,
            }
            if columns:
                payload["columns"] = columns
            if filters:
                for k, v in filters.items():
                    if v:
                        payload[k] = v
            if split_columns:
                payload["split_columns"] = split_columns

            resp = requests.post(url, json=payload, headers=self._headers(), timeout=_REQUEST_TIMEOUT)
            try:
                data = self._parse_json_response(resp)
            except Exception as json_err:
                logger.warning("JSON parse error adv=%s level=%s: %s", advertiser_id, level, json_err)
                return all_items
            if page == 1:
                logger.info("offline report adv=%s %s~%s level=%s code=%s", advertiser_id, start_date, end_date, level, data.get("code"))

            if self._should_retry_after_refresh(data, "离线报表"):
                data = self._refresh_and_retry(url, payload, self._headers, "离线报表")
                if data.get("code") != 0:
                    raise Exception(f"token刷新后拉取仍失败: {data}")

            if data.get("code") != 0:
                raise Exception(f"拉取离线报表失败: {data}")

            result = data.get("data", {})
            items = result.get("data_list", []) or result.get("list", [])
            for item in items:
                item["_investment_type"] = "标准投"
            all_items.extend(items)

            # 返回数据不足 page_size，说明没有更多页
            if len(items) < page_size:
                break
            page += 1

        logger.info("offline report adv=%s %s~%s level=%s 返回 %d 条记录", advertiser_id, start_date, end_date, level, len(all_items))
        return all_items

    def fetch_easy_promotion_report(self, advertiser_id, start_date, end_date=None, columns=None):
        """
        拉取简单投离线报表（推广组/标的级别），返回聚合后的账户级数据
        endpoint: /api/open/jg/data/report/offline/easy/promotion/group
        """


        self.ensure_token()
        if not end_date:
            end_date = start_date

        url = config.XHS_EASY_PROMOTION_URL
        all_items = []
        page = 1
        page_size = 500

        while True:
            payload = {
                "advertiser_id": advertiser_id,
                "start_date": start_date,
                "end_date": end_date,
                "page_num": page,
                "page_size": page_size,
            }
            if columns:
                payload["columns"] = columns

            resp = self._post_with_retries(url, payload, self._auth_headers(), "简单投实时报表")
            try:
                data = self._parse_json_response(resp)
            except Exception as json_err:
                logger.warning("简单投 JSON parse error adv=%s: %s", advertiser_id, json_err)
                return all_items

            if page == 1:
                logger.info("easy promotion adv=%s %s~%s code=%s", advertiser_id, start_date, end_date, data.get("code"))

            if self._should_retry_after_refresh(data, "简单投离线报表"):
                data = self._refresh_and_retry(url, payload, self._auth_headers, "简单投离线报表")
                if data.get("code") != 0:
                    raise Exception(f"简单投token刷新后仍失败: {data}")

            if data.get("code") != 0:
                raise Exception(f"简单投报表失败: {data}")

            result = data.get("data", {})
            items = result.get("data_list", []) or []
            all_items.extend(items)

            if len(items) < page_size:
                break
            page += 1

        logger.info("easy promotion adv=%s %s~%s 返回 %d 条记录", advertiser_id, start_date, end_date, len(all_items))
        return all_items

    def fetch_easy_plan_report(self, advertiser_id, start_date, end_date=None, split_columns=None):
        """
        拉取简单投离线报表（计划层级）
        endpoint: /api/open/jg/data/report/offline/easy/promotion/base
        """


        self.ensure_token()
        if not end_date:
            end_date = start_date

        url = config.XHS_EASY_PLAN_URL
        all_items = []
        page = 1
        page_size = 500

        while True:
            payload = {
                "advertiser_id": advertiser_id,
                "start_date": start_date,
                "end_date": end_date,
                "page_num": page,
                "page_size": page_size,
            }
            if split_columns:
                payload["split_columns"] = split_columns

            resp = requests.post(url, json=payload, headers=self._auth_headers(), timeout=_REQUEST_TIMEOUT)
            try:
                data = self._parse_json_response(resp)
            except Exception as json_err:
                logger.warning("简单投计划 JSON parse error adv=%s: %s", advertiser_id, json_err)
                return all_items

            if page == 1:
                logger.info("easy plan adv=%s %s~%s code=%s", advertiser_id, start_date, end_date, data.get("code"))

            if self._should_retry_after_refresh(data, "简单投计划报表"):
                data = self._refresh_and_retry(url, payload, self._auth_headers, "简单投计划报表")

            if data.get("code") != 0:
                logger.error("简单投计划报表失败: %s", data)
                return all_items

            result = data.get("data", {})
            items = result.get("data_list", []) or []
            for item in items:
                item["_investment_type"] = "简单投"
            all_items.extend(items)

            if len(items) < page_size:
                break
            page += 1

        logger.info("easy plan adv=%s %s~%s 返回 %d 条记录", advertiser_id, start_date, end_date, len(all_items))
        return all_items

    def fetch_easy_note_report(self, advertiser_id, start_date, end_date=None, split_columns=None):
        """
        拉取简单投离线报表（笔记层级）
        endpoint: /api/open/jg/data/report/offline/easy/promotion/note
        """


        self.ensure_token()
        if not end_date:
            end_date = start_date

        url = config.XHS_EASY_NOTE_URL
        all_items = []
        page = 1
        page_size = 500

        while True:
            payload = {
                "advertiser_id": advertiser_id,
                "start_date": start_date,
                "end_date": end_date,
                "page_num": page,
                "page_size": page_size,
            }
            if split_columns:
                payload["split_columns"] = split_columns

            resp = requests.post(url, json=payload, headers=self._auth_headers(), timeout=_REQUEST_TIMEOUT)
            try:
                data = self._parse_json_response(resp)
            except Exception as json_err:
                logger.warning("简单投笔记 JSON parse error adv=%s: %s", advertiser_id, json_err)
                return all_items

            if page == 1:
                logger.info("easy note adv=%s %s~%s code=%s", advertiser_id, start_date, end_date, data.get("code"))

            if self._should_retry_after_refresh(data, "简单投笔记报表"):
                data = self._refresh_and_retry(url, payload, self._auth_headers, "简单投笔记报表")

            if data.get("code") != 0:
                logger.error("简单投笔记报表失败: %s", data)
                return all_items

            result = data.get("data", {})
            items = result.get("data_list", []) or []
            for item in items:
                item["_investment_type"] = "简单投"
            all_items.extend(items)

            if len(items) < page_size:
                break
            page += 1

        logger.info("easy note adv=%s %s~%s 返回 %d 条记录", advertiser_id, start_date, end_date, len(all_items))
        return all_items

    def fetch_easy_realtime_report(self, advertiser_id, columns=None):
        """
        拉取简单投实时报表（标的层级）
        endpoint: /api/open/jg/data/report/realtime/ube/group
        返回标的级别数据列表，每条含 group_paradigm + data 展平
        """


        self.ensure_token()
        today = date.today().isoformat()

        if not columns:
            columns = [
                "fee", "impression", "click", "ctr", "acp", "cpm",
                "interaction", "like", "collect", "comment", "follow", "share",
                "leads", "validLeads", "messageConsult", "messageConsultCpl",
                "msgLeadsNum", "msgLeadsCost", "initiativeMessage", "initiativeMessageCpl",
                "actionButtonClick", "actionButtonCtr",
                "searchCmtClick", "searchCmtClickCvr",
                "iUserNum", "iUserPrice", "tiUserNum", "tiUserPrice",
            ]

        url = config.XHS_EASY_REALTIME_URL
        all_items = []
        page = 1
        page_size = 200

        while True:
            payload = {
                "advertiser_id": advertiser_id,
                "start_date": today,
                "end_date": today,
                "columns": columns,
                "page_num": page,
                "page_size": page_size,
            }

            resp = requests.post(url, json=payload, headers=self._auth_headers(), timeout=_REQUEST_TIMEOUT)
            try:
                data = self._parse_json_response(resp)
            except Exception as json_err:
                logger.warning("简单投实时 JSON parse error adv=%s: %s", advertiser_id, json_err)
                return all_items

            if page == 1:
                logger.info("easy realtime adv=%s code=%s", advertiser_id, data.get("code"))

            if self._should_retry_after_refresh(data, "简单投实时报表"):
                data = self._refresh_and_retry(url, payload, self._auth_headers, "简单投实时报表")

            if data.get("code") in (410023, 410026):
                raise XhsApiPermissionError(data.get("msg") or "实时报表无权限")
            if data.get("code") != 0:
                logger.error("简单投实时报表失败: %s", data)
                return all_items

            result = data.get("data", {})
            items = result.get("data_list", []) or []

            for item in items:
                # 展平 group_paradigm 到数据中
                paradigm = item.pop("group_paradigm", {}) or {}
                item["campaign_group_id"] = paradigm.get("campaign_group_id", "")
                item["campaign_group_name"] = paradigm.get("campaign_group_name", "")
                item["enable"] = paradigm.get("enable", "")
                item["_investment_type"] = "简单投"
                # 将 camelCase 的 data 子对象字段展平
                sub_data = item.pop("data", {}) or {}
                item.update(sub_data)

            all_items.extend(items)

            total_count = result.get("page", {}).get("total_count", 0)
            if len(all_items) >= total_count or len(items) < page_size:
                break
            page += 1

        logger.info("easy realtime adv=%s 返回 %d 条记录", advertiser_id, len(all_items))
        return all_items

    def fetch_realtime_report(self, advertiser_id):
        """拉取实时报表（账户层级）"""
        self.ensure_token()
        url = config.XHS_REALTIME_REPORT_URLS["account"]
        today = date.today().isoformat()
        payload = {
            "advertiser_id": advertiser_id,
            "start_date": today,
            "end_date": today,
        }

        resp = self._post_with_retries(url, payload, self._headers(), "实时报表")
        data = resp.json()

        if self._should_retry_after_refresh(data, "实时报表"):
            data = self._refresh_and_retry(url, payload, self._headers, "实时报表", parse_json=False)

        if data.get("code") in (410023, 410026):
            raise XhsApiPermissionError(data.get("msg") or "实时报表无权限")
        if data.get("code") != 0:
            raise Exception(f"拉取实时报表失败: {data}")

        result = data.get("data")
        if isinstance(result, dict):
            # 实时报表返回单个对象而非列表
            result["_investment_type"] = "标准投"
            return [result]
        if isinstance(result, list):
            for item in result:
                item["_investment_type"] = "标准投"
            return result
        return []

    def fetch_chengfeng_realtime_report(self, advertiser_id):
        """拉取乘风实时报表（账户层级）"""
        self.ensure_token()
        url = config.XHS_WIND_REALTIME_REPORT_URLS["account"]
        today = date.today().isoformat()
        payload = {
            "advertiser_id": advertiser_id,
            "start_date": today,
            "end_date": today,
            "columns": WIND_REALTIME_METRIC_COLUMNS,
        }

        resp = self._post_with_retries(url, payload, self._auth_headers(), "乘风实时报表")
        data = resp.json()

        if self._should_retry_after_refresh(data, "乘风实时报表"):
            data = self._refresh_and_retry(url, payload, self._auth_headers, "乘风实时报表", parse_json=False)

        if data.get("code") in (410023, 410026):
            raise XhsApiPermissionError(data.get("msg") or "乘风实时报表无权限")
        if data.get("code") != 0:
            raise Exception(f"拉取乘风实时报表失败: {data}")

        result = data.get("data")
        if isinstance(result, dict):
            result["_investment_type"] = "标准投"
            return [result]
        return []

    def fetch_chengfeng_offline_report(self, advertiser_id, start_date, end_date=None,
                                      level="creativity", filters=None, split_columns=None):
        """拉取乘风离线报表。"""
        self.ensure_token()
        if not end_date:
            end_date = start_date
        url = config.XHS_WIND_OFFLINE_REPORT_URLS.get(level, config.XHS_WIND_OFFLINE_REPORT_URLS["creativity"])
        all_items = []
        page = 1
        page_size = 500
        while True:
            payload = {
                "advertiser_id": advertiser_id,
                "start_date": start_date,
                "end_date": end_date,
                "time_unit": "DAY",
                "page_num": page,
                "page_size": page_size,
                "columns": WIND_OFFLINE_METRIC_COLUMNS,
            }
            if split_columns:
                payload["split_columns"] = split_columns
            if filters:
                payload["filters"] = filters
            resp = requests.post(url, json=payload, headers=self._headers(), timeout=_REQUEST_TIMEOUT)
            data = resp.json()

            if self._should_retry_after_refresh(data, "乘风离线报表"):
                data = self._refresh_and_retry(url, payload, self._headers, "乘风离线报表", parse_json=False)

            if data.get("code") == 410023:
                raise XhsApiPermissionError(data.get("msg") or "乘风离线报表无权限")
            if data.get("code") != 0:
                raise Exception(f"拉取乘风离线报表失败: {data}")

            result = data.get("data") or {}
            items = result.get("data_list", []) or []
            for item in items:
                item["_investment_type"] = "标准投"
            all_items.extend(items)
            total_count = int(result.get("total_count") or 0)
            if len(all_items) >= total_count or len(items) < page_size:
                break
            page += 1
        return all_items


def fetch_all_realtime(include_errors=False, include_meta=False):
    """拉取所有自动关联子账号的实时报表，按端口分组并发拉取"""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    all_accounts = models.get_all_sub_accounts()

    # 刷新缓存确保端口路由准确
    if not _client_advertiser_cache:
        _refresh_client_advertiser_cache()

    results = {}
    errors = []
    skipped = []
    lock = __import__('threading').Lock()

    def _fetch_one(account):
        adv_id = _to_advertiser_id(account["account_id"])
        if adv_id is None:
            return None, None

        def _merge_realtime_data(data):
            merged = {}
            if data and isinstance(data, list):
                for item in data:
                    if item and isinstance(item, dict):
                        for k, v in item.items():
                            if k in merged and isinstance(merged[k], (int, float)):
                                try:
                                    merged[k] = merged[k] + float(v or 0)
                                except (ValueError, TypeError):
                                    pass
                            else:
                                try:
                                    merged[k] = float(v) if v and isinstance(v, (int, float, str)) and str(v).replace('.', '').replace('-', '').isdigit() else v
                                except (ValueError, TypeError):
                                    merged[k] = v
            merged["sub_account_id"] = account["id"]
            merged["account_id"] = str(account["account_id"])
            merged["account_name"] = account.get("account_name", "")
            merged["_account_name"] = account.get("account_name", "")
            merged["project_id"] = account.get("project_id")
            merged["project_name"] = account.get("project_name", "")
            merged["_project_name"] = account.get("project_name", "")
            merged["_investment_type"] = "标准投"
            if "fee" not in merged:
                merged["fee"] = 0.0
            else:
                merged["fee"] = round(float(merged["fee"] or 0), 2)
            return merged

        client = _get_client_for_account(account)
        client_unavailable = _client_unavailable(client)
        if client_unavailable and (
            account.get("platform") == "乘风" or not _account_in_available_client_cache(account)
        ):
            status = _client_status(client)
            logger.debug(
                "实时报表跳过不可用端口 account=%s app_id=%s: %s",
                account["account_id"],
                getattr(client, "app_id", ""),
                status.get("error", ""),
            )
            with lock:
                skipped.append(account["account_id"])
            return None, None
        try:
            if _should_use_chengfeng_realtime(account, client):
                return _merge_realtime_data(client.fetch_chengfeng_realtime_report(adv_id)), None
            return _merge_realtime_data(client.fetch_realtime_report(adv_id)), None
        except (XhsApiPermissionError, XhsApiAuthError) as e:
            for fallback_client in _fallback_clients_for_account(account, client):
                try:
                    if account.get("platform") == "乘风" and not _should_use_chengfeng_realtime(account, fallback_client):
                        continue
                    if _should_use_chengfeng_realtime(account, fallback_client):
                        return _merge_realtime_data(fallback_client.fetch_chengfeng_realtime_report(adv_id)), None
                    return _merge_realtime_data(fallback_client.fetch_realtime_report(adv_id)), None
                except (XhsApiPermissionError, XhsApiAuthError) as fallback_error:
                    logger.debug("实时报表回退端口不可用 account=%s app_id=%s: %s", account["account_id"], getattr(fallback_client, "app_id", ""), fallback_error)
                except Exception as fallback_error:
                    logger.warning("实时报表回退端口失败 account=%s app_id=%s: %s", account["account_id"], getattr(fallback_client, "app_id", ""), fallback_error)
            logger.error("实时报表拉取失败 account=%s: %s", account["account_id"], e)
            return None, account["account_id"]
        except Exception as e:
            logger.error("实时报表拉取失败 account=%s: %s", account["account_id"], e)
            return None, account["account_id"]

    def _fetch_easy_realtime(account):
        """拉取简单投实时数据（标的级别，每个账户可能多条）"""
        adv_id = _to_advertiser_id(account["account_id"])
        if adv_id is None:
            return [], account["account_id"]
        if account.get("platform") == "乘风":
            return [], None
        client = _get_client_for_account(account)
        if _client_unavailable(client) and not _account_in_available_client_cache(account):
            return [], None
        try:
            data = client.fetch_easy_realtime_report(adv_id)
        except (XhsApiPermissionError, XhsApiAuthError) as e:
            data = None
            for fallback_client in _fallback_clients_for_account(account, client):
                try:
                    data = fallback_client.fetch_easy_realtime_report(adv_id)
                    break
                except (XhsApiPermissionError, XhsApiAuthError) as fallback_error:
                    logger.debug("简单投实时回退端口不可用 account=%s app_id=%s: %s", account["account_id"], getattr(fallback_client, "app_id", ""), fallback_error)
                except Exception as fallback_error:
                    logger.warning("简单投实时回退端口失败 account=%s app_id=%s: %s", account["account_id"], getattr(fallback_client, "app_id", ""), fallback_error)
            if data is None:
                logger.warning("简单投实时拉取失败 account=%s: %s", account["account_id"], e)
                return [], account["account_id"]
        except Exception as e:
            logger.warning("简单投实时拉取失败 account=%s: %s", account["account_id"], e)
            return [], account["account_id"]
        try:
            for item in data:
                item["sub_account_id"] = account["id"]
                item["account_id"] = str(account["account_id"])
                item["account_name"] = account.get("account_name", "")
                item["_account_name"] = account.get("account_name", "")
                item["project_id"] = account.get("project_id")
                item["project_name"] = account.get("project_name", "")
                item["_project_name"] = account.get("project_name", "")
                item["_investment_type"] = "简单投"
                for k in (
                    "fee", "impression", "click", "ctr", "acp", "cpm",
                    "interaction", "like", "collect", "comment", "follow", "share",
                    "leads", "validLeads", "messageConsult", "messageConsultCpl",
                    "msgLeadsNum", "msgLeadsCost", "initiativeMessage", "initiativeMessageCpl",
                    "actionButtonClick", "actionButtonCtr", "searchCmtClick", "searchCmtClickCvr",
                    "iUserNum", "iUserPrice", "tiUserNum", "tiUserPrice",
                ):
                    if k in item:
                        try:
                            item[k] = float(item[k] or 0)
                        except (ValueError, TypeError):
                            item[k] = 0.0
                if "fee" in item:
                    item["fee"] = round(item["fee"], 2)
            return data, None
        except Exception as e:
            logger.warning("简单投实时拉取失败 account=%s: %s", account["account_id"], e)
            return [], account["account_id"]

    # 并发拉取标准投 + 简单投实时
    with ThreadPoolExecutor(max_workers=8) as executor:
        std_futures = {executor.submit(_fetch_one, acc): acc for acc in all_accounts}
        easy_futures = {executor.submit(_fetch_easy_realtime, acc): acc for acc in all_accounts}

        for future in as_completed(std_futures):
            merged, err_id = future.result()
            if merged and err_id is None:
                with lock:
                    results[merged["account_id"]] = merged
            elif err_id:
                errors.append(err_id)

        # 简单投实时数据以列表形式存储在 results_easy 中
        results_easy = []
        for future in as_completed(easy_futures):
            items, err_id = future.result()
            if items and err_id is None:
                with lock:
                    results_easy.extend(items)

    logger.info("实时报表拉取完成: 标准投 %d 成功, 简单投 %d 条, %d 失败, %d 授权不可用跳过",
                len(results), len(results_easy), len(errors), len(skipped))
    meta = {
        "error_count": len(errors),
        "skipped_count": len(skipped),
        "skipped_accounts": skipped,
        "unavailable_ports": {
            str(app_id): status
            for app_id, status in _client_advertiser_status.items()
            if status and not status.get("ok")
        },
    }
    if include_meta:
        return results, results_easy, errors, meta
    if include_errors:
        return results, results_easy, errors
    return results, results_easy


def fetch_all_balances():
    """拉取所有子账号的账户余额，返回按 account_id(advertiser_id) 索引的字典（并发查询）"""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import threading

    all_accounts = models.get_all_sub_accounts()
    if not all_accounts:
        return {}

    # 构建 advertiser_id -> virtual_seller_id 映射（balance API 需要 virtual_seller_id）
    import time as _time
    global _vsid_cache
    now = _time.time()
    if now - _vsid_cache["fetched_at"] > 1800:
        adv_to_vsid = {}
        for client in get_all_clients():
            try:
                details = client.fetch_all_sub_account_details()
                for item in details:
                    adv_id = str(item.get("advertiser_id", ""))
                    vsid = item.get("virtual_seller_id", "")
                    if adv_id and vsid:
                        adv_to_vsid[adv_id] = vsid
            except Exception as e:
                logger.warning("拉取 %s 子账号列表失败(余额查询): %s", client.app_id, e)
        _vsid_cache["mapping"] = adv_to_vsid
        _vsid_cache["fetched_at"] = now
        logger.info("余额查询: adv->vsid 映射已刷新, %d 条", len(adv_to_vsid))
    adv_to_vsid = _vsid_cache["mapping"]

    results = {}
    errors = []
    lock = threading.Lock()

    # 按 virtual_seller_id 分批查询
    batch_size = 100
    batches = []
    for i in range(0, len(all_accounts), batch_size):
        batch = all_accounts[i:i + batch_size]
        vsid_list = []
        id_map = {}  # vsid -> advertiser_id (用于结果映射回 advertiser_id)
        for a in batch:
            aid = str(a["account_id"])
            vsid = adv_to_vsid.get(aid)
            if vsid:
                vsid_list.append(vsid)
                id_map[vsid] = aid
            # 没有 vsid 的账号无法查余额，跳过
        if vsid_list:
            batches.append((vsid_list, id_map))

    def _query_batch(batch_info):
        vsid_list, id_map = batch_info
        try:
            client = _get_client_for_id_list(vsid_list)
            resp = requests.post(
                f"{config.XHS_BASE_URL}/finance/balance/query",
                json={
                    "user_id": client.user_id,
                    "virtual_seller_id_list": vsid_list,
                },
                headers=client._auth_headers(),
                timeout=_REQUEST_TIMEOUT,
            )
            data = resp.json()

            if data.get("code") != 0:
                logger.warning("余额查询失败: %s", data.get("msg"))
                return None, vsid_list

            balance_list = data.get("data", {}).get("wallet_balance_list", [])
            batch_results = {}
            for item in balance_list:
                vsid = str(item.get("virtual_seller_id", ""))
                balance = item.get("total_available_balance", "0.00")
                try:
                    balance_val = round(float(balance), 2)
                except (ValueError, TypeError):
                    balance_val = 0.0
                if vsid:
                    mapped_id = id_map.get(vsid, vsid)
                    batch_results[mapped_id] = balance_val
            return batch_results, None
        except Exception as e:
            logger.error("余额查询异常: %s", e)
            return None, vsid_list

    # 并发查询所有批次
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(_query_batch, b): b for b in batches}
        for future in as_completed(futures):
            batch_results, err_ids = future.result()
            if batch_results:
                with lock:
                    results.update(batch_results)
            elif err_ids:
                with lock:
                    errors.extend(err_ids)

    logger.info("余额查询完成: %d 成功, %d 失败", len(results), len(errors))
    return results


def _report_worker_count(account_ids, cap=None):
    try:
        count = len(account_ids)
    except TypeError:
        count = 1
    if cap is None:
        cap = config.MPI_REPORT_WORKERS
    return max(1, min(cap, count))


def _prepare_report_fetch():
    try:
        if not _client_advertiser_cache:
            _refresh_client_advertiser_cache()
        _ensure_all_tokens()
    except Exception as e:
        logger.warning("报表拉取前置检查失败，将继续拉取: %s", e)


def fetch_detail_report(account_ids, start_date, end_date, level="account",
                        filters=None, split_columns=None):
    """
    按需拉取明细报表数据（不存储，直接返回原始API数据）
    MPI离线报表API限制单次最多7天，超过7天自动分块拉取并合并（不聚合）。
    使用线程池并发拉取，提升效率。
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import threading

    all_items = []
    errors = []
    lock = threading.Lock()
    _prepare_report_fetch()
    worker_count = _report_worker_count(account_ids)

    # 获取 account_id 到项目信息的映射
    conn = models.get_db()
    placeholders = ",".join("?" for _ in account_ids)
    mapping_rows = conn.execute(
        f"""SELECT sa.account_id, sa.account_name, p.id as project_id, p.project_name,
                   p.platform, u.real_name as operator_name
            FROM sub_accounts sa
            JOIN projects p ON sa.project_id=p.id
            LEFT JOIN users u ON p.operator_id=u.id
            WHERE sa.account_id IN ({placeholders})""",
        account_ids,
    ).fetchall()
    conn.close()

    acct_map = {}
    for r in mapping_rows:
        acct_map[r["account_id"]] = {
            "project_id": r["project_id"],
            "project_name": r["project_name"],
            "operator_name": r["operator_name"],
            "account_name": r["account_name"],
            "platform": r["platform"],
        }

    start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
    end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()

    # 分块拉取：MPI离线报表API单次最多6天（7天含首尾会被API拒绝）
    chunk_days = 6
    date_chunks = []
    cur = start_dt
    while cur <= end_dt:
        chunk_end = min(cur + timedelta(days=chunk_days - 1), end_dt)
        date_chunks.append((cur.isoformat(), chunk_end.isoformat()))
        cur = chunk_end + timedelta(days=1)

    def _fetch_account(account_id):
        adv_id = _to_advertiser_id(account_id)
        if adv_id is None:
            return None, account_id
        try:
            items = []
            account_client = _get_client_for_account_id(account_id)
            info = acct_map.get(account_id, {})
            for chunk_start, chunk_end in date_chunks:
                if info.get("platform") == "乘风" and hasattr(account_client, "fetch_chengfeng_offline_report"):
                    chunk_data = account_client.fetch_chengfeng_offline_report(
                        advertiser_id=adv_id,
                        start_date=chunk_start,
                        end_date=chunk_end,
                        level=level,
                        filters=filters,
                        split_columns=split_columns,
                    )
                else:
                    chunk_data = account_client.fetch_offline_report(
                        advertiser_id=adv_id,
                        start_date=chunk_start,
                        end_date=chunk_end,
                        level=level,
                        filters=filters,
                        split_columns=split_columns,
                    )
                if chunk_data:
                    items.extend(chunk_data)
                    logger.info("account=%s %s~%s 拉取成功: %d 条", account_id, chunk_start, chunk_end, len(chunk_data))

            if info.get("platform") != "乘风":
                try:
                    easy_items = []
                    for chunk_start, chunk_end in date_chunks:
                        easy_data = account_client.fetch_easy_plan_report(
                            advertiser_id=adv_id,
                            start_date=chunk_start,
                            end_date=chunk_end,
                            split_columns=split_columns,
                        )
                        if easy_data:
                            easy_items.extend(easy_data)
                    if easy_items:
                        items.extend(easy_items)
                        logger.info("account=%s 简单投计划拉取成功: %d 条", account_id, len(easy_items))
                except Exception as easy_err:
                    logger.warning("简单投计划拉取失败 account=%s: %s", account_id, easy_err)

            for item in items:
                item["_account_id"] = account_id
                item["_account_name"] = info.get("account_name", "")
                item["_project_id"] = info.get("project_id", "")
                item["_project_name"] = info.get("project_name", "")
                item["_operator_name"] = info.get("operator_name", "")
                if "_investment_type" not in item:
                    item["_investment_type"] = "标准投"
            return items, None
        except Exception as e:
            logger.error("明细报表拉取失败 account=%s: %s", account_id, e)
            return None, account_id

    # 并发拉取，按账号数动态调整线程数
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {executor.submit(_fetch_account, aid): aid for aid in account_ids}
        for future in as_completed(futures):
            items, err_id = future.result()
            if items is not None and err_id is None:
                with lock:
                    all_items.extend(items)
            elif err_id:
                errors.append(err_id)

    logger.info("明细报表拉取完成: level=%s %d 条记录, %d 失败", level, len(all_items), len(errors))
    return all_items


def fetch_note_list(advertiser_id, page=1, page_size=100):
    """
    调用获取笔记列表API (/api/open/jg/note/list)，获取笔记详情
    返回 author、note_url、note_content_type、note_author_user_id 等
    note_type: 1=我的笔记, 2=合作笔记, 11=授权笔记, 12=素材笔记
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    client = _get_client_for_account_id(advertiser_id)
    url = f"{config.XHS_BASE_URL}/jg/note/list"
    seen_ids = set()

    adv_id = _to_advertiser_id(advertiser_id)
    if adv_id is None:
        return []

    def _fetch_type(ntype):
        notes = []
        p = page
        while True:
            payload = {
                "advertiser_id": adv_id,
                "note_type": ntype,
                "page": p,
                "page_size": page_size,
                "base_only": False,
            }
            try:
                resp = requests.post(url, json=payload, headers=client._headers(), timeout=_REQUEST_TIMEOUT)
                data = resp.json()
                if client._should_retry_after_refresh(data, "笔记列表API"):
                    data = client._refresh_and_retry(url, payload, client._headers, "笔记列表API", parse_json=False)
                if data.get("code") != 0:
                    logger.debug("笔记列表API adv=%s type=%d code=%s msg=%s",
                                 advertiser_id, ntype, data.get("code"), data.get("msg"))
                    break
                type_notes = data.get("data", {}).get("notes", []) or []
                notes.extend(type_notes)
                total = data.get("data", {}).get("total", 0)
                if p * page_size >= total or len(type_notes) < page_size:
                    break
                p += 1
            except Exception as e:
                logger.warning("笔记列表API异常 adv=%s type=%d: %s", advertiser_id, ntype, e)
                break
        return notes

    all_notes = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(_fetch_type, ntype): ntype for ntype in [1, 2, 11, 12]}
        for future in as_completed(futures):
            for n in future.result():
                nid = n.get("note_id", "")
                if nid and nid not in seen_ids:
                    seen_ids.add(nid)
                    all_notes.append(n)

    logger.info("笔记列表API adv=%s 返回 %d 条笔记(去重)", advertiser_id, len(all_notes))
    return all_notes


def fetch_note_report(account_ids, start_date, end_date,
                      filters=None, split_columns=None):
    """按需拉取笔记/创意层级报表数据（以笔记ID为维度聚合），包含标准投+简单投"""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import threading

    # 先拉取标准投 creativity 层级数据
    std_items = fetch_detail_report(
        account_ids, start_date, end_date,
        level="creativity",
        filters=filters,
        split_columns=split_columns,
    )

    # 再并发拉取简单投笔记层级数据
    easy_items = []
    errors = []
    lock = threading.Lock()

    conn = models.get_db()
    placeholders = ",".join("?" for _ in account_ids)
    mapping_rows = conn.execute(
        f"""SELECT sa.account_id, sa.account_name, p.id as project_id, p.project_name,
                   u.real_name as operator_name
            FROM sub_accounts sa
            JOIN projects p ON sa.project_id=p.id
            LEFT JOIN users u ON p.operator_id=u.id
            WHERE sa.account_id IN ({placeholders})""",
        account_ids,
    ).fetchall()
    conn.close()

    acct_map = {}
    for r in mapping_rows:
        acct_map[r["account_id"]] = {
            "project_id": r["project_id"],
            "project_name": r["project_name"],
            "operator_name": r["operator_name"],
            "account_name": r["account_name"],
        }

    start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
    end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
    chunk_days = 6
    date_chunks = []
    cur = start_dt
    while cur <= end_dt:
        chunk_end = min(cur + timedelta(days=chunk_days - 1), end_dt)
        date_chunks.append((cur.isoformat(), chunk_end.isoformat()))
        cur = chunk_end + timedelta(days=1)

    def _fetch_easy_note(account_id):
        adv_id = _to_advertiser_id(account_id)
        if adv_id is None:
            return None, account_id
        try:
            items = []
            account_client = _get_client_for_account_id(account_id)
            for chunk_start, chunk_end in date_chunks:
                easy_data = account_client.fetch_easy_note_report(
                    advertiser_id=adv_id,
                    start_date=chunk_start,
                    end_date=chunk_end,
                    split_columns=split_columns,
                )
                if easy_data:
                    items.extend(easy_data)
            info = acct_map.get(account_id, {})
            for item in items:
                item["_account_id"] = account_id
                item["_account_name"] = info.get("account_name", "")
                item["_project_id"] = info.get("project_id", "")
                item["_project_name"] = info.get("project_name", "")
                item["_operator_name"] = info.get("operator_name", "")
            return items, None
        except Exception as e:
            logger.warning("简单投笔记拉取失败 account=%s: %s", account_id, e)
            return None, account_id

    worker_count = _report_worker_count(account_ids)
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {executor.submit(_fetch_easy_note, aid): aid for aid in account_ids}
        for future in as_completed(futures):
            items, err_id = future.result()
            if items is not None and err_id is None:
                with lock:
                    easy_items.extend(items)
            elif err_id:
                errors.append(err_id)

    logger.info("笔记报表拉取完成: 标准投 %d 条, 简单投 %d 条", len(std_items), len(easy_items))
    return std_items + easy_items



def fetch_note_level_report(account_ids, start_date, end_date):
    """拉取笔记层级离线报表（直接返回note_id维度，含note_title/note_image/note_jump_url）"""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    import threading

    all_items = []
    lock = threading.Lock()
    _prepare_report_fetch()
    worker_count = _report_worker_count(account_ids)
    start_dt = datetime.strptime(start_date, "%Y-%m-%d").date()
    end_dt = datetime.strptime(end_date, "%Y-%m-%d").date()
    date_chunks = []
    cur = start_dt
    while cur <= end_dt:
        chunk_end = min(cur + timedelta(days=5), end_dt)
        date_chunks.append((cur.isoformat(), chunk_end.isoformat()))
        cur = chunk_end + timedelta(days=1)

    def _fetch_one(account_id):
        adv_id = _to_advertiser_id(account_id)
        if adv_id is None:
            return [], account_id
        try:
            account_client = _get_client_for_account_id(account_id)
            items = []
            for chunk_start, chunk_end in date_chunks:
                chunk_items = account_client.fetch_offline_report(
                    advertiser_id=adv_id,
                    start_date=chunk_start,
                    end_date=chunk_end,
                    level="note",
                )
                if chunk_items:
                    items.extend(chunk_items)
            for item in items:
                item["_account_id"] = account_id
            return items, None
        except Exception as e:
            logger.warning("笔记层级报表失败 account=%s: %s", account_id, e)
            return [], account_id

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {executor.submit(_fetch_one, aid): aid for aid in account_ids}
        for future in as_completed(futures):
            items, err_id = future.result()
            if items:
                with lock:
                    all_items.extend(items)

    logger.info("笔记层级报表拉取完成: %d 条", len(all_items))

    # 简单投笔记层级报表
    easy_items = []
    def _fetch_easy_note(account_id):
        adv_id = _to_advertiser_id(account_id)
        if adv_id is None:
            return [], account_id
        try:
            account_client = _get_client_for_account_id(account_id)
            items = []
            for chunk_start, chunk_end in date_chunks:
                chunk_items = account_client.fetch_easy_note_report(
                    advertiser_id=adv_id,
                    start_date=chunk_start,
                    end_date=chunk_end,
                )
                if chunk_items:
                    items.extend(chunk_items)
            if items:
                for item in items:
                    item["_account_id"] = account_id
                    item["_investment_type"] = "简单投"
            return items, None
        except Exception as e:
            logger.debug("简单投笔记报表失败 account=%s: %s", account_id, e)
            return [], account_id

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {executor.submit(_fetch_easy_note, aid): aid for aid in account_ids}
        for future in as_completed(futures):
            items, err_id = future.result()
            if items:
                with lock:
                    easy_items.extend(items)

    if easy_items:
        logger.info("简单投笔记报表拉取完成: %d 条", len(easy_items))
        all_items.extend(easy_items)

    return all_items


def _has_recent_positive_consumption(sub_account_id, before_date, days=7):
    """判断账号在 before_date 前几天是否仍有消耗，用于识别接口空返回异常。"""
    target = datetime.strptime(before_date, "%Y-%m-%d").date() if isinstance(before_date, str) else before_date
    start = (target - timedelta(days=days)).isoformat()
    end = (target - timedelta(days=1)).isoformat()
    conn = models.get_db()
    row = conn.execute(
        """SELECT COALESCE(SUM(cost_total), 0) AS total
           FROM daily_consumption
           WHERE sub_account_id=? AND date>=? AND date<=?""",
        (sub_account_id, start, end),
    ).fetchone()
    conn.close()
    return float(row["total"] or 0) > 0


def find_suspicious_zero_accounts(report_date=None, lookback_days=7):
    """找出昨日为 0/缺失但最近仍有消耗的账号，避免局部同步失败被当成真实 0。"""
    if not report_date:
        report_date = (date.today() - timedelta(days=1)).isoformat()
    target = datetime.strptime(report_date, "%Y-%m-%d").date()
    start = (target - timedelta(days=lookback_days)).isoformat()
    end = (target - timedelta(days=1)).isoformat()
    conn = models.get_db()
    rows = conn.execute(
        """
        WITH prev AS (
            SELECT sub_account_id, SUM(cost_total) AS cost_prev
            FROM daily_consumption
            WHERE date>=? AND date<=?
            GROUP BY sub_account_id
        )
        SELECT sa.*, p.project_name, COALESCE(dc.cost_total, 0) AS cost_y, dc.id AS row_y,
               dc.updated_at AS updated_y, prev.cost_prev
        FROM sub_accounts sa
        JOIN projects p ON p.id=sa.project_id
        JOIN prev ON prev.sub_account_id=sa.id
        LEFT JOIN daily_consumption dc ON dc.sub_account_id=sa.id AND dc.date=?
        WHERE prev.cost_prev>0 AND (dc.id IS NULL OR COALESCE(dc.cost_total, 0)=0)
        ORDER BY prev.cost_prev DESC
        """,
        (start, end, report_date),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def retry_suspicious_zero_accounts(report_date=None, max_rounds=2):
    """对局部 0 值账号做账号级重拉，作为凌晨/早晨补跑后的保险。"""
    if not report_date:
        report_date = (date.today() - timedelta(days=1)).isoformat()

    fixed = 0
    remaining = []
    for round_idx in range(max_rounds):
        candidates = find_suspicious_zero_accounts(report_date)
        if not candidates:
            if round_idx == 0:
                logger.info("未发现 %s 局部 0 值异常账号", report_date)
            break
        logger.warning("检测到 %s 局部 0 值异常账号 %d 个，开始第 %d 轮重拉", report_date, len(candidates), round_idx + 1)
        for account in candidates:
            try:
                sync_single_account(account["id"], report_date)
            except Exception as e:
                logger.warning(
                    "局部0值异常账号重拉失败 account=%s project=%s: %s",
                    account.get("account_id"), account.get("project_name"), e,
                )
        remaining = find_suspicious_zero_accounts(report_date)
        fixed = len(candidates) - len(remaining)
        if not remaining:
            logger.info("%s 局部 0 值异常账号重拉完成", report_date)
            break

    if remaining:
        logger.warning(
            "%s 仍有 %d 个账号疑似同步异常: %s",
            report_date,
            len(remaining),
            ", ".join(f"{r.get('project_name')}:{r.get('account_id')}" for r in remaining[:20]),
        )
    return {"fixed": fixed, "remaining": len(remaining)}


# ---- 同步任务 ----

def _fetch_offline_report_with_column_fallback(client, advertiser_id, start_date, end_date=None, is_chengfeng=False):
    if is_chengfeng and hasattr(client, "fetch_chengfeng_offline_report"):
        try:
            return client.fetch_chengfeng_offline_report(
                advertiser_id=advertiser_id,
                start_date=start_date,
                end_date=end_date,
            )
        except Exception as e:
            logger.warning("乘风离线报表拉取失败 adv=%s date=%s: %s", advertiser_id, start_date, e)
            raise
    standard_filters = {"creation_type": [0, 2]}
    try:
        return client.fetch_offline_report(
            advertiser_id=advertiser_id,
            start_date=start_date,
            end_date=end_date,
            columns=OFFLINE_METRIC_COLUMNS,
            filters=standard_filters,
        )
    except Exception as e:
        message = str(e)
        if "展示字段不正确" not in message and "columns" not in message:
            raise
        logger.warning("离线报表扩展字段不可用 adv=%s date=%s，降级为默认字段重试: %s", advertiser_id, start_date, e)
        return client.fetch_offline_report(
            advertiser_id=advertiser_id,
            start_date=start_date,
            end_date=end_date,
            filters=standard_filters,
        )


def _fetch_easy_promotion_report_with_column_fallback(client, advertiser_id, start_date, end_date=None):
    try:
        return client.fetch_easy_promotion_report(
            advertiser_id=advertiser_id,
            start_date=start_date,
            end_date=end_date,
            columns=OFFLINE_METRIC_COLUMNS,
        )
    except Exception as e:
        message = str(e)
        if "展示字段不正确" not in message and "columns" not in message:
            raise
        logger.debug("简单投扩展字段不可用 adv=%s date=%s，降级为默认字段重试: %s", advertiser_id, start_date, e)
        return client.fetch_easy_promotion_report(
            advertiser_id=advertiser_id,
            start_date=start_date,
            end_date=end_date,
        )


def _fetch_easy_plan_report(client, advertiser_id, start_date, end_date=None):
    return client.fetch_easy_plan_report(
        advertiser_id=advertiser_id,
        start_date=start_date,
        end_date=end_date,
    )


def _fetch_easy_sync_report(client, advertiser_id, start_date, end_date=None):
    plan_data = _fetch_easy_plan_report(client, advertiser_id, start_date, end_date)
    if plan_data:
        return plan_data
    return _fetch_easy_promotion_report_with_column_fallback(client, advertiser_id, start_date, end_date)


def _extra_consumption_metrics(metrics):
    return {
        field: metrics.get(field, 0)
        for field in models.CHENGFENG_PROJECT_CARD_DAILY_FIELDS
        if field not in {
            "impression", "click", "interaction", "like_count", "comment_count", "collect_count",
            "follow_count", "share_count", "action_button_click", "search_cmt_click",
        }
    }


def _aggregate_report_fields(items, agg=None):
    """将报表数据列表聚合到 agg 字典"""
    if agg is None:
        agg = {}
    field_aliases = {
        "telephone_click": ("phone_call_cnt", "telephone_click", "phoneCallCnt"),
        "leads": ("leads", "msg_leads_form_submit_num"),
        "msg_leads_num": ("msg_leads_num", "msgLeadsNum"),
        "total_order_num_7d": ("total_order_num_7d", "goods_order"),
        "total_order_gmv_7d": ("total_order_gmv_7d", "rgmv"),
    }
    fields = (
        "impression", "click", "interaction", "leads", "message_consult",
        "msg_leads_num", "valid_leads", "like", "comment", "collect", "follow", "share",
        "initiative_message", "action_button_click", "search_cmt_click",
        "i_user_num", "ti_user_num", "telephone_click",
    ) + tuple(field for field in models.CHENGFENG_PROJECT_CARD_DAILY_FIELDS if field not in {
        "impression", "click", "interaction", "like_count", "comment_count", "collect_count",
        "follow_count", "share_count", "action_button_click", "search_cmt_click",
    })
    for item in items:
        agg["fee"] = agg.get("fee", 0.0) + _safe_float(item.get("fee", 0))
        for key in fields:
            aliases = field_aliases.get(key, (key,))
            agg[key] = agg.get(key, 0.0) + _safe_float(_metric_value(item, *aliases))
    return agg


def _ensure_all_tokens():
    """在批量拉取前确保所有端口 token 有效，并发刷新，避免逐请求竞态刷新"""
    import time
    from concurrent.futures import ThreadPoolExecutor, as_completed

    clients = get_all_clients()

    def _refresh_one(client):
        try:
            token_info = models.get_token(app_id=client.app_id)
            if not token_info or not token_info.get("access_token"):
                token_info = models.get_token(app_id="")
            if token_info and token_info.get("expires_at"):
                try:
                    expires = datetime.fromisoformat(token_info["expires_at"])
                    remaining = (expires - datetime.now()).total_seconds()
                    if remaining > 3600:
                        return client.app_id, "ok", remaining
                except (ValueError, TypeError):
                    pass
            logger.info("sync前刷新端口 %s token...", client.app_id or "默认")
            client.refresh_access_token()
            return client.app_id, "refreshed", 0
        except Exception as e:
            return client.app_id, "failed", str(e)

    with ThreadPoolExecutor(max_workers=len(clients)) as ex:
        futures = {ex.submit(_refresh_one, c): c for c in clients}
        for f in as_completed(futures):
            app_id, status, detail = f.result()
            if status == "ok":
                logger.debug("端口 %s token 剩余 %.0f 秒，无需刷新", app_id, detail)
            elif status == "refreshed":
                logger.info("端口 %s token 已刷新", app_id)
            else:
                logger.warning("端口 %s token 刷新失败: %s", app_id, detail)


def _sync_single_account(account, report_date, retry_count=1):
    """同步单个账户的消耗数据，支持重试"""
    import time
    adv_id = _to_advertiser_id(account["account_id"])
    if adv_id is None:
        return None, True

    for attempt in range(1, retry_count + 1):
        try:
            client = _get_client_for_account(account)

            standard_data = _fetch_offline_report_with_column_fallback(
                client,
                adv_id,
                report_date,
                is_chengfeng=account.get("platform") == "乘风",
            )
            agg = _aggregate_report_fields(standard_data)
            cost_standard = agg.pop("fee", 0.0)

            cost_simple = 0.0
            easy_agg = {}
            try:
                easy_data = _fetch_easy_sync_report(
                    client,
                    adv_id,
                    report_date,
                )
                easy_agg = _aggregate_report_fields(easy_data)
                cost_simple = easy_agg.pop("fee", 0.0)
            except Exception as e:
                logger.debug("简单投拉取失败 account=%s: %s", account["account_id"], e)

            for key in easy_agg:
                agg[key] = agg.get(key, 0) + easy_agg[key]
            cost_standard = round(cost_standard, 2)
            cost_simple = round(cost_simple, 2)

            imp = agg.get("impression", 0)
            clk = agg.get("click", 0)
            agg["ctr"] = round(clk / imp * 100, 2) if imp > 0 else 0

            if cost_standard == 0 and cost_simple == 0 and _has_recent_positive_consumption(account["id"], report_date):
                logger.warning(
                    "子账号 %s 在 %s 接口返回 0，但最近7天有消耗，保留原状态并标记失败等待补跑",
                    account["account_id"], report_date,
                )
                return 0.0, True

            models.upsert_consumption(
                sub_account_id=account["id"],
                report_date=report_date,
                cost_simple=cost_simple,
                cost_standard=cost_standard,
                impression=int(agg.get("impression", 0)),
                click=int(agg.get("click", 0)),
                interaction=int(agg.get("interaction", 0)),
                ctr=agg.get("ctr", 0),
                leads=int(agg.get("leads", 0)),
                message_consult=int(agg.get("message_consult", 0)),
                msg_leads_num=int(agg.get("msg_leads_num", 0)),
                valid_leads=int(agg.get("valid_leads", 0)),
                like_count=int(agg.get("like", 0)),
                comment_count=int(agg.get("comment", 0)),
                collect_count=int(agg.get("collect", 0)),
                follow_count=int(agg.get("follow", 0)),
                share_count=int(agg.get("share", 0)),
                form_submit=int(agg.get("form_submit", 0)),
                telephone_click=int(agg.get("telephone_click", 0)),
                initiative_message=int(agg.get("initiative_message", 0)),
                action_button_click=int(agg.get("action_button_click", 0)),
                search_cmt_click=int(agg.get("search_cmt_click", 0)),
                i_user_num=int(agg.get("i_user_num", 0)),
                ti_user_num=int(agg.get("ti_user_num", 0)),
                **_extra_consumption_metrics(agg),
            )
            return cost_standard + cost_simple, False

        except Exception as e:
            if attempt < retry_count:
                logger.warning("同步子账号 %s 失败(第%d次)，3秒后重试: %s", account["account_id"], attempt, e)
                time.sleep(3)
            else:
                logger.error("同步子账号 %s 失败(重试%d次后放弃): %s", account["account_id"], retry_count, e)
                return 0.0, True


def sync_daily_consumption(report_date=None):
    """
    每日同步消耗数据：按端口分组并发拉取标准投和简单投离线报表写入数据库
    report_date: str YYYY-MM-DD，默认昨天
    """
    if not report_date:
        report_date = (date.today() - timedelta(days=1)).isoformat()

    logger.info("开始同步 %s 的消耗数据", report_date)

    all_accounts = models.get_all_sub_accounts()
    if not all_accounts:
        logger.info("没有子账号，跳过")
        return

    _ensure_all_tokens()

    # 刷新端口广告主缓存，确保账号正确路由到对应端口
    _refresh_client_advertiser_cache()

    # 按端口分组账号，减少端口切换开销
    port_groups = {}  # {app_id: [accounts]}
    uncached = []
    for account in all_accounts:
        adv_id = _to_advertiser_id(account["account_id"])
        if adv_id is None:
            continue
        client = _get_client_for_account(account)
        aid = client.app_id
        if aid not in port_groups:
            port_groups[aid] = []
        port_groups[aid].append(account)

    success_count = 0
    fail_count = 0
    skip_count = 0
    total_fee = 0.0
    lock = __import__('threading').Lock()

    def _sync_batch(accounts, port_label):
        nonlocal success_count, fail_count, total_fee
        batch_ok = 0
        batch_fail = 0
        batch_fee = 0.0
        for account in accounts:
            fee, failed = _sync_single_account(account, report_date, retry_count=2)
            if failed:
                batch_fail += 1
            else:
                batch_ok += 1
                batch_fee += fee or 0
        with lock:
            success_count += batch_ok
            fail_count += batch_fail
            total_fee += batch_fee
        logger.info("端口 %s 批量同步完成: 成功=%d 失败=%d", port_label, batch_ok, batch_fail)

    # 各端口并发执行（端口间并行，端口内串行避免API限频）
    from concurrent.futures import ThreadPoolExecutor, as_completed
    with ThreadPoolExecutor(max_workers=len(port_groups)) as executor:
        futures = []
        for app_id, accounts in port_groups.items():
            futures.append(executor.submit(_sync_batch, accounts, app_id))
        for f in as_completed(futures):
            try:
                f.result()
            except Exception as e:
                logger.error("端口批量同步异常: %s", e)

    logger.info("消耗数据同步完成 %s: 成功=%d 失败=%d 跳过=%d 总消耗=%.2f",
                report_date, success_count, fail_count, skip_count, total_fee)


def sync_single_account(sub_account_id, report_date=None):
    """同步单个子账号的消耗数据（标准投+简单投）"""
    if not report_date:
        report_date = (date.today() - timedelta(days=1)).isoformat()

    conn = models.get_db()
    row = conn.execute(
        """SELECT sa.*, p.platform, p.project_name
           FROM sub_accounts sa
           JOIN projects p ON p.id = sa.project_id
           WHERE sa.id=?""",
        (sub_account_id,),
    ).fetchone()
    conn.close()
    if not row:
        logger.error("子账号 %s 不存在", sub_account_id)
        return

    account = dict(row)
    client = _get_client_for_account(account)
    adv_id = _to_advertiser_id(account["account_id"])
    if adv_id is None:
        logger.error("子账号 %s 的 account_id 不是纯数字，无法同步", account["account_id"])
        return

    # 标准投
    standard_data = _fetch_offline_report_with_column_fallback(
        client,
        adv_id,
        report_date,
        is_chengfeng=account.get("platform") == "乘风",
    )
    agg = _aggregate_report_fields(standard_data)
    cost_standard = agg.pop("fee", 0.0)

    # 简单投
    cost_simple = 0.0
    try:
        easy_data = _fetch_easy_sync_report(client, adv_id, report_date)
        easy_agg = _aggregate_report_fields(easy_data)
        cost_simple = easy_agg.pop("fee", 0.0)
        for key in easy_agg:
            agg[key] = agg.get(key, 0) + easy_agg[key]
    except Exception as e:
        logger.debug("简单投拉取失败 account=%s: %s", account["account_id"], e)

    cost_standard = round(cost_standard, 2)
    cost_simple = round(cost_simple, 2)

    imp = agg.get("impression", 0)
    clk = agg.get("click", 0)
    agg["ctr"] = round(clk / imp * 100, 2) if imp > 0 else 0

    if cost_standard == 0 and cost_simple == 0 and _has_recent_positive_consumption(account["id"], report_date):
        logger.warning(
            "单账号 %s 在 %s 接口返回 0，但最近7天有消耗，跳过写入避免覆盖为0",
            account["account_id"], report_date,
        )
        return

    models.upsert_consumption(
        sub_account_id=account["id"],
        report_date=report_date,
        cost_simple=cost_simple,
        cost_standard=cost_standard,
        impression=int(agg.get("impression", 0)),
        click=int(agg.get("click", 0)),
        interaction=int(agg.get("interaction", 0)),
        ctr=agg.get("ctr", 0),
        leads=int(agg.get("leads", 0)),
        message_consult=int(agg.get("message_consult", 0)),
        msg_leads_num=int(agg.get("msg_leads_num", 0)),
        valid_leads=int(agg.get("valid_leads", 0)),
        like_count=int(agg.get("like", 0)),
        comment_count=int(agg.get("comment", 0)),
        collect_count=int(agg.get("collect", 0)),
        follow_count=int(agg.get("follow", 0)),
        share_count=int(agg.get("share", 0)),
        form_submit=int(agg.get("form_submit", 0)),
        telephone_click=int(agg.get("telephone_click", 0)),
        initiative_message=int(agg.get("initiative_message", 0)),
        action_button_click=int(agg.get("action_button_click", 0)),
        search_cmt_click=int(agg.get("search_cmt_click", 0)),
        i_user_num=int(agg.get("i_user_num", 0)),
        ti_user_num=int(agg.get("ti_user_num", 0)),
    )
    logger.info("单账号同步完成: %s (%s) 标准投=%.2f 简单投=%.2f", account["account_id"], report_date, cost_standard, cost_simple)


def backfill_missing_dates():
    """检测并补拉缺失日期的消耗数据（服务器启动时自动调用）"""
    conn = models.get_db()
    # 获取已有数据的日期范围
    row = conn.execute(
        "SELECT MIN(date), MAX(date) FROM daily_consumption"
    ).fetchone()
    conn.close()

    if not row or not row[0]:
        logger.info("无历史数据，跳过自动补缺")
        return

    earliest = datetime.strptime(row[0], "%Y-%m-%d").date()
    latest = datetime.strptime(row[1], "%Y-%m-%d").date()
    yesterday = date.today() - timedelta(days=1)

    # 从最早数据日期的下一天到昨天，找出缺失的日期
    check_start = earliest + timedelta(days=1)
    check_end = yesterday

    if check_start > check_end:
        return

    # 获取已有日期集合
    conn = models.get_db()
    existing = set(r[0] for r in conn.execute(
        "SELECT DISTINCT date FROM daily_consumption WHERE date >= ? AND date <= ?",
        (check_start.isoformat(), check_end.isoformat()),
    ).fetchall())
    conn.close()

    # 找出缺失日期
    missing = []
    d = check_start
    while d <= check_end:
        if d.isoformat() not in existing:
            missing.append(d.isoformat())
        d += timedelta(days=1)

    if not missing:
        logger.info("数据完整，无缺失日期")
        return

    logger.info("检测到 %d 个缺失日期: %s，开始补拉...", len(missing), ", ".join(missing))
    for dt in missing:
        try:
            sync_daily_consumption(dt)
            logger.info("补拉完成: %s", dt)
        except Exception as e:
            logger.error("补拉失败: %s - %s", dt, e)

    logger.info("缺失日期补拉完成，共处理 %d 天", len(missing))


def sync_projects_historical(project_ids):
    """
    按项目ID同步���耗数据（标投+简投）
    - 已有数据的账号：重拉最近120天（upsert覆盖，保证季度口径持续校准）
    - 新账号：从2025-01-01拉取全部历史
    """
    yesterday = date.today() - timedelta(days=1)
    recent_start = yesterday - timedelta(days=120)

    logger.info("开始按项目同步: 项目ID=%s", project_ids)

    # 获取指定项目下的所有自动拉取子账号
    conn = models.get_db()
    placeholders = ",".join("?" for _ in project_ids)
    rows = conn.execute(
        f"""SELECT sa.*, p.platform, p.project_name FROM sub_accounts sa
            JOIN projects p ON p.id = sa.project_id
            WHERE sa.project_id IN ({placeholders})
            ORDER BY sa.id""",
        project_ids,
    ).fetchall()

    # 检查哪些子账号有已有数据
    has_data = set()
    date_rows = conn.execute(
        f"""SELECT DISTINCT dc.sub_account_id
            FROM daily_consumption dc
            JOIN sub_accounts sa ON dc.sub_account_id=sa.id
            WHERE sa.project_id IN ({placeholders})""",
        project_ids,
    ).fetchall()
    for r in date_rows:
        has_data.add(r["sub_account_id"])
    conn.close()

    auto_accounts = [dict(r) for r in rows]

    if not auto_accounts:
        logger.info("指定项目下没有自动拉取类型的子账号")
        return 0

    total_records = 0
    for account in auto_accounts:
        adv_id = _to_advertiser_id(account["account_id"])
        if adv_id is None:
            continue
        has_existing = account["id"] in has_data

        if has_existing:
            sync_start = recent_start
            logger.info("子账号 %s 近期同步: %s ~ %s", account["account_id"], sync_start, yesterday)
        else:
            # 新账号：从2025-01-01拉取全量历史
            sync_start = date(2025, 1, 1)
            logger.info("子账号 %s 全量同步: %s ~ %s", account["account_id"], sync_start, yesterday)

        try:
            account_client = _get_client_for_account(account)

            # ── 标准投 ──
            std_by_date = {}
            report_data = _fetch_offline_report_with_column_fallback(
                account_client,
                adv_id,
                sync_start.isoformat(),
                yesterday.isoformat(),
                is_chengfeng=account.get("platform") == "乘风",
            )
            if report_data:
                for item in report_data:
                    item_date = item.get("time", sync_start.isoformat())
                    std_by_date.setdefault(item_date, {})
                    _aggregate_report_fields([item], std_by_date[item_date])

            # ── 简单投 ──
            easy_by_date = {}
            try:
                easy_data = _fetch_easy_sync_report(
                    account_client,
                    adv_id,
                    sync_start.isoformat(),
                    yesterday.isoformat(),
                )
                if easy_data:
                    for item in easy_data:
                        item_date = item.get("time", sync_start.isoformat())
                        easy_by_date.setdefault(item_date, {})
                        _aggregate_report_fields([item], easy_by_date[item_date])
            except Exception as e:
                logger.debug("简单投拉取失败 account=%s: %s", account["account_id"], e)

            # ── 合并写入 ──
            all_dates = set(std_by_date.keys()) | set(easy_by_date.keys())
            for item_date in sorted(all_dates):
                std = std_by_date.get(item_date, {})
                easy = easy_by_date.get(item_date, {"fee": 0})
                cost_std = std.get("fee", 0)
                cost_easy = easy.get("fee", 0)
                if cost_std == 0 and cost_easy == 0:
                    continue
                merged = dict(std)
                for key, val in easy.items():
                    if key == "fee":
                        continue
                    merged[key] = merged.get(key, 0) + val
                imp = merged.get("impression", 0)
                clk = merged.get("click", 0)
                ctr = round(clk / imp * 100, 2) if imp > 0 else 0
                models.upsert_consumption(
                    sub_account_id=account["id"],
                    report_date=item_date,
                    cost_standard=cost_std,
                    cost_simple=cost_easy,
                    impression=int(imp),
                    click=int(clk),
                    interaction=int(merged.get("interaction", 0)),
                    ctr=ctr,
                    leads=int(merged.get("leads", 0)),
                    message_consult=int(merged.get("message_consult", 0)),
                    msg_leads_num=int(merged.get("msg_leads_num", 0)),
                    valid_leads=int(merged.get("valid_leads", 0)),
                    like_count=int(merged.get("like", 0)),
                    comment_count=int(merged.get("comment", 0)),
                    collect_count=int(merged.get("collect", 0)),
                    follow_count=int(merged.get("follow", 0)),
                    share_count=int(merged.get("share", 0)),
                    form_submit=0,
                    telephone_click=int(merged.get("telephone_click", 0)),
                    initiative_message=int(merged.get("initiative_message", 0)),
                    action_button_click=int(merged.get("action_button_click", 0)),
                    search_cmt_click=int(merged.get("search_cmt_click", 0)),
                    i_user_num=int(merged.get("i_user_num", 0)),
                    ti_user_num=int(merged.get("ti_user_num", 0)),
                    **_extra_consumption_metrics(merged),
                )
                total_records += 1

            logger.info("子账号 %s 同步完成", account["account_id"])

        except Exception as e:
            logger.error("同步子账号 %s 失败: %s", account["account_id"], e)

    logger.info("按项目增量同步完成，共 %d 条新记录", total_records)
    return total_records


def backfill_account_history(sub_account_id):
    """新绑定子账号时自动补拉历史消耗（标投+简投，从2025-01-01到昨天）。"""
    import time
    conn = models.get_db()
    row = conn.execute(
        """SELECT sa.*, p.platform, p.project_name FROM sub_accounts sa
           JOIN projects p ON p.id = sa.project_id
           WHERE sa.id=?""",
        (sub_account_id,),
    ).fetchone()
    conn.close()
    if not row:
        return 0

    account = dict(row)
    adv_id = _to_advertiser_id(account["account_id"])
    if adv_id is None:
        return 0

    yesterday = date.today() - timedelta(days=1)
    start = date(2025, 1, 1)
    if start > yesterday:
        return 0

    _prepare_report_fetch()

    try:
        client = _get_client_for_account(account)
    except Exception as e:
        logger.error("补拉历史-获取client失败: %s", e)
        return 0

    total = 0
    chunk_days = 6
    date_chunks = []
    cur = start
    while cur <= yesterday:
        chunk_end = min(cur + timedelta(days=chunk_days - 1), yesterday)
        date_chunks.append((cur.isoformat(), chunk_end.isoformat()))
        cur = chunk_end + timedelta(days=1)

    def _date_key(item, default_date):
        raw = item.get("time") or item.get("date") or item.get("report_date") or default_date
        return str(raw)[:10]

    def _merge_metrics(target, item):
        for key in (
            "fee", "impression", "click", "interaction",
            "message_consult", "msg_leads_num", "valid_leads", "like", "comment", "collect",
            "follow", "share", "initiative_message", "action_button_click",
            "search_cmt_click", "i_user_num", "ti_user_num",
        ):
            target[key] = target.get(key, 0.0) + _safe_float(item.get(key, 0))
        target["leads"] = target.get("leads", 0.0) + _safe_float(_metric_value(item, "leads", "msg_leads_form_submit_num"))
        target["telephone_click"] = target.get("telephone_click", 0.0) + _safe_float(_metric_value(item, "phone_call_cnt", "telephone_click", "phoneCallCnt"))

    logger.info(
        "补拉历史启动: %s (%s) %s~%s chunks=%d",
        account.get("account_name", ""), account["account_id"], start, yesterday, len(date_chunks),
    )

    for chunk_start, chunk_end in date_chunks:
        try:
            std_by_date = {}
            std_data = _fetch_offline_report_with_column_fallback(
                client,
                adv_id,
                chunk_start,
                chunk_end,
                is_chengfeng=account.get("platform") == "乘风",
            )
            for item in std_data or []:
                item_date = _date_key(item, chunk_start)
                std_by_date.setdefault(item_date, {})
                _merge_metrics(std_by_date[item_date], item)

            easy_by_date = {}
            try:
                easy_data = _fetch_easy_sync_report(
                    client,
                    adv_id,
                    chunk_start,
                    chunk_end,
                )
                for item in easy_data or []:
                    item_date = _date_key(item, chunk_start)
                    easy_by_date.setdefault(item_date, {})
                    _merge_metrics(easy_by_date[item_date], item)
            except Exception as easy_err:
                logger.debug("补拉历史-简单投失败 account=%s %s~%s: %s", account["account_id"], chunk_start, chunk_end, easy_err)

            all_dates = sorted(set(std_by_date.keys()) | set(easy_by_date.keys()))
            for item_date in all_dates:
                std = std_by_date.get(item_date, {})
                easy = easy_by_date.get(item_date, {})
                cost_std = _safe_float(std.get("fee", 0))
                cost_easy = _safe_float(easy.get("fee", 0))
                if cost_std <= 0 and cost_easy <= 0:
                    continue
                merged = dict(std)
                for key, val in easy.items():
                    if key == "fee":
                        continue
                    merged[key] = merged.get(key, 0) + val
                imp = merged.get("impression", 0)
                clk = merged.get("click", 0)
                merged["ctr"] = round(clk / imp * 100, 2) if imp > 0 else 0
                models.upsert_consumption(
                    sub_account_id=account["id"], report_date=item_date,
                    cost_standard=cost_std, cost_simple=cost_easy,
                    impression=int(merged.get("impression", 0)),
                    click=int(merged.get("click", 0)),
                    interaction=int(merged.get("interaction", 0)),
                    ctr=merged.get("ctr", 0),
                    leads=int(merged.get("leads", 0)),
                    message_consult=int(merged.get("message_consult", 0)),
                    msg_leads_num=int(merged.get("msg_leads_num", 0)),
                    valid_leads=int(merged.get("valid_leads", 0)),
                    like_count=int(merged.get("like", 0)),
                    comment_count=int(merged.get("comment", 0)),
                    collect_count=int(merged.get("collect", 0)),
                    follow_count=int(merged.get("follow", 0)),
                    share_count=int(merged.get("share", 0)),
                    form_submit=0,
                    telephone_click=int(merged.get("telephone_click", 0)),
                    initiative_message=int(merged.get("initiative_message", 0)),
                    action_button_click=int(merged.get("action_button_click", 0)),
                    search_cmt_click=int(merged.get("search_cmt_click", 0)),
                    i_user_num=int(merged.get("i_user_num", 0)),
                    ti_user_num=int(merged.get("ti_user_num", 0)),
                    **_extra_consumption_metrics(merged),
                )
                total += 1
            if all_dates:
                logger.info("补拉历史分块完成 account=%s %s~%s 写入%d天", account["account_id"], chunk_start, chunk_end, len(all_dates))
        except Exception as exc:
            logger.warning("补拉历史分块失败 account=%s %s~%s: %s", account["account_id"], chunk_start, chunk_end, exc)
        time.sleep(0.05)

    logger.info("补拉历史完成: %s (%s) 新增%d条", account["account_name"], account["account_id"], total)
    return total



def sync_historical_consumption():
    """全量历史数据同步：委托给 sync_projects_historical 处理所有项目"""
    conn = models.get_db()
    rows = conn.execute("SELECT DISTINCT id FROM projects").fetchall()
    conn.close()
    all_pids = [r["id"] for r in rows]
    if not all_pids:
        logger.info("没有项目，跳过全量同步")
        return
    sync_projects_historical(all_pids)


def sync_sub_account_details():
    """从MPI拉取子账号详情，批量更新 company_name 和 virtual_seller_id 到数据库"""
    total_count = 0
    for client in get_all_clients():
        details = client.fetch_all_sub_account_details()
        if not details:
            continue
        count = 0
        with models.db_connection() as conn:
            for item in details:
                adv_id = str(item.get("advertiser_id"))
                vsid = item.get("virtual_seller_id")
                company = item.get("company_name", "")
                if not adv_id:
                    continue
                if company:
                    conn.execute("UPDATE sub_accounts SET company_name=? WHERE account_id=?", (company, adv_id))
                if vsid:
                    conn.execute("UPDATE sub_accounts SET virtual_seller_id=? WHERE account_id=?", (vsid, adv_id))
                    count += 1
        logger.info("子账号详情同步完成 app_id=%s: %d 条更新", client.app_id, count)
        total_count += count
    # 同步完成后刷新端口广告主缓存
    _refresh_client_advertiser_cache()
    return total_count


# ---- 多端口客户端管理 ----

def _has_chengfeng_projects():
    """检查是否存在乘风平台的项目"""
    try:
        conn = models.get_db()
        row = conn.execute("SELECT COUNT(*) as cnt FROM projects WHERE platform='乘风'").fetchone()
        conn.close()
        return row and row["cnt"] > 0
    except Exception:
        return False


def get_all_clients():
    """返回所有已配置且需要的端口客户端列表"""
    clients = [XhsApiClient()]
    if config.XHS_APP_ID_2 and _has_chengfeng_projects():
        clients.append(XhsApiClient(
            app_id=config.XHS_APP_ID_2,
            secret=config.XHS_SECRET_2,
            user_id=config.XHS_USER_ID_2,
        ))
    if config.XHS_APP_ID_3:
        clients.append(XhsApiClient(
            app_id=config.XHS_APP_ID_3,
            secret=config.XHS_SECRET_3,
            user_id=config.XHS_USER_ID_3,
        ))
    return clients


def validate_advertiser_access(advertiser_id, report_date=None):
    """Validate an advertiser id against active ports and cache it when accessible."""
    adv_id = str(advertiser_id).strip()
    if not adv_id.isdigit():
        return {"ok": False, "advertiser_id": adv_id, "error": "invalid_advertiser_id", "ports": []}

    if not report_date:
        report_date = (date.today() - timedelta(days=1)).isoformat()

    port_results = []
    for client in get_all_clients():
        try:
            client.fetch_offline_report(
                advertiser_id=int(adv_id),
                start_date=report_date,
                end_date=report_date,
                level="account",
            )
            cached = models.get_advertiser(adv_id)
            advertiser_name = (cached or {}).get("advertiser_name") or f"投放账号 {adv_id}"
            result = {
                "ok": True,
                "advertiser_id": adv_id,
                "advertiser_name": advertiser_name,
                "app_id": str(client.app_id),
            }
            models.save_advertisers([result])
            return result
        except Exception as exc:
            port_results.append({
                "app_id": str(client.app_id),
                "error": str(exc)[:240],
            })

    return {
        "ok": False,
        "advertiser_id": adv_id,
        "error": "no_active_port_access",
        "ports": port_results,
    }


# 端口广告主ID缓存（用于判断账号属于哪个端口）
_client_advertiser_cache = {}  # {app_id: set(advertiser_ids)}


def _refresh_client_advertiser_cache():
    """刷新各端口广告主缓存"""
    global _client_advertiser_cache, _client_advertiser_status
    _client_advertiser_cache = {}
    _client_advertiser_status = {}
    for client in get_all_clients():
        try:
            if not hasattr(client, "fetch_all_sub_account_details"):
                _client_advertiser_status[str(client.app_id)] = {"ok": True, "error": "no advertiser-list method", "count": 0}
                continue
            token_info = models.get_token(app_id=client.app_id)
            if not token_info or not token_info.get("access_token"):
                _client_advertiser_status[str(client.app_id)] = {"ok": False, "error": "无access_token", "count": 0}
                continue
            # 拉取子账号列表获取该端口的广告主ID
            details = client.fetch_all_sub_account_details()
            aid_set = set()
            for item in details:
                adv_id = str(item.get("advertiser_id", ""))
                vsid = str(item.get("virtual_seller_id", ""))
                if adv_id:
                    aid_set.add(adv_id)
                if vsid and vsid != adv_id:
                    aid_set.add(vsid)
            _client_advertiser_cache[client.app_id] = aid_set
            _client_advertiser_status[str(client.app_id)] = {"ok": True, "error": "", "count": len(aid_set)}
        except XhsApiPermissionError as e:
            _client_advertiser_status[str(client.app_id)] = {
                "ok": True,
                "limited": True,
                "error": str(e),
                "count": 0,
            }
            logger.info("刷新端口 %s 广告主缓存受限，继续按项目端口路由: %s", client.app_id, e)
        except Exception as e:
            _client_advertiser_status[str(client.app_id)] = {"ok": False, "error": str(e), "count": 0}
            logger.warning("刷新端口 %s 广告主缓存失败: %s", client.app_id, e)


def _client_status(client):
    return _client_advertiser_status.get(str(getattr(client, "app_id", ""))) or {}


def _client_unavailable(client):
    status = _client_status(client)
    return bool(status) and not status.get("ok")


def _account_in_available_client_cache(account):
    account_id = str(account.get("account_id", ""))
    for app_id, ids in _client_advertiser_cache.items():
        status = _client_advertiser_status.get(str(app_id)) or {}
        if status.get("ok") and account_id in ids:
            return True
    return False


def _should_use_chengfeng_realtime(account, client):
    if not hasattr(client, "fetch_chengfeng_realtime_report"):
        return False
    if account.get("platform") == "乘风":
        return True
    return bool(config.XHS_APP_ID_2 and str(client.app_id) == str(config.XHS_APP_ID_2))


def _get_port2_client():
    if not config.XHS_APP_ID_2:
        return None
    for client in get_all_clients():
        if str(client.app_id) == str(config.XHS_APP_ID_2):
            return client
    return None


def _get_port2_client_from(clients):
    if not config.XHS_APP_ID_2:
        return None
    for client in clients:
        if str(client.app_id) == str(config.XHS_APP_ID_2):
            return client
    return None


def _get_client_for_account(account):
    """根据子账号信息找到对应的端口客户端"""
    clients = get_all_clients()
    default_client = clients[0] if clients else XhsApiClient()
    if account.get("platform") == "乘风":
        port2_client = _get_port2_client_from(clients)
        if port2_client:
            return port2_client
    cached = _get_cached_client_for_account(account)
    if cached:
        return cached
    account_id = str(account.get("account_id", ""))
    if _client_advertiser_cache and config.XHS_APP_ID_2:
        port2_accounts = _client_advertiser_cache.get(config.XHS_APP_ID_2) or _client_advertiser_cache.get(str(config.XHS_APP_ID_2)) or set()
        if account.get("platform") == "乘风" and account_id in port2_accounts:
            for client in clients:
                if str(client.app_id) == str(config.XHS_APP_ID_2):
                    return client
        return default_client
    if account.get("platform") == "乘风" and config.XHS_APP_ID_2:
        for client in clients:
            if str(client.app_id) == str(config.XHS_APP_ID_2):
                return client
    return default_client


def _get_cached_client_for_account(account):
    account_id = str(account.get("account_id", ""))
    for client in get_all_clients():
        if client.app_id in _client_advertiser_cache:
            if account_id in _client_advertiser_cache[client.app_id]:
                return client
    return None


def _fallback_clients_for_account(account, primary_client=None):
    """Return alternate MPI clients in a stable order for account-port fallback."""
    clients = get_all_clients()
    primary_app_id = str(getattr(primary_client, "app_id", ""))
    ordered = []
    seen = set()

    def add(client):
        if not client:
            return
        app_id = str(getattr(client, "app_id", ""))
        if not app_id or app_id == primary_app_id or app_id in seen:
            return
        ordered.append(client)
        seen.add(app_id)

    cached = _get_cached_client_for_account(account)
    add(cached)

    port2_client = _get_port2_client_from(clients)
    if account.get("platform") == "乘风":
        add(port2_client)
    else:
        # Non-乘风 accounts are often on the third GUI port; try non-port2
        # clients first before falling back to 乘风 port.
        for client in clients:
            if port2_client and str(client.app_id) == str(port2_client.app_id):
                continue
            add(client)
        add(port2_client)

    for client in clients:
        add(client)
    return ordered


def _get_account_record_for_client_lookup(account_id):
    """根据 account_id 查询本地账号和项目平台信息"""
    try:
        conn = models.get_db()
        row = conn.execute(
            """SELECT sa.account_id, p.platform
               FROM sub_accounts sa
               JOIN projects p ON sa.project_id=p.id
               WHERE sa.account_id=?
               LIMIT 1""",
            (str(account_id),),
        ).fetchone()
        conn.close()
        return dict(row) if row else None
    except Exception as e:
        logger.warning("查询账号 %s 项目平台失败: %s", account_id, e)
        return None


def _get_client_for_account_id(account_id):
    """根据 account_id 找到对应的端口客户端"""
    account_id = str(account_id)
    account = _get_account_record_for_client_lookup(account_id)
    if account:
        client = _get_client_for_account(account)
        if client:
            return client
    for client in get_all_clients():
        if client.app_id in _client_advertiser_cache:
            if account_id in _client_advertiser_cache[client.app_id]:
                return client
    return XhsApiClient()


def _get_client_for_accounts(accounts):
    """根据一批账号找到对应的端口客户端（取第一个匹配的）"""
    for account in accounts:
        client = _get_client_for_account(account)
        return client
    return XhsApiClient()


def _get_client_for_id_list(id_list):
    """根据一批 account_id 找到对应的端口客户端"""
    for aid in id_list:
        return _get_client_for_account_id(aid)
    return XhsApiClient()


def _normalise_spu_item(item, account):
    if not isinstance(item, dict):
        return None
    spu_id = (
        item.get("spu_id")
        or item.get("spuId")
        or item.get("main_spu_id")
        or item.get("mainSpuId")
        or item.get("id")
        or item.get("spuID")
        or ""
    )
    spu_name = (
        item.get("spu_name")
        or item.get("spuName")
        or item.get("name")
        or item.get("product_name")
        or item.get("productName")
        or ""
    )
    spu_id = str(spu_id).strip()
    spu_name = str(spu_name).strip()
    if not spu_id and not spu_name:
        return None
    return {
        "spu_id": spu_id,
        "spu_name": spu_name or f"SPU {spu_id}",
        "account_id": str(account.get("account_id", "")),
        "account_name": account.get("account_name", ""),
        "main_spu_id": str(item.get("main_spu_id") or item.get("mainSpuId") or ""),
        "spu_status": item.get("spu_status") or item.get("spuStatus"),
        "taxonomy_code": item.get("taxonomy_code") or item.get("taxonomyCode") or "",
        "brand_id": str(item.get("brand_id") or item.get("brandId") or ""),
        "nick_name_list": item.get("nick_name_list") or item.get("nickNameList") or [],
        "series_list": item.get("series_list") or item.get("seriesList") or [],
        "pic_url_list": item.get("pic_url_list") or item.get("picUrlList") or [],
    }


def fetch_spu_list_for_accounts(accounts, keyword=None, max_accounts=6):
    """按项目关联子账号批量拉取 SPU 列表，返回去重后的产品锚点。"""
    if not accounts:
        return {"spus": [], "accounts": 0, "errors": []}

    dedup = {}
    errors = []
    scanned = 0
    for account in accounts[:max_accounts]:
        advertiser_id = _to_advertiser_id(account.get("account_id"))
        if advertiser_id is None:
            continue
        scanned += 1
        preferred = _get_client_for_account(account)
        clients = [preferred] + [c for c in get_all_clients() if c.app_id != preferred.app_id]
        for client in clients:
            try:
                raw_items = client.fetch_spu_list(advertiser_id, keyword=keyword)
                for raw in raw_items:
                    spu = _normalise_spu_item(raw, account)
                    if not spu:
                        continue
                    key = spu["spu_id"] or spu["spu_name"]
                    if key not in dedup:
                        dedup[key] = spu
                break
            except Exception as exc:
                errors.append({
                    "account_id": str(account.get("account_id", "")),
                    "account_name": account.get("account_name", ""),
                    "app_id": str(client.app_id),
                    "error": str(exc)[:240],
                })
                continue

    spus = sorted(dedup.values(), key=lambda item: (item.get("spu_name") or "", item.get("spu_id") or ""))
    return {"spus": spus, "accounts": scanned, "errors": errors[:20]}


def _bili_response_filename(headers):
    disposition = (headers or {}).get("Content-Disposition") or (headers or {}).get("content-disposition") or ""
    match = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)', disposition)
    return match.group(1) if match else ""


def parse_bili_async_report_content(content, content_type="", filename=""):
    text = content.decode("utf-8-sig") if isinstance(content, (bytes, bytearray)) else str(content or "")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []
    return [dict(row) for row in reader if any(str(value or "").strip() for value in row.values())]


class BiliApiClient:
    """B站三连 Marketing API 客户端。"""

    def __init__(self, access_token=None, base_url=None, adp_version=None, app_id=None):
        self.app_id = app_id or config.BILI_CLIENT_ID
        self.access_token = access_token
        self.base_url = (base_url or config.BILI_BASE_URL).rstrip("/")
        self.adp_version = str(adp_version or config.BILI_ADP_VERSION or "6")

    def get_token_by_auth_code(self, auth_code):
        if not auth_code:
            raise Exception("缺少授权 code")
        if not config.BILI_CLIENT_ID or not config.BILI_CLIENT_SECRET or not config.BILI_REDIRECT_URI:
            raise Exception("B站 OAuth 环境变量未配置完整")
        resp = requests.post(
            config.BILI_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "client_id": config.BILI_CLIENT_ID,
                "client_secret": config.BILI_CLIENT_SECRET,
                "code": auth_code,
                "redirect_uri": config.BILI_REDIRECT_URI,
            },
            timeout=_REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            raise Exception(f"B站授权失败: HTTP {resp.status_code} {resp.text[:200]}")
        data = resp.json()
        code = data.get("code", data.get("errno", 0))
        if str(code) not in ("0", "200", "OK"):
            raise Exception(f"B站授权失败: {data.get('message') or data.get('msg') or data}")
        result = data.get("data") if isinstance(data.get("data"), dict) else data
        access_token = result.get("access_token", "")
        refresh_token = result.get("refresh_token", "")
        expires_in = int(result.get("expires_in") or result.get("access_token_expires_in") or 86400)
        if not access_token:
            raise Exception("B站授权响应中未找到 access_token")
        models.save_token(access_token, refresh_token, expires_in, app_id=config.BILI_CLIENT_ID)
        self.access_token = access_token
        return models.get_token(app_id=config.BILI_CLIENT_ID)

    def _get_access_token(self):
        if self.access_token:
            return self.access_token
        token_info = models.get_token(app_id=self.app_id)
        if token_info and token_info.get("access_token"):
            self.access_token = token_info["access_token"]
            return self.access_token
        if config.BILI_ACCESS_TOKEN:
            self.access_token = config.BILI_ACCESS_TOKEN
            return self.access_token
        raise Exception("未配置 B站 access_token，请先完成 B站 OAuth 授权")

    def refresh_access_token(self):
        refresh_token = models.get_refresh_token(app_id=self.app_id)
        if not refresh_token:
            raise Exception("无 B站 refresh_token，请重新授权")
        if not config.BILI_CLIENT_ID or not config.BILI_CLIENT_SECRET:
            raise Exception("B站 OAuth 环境变量未配置完整")
        resp = requests.post(
            config.BILI_REFRESH_URL,
            data={
                "grant_type": "refresh_token",
                "client_id": config.BILI_CLIENT_ID,
                "client_secret": config.BILI_CLIENT_SECRET,
                "refresh_token": refresh_token,
            },
            timeout=_REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            raise Exception(f"B站 token 刷新失败: HTTP {resp.status_code} {resp.text[:200]}")
        data = resp.json()
        code = data.get("code", data.get("errno", 0))
        if str(code) not in ("0", "200", "OK"):
            raise Exception(f"B站 token 刷新失败: {data.get('message') or data.get('msg') or data}")
        result = data.get("data") if isinstance(data.get("data"), dict) else data
        access_token = result.get("access_token", "")
        new_refresh = result.get("refresh_token", "")
        expires_in = int(result.get("expires_in") or result.get("access_token_expires_in") or 86400)
        if not access_token:
            raise Exception("B站刷新响应中未找到 access_token")
        models.save_token(access_token, new_refresh or refresh_token, expires_in, app_id=self.app_id)
        self.access_token = access_token
        return models.get_token(app_id=self.app_id)

    def _headers(self):
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._get_access_token()}",
        }

    def _request(self, method, path, params=None, json_body=None, raw=False):
        url = f"{self.base_url}/{path.lstrip('/')}"
        req_params = dict(params or {})
        req_params.setdefault("adp_version", self.adp_version)
        resp = requests.request(
            method,
            url,
            params=req_params,
            json=json_body,
            headers=self._headers(),
            timeout=_REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            raise Exception(f"B站API请求失败: HTTP {resp.status_code} {resp.text[:200]}")
        data = resp.json()
        code = data.get("code", data.get("errno", 0))
        if str(code) not in ("0", "200", "OK"):
            raise Exception(f"B站API返回错误: {data.get('message') or data.get('msg') or data}")
        if raw:
            return data
        return data.get("data", data)

    @staticmethod
    def _extract_list(data):
        if isinstance(data, list):
            return data
        if not isinstance(data, dict):
            return []
        for key in ("list", "items", "rows", "data", "records", "result"):
            value = data.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                nested = BiliApiClient._extract_list(value)
                if nested:
                    return nested
        return []

    @staticmethod
    def _extract_total(data):
        if not isinstance(data, dict):
            return None
        for key in ("total", "total_count", "count"):
            value = data.get(key)
            if value not in (None, ""):
                try:
                    return int(value)
                except (TypeError, ValueError):
                    return None
        return None

    def _list_pages(self, path, params=None, page_size=100):
        items = []
        page = 1
        while True:
            req_params = dict(params or {})
            req_params.update({"page": page, "size": page_size})
            data = self._request("GET", path, params=req_params)
            rows = self._extract_list(data)
            if not rows:
                break
            items.extend(rows)
            total = self._extract_total(data)
            response_size = page_size
            if isinstance(data, dict):
                try:
                    response_size = int(data.get("size") or data.get("page_size") or page_size)
                except (TypeError, ValueError):
                    response_size = page_size
            if total is None:
                if len(rows) < page_size:
                    break
            elif page * response_size >= total:
                break
            page += 1
        return items

    def list_agent_accounts(self):
        subjects = self._list_pages("/oauth2/subjects")
        accounts = []
        for subject in subjects:
            subject_type = subject.get("subject_type")
            subject_id = subject.get("subject_id")
            if subject_type in (None, "") or subject_id in (None, ""):
                continue
            accounts.extend(self._list_pages(
                "/oauth2/advertisers",
                params={"subject_type": subject_type, "subject_id": subject_id},
            ))
        return accounts

    def fetch_cash(self, account_id):
        return self._request("GET", "/report/v2/cash", params={"account_id": account_id})

    def fetch_custom_report_response(self, start_date, end_date, dimensions=None, metrics=None, filters=None, account_id=None, page=1, size=100):
        default_metrics = [
            item["key"] for item in BILI_ALL_COLUMNS
            if item.get("aggregate") != "skip" and item.get("format") != "text"
        ]
        safe_metrics = [
            "show_count",
            "click_count",
            "charged_cost_milli",
            "click_rate",
            "cost_per_click",
            "average_cost_per_thousand",
            "video_play_count",
            "video_like_count",
            "video_fav_count",
            "video_coin_count",
            "video_interact_count",
            "comment_url_click_count",
            "component_click_count",
            "dynamic_goods_url_click_count",
            "live_bottom_icon_click_count",
        ]
        body = {
            "start_time": start_date,
            "end_time": end_date,
            "dimensions": dimensions or ["date_time", "account_id"],
            "metrics": metrics or default_metrics,
            "filters": filters or [],
            "order_by": [{"field": "charged_cost_milli", "type": "2"}],
            "page": int(page or 1),
            "size": int(size or 100),
        }
        if account_id not in (None, ""):
            body["account_id"] = int(account_id)
        try:
            response = self._request("POST", "/report/v3/custom/query", json_body=body, raw=True)
        except Exception:
            if metrics:
                raise
            body["metrics"] = safe_metrics
            response = self._request("POST", "/report/v3/custom/query", json_body=body, raw=True)
        result = response.get("result") if isinstance(response, dict) and isinstance(response.get("result"), dict) else response.get("data", response)
        return {"response": response, "data": result, "rows": self._extract_list(result)}

    def fetch_custom_report(self, start_date, end_date, dimensions=None, metrics=None, filters=None, account_id=None, page=1, size=100):
        return self.fetch_custom_report_response(
            start_date,
            end_date,
            dimensions=dimensions,
            metrics=metrics,
            filters=filters,
            account_id=account_id,
            page=page,
            size=size,
        )["rows"]

    def create_async_custom_report(self, start_date, end_date, dimensions=None, metrics=None, filters=None, account_id=None):
        if account_id in (None, ""):
            raise Exception("B站异步报表创建缺少 account_id")
        body = {
            "account_id": int(account_id),
            "report_category": 3,
            "start_time": start_date,
            "end_time": end_date,
            "file_format": "csv",
            "file_name": f"{account_id}-bili-report-{start_date}-{end_date}",
            "dimensions": dimensions or ["date", "account_id"],
            "metrics": metrics or BILI_ASYNC_REPORT_METRIC_KEYS,
            "filters": filters or [{"field": "account_id", "values": [str(account_id)]}],
        }
        return self._request("POST", BILI_ASYNC_REPORT_CREATE_PATH, json_body=body)

    def get_async_custom_report_status(self, task_id, account_id=None):
        if account_id in (None, ""):
            raise Exception("B站异步报表状态查询缺少 account_id")
        return self._request("GET", BILI_ASYNC_REPORT_STATUS_PATH, params={"account_id": int(account_id), "task_id": task_id})

    def download_async_custom_report(self, download_url):
        resp = requests.request("GET", download_url, timeout=_REQUEST_TIMEOUT)
        if resp.status_code != 200:
            raise Exception(f"B站异步报表下载失败: HTTP {resp.status_code} {resp.text[:200]}")
        return {
            "content": resp.content,
            "content_type": resp.headers.get("Content-Type") or resp.headers.get("content-type") or "",
            "filename": _bili_response_filename(resp.headers),
        }

    def fetch_async_custom_report_rows(self, start_date, end_date, dimensions=None, metrics=None, filters=None, account_id=None, max_polls=BILI_ASYNC_REPORT_MAX_POLLS):
        task = self.create_async_custom_report(start_date, end_date, dimensions=dimensions, metrics=metrics, filters=filters, account_id=account_id)
        task_id = task.get("task_id") or task.get("taskId") or task.get("id")
        if not task_id:
            raise Exception(f"B站异步报表创建响应缺少 task_id: {task}")
        status = task
        for _ in range(max_polls):
            status = self.get_async_custom_report_status(task_id, account_id=account_id)
            state = status.get("status")
            if state is None:
                state = status.get("state")
            if state is None:
                state = status.get("task_status")
            state_text = str(state).upper() if state is not None else ""
            if state == 2 or state_text in ("2", "SUCCESS", "SUCCEEDED", "FINISHED", "DONE"):
                download_url = status.get("download_url") or status.get("downloadUrl") or status.get("url")
                if not download_url:
                    raise Exception(f"B站异步报表完成但缺少 download_url: {status}")
                downloaded = self.download_async_custom_report(download_url)
                return parse_bili_async_report_content(downloaded["content"], downloaded.get("content_type", ""), downloaded.get("filename", ""))
            if state == -1 or state_text in ("-1", "FAIL", "FAILED", "ERROR"):
                raise Exception(f"B站异步报表生成失败: {status}")
            sleep_time.sleep(BILI_ASYNC_REPORT_POLL_INTERVAL_SECONDS)
        raise Exception(f"B站异步报表生成超时: {status}")

    def fetch_account_launch_data(self, account_id, report_date):
        return self.fetch_account_launch_data_range(account_id, report_date, report_date)

    def fetch_account_launch_data_range_batch(self, account_ids, start_date, end_date, page_size=100):
        account_ids = [int(account_id) for account_id in account_ids if str(account_id or "").strip()]
        if not account_ids:
            return []
        tz = ZoneInfo("Asia/Shanghai")
        start_day = date.fromisoformat(str(start_date))
        end_day = date.fromisoformat(str(end_date))
        start_time = int(datetime.combine(start_day, time.min, tzinfo=tz).timestamp() * 1000)
        end_time = int(datetime.combine(end_day, time(23, 59, 59), tzinfo=tz).timestamp() * 1000)
        items = []
        page = 1
        while True:
            data = self._request(
                "POST",
                "/report/v2/agent/account/launch/data",
                json_body={
                    "account_ids": account_ids,
                    "group_type": 1,
                    "from_time": start_time,
                    "to_time": end_time,
                    "sort_field": "san_lian_launch_total_consume",
                    "sort_type": 0,
                    "page": page,
                    "page_size": page_size,
                },
            )
            rows = self._extract_list(data)
            if not rows:
                break
            items.extend(rows)
            total = self._extract_total(data)
            if total is None:
                if len(rows) < page_size:
                    break
            elif page * page_size >= total:
                break
            page += 1
        return items

    def fetch_account_launch_data_range(self, account_id, start_date, end_date, page_size=100):
        return self.fetch_account_launch_data_range_batch([account_id], start_date, end_date, page_size=page_size)

    def list_campaigns(self, account_id, **params):
        req_params = {"account_id": account_id, **params}
        data = self._request("GET", "/cpc/v3/campaign/list_campaigns", params=req_params)
        return self._extract_list(data)

    def list_units(self, account_id, **params):
        req_params = {"account_id": account_id, **params}
        data = self._request("GET", "/cpc/v3/unit/list_units", params=req_params)
        return self._extract_list(data)

    def list_creatives(self, account_id, **params):
        req_params = {"account_id": account_id, **params}
        data = self._request("GET", "/cpc/v3/creative/list_creatives", params=req_params)
        return self._extract_list(data)


def _bili_nested_value(item, group, *keys):
    nested = item.get(group)
    if isinstance(nested, dict):
        for key in keys:
            if key in nested and nested.get(key) not in (None, ""):
                return nested.get(key)
    return None


def _bili_metric_int(item, *keys):
    for key in keys:
        value = item.get(key) if key in item else _bili_nested_value(item, "metrics", key)
        if value not in (None, ""):
            try:
                return int(float(value))
            except (TypeError, ValueError):
                return 0
    return 0


BILI_SYNC_METRIC_KEYS = [
    item["key"] for item in BILI_ALL_COLUMNS
    if item.get("aggregate") != "skip" and item.get("format") != "text"
]
for _key in ("form_submit", "valid_leads", "comment_click_count", "app_wake_count", "order_submit_count"):
    if _key not in BILI_SYNC_METRIC_KEYS:
        BILI_SYNC_METRIC_KEYS.append(_key)

BILI_CUSTOM_REPORT_METRIC_KEYS = [
    "show_count",
    "click_count",
    "charged_cost_milli",
    "video_play_count",
    "video_interact_count",
    "comment_url_click_count",
    "component_click_count",
    "dynamic_goods_url_click_count",
    "live_bottom_icon_click_count",
]

BILI_LEAD_REPORT_METRIC_KEYS = [
    "charged_cost_milli",
    "form_submit_count",
    "clue_valid_count",
]

BILI_ASYNC_REPORT_METRIC_KEYS = [
    "show_cnt",
    "click_cnt",
    "cost",
    "form_submit",
    "clue_valid",
    "video_play",
    "video_engagement",
    "comment_url_click",
    "component_click",
    "dynamic_goods_url_click",
    "live_bottom_icon_click",
]

BILI_METRIC_ALIASES = {
    **{key: (key,) for key in BILI_SYNC_METRIC_KEYS},
    "charged_cost_milli": ("charged_cost_milli", "cost"),
    "show_count": ("show_count", "show_cnt"),
    "click_count": ("click_count", "click_cnt"),
    "form_submit": ("form_submit", "form_submit_count", "leads", "msg_leads_form_submit_num", "app_book_form_submit_cnt"),
    "valid_leads": ("valid_leads", "valid_leads_count", "clue_valid_count", "clue_valid"),
    "comment_click_count": ("comment_click_count", "comment_url_click_count", "comment_url_click", "component_click_count", "component_click", "dynamic_goods_url_click_count", "dynamic_goods_url_click", "live_bottom_icon_click_count", "live_bottom_icon_click"),
    "app_wake_count": ("app_wake_count", "app_invoke_count", "app_open_count", "invoke_app_enter_store_cnt", "app_key_action_cnt"),
    "order_submit_count": ("order_submit_count", "order_count", "order_submit", "pay_order_count", "order_place_count", "order_place", "order_pay_count", "current_app_pay_cnt", "out_click_product_deal_order_7d", "out_click_product_total_order_7d"),
    "video_play_count": ("video_play_count", "play_count", "video_play"),
    "video_like_count": ("video_like_count",),
    "video_fav_count": ("video_fav_count",),
    "video_coin_count": ("video_coin_count",),
    "video_interact_count": ("video_interact_count", "video_engagement"),
}


def _bili_metric_sum(item, key):
    for alias in BILI_METRIC_ALIASES.get(key, (key,)):
        value = _bili_metric_int(item, alias)
        if value:
            return value
    return 0


def _bili_empty_agg():
    return {key: 0 for key in BILI_SYNC_METRIC_KEYS}


def _bili_add_item_metrics(agg, item):
    for key in BILI_SYNC_METRIC_KEYS:
        agg[key] += _bili_metric_sum(item, key)
    if not _bili_metric_int(item, "charged_cost_milli"):
        agg["charged_cost_milli"] += int(round(float(item.get("san_lian_launch_total_consume") or 0) * 100000))


BILI_CUSTOM_SUPPLEMENT_KEYS = (
    "form_submit",
    "valid_leads",
    "comment_click_count",
    "app_wake_count",
    "order_submit_count",
    "video_play_count",
    "video_interact_count",
)


def _bili_add_custom_supplement_metrics(agg, item):
    for key in BILI_CUSTOM_SUPPLEMENT_KEYS:
        agg[key] += _bili_metric_sum(item, key)


def _bili_date_value(item, default_date):
    value = (
        item.get("date_time")
        or item.get("date")
        or item.get("stat_date")
        or _bili_nested_value(item, "dimensions", "date_time", "date", "stat_date")
        or default_date
    )
    value = str(value)
    return value[:10]


def _bili_item_has_report_date(item):
    return bool(
        item.get("date_time")
        or item.get("date")
        or item.get("stat_date")
        or _bili_nested_value(item, "dimensions", "date_time", "date", "stat_date")
    )


def _bili_account_value(item, default_account_id=""):
    value = (
        item.get("account_id")
        or item.get("advertiser_id")
        or item.get("accountId")
        or _bili_nested_value(item, "dimensions", "account_id", "advertiser_id", "accountId")
        or default_account_id
        or ""
    )
    return str(value).strip()


def get_bili_client():
    if config.BILI_CLIENT_ID:
        return BiliApiClient()
    return None


def refresh_bili_accounts_cache():
    client = BiliApiClient()
    accounts = client.list_agent_accounts()
    bound_account_ids = {
        str(account.get("external_account_id") or account.get("account_id") or "").strip()
        for account in models.get_all_sub_accounts(media=models.MEDIA_BILI)
    }
    bound_account_ids.discard("")
    enriched_accounts = []
    seen_account_ids = set()
    for account in accounts:
        account_id = str(account.get("account_id") or account.get("ad_account_id") or account.get("id") or account.get("advertiser_id") or "").strip()
        if account_id:
            seen_account_ids.add(account_id)
        if not account_id or account_id not in bound_account_ids:
            enriched_accounts.append(account)
            continue
        try:
            cash = client.fetch_cash(account_id)
            if isinstance(cash, dict):
                account = {**account, **cash}
            sleep_time.sleep(1)
        except Exception as exc:
            logger.warning("B站账户资金刷新失败 account=%s: %s", account_id, exc)
        enriched_accounts.append(account)
    for account_id in sorted(bound_account_ids - seen_account_ids):
        account = {"account_id": account_id, "account_name": account_id}
        try:
            cash = client.fetch_cash(account_id)
            if isinstance(cash, dict):
                account = {**account, **cash}
            sleep_time.sleep(1)
        except Exception as exc:
            logger.warning("B站绑定账户资金刷新失败 account=%s: %s", account_id, exc)
        enriched_accounts.append(account)
    models.save_bili_accounts_cache(enriched_accounts)
    logger.info("B站账号缓存刷新完成: %d 条，资金刷新账号=%d 条", len(enriched_accounts), len(bound_account_ids))
    return len(enriched_accounts)


def sync_bili_daily_consumption(report_date=None):
    if not report_date:
        report_date = (date.today() - timedelta(days=1)).isoformat()
    accounts = models.get_all_sub_accounts(media=models.MEDIA_BILI)
    if not accounts:
        logger.info("没有 B站子账号，跳过同步")
        return {"success": 0, "failed": 0, "total_cost": 0.0}

    client = BiliApiClient()
    success = 0
    failed = 0
    total_cost = 0.0
    account_pairs = []
    for account in accounts:
        account_id = str(account.get("external_account_id") or account.get("account_id") or "").strip()
        if account_id:
            account_pairs.append((account, account_id))
    launch_rows_by_account = {}
    if account_pairs:
        try:
            batch_rows = client.fetch_account_launch_data_range_batch([account_id for _account, account_id in account_pairs], report_date, report_date)
            for item in batch_rows or []:
                account_value = _bili_account_value(item, "")
                if account_value:
                    launch_rows_by_account.setdefault(account_value, []).append(item)
        except Exception as exc:
            logger.warning("B站批量账户消耗同步失败 date=%s: %s", report_date, exc)
    for account, account_id in account_pairs:
        try:
            rows = launch_rows_by_account.get(account_id, [])
            if not rows:
                rows = client.fetch_custom_report(
                    report_date,
                    report_date,
                    dimensions=["date_time", "account_id"],
                    metrics=["show_count", "click_count", "charged_cost_milli"],
                    account_id=account_id,
                )
            custom_rows = client.fetch_custom_report(
                report_date,
                report_date,
                dimensions=["date_time", "account_id"],
                metrics=BILI_CUSTOM_REPORT_METRIC_KEYS,
                account_id=account_id,
            )
            try:
                lead_rows = client.fetch_custom_report(
                    report_date,
                    report_date,
                    dimensions=["date_time", "account_id"],
                    metrics=BILI_LEAD_REPORT_METRIC_KEYS,
                    account_id=account_id,
                )
            except Exception as exc:
                logger.warning("B站线索字段同步跳过 account=%s date=%s: %s", account_id, report_date, exc)
                lead_rows = []
            agg = _bili_empty_agg()
            for item in rows:
                if _bili_account_value(item, account_id) and _bili_account_value(item, account_id) != account_id:
                    continue
                _bili_add_item_metrics(agg, item)
            for item in custom_rows:
                if _bili_account_value(item, account_id) and _bili_account_value(item, account_id) != account_id:
                    continue
                _bili_add_custom_supplement_metrics(agg, item)
            for item in lead_rows:
                if _bili_account_value(item, account_id) and _bili_account_value(item, account_id) != account_id:
                    continue
                _bili_add_custom_supplement_metrics(agg, item)
            models.upsert_bili_consumption(account["id"], report_date, **agg)
            total_cost += agg["charged_cost_milli"] / 100000.0
            success += 1
        except Exception as exc:
            failed += 1
            logger.warning("B站子账号同步失败 account=%s date=%s: %s", account_id, report_date, exc)
    logger.info("B站消耗同步完成 %s: 成功=%d 失败=%d 总消耗=%.2f", report_date, success, failed, total_cost)
    return {"success": success, "failed": failed, "total_cost": round(total_cost, 2)}


def backfill_bili_accounts(sub_account_ids, start_date=None, end_date=None):
    accounts = models.get_sub_accounts_by_ids(sub_account_ids, media=models.MEDIA_BILI)
    if not accounts:
        return {"success": 0, "failed": 0}
    if not start_date:
        start_date = "2025-01-01"
    if not end_date:
        end_date = (date.today() - timedelta(days=1)).isoformat()
    client = BiliApiClient()
    success = 0
    failed = 0
    for account in accounts:
        account_id = str(account.get("external_account_id") or account.get("account_id") or "").strip()
        try:
            current_date = date.fromisoformat(start_date)
            last_date = date.fromisoformat(end_date)
            multi_day = current_date < last_date
            used_async = False
            rows = []
            if multi_day and hasattr(client, "fetch_async_custom_report_rows"):
                try:
                    rows = client.fetch_async_custom_report_rows(
                        start_date,
                        end_date,
                        dimensions=["date", "account_id"],
                        metrics=BILI_ASYNC_REPORT_METRIC_KEYS,
                        account_id=account_id,
                    )
                    used_async = bool(rows)
                except Exception as exc:
                    logger.warning("B站异步报表补拉回退 account=%s range=%s~%s: %s", account_id, start_date, end_date, exc)
                    rows = []
            if not rows:
                rows = client.fetch_account_launch_data_range(account_id, start_date, end_date)
                if multi_day and any(not _bili_item_has_report_date(item) for item in rows):
                    logger.warning("B站区间补拉返回无日期聚合行，改为逐日补拉 account=%s range=%s~%s", account_id, start_date, end_date)
                    rows = []
            if not rows:
                rows = []
                while current_date <= last_date:
                    day = current_date.isoformat()
                    for item in client.fetch_custom_report(
                        day,
                        day,
                        dimensions=["date_time", "account_id"],
                        metrics=["show_count", "click_count", "charged_cost_milli"],
                        account_id=account_id,
                    ):
                        rows.append({**item, "date_time": day})
                    current_date += timedelta(days=1)
            by_date = {}
            for item in rows:
                if _bili_account_value(item, account_id) and _bili_account_value(item, account_id) != account_id:
                    continue
                item_date = _bili_date_value(item, start_date)
                by_date.setdefault(item_date, _bili_empty_agg())
                _bili_add_item_metrics(by_date[item_date], item)
            for item_date, agg in by_date.items():
                models.upsert_bili_consumption(account["id"], item_date, **agg)
                success += 1
        except Exception as exc:
            failed += 1
            logger.warning("B站账号补拉失败 sub_account=%s account=%s: %s", account.get("id"), account_id, exc)
    return {"success": success, "failed": failed}


def backfill_bili_project(project_id, start_date, end_date):
    accounts = models.get_sub_accounts_by_project(project_id)
    account_ids = [a["id"] for a in accounts if (a.get("media") or models.MEDIA_XHS) == models.MEDIA_BILI]
    return backfill_bili_accounts(account_ids, start_date, end_date)


class AlipayApiClient:
    """支付宝广告 OpenAPI 客户端。"""

    REPORT_METHOD = "alipay.data.dataservice.ad.reportdata.query"
    AGENT_REPORT_METHOD = "alipay.data.dataservice.ad.agentreportdata.query"
    PAGE_PRINCIPAL_METHOD = "alipay.data.dataservice.ad.pageprincipal.query"
    PRINCIPAL_CONSUME_METHOD = "alipay.data.dataservice.ad.principalconsume.query"
    LIST_KEYS = (
        "data_list", "dataList", "principal_list", "principalList",
        "consume_list", "consumeList", "detail_list", "detailList",
        "result_list", "resultList", "record_list", "recordList",
        "list", "items", "rows", "records", "data", "result",
    )
    TOTAL_KEYS = (
        "total", "total_count", "totalCount", "total_num", "totalNum",
        "total_size", "totalSize", "count",
    )

    @staticmethod
    def _config_value(*values):
        for value in values:
            if value not in (None, ""):
                return value
        return ""

    def __init__(self, app_id=None, private_key=None, app_auth_token=None,
                 biz_token=None, alipay_pid=None, principal_tag=None,
                 gateway_url=None):
        self.app_id = self._config_value(app_id, config.ALIPAY_APP_ID, getattr(config, "XIN_AGENT_ALIPAY_APP_ID", ""))
        self.private_key_text = self._config_value(private_key, config.ALIPAY_PRIVATE_KEY, getattr(config, "XIN_AGENT_ALIPAY_PRIVATE_KEY", ""))
        self.private_key_file = self._config_value(
            getattr(config, "ALIPAY_PRIVATE_KEY_FILE", ""),
            getattr(config, "XIN_AGENT_ALIPAY_PRIVATE_KEY_FILE", ""),
        )
        self.app_auth_token = self._config_value(app_auth_token, config.ALIPAY_APP_AUTH_TOKEN, getattr(config, "XIN_AGENT_ALIPAY_APP_AUTH_TOKEN", ""))
        self.biz_token = self._config_value(biz_token, config.ALIPAY_BIZ_TOKEN, getattr(config, "XIN_AGENT_ALIPAY_BIZ_TOKEN", ""))
        self.alipay_pid = self._config_value(alipay_pid, config.ALIPAY_PID, getattr(config, "XIN_AGENT_ALIPAY_PID", ""))
        self.principal_tag = self._config_value(principal_tag, config.ALIPAY_PRINCIPAL_TAG, getattr(config, "XIN_AGENT_ALIPAY_PRINCIPAL_TAG", ""))
        self.agent_principal_tag = self._config_value(
            getattr(config, "ALIPAY_AGENT_PRINCIPAL_TAG", ""),
            getattr(config, "XIN_AGENT_ALIPAY_PRINCIPAL_TAG", ""),
            self.principal_tag,
        )
        self.gateway_url = gateway_url or config.ALIPAY_GATEWAY_URL
        self.sign_type = config.ALIPAY_SIGN_TYPE or "RSA2"
        self.version = config.ALIPAY_API_VERSION or "1.0"
        self.charset = "utf-8"
        self._private_key = None

    def _load_private_key(self):
        if self._private_key is not None:
            return self._private_key
        raw = str(self.private_key_text or "").strip().replace("\\n", "\n")
        if not raw and self.private_key_file:
            with open(self.private_key_file, "r", encoding="utf-8") as fh:
                raw = fh.read().strip().replace("\\n", "\n")
        if not raw:
            raise Exception("支付宝私钥未配置")
        if "BEGIN" not in raw:
            compact = "".join(raw.split())
            lines = [compact[i:i + 64] for i in range(0, len(compact), 64)]
            raw = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(lines) + "\n-----END PRIVATE KEY-----"
        self._private_key = serialization.load_pem_private_key(raw.encode("utf-8"), password=None)
        return self._private_key

    def _sign(self, params):
        sign_items = []
        for key in sorted(params):
            if key == "sign":
                continue
            value = params.get(key)
            if value in (None, ""):
                continue
            sign_items.append(f"{key}={value}")
        sign_text = "&".join(sign_items)
        signature = self._load_private_key().sign(
            sign_text.encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return base64.b64encode(signature).decode("ascii")

    @staticmethod
    def _response_key(method):
        return method.replace(".", "_") + "_response"

    @staticmethod
    def _extract_list(data):
        if isinstance(data, list):
            return data
        if not isinstance(data, dict):
            return []
        for key in AlipayApiClient.LIST_KEYS:
            value = data.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                nested = AlipayApiClient._extract_list(value)
                if nested:
                    return nested
        return []

    @staticmethod
    def _extract_total(data):
        if not isinstance(data, dict):
            return None
        for key in AlipayApiClient.TOTAL_KEYS:
            value = data.get(key)
            if value not in (None, ""):
                try:
                    return int(float(value))
                except (TypeError, ValueError):
                    return None
        for value in data.values():
            if isinstance(value, dict):
                nested = AlipayApiClient._extract_total(value)
                if nested is not None:
                    return nested
        return None

    def _request(self, method, biz_content=None, app_auth_token=None, response_key=None):
        if not self.app_id:
            raise Exception("支付宝 APP_ID 未配置")
        params = {
            "app_id": self.app_id,
            "method": method,
            "charset": self.charset,
            "sign_type": self.sign_type,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "version": self.version,
        }
        token = app_auth_token if app_auth_token is not None else self._get_app_auth_token()
        if token:
            params["app_auth_token"] = token
        if biz_content is not None:
            params["biz_content"] = json.dumps(biz_content, ensure_ascii=False, separators=(",", ":"))
        params["sign"] = self._sign(params)
        resp = requests.post(self.gateway_url, data=params, timeout=_REQUEST_TIMEOUT)
        if resp.status_code != 200:
            raise Exception(f"支付宝API请求失败: HTTP {resp.status_code} {resp.text[:200]}")
        data = resp.json()
        error = data.get("error_response")
        if isinstance(error, dict):
            message = error.get("sub_msg") or error.get("msg") or "支付宝API返回错误"
            raise AlipayApiError(
                message,
                code=error.get("code"),
                sub_code=error.get("sub_code"),
                sub_msg=error.get("sub_msg"),
                method=method,
                body=error,
            )
        body = data.get(response_key or self._response_key(method))
        if not isinstance(body, dict):
            raise Exception(f"支付宝API响应格式异常: {data}")
        code = str(body.get("code", "10000"))
        if code and code != "10000":
            message = body.get("sub_msg") or body.get("msg") or "支付宝API返回错误"
            raise AlipayApiError(
                message,
                code=body.get("code"),
                sub_code=body.get("sub_code"),
                sub_msg=body.get("sub_msg"),
                method=method,
                body=body,
            )
        return body

    def _get_app_auth_token(self):
        if self.app_auth_token:
            return self.app_auth_token
        token_info = models.get_token(app_id=self.app_id) if self.app_id else None
        if token_info and token_info.get("access_token"):
            self.app_auth_token = token_info["access_token"]
            return self.app_auth_token
        return ""

    def get_token_by_auth_code(self, auth_code):
        if not auth_code:
            raise Exception("缺少授权 code")
        body = self._request(
            "alipay.open.auth.token.app",
            {"grant_type": "authorization_code", "code": auth_code},
            app_auth_token="",
        )
        token = body.get("app_auth_token") or body.get("access_token")
        refresh = body.get("app_refresh_token") or body.get("refresh_token") or ""
        expires_in = int(body.get("expires_in") or body.get("app_auth_token_expires_in") or 31536000)
        if not token:
            raise Exception("支付宝授权响应中未找到 app_auth_token")
        models.save_token(token, refresh, expires_in, app_id=self.app_id)
        self.app_auth_token = token
        return models.get_token(app_id=self.app_id)

    def _paged_request(self, method, biz_content, list_key=None, page_key="current", size_key="page_size", page_size=None):
        items = []
        page = 1
        page_size = int(page_size or config.ALIPAY_PAGE_SIZE or 100)
        while True:
            body = dict(biz_content or {})
            body[page_key] = page
            body[size_key] = page_size
            data = self._request(method, body)
            rows = data.get(list_key) if list_key else None
            if not isinstance(rows, list):
                rows = self._extract_list(data)
            if not rows:
                break
            items.extend(rows)
            total = self._extract_total(data)
            if total is None:
                if len(rows) < page_size:
                    break
            elif page * page_size >= total:
                break
            page += 1
        return items

    def list_page_principals(self, keyword="", status="", page_size=None):
        body = {}
        if keyword:
            body["key_word"] = keyword
        if status:
            body["status"] = status
        return self._paged_request(
            self.PAGE_PRINCIPAL_METHOD,
            body,
            list_key="principal_list",
            page_key="page_num",
            size_key="page_size",
            page_size=page_size,
        )

    def list_agent_accounts(self):
        rows = self.list_page_principals()
        accounts = []
        for row in rows:
            item = _alipay_apply_aliases(dict(row))
            item["account_id"] = str(_alipay_first_value(
                item,
                "account_id", "principal_tag", "principal_id", "principalId",
                "principal_pid", "principalPid", "alipay_oid", "alipayOid",
                "alipay_account", "alipayAccount",
            ) or "").strip()
            item["account_name"] = str(_alipay_first_value(
                item,
                "account_name", "principal_name", "principalName",
                "principal_alipay_account", "principalAlipayAccount",
                "alipay_account", "alipayAccount", "account_id",
            ) or "").strip()
            accounts.append(item)
        if self.principal_tag and not any(str(item.get("principal_tag") or "") == self.principal_tag for item in accounts):
            accounts.append({"account_id": self.principal_tag, "account_name": self.principal_tag, "principal_tag": self.principal_tag})
        return accounts

    @staticmethod
    def _date8(value):
        text = str(value or "").strip()
        if re.fullmatch(r"\d{8}", text):
            return text
        return date.fromisoformat(text[:10]).strftime("%Y%m%d")

    @staticmethod
    def _date10(value):
        text = str(value or "").strip()
        if re.fullmatch(r"\d{8}", text):
            return f"{text[:4]}-{text[4:6]}-{text[6:8]}"
        return text[:10]

    def _report_base_content(self, start_date, end_date, query_type="DETAIL", ad_level="PRINCIPAL"):
        if not self.biz_token:
            raise Exception("支付宝 ALIPAY_BIZ_TOKEN 未配置")
        if not self.alipay_pid:
            raise Exception("支付宝 ALIPAY_PID 未配置")
        return {
            "biz_token": self.biz_token,
            "alipay_pid": self.alipay_pid,
            "query_type": query_type,
            "ad_level": ad_level,
            "start_date": self._date8(start_date),
            "end_date": self._date8(end_date),
        }

    def query_reportdata(self, start_date, end_date, principal_tag=None, query_type="DETAIL",
                         ad_level="PRINCIPAL", page=1, page_size=None, **filters):
        principal_tag = principal_tag or self.principal_tag
        if not principal_tag:
            raise Exception("支付宝 principal_tag 未配置")
        body = self._report_base_content(start_date, end_date, query_type=query_type, ad_level=ad_level)
        body.update({"principal_tag": principal_tag, "current": int(page or 1), "page_size": int(page_size or config.ALIPAY_PAGE_SIZE or 100)})
        body.update({k: v for k, v in filters.items() if v not in (None, "", [])})
        return self._request(self.REPORT_METHOD, body)

    def query_agent_reportdata(self, start_date, end_date, principal_tag_list=None, query_type="DETAIL",
                               ad_level="PRINCIPAL", page=1, page_size=None, **filters):
        if not self.agent_principal_tag:
            raise Exception("支付宝代理商 principal_tag 未配置")
        body = self._report_base_content(start_date, end_date, query_type=query_type, ad_level=ad_level)
        body.update({
            "principal_tag": self.agent_principal_tag,
            "current": int(page or 1),
            "page_size": int(page_size or config.ALIPAY_PAGE_SIZE or 100),
        })
        if principal_tag_list:
            body["principal_tag_list"] = [str(v).strip() for v in principal_tag_list if str(v or "").strip()]
        body.update({k: v for k, v in filters.items() if v not in (None, "", [])})
        return self._request(self.AGENT_REPORT_METHOD, body)

    def fetch_report_rows(self, start_date, end_date, principal_tag=None, level="account",
                          query_type="DETAIL", page_size=None, **filters):
        level_map = {
            "account": "PRINCIPAL",
            "campaign": "PLAN",
            "unit": "GROUP",
            "creativity": "CREATIVE",
            "creative": "CREATIVE",
            "material": "MATERIAL",
        }
        ad_level = level_map.get(str(level or "account"), "PRINCIPAL")
        page_size = int(page_size or config.ALIPAY_PAGE_SIZE or 100)
        rows = []
        page = 1
        use_agent = str(config.ALIPAY_REPORT_MODE or "agent").lower() == "agent" and bool(self.agent_principal_tag)
        while True:
            if use_agent:
                data = self.query_agent_reportdata(
                    start_date,
                    end_date,
                    principal_tag_list=[principal_tag] if principal_tag else None,
                    query_type=query_type,
                    ad_level=ad_level,
                    page=page,
                    page_size=page_size,
                    **filters,
                )
            else:
                data = self.query_reportdata(
                    start_date,
                    end_date,
                    principal_tag=principal_tag,
                    query_type=query_type,
                    ad_level=ad_level,
                    page=page,
                    page_size=page_size,
                    **filters,
                )
            items = data.get("data_list") if isinstance(data.get("data_list"), list) else self._extract_list(data)
            rows.extend(items)
            total = self._extract_total(data)
            if not items or (total is None and len(items) < page_size) or (total is not None and page * page_size >= total):
                break
            page += 1
        return rows

    def fetch_principal_consume_rows(self, start_date, end_date, principal_tag=None, page_size=None):
        principal_tag = principal_tag or self.principal_tag
        if not principal_tag:
            raise Exception("支付宝 principal_tag 未配置")
        body = {
            "principal_tag": principal_tag,
            "start_date": self._date10(start_date),
            "end_date": self._date10(end_date),
            "group_condition": "DATE",
            "biz_scene": config.ALIPAY_DEFAULT_BIZ_SCENE or "SEARCH",
            "current": 1,
            "page_size": int(page_size or config.ALIPAY_PAGE_SIZE or 100),
        }
        if config.ALIPAY_DEFAULT_SCENE_TYPE:
            body["scene_type"] = config.ALIPAY_DEFAULT_SCENE_TYPE
        return self._paged_request(self.PRINCIPAL_CONSUME_METHOD, body, list_key="data_list", page_key="current", size_key="page_size")


def _alipay_float(value, default=0.0):
    if value in (None, ""):
        return default
    text = str(value).strip().replace(",", "")
    if text in ("-", "--"):
        return default
    if text.endswith("%"):
        text = text[:-1]
    try:
        return float(text)
    except (TypeError, ValueError):
        return default


def _alipay_int(value):
    return int(round(_alipay_float(value)))


def _alipay_first_value(item, *keys):
    if not isinstance(item, dict):
        return None
    for key in keys:
        value = item.get(key)
        if value not in (None, ""):
            return value
    return None


_ALIPAY_FIELD_ALIASES = {
    "time": ("date", "biz_date", "bizDate", "stat_date", "statDate", "report_date", "reportDate"),
    "biz_date": ("bizDate", "stat_date", "statDate", "date", "report_date", "reportDate"),
    "data_id": ("dataId", "id"),
    "query_type": ("queryType",),
    "ad_level": ("adLevel", "level"),
    "biz_scene": ("bizScene",),
    "scene_type": ("sceneType", "scene_code", "sceneCode"),
    "status_name": ("statusName",),
    "gmt_create": ("gmtCreate",),
    "principal_tag": ("principalTag",),
    "principal_id": ("principalId",),
    "principal_name": ("principalName", "principal_account_name", "principalAccountName", "account_name", "accountName"),
    "principal_pid": ("principalPid", "principal_pid", "alipay_pid", "alipayPid", "pid"),
    "principal_alipay_account": ("principalAlipayAccount", "alipay_account", "alipayAccount"),
    "alipay_oid": ("alipayOid",),
    "alipay_account": ("alipayAccount",),
    "first_trade_name": ("firstTradeName",),
    "second_trade_name": ("secondTradeName",),
    "agent_name": ("agentName",),
    "agent_alipay_account": ("agentAlipayAccount",),
    "plan_id": ("planId", "campaign_id", "campaignId", "campaignIdStr"),
    "plan_name": ("planName", "campaign_name", "campaignName"),
    "order_id": ("orderId",),
    "order_name": ("orderName",),
    "group_id": ("groupId", "unit_id", "unitId", "adgroup_id", "adgroupId"),
    "group_name": ("groupName", "unit_name", "unitName", "adgroup_name", "adgroupName"),
    "creative_id": ("creativeId", "creativity_id", "creativityId"),
    "creative_name": ("creativeName", "creativity_name", "creativityName"),
    "creative_status": ("creativeStatus", "status"),
    "market_target_code": ("marketTargetCode",),
    "market_target_name": ("marketTargetName",),
    "scene_code": ("sceneCode",),
    "scene_name": ("sceneName",),
    "material_id": ("materialId", "photo_id", "photoId", "video_id", "videoId"),
    "material_name": ("materialName", "photo_name", "photoName", "video_name", "videoName"),
    "material_level": ("materialLevel",),
    "photo_id": ("photoId",),
    "video_id": ("videoId",),
}

_ALIPAY_METRIC_ALIASES = {
    "impression": ("impression", "show_count", "showCount", "exposure", "exposure_count", "exposureCount", "pv"),
    "click": ("click", "click_count", "clickCount", "click_num", "clickNum"),
    "conv_result": ("conv_result", "convResult", "conversion_result", "conversionResult", "convert_count", "convertCount"),
    "form_submit": ("form_submit", "formSubmit", "leads", "lead_count", "leadCount", "form_count", "formCount"),
    "valid_leads": ("valid_leads", "validLeads", "valid_lead_count", "validLeadCount"),
    "click_rate": ("click_rate", "clickRate", "ctr"),
    "cpc": ("cpc", "click_cost", "clickCost", "avg_click_cost", "avgClickCost"),
    "cpm": ("cpm", "ecpm", "thousand_show_cost", "thousandShowCost"),
    "cvr": ("cvr", "conversion_rate", "conversionRate", "conv_rate", "convRate"),
    "avg_conv_cost": ("avg_conv_cost", "avgConvCost", "conversion_cost", "conversionCost", "conv_cost", "convCost"),
}

_ALIPAY_COST_YUAN_KEYS = (
    "cost_format", "costFormat", "cost_total", "costTotal", "cost_yuan", "costYuan",
    "cash_amount_format", "cashAmountFormat", "cut_amount_format", "cutAmountFormat",
    "consume_amount", "consumeAmount", "consume_amount_format", "consumeAmountFormat",
    "amount_format", "amountFormat",
)
_ALIPAY_COST_CENT_KEYS = (
    "cost_cent", "costCent", "cost_fen", "costFen",
    "consume_amount_cent", "consumeAmountCent", "amount_cent", "amountCent",
)


def _alipay_apply_aliases(row):
    for target, aliases in _ALIPAY_FIELD_ALIASES.items():
        value = _alipay_first_value(row, target, *aliases)
        if value not in (None, "") and row.get(target) in (None, ""):
            row[target] = value
    return row


def _alipay_metric_value(item, key):
    return _alipay_first_value(item, *_ALIPAY_METRIC_ALIASES.get(key, (key,)))


def alipay_account_match_keys(item):
    data = _alipay_apply_aliases(dict(item or {}))
    keys = set()
    for key in (
        "account_id",
        "external_account_id",
        "principal_tag",
        "principal_id",
        "principal_pid",
        "alipay_oid",
        "alipay_account",
        "principal_alipay_account",
        "_account_id",
        "_account_name",
        "account_name",
        "principal_name",
    ):
        value = data.get(key)
        if value in (None, ""):
            continue
        text = str(value).strip()
        if text:
            keys.add(text)
    return keys


def _alipay_accounts_with_match_keys(accounts):
    account_items = [dict(account or {}) for account in accounts or []]
    lookup_ids = []
    for account in account_items:
        for key in ("account_id", "external_account_id", "principal_tag"):
            value = str(account.get(key) or "").strip()
            if value:
                lookup_ids.append(value)
    cache_by_key = {}
    for cached in models.get_alipay_accounts_cache_by_ids(lookup_ids):
        cached_keys = alipay_account_match_keys(cached)
        for key in cached_keys:
            cache_by_key.setdefault(key, cached)
    for account in account_items:
        keys = alipay_account_match_keys(account)
        for key in list(keys):
            cached = cache_by_key.get(key)
            if cached:
                keys.update(alipay_account_match_keys(cached))
        account["_alipay_match_keys"] = keys
    return account_items


def _alipay_match_account_for_report_row(row, accounts):
    row_keys = alipay_account_match_keys(row)
    for account in accounts or []:
        if row_keys & set(account.get("_alipay_match_keys") or []):
            return account
    return None


def _alipay_conversion_list(item):
    value = _alipay_first_value(
        item,
        "conversion_data_list", "conversionDataList",
        "conversion_list", "conversionList",
        "conversion_infos", "conversionInfos",
    )
    return value if isinstance(value, list) else []


def _alipay_cost_yuan(item):
    for key in _ALIPAY_COST_YUAN_KEYS:
        value = item.get(key)
        if value not in (None, ""):
            return round(_alipay_float(value), 4)
    for key in _ALIPAY_COST_CENT_KEYS:
        value = item.get(key)
        if value not in (None, ""):
            text = str(value).strip().replace(",", "")
            amount = _alipay_float(value)
            return round(amount / 100.0, 4) if re.fullmatch(r"-?\d+", text) else round(amount, 4)
    value = item.get("cost")
    if value not in (None, ""):
        unit = str(_alipay_first_value(item, "cost_unit", "costUnit", "amount_unit", "amountUnit") or "").lower()
        amount = _alipay_float(value)
        if "cent" in unit or "fen" in unit or "分" in unit:
            return round(amount / 100.0, 4)
        return round(amount, 4)
    return 0.0


def _alipay_empty_agg():
    return {
        "cost": 0.0,
        "cost_total": 0.0,
        "impression": 0,
        "click": 0,
        "show_count": 0,
        "click_count": 0,
        "conv_result": 0,
        "form_submit": 0,
        "valid_leads": 0,
    }


def _alipay_row_date(item, default_date):
    return AlipayApiClient._date10(_alipay_first_value(item, "biz_date", "bizDate", "date", "time", "stat_date", "statDate") or default_date)


def _alipay_add_item_metrics(agg, item):
    item = _alipay_apply_aliases(dict(item or {}))
    cost = _alipay_cost_yuan(item)
    impression = _alipay_int(_alipay_metric_value(item, "impression"))
    click = _alipay_int(_alipay_metric_value(item, "click"))
    conv_result = _alipay_int(_alipay_metric_value(item, "conv_result"))
    conversion_list = _alipay_conversion_list(item)
    if isinstance(conversion_list, list):
        conv_result += sum(_alipay_int(_alipay_metric_value(row, "conv_result")) for row in conversion_list if isinstance(row, dict))
    agg["cost"] += cost
    agg["cost_total"] += cost
    agg["impression"] += impression
    agg["click"] += click
    agg["show_count"] += impression
    agg["click_count"] += click
    agg["conv_result"] += conv_result
    agg["form_submit"] += _alipay_int(_alipay_metric_value(item, "form_submit"))
    agg["valid_leads"] += _alipay_int(_alipay_metric_value(item, "valid_leads"))
    for key in ("cpc", "cpm", "click_rate", "cvr", "avg_conv_cost"):
        value = _alipay_metric_value(item, key)
        if value not in (None, "") and key not in agg:
            agg[key] = _alipay_float(value)


def _alipay_flatten_report_row(item, account=None, fallback_principal_tag=""):
    row = _alipay_apply_aliases(dict(item or {}))
    account = account or {}
    principal_tag = str(row.get("principal_tag") or fallback_principal_tag or account.get("external_account_id") or account.get("account_id") or "").strip()
    account_id = str(
        account.get("account_id")
        or principal_tag
        or row.get("principal_id")
        or row.get("principal_pid")
        or row.get("alipay_oid")
        or row.get("principal_alipay_account")
        or row.get("data_id")
        or ""
    ).strip()
    account_name = str(
        account.get("account_name")
        or row.get("principal_name")
        or row.get("principal_alipay_account")
        or account_id
    ).strip()
    cost = _alipay_cost_yuan(row)
    impression = _alipay_int(_alipay_metric_value(row, "impression"))
    click = _alipay_int(_alipay_metric_value(row, "click"))
    conv_result = _alipay_int(_alipay_metric_value(row, "conv_result"))
    conversion_list = _alipay_conversion_list(row)
    if isinstance(conversion_list, list) and conversion_list:
        row["conversion_data_list"] = conversion_list
        row["conversion_result"] = sum(_alipay_int(_alipay_metric_value(item, "conv_result")) for item in conversion_list if isinstance(item, dict))
        first = next((item for item in conversion_list if isinstance(item, dict)), {})
        row.setdefault("conversion_code", _alipay_first_value(first, "conversion_code", "conversionCode", "conv_code", "convCode") or "")
        row.setdefault("conversion_name", _alipay_first_value(first, "conversion_name", "conversionName", "conv_name", "convName") or "")
        conv_result = conv_result or _alipay_int(row.get("conversion_result"))
    row.update({
        "platform": "alipay",
        "_account_id": account_id,
        "_account_name": account_name,
        "principal_tag": principal_tag,
        "time": _alipay_row_date(row, date.today().isoformat()),
        "cost": cost,
        "cost_total": cost,
        "impression": impression,
        "click": click,
        "show_count": impression,
        "click_count": click,
        "conv_result": conv_result,
        "form_submit": _alipay_int(_alipay_metric_value(row, "form_submit")),
        "valid_leads": _alipay_int(_alipay_metric_value(row, "valid_leads")),
    })
    for key in ("click_rate", "cpc", "cpm", "cvr", "avg_conv_cost"):
        value = _alipay_metric_value(row, key)
        if value not in (None, ""):
            row[key] = _alipay_float(value)
    if not row.get("click_rate"):
        row["click_rate"] = (click / impression * 100) if impression else 0
    if not row.get("cpc"):
        row["cpc"] = cost / click if click else 0
    if not row.get("cpm"):
        row["cpm"] = cost / impression * 1000 if impression else 0
    if not row.get("avg_conv_cost"):
        row["avg_conv_cost"] = cost / conv_result if conv_result else 0
    return row


def get_alipay_client():
    if config.ALIPAY_APP_ID or getattr(config, "XIN_AGENT_ALIPAY_APP_ID", ""):
        return AlipayApiClient()
    return None


def refresh_alipay_accounts_cache():
    client = AlipayApiClient()
    accounts = client.list_agent_accounts()
    bound_tags = {
        str(account.get("external_account_id") or account.get("account_id") or "").strip()
        for account in models.get_all_sub_accounts(media=models.MEDIA_ALIPAY)
    }
    bound_tags.discard("")
    known = {str(account.get("principal_tag") or account.get("account_id") or "").strip() for account in accounts}
    for tag in sorted(bound_tags - known):
        accounts.append({"account_id": tag, "account_name": tag, "principal_tag": tag})
    models.save_alipay_accounts_cache(accounts)
    logger.info("支付宝账号缓存刷新完成: %d 条", len(accounts))
    return len(accounts)


def sync_alipay_daily_consumption(report_date=None):
    if not report_date:
        report_date = (date.today() - timedelta(days=1)).isoformat()
    accounts = models.get_all_sub_accounts(media=models.MEDIA_ALIPAY)
    if not accounts:
        logger.info("没有 支付宝子账号，跳过同步")
        return {"success": 0, "failed": 0, "total_cost": 0.0}
    client = AlipayApiClient()
    if str(config.ALIPAY_REPORT_MODE or "agent").lower() == "agent" and client.agent_principal_tag:
        account_items = _alipay_accounts_with_match_keys(accounts)
        aggs = {str(account.get("id") or account.get("account_id") or idx): _alipay_empty_agg() for idx, account in enumerate(account_items)}
        try:
            rows = client.fetch_report_rows(report_date, report_date, principal_tag=None, level="account")
        except Exception as exc:
            logger.warning("Alipay agent full report sync failed date=%s: %s", report_date, exc)
            return {"success": 0, "failed": len(account_items), "total_cost": 0.0}
        for row in rows or []:
            account = _alipay_match_account_for_report_row(row, account_items)
            if not account:
                continue
            agg_key = str(account.get("id") or account.get("account_id") or account_items.index(account))
            _alipay_add_item_metrics(aggs.setdefault(agg_key, _alipay_empty_agg()), row)
        success = 0
        total_cost = 0.0
        for idx, account in enumerate(account_items):
            agg_key = str(account.get("id") or account.get("account_id") or idx)
            agg = aggs.get(agg_key) or _alipay_empty_agg()
            models.upsert_alipay_consumption(
                account["id"],
                report_date,
                cost=agg.get("cost_total") or agg.get("cost"),
                impression=agg.get("impression"),
                click=agg.get("click"),
                form_submit=agg.get("form_submit"),
                valid_leads=agg.get("valid_leads"),
                conv_result=agg.get("conv_result"),
                **{k: v for k, v in agg.items() if k not in {"cost", "cost_total", "impression", "click", "form_submit", "valid_leads", "conv_result"}},
            )
            total_cost += float(agg.get("cost_total") or agg.get("cost") or 0)
            success += 1
        logger.info("Alipay agent full report sync completed %s: success=%d total_cost=%.2f", report_date, success, total_cost)
        return {"success": success, "failed": 0, "total_cost": round(total_cost, 2)}
    success = 0
    failed = 0
    total_cost = 0.0
    for account in accounts:
        principal_tag = str(account.get("external_account_id") or account.get("account_id") or "").strip()
        if not principal_tag:
            continue
        try:
            rows = client.fetch_report_rows(report_date, report_date, principal_tag=principal_tag, level="account")
            agg = _alipay_empty_agg()
            if rows:
                for item in rows:
                    _alipay_add_item_metrics(agg, item)
            else:
                consume_rows = client.fetch_principal_consume_rows(report_date, report_date, principal_tag=principal_tag)
                for item in consume_rows:
                    agg["cost"] += _alipay_cost_yuan(item)
                agg["cost_total"] = agg["cost"]
            models.upsert_alipay_consumption(
                account["id"],
                report_date,
                cost=agg.get("cost_total") or agg.get("cost"),
                impression=agg.get("impression"),
                click=agg.get("click"),
                form_submit=agg.get("form_submit"),
                valid_leads=agg.get("valid_leads"),
                conv_result=agg.get("conv_result"),
                **{k: v for k, v in agg.items() if k not in {"cost", "cost_total", "impression", "click", "form_submit", "valid_leads", "conv_result"}},
            )
            total_cost += float(agg.get("cost_total") or agg.get("cost") or 0)
            success += 1
        except Exception as exc:
            failed += 1
            logger.warning("支付宝子账号同步失败 principal_tag=%s date=%s: %s", principal_tag, report_date, exc)
    logger.info("支付宝消耗同步完成 %s: 成功=%d 失败=%d 总消耗=%.2f", report_date, success, failed, total_cost)
    return {"success": success, "failed": failed, "total_cost": round(total_cost, 2)}


def backfill_alipay_accounts(sub_account_ids, start_date=None, end_date=None):
    accounts = models.get_sub_accounts_by_ids(sub_account_ids, media=models.MEDIA_ALIPAY)
    if not accounts:
        return {"success": 0, "failed": 0}
    if not start_date:
        start_date = "2025-01-01"
    if not end_date:
        end_date = (date.today() - timedelta(days=1)).isoformat()
    client = AlipayApiClient()
    if str(config.ALIPAY_REPORT_MODE or "agent").lower() == "agent" and client.agent_principal_tag:
        account_items = _alipay_accounts_with_match_keys(accounts)
        success = 0
        try:
            current = date.fromisoformat(start_date)
            last = date.fromisoformat(end_date)
            while current <= last:
                chunk_end = min(current + timedelta(days=6), last)
                rows = client.fetch_report_rows(current.isoformat(), chunk_end.isoformat(), principal_tag=None, level="account")
                by_account_date = {}
                for item in rows or []:
                    account = _alipay_match_account_for_report_row(item, account_items)
                    if not account:
                        continue
                    item_date = _alipay_row_date(item, current.isoformat())
                    key = (account["id"], item_date)
                    by_account_date.setdefault(key, _alipay_empty_agg())
                    _alipay_add_item_metrics(by_account_date[key], item)
                for (sub_account_id, item_date), agg in by_account_date.items():
                    models.upsert_alipay_consumption(
                        sub_account_id,
                        item_date,
                        cost=agg.get("cost_total") or agg.get("cost"),
                        impression=agg.get("impression"),
                        click=agg.get("click"),
                        form_submit=agg.get("form_submit"),
                        valid_leads=agg.get("valid_leads"),
                        conv_result=agg.get("conv_result"),
                        **{k: v for k, v in agg.items() if k not in {"cost", "cost_total", "impression", "click", "form_submit", "valid_leads", "conv_result"}},
                    )
                    success += 1
                current = chunk_end + timedelta(days=1)
            return {"success": success, "failed": 0}
        except Exception as exc:
            logger.warning("Alipay agent full report backfill failed range=%s~%s: %s", start_date, end_date, exc)
            return {"success": success, "failed": len(account_items)}
    success = 0
    failed = 0
    for account in accounts:
        principal_tag = str(account.get("external_account_id") or account.get("account_id") or "").strip()
        try:
            current = date.fromisoformat(start_date)
            last = date.fromisoformat(end_date)
            while current <= last:
                chunk_end = min(current + timedelta(days=6), last)
                rows = client.fetch_report_rows(current.isoformat(), chunk_end.isoformat(), principal_tag=principal_tag, level="account")
                by_date = {}
                for item in rows:
                    item_date = _alipay_row_date(item, current.isoformat())
                    by_date.setdefault(item_date, _alipay_empty_agg())
                    _alipay_add_item_metrics(by_date[item_date], item)
                for item_date, agg in by_date.items():
                    models.upsert_alipay_consumption(
                        account["id"],
                        item_date,
                        cost=agg.get("cost_total") or agg.get("cost"),
                        impression=agg.get("impression"),
                        click=agg.get("click"),
                        form_submit=agg.get("form_submit"),
                        valid_leads=agg.get("valid_leads"),
                        conv_result=agg.get("conv_result"),
                        **{k: v for k, v in agg.items() if k not in {"cost", "cost_total", "impression", "click", "form_submit", "valid_leads", "conv_result"}},
                    )
                    success += 1
                current = chunk_end + timedelta(days=1)
        except Exception as exc:
            failed += 1
            logger.warning("支付宝账号补拉失败 sub_account=%s principal_tag=%s: %s", account.get("id"), principal_tag, exc)
    return {"success": success, "failed": failed}


def backfill_alipay_project(project_id, start_date, end_date):
    accounts = models.get_sub_accounts_by_project(project_id)
    account_ids = [a["id"] for a in accounts if (a.get("media") or models.MEDIA_XHS) == models.MEDIA_ALIPAY]
    return backfill_alipay_accounts(account_ids, start_date, end_date)


# 全局客户端实例（默认端口）
xhs_client = XhsApiClient()
