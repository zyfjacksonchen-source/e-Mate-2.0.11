"""数据库模型层 - SQLite"""

import sqlite3
import hashlib
import calendar
import json
import re
import os
from pathlib import Path
import config as runtime_config
from datetime import datetime, date, timedelta
from contextlib import contextmanager
from config import XHS_APP_ID, XHS_APP_ID_2, XHS_APP_ID_3, BILI_ACCESS_TOKEN, BILI_BASE_URL, BILI_ADP_VERSION


DATABASE = str(
    getattr(runtime_config, "DATABASE", "")
    or os.environ.get("XIN_AGENT_DATABASE", "")
    or os.environ.get("DATABASE", "")
    or (Path(__file__).resolve().parent / "data" / "xhs_report.db")
)
database = DATABASE
Database = DATABASE


def build_xhs_pc_note_url(note_id=None, fallback_url=""):
    nid = str(note_id or "").strip()
    raw = str(fallback_url or "").strip()
    redirect = ""
    import re
    m_id = re.search(r"\b[0-9a-fA-F]{24}\b", nid)
    if m_id:
        nid = m_id.group(0)
    elif "," in nid or "\n" in nid:
        nid = ""
    if raw:
        try:
            from urllib.parse import parse_qs, unquote, urlsplit
            qs = parse_qs(urlsplit(raw).query)
            redirect = (qs.get("redirectPath") or [""])[0]
            if not redirect:
                m_redirect = re.search(r"[?&]redirectPath=([^&]+)", raw)
                redirect = m_redirect.group(1) if m_redirect else ""
        except Exception:
            redirect = ""
        if not nid:
            m = re.search(r"/discovery/item/([A-Za-z0-9]+)", raw) or re.search(r"/explore/([A-Za-z0-9]+)", raw)
            if not m and redirect:
                m = re.search(r"/discovery/item/([A-Za-z0-9]+)", unquote(redirect)) or re.search(r"/explore/([A-Za-z0-9]+)", unquote(redirect))
            if m:
                nid = m.group(1)
    if not nid:
        return "" if "xiaohongshu.com/search_result" in raw else (raw if raw.startswith("http") else "")

    token = ""
    if raw:
        try:
            from urllib.parse import parse_qs, quote, unquote, urlsplit
            token = (parse_qs(urlsplit(raw).query).get("xsec_token") or [""])[0]
            if not token and redirect:
                token = (parse_qs(urlsplit(unquote(redirect)).query).get("xsec_token") or [""])[0]
        except Exception:
            token = ""
    url = f"https://www.xiaohongshu.com/explore/{nid}?source=webshare&xhsshare=pc_web"
    if token:
        url += "&xsec_token=" + quote(token, safe="")
    return url + "&xsec_source=pc_share"


def preserve_note_url(note_id=None, raw_url=""):
    raw = str(raw_url or "").strip()
    if raw.startswith("http"):
        return raw
    return build_xhs_pc_note_url(note_id, raw)


def extract_xhs_note_entries(text):
    raw = str(text or "")
    entries = []
    seen = set()

    def add(note_id, url=""):
        nid = str(note_id or "").strip()
        key = nid.lower()
        if not nid or key in seen:
            return
        seen.add(key)
        entries.append({"note_id": nid, "note_url": build_xhs_pc_note_url(nid, url)})

    import re
    from urllib.parse import unquote
    for url in re.findall(r"https?://[^\s，。；;]+", raw):
        decoded = unquote(url)
        match = re.search(r"/(?:discovery/item|explore)/([A-Za-z0-9]+)", decoded)
        if match:
            add(match.group(1), decoded)

    for note_id in re.findall(r"\b[0-9a-fA-F]{24}\b", raw):
        add(note_id)
    return entries


MEDIA_XHS = "小红书"
MEDIA_BILI = "B站"
MEDIA_ALIPAY = "支付宝"
DEPARTMENT_BILI_ALIPAY = "B站支付宝"
HANDOVER_TARGET_OPERATOR = "operator"
HANDOVER_TARGET_SELF = "self"
HANDOVER_SELF_LABEL = "自运营"

MARKETING_LINK_OPTIONS = ["私信", "下单", "种草", "app"]


def normalize_marketing_link(value):
    raw = str(value or "").strip()
    low = raw.lower()
    if not raw:
        return "私信"
    if any(token in raw for token in ("客资", "线索", "留咨", "留资", "咨询", "私信")) or raw in ("咨",):
        return "私信"
    if raw in ("下单", "订单", "购买") or low in ("order", "purchase"):
        return "下单"
    if "种草" in raw:
        return "种草"
    if low == "app" or raw == "APP":
        return "app"
    return raw if raw in MARKETING_LINK_OPTIONS else "私信"


PROJECT_CARD_DEFAULT_FIELDS = [
    "realtime_initiative_message",
    "realtime_initiative_message_cpl",
    "realtime_msg_leads_num",
    "realtime_msg_leads_cost",
]

PROJECT_CARD_DEFAULT_FIELDS_BY_LINK = {
    "私信": ["realtime_initiative_message", "realtime_initiative_message_cpl", "realtime_msg_leads_num", "realtime_msg_leads_cost"],
    "下单": ["realtime_total_order_num_7d", "realtime_total_order_num_7d_cost", "realtime_total_order_gmv_7d", "realtime_total_order_roi_7d"],
    "app": ["realtime_impression", "realtime_click", "realtime_ctr", "realtime_conversion_rate"],
    "种草": ["realtime_impression", "realtime_cpm", "realtime_click", "realtime_acp"],
}

PROJECT_CARD_DAILY_FIELDS = [
    "impression",
    "click",
    "interaction",
    "leads",
    "message_consult",
    "msg_leads_num",
    "initiative_message",
    "valid_leads",
    "like_count",
    "comment_count",
    "collect_count",
    "follow_count",
    "share_count",
    "action_button_click",
    "search_cmt_click",
    "total_order_num_7d",
    "total_order_gmv_7d",
    "i_user_num",
    "ti_user_num",
    "telephone_click",
    "form_submit",
    "charged_cost_milli",
    "show_count",
    "click_count",
    "comment_click_count",
    "app_wake_count",
    "order_submit_count",
    "video_play_count",
    "video_like_count",
    "video_fav_count",
    "video_coin_count",
    "video_interact_count",
]

CHENGFENG_PROJECT_CARD_DAILY_FIELDS = [
    "impression",
    "click",
    "interaction",
    "like_count",
    "comment_count",
    "collect_count",
    "follow_count",
    "share_count",
    "action_button_click",
    "search_cmt_click",
    "reserve_pv",
    "live_subscribe_cnt",
    "live_watch_cnt",
    "live_follow_cnt",
    "live_5s_watch_cnt",
    "live_cmt_cnt",
    "live_30s_watch_cnt",
    "goods_view_num",
    "goods_add_cart_num",
    "total_order_num_7d",
    "total_order_gmv_7d",
    "deal_order_num_7d",
    "deal_order_gmv_7d",
    "live_direct_purchase_order_num_24h",
    "live_direct_purchase_order_gmv_24h",
    "live_direct_deal_order_num_24h",
    "live_direct_deal_order_gmv_24h",
    "new_seller_goods_view_num",
    "new_seller_deal_order_num_7d",
    "new_seller_deal_order_gmv_7d",
]

PROJECT_CARD_DAILY_FIELDS = list(dict.fromkeys(PROJECT_CARD_DAILY_FIELDS + CHENGFENG_PROJECT_CARD_DAILY_FIELDS))

PROJECT_CARD_REALTIME_FIELDS = [
    "realtime_impression",
    "realtime_click",
    "realtime_interaction",
    "realtime_ctr",
    "realtime_conversion_rate",
    "realtime_acp",
    "realtime_cpm",
    "realtime_like_count",
    "realtime_collect_count",
    "realtime_comment_count",
    "realtime_follow_count",
    "realtime_share_count",
    "realtime_leads",
    "realtime_valid_leads",
    "realtime_message_consult",
    "realtime_message_consult_cpl",
    "realtime_msg_leads_num",
    "realtime_msg_leads_cost",
    "realtime_initiative_message",
    "realtime_initiative_message_cpl",
    "realtime_action_button_click",
    "realtime_action_button_ctr",
    "realtime_search_cmt_click",
    "realtime_search_cmt_click_cvr",
    "realtime_total_order_num_7d",
    "realtime_total_order_num_7d_cost",
    "realtime_total_order_gmv_7d",
    "realtime_total_order_roi_7d",
    "realtime_i_user_num",
    "realtime_i_user_price",
    "realtime_ti_user_num",
    "realtime_ti_user_price",
]

CHENGFENG_PROJECT_CARD_REALTIME_FIELDS = [f"realtime_{key}" for key in CHENGFENG_PROJECT_CARD_DAILY_FIELDS]
PROJECT_CARD_REALTIME_FIELDS = list(dict.fromkeys(PROJECT_CARD_REALTIME_FIELDS + CHENGFENG_PROJECT_CARD_REALTIME_FIELDS))

PROJECT_CARD_FIELD_DEFS = [
    {"key": "realtime_cost", "label": "实时消耗", "category": "实时展现数据", "format": "money", "source": "realtime", "default": True},
    {"key": "private_consult_cost", "label": "私信留资成本", "category": "私信营销数据", "format": "money", "source": "formula", "default": True},
    {"key": "realtime_impression", "label": "展现量", "category": "实时展现数据", "format": "number", "source": "realtime"},
    {"key": "realtime_click", "label": "点击量", "category": "实时展现数据", "format": "number", "source": "realtime"},
    {"key": "realtime_interaction", "label": "互动量", "category": "实时笔记互动", "format": "number", "source": "realtime"},
    {"key": "realtime_ctr", "label": "点击率", "category": "实时展现数据", "format": "percent", "source": "realtime"},
    {"key": "realtime_conversion_rate", "label": "转化率", "category": "实时展现数据", "format": "percent", "source": "formula"},
    {"key": "realtime_acp", "label": "平均点击成本", "category": "实时展现数据", "format": "money", "source": "realtime"},
    {"key": "realtime_cpm", "label": "平均千次展示费用", "category": "实时展现数据", "format": "money", "source": "realtime"},
    {"key": "realtime_like_count", "label": "点赞", "category": "实时笔记互动", "format": "number", "source": "realtime"},
    {"key": "realtime_collect_count", "label": "收藏", "category": "实时笔记互动", "format": "number", "source": "realtime"},
    {"key": "realtime_comment_count", "label": "评论", "category": "实时笔记互动", "format": "number", "source": "realtime"},
    {"key": "realtime_follow_count", "label": "关注", "category": "实时笔记互动", "format": "number", "source": "realtime"},
    {"key": "realtime_share_count", "label": "分享", "category": "实时笔记互动", "format": "number", "source": "realtime"},
    {"key": "realtime_leads", "label": "表单提交量", "category": "实时销售线索数据", "format": "number", "source": "realtime"},
    {"key": "realtime_valid_leads", "label": "有效表单量", "category": "实时销售线索数据", "format": "number", "source": "realtime"},
    {"key": "realtime_message_consult", "label": "私信进线数", "category": "实时私信营销数据", "format": "number", "source": "realtime"},
    {"key": "realtime_message_consult_cpl", "label": "私信进线成本", "category": "实时私信营销数据", "format": "money", "source": "realtime"},
    {"key": "realtime_msg_leads_num", "label": "私信留资数", "category": "实时私信营销数据", "format": "number", "source": "realtime"},
    {"key": "realtime_msg_leads_cost", "label": "私信留资成本", "category": "实时私信营销数据", "format": "money", "source": "realtime"},
    {"key": "realtime_initiative_message", "label": "私信开口数", "category": "实时私信营销数据", "format": "number", "source": "realtime"},
    {"key": "realtime_initiative_message_cpl", "label": "私信开口成本", "category": "实时私信营销数据", "format": "money", "source": "realtime"},
    {"key": "realtime_action_button_click", "label": "行动按钮点击量", "category": "实时笔记互动", "format": "number", "source": "realtime"},
    {"key": "realtime_action_button_ctr", "label": "行动按钮点击率", "category": "实时笔记互动", "format": "percent", "source": "realtime"},
    {"key": "realtime_search_cmt_click", "label": "搜索组件点击量", "category": "实时种草效果数据", "format": "number", "source": "realtime"},
    {"key": "realtime_search_cmt_click_cvr", "label": "搜索组件点击转化率", "category": "实时种草效果数据", "format": "percent", "source": "realtime"},
    {"key": "realtime_total_order_num_7d", "label": "7日总下单订单量", "category": "实时下单数据", "format": "number", "source": "realtime"},
    {"key": "realtime_total_order_num_7d_cost", "label": "7日总下单订单成本", "category": "实时下单数据", "format": "money", "source": "formula"},
    {"key": "realtime_total_order_gmv_7d", "label": "7日总下单金额", "category": "实时下单数据", "format": "money", "source": "realtime"},
    {"key": "realtime_total_order_roi_7d", "label": "7日总下单ROI", "category": "实时下单数据", "format": "number", "source": "formula"},
    {"key": "realtime_i_user_num", "label": "新增种草人群", "category": "实时种草效果数据", "format": "number", "source": "realtime"},
    {"key": "realtime_i_user_price", "label": "新增种草人群成本", "category": "实时种草效果数据", "format": "money", "source": "realtime"},
    {"key": "realtime_ti_user_num", "label": "新增深度种草人群", "category": "实时种草效果数据", "format": "number", "source": "realtime"},
    {"key": "realtime_ti_user_price", "label": "新增深度种草人群成本", "category": "实时种草效果数据", "format": "money", "source": "realtime"},

    {"key": "yesterday_cost", "label": "昨日消耗", "category": "消耗指标", "format": "money", "source": "daily", "default": True},
    {"key": "account_balance", "label": "账户余额", "category": "账户数据", "format": "money", "source": "realtime", "default": True},
    {"key": "selected_cost", "label": "所选时间消费", "category": "消耗指标", "format": "money", "source": "daily"},
    {"key": "change_amount", "label": "较上一周期", "category": "消耗指标", "format": "money", "source": "formula"},
    {"key": "month_cost", "label": "本月消费", "category": "消耗指标", "format": "money", "source": "daily"},
    {"key": "account_count", "label": "账号数", "category": "项目基础", "format": "number", "source": "project"},
    {"key": "impression", "label": "展现量", "category": "展现数据", "format": "number", "source": "daily"},
    {"key": "click", "label": "点击量", "category": "展现数据", "format": "number", "source": "daily"},
    {"key": "interaction", "label": "互动量", "category": "笔记互动", "format": "number", "source": "daily"},
    {"key": "ctr", "label": "点击率", "category": "展现数据", "format": "percent", "source": "formula"},
    {"key": "conversion_rate", "label": "转化率", "category": "展现数据", "format": "percent", "source": "formula"},
    {"key": "cpc", "label": "平均点击成本", "category": "展现数据", "format": "money", "source": "formula"},
    {"key": "cpm", "label": "平均千次展示费用", "category": "展现数据", "format": "money", "source": "formula"},
    {"key": "leads", "label": "表单提交量", "category": "销售线索数据", "format": "number", "source": "daily"},
    {"key": "cpl", "label": "表单成本", "category": "销售线索数据", "format": "money", "source": "formula"},
    {"key": "message_consult", "label": "私信进线数", "category": "私信营销数据", "format": "number", "source": "daily"},
    {"key": "consult_cost", "label": "私信进线成本", "category": "私信营销数据", "format": "money", "source": "formula"},
    {"key": "msg_leads_num", "label": "私信留资数", "category": "私信营销数据", "format": "number", "source": "daily"},
    {"key": "valid_leads", "label": "有效表单量", "category": "销售线索数据", "format": "number", "source": "daily"},
    {"key": "initiative_message", "label": "私信开口数", "category": "私信营销数据", "format": "number", "source": "daily"},
    {"key": "initiative_message_cpl", "label": "私信开口成本", "category": "私信营销数据", "format": "money", "source": "formula"},
    {"key": "like_count", "label": "点赞", "category": "笔记互动", "format": "number", "source": "daily"},
    {"key": "comment_count", "label": "评论", "category": "笔记互动", "format": "number", "source": "daily"},
    {"key": "collect_count", "label": "收藏", "category": "笔记互动", "format": "number", "source": "daily"},
    {"key": "follow_count", "label": "关注", "category": "笔记互动", "format": "number", "source": "daily"},
    {"key": "share_count", "label": "分享", "category": "笔记互动", "format": "number", "source": "daily"},
    {"key": "action_button_click", "label": "行动按钮点击量", "category": "笔记互动", "format": "number", "source": "daily"},
    {"key": "action_button_ctr", "label": "行动按钮点击率", "category": "笔记互动", "format": "percent", "source": "formula"},
    {"key": "search_cmt_click", "label": "搜索组件点击量", "category": "种草效果数据", "format": "number", "source": "daily"},
    {"key": "search_cmt_click_cvr", "label": "搜索组件点击转化率", "category": "种草效果数据", "format": "percent", "source": "formula"},
    {"key": "i_user_num", "label": "新增种草人群", "category": "种草效果数据", "format": "number", "source": "daily"},
    {"key": "i_user_price", "label": "新增种草人群成本", "category": "种草效果数据", "format": "money", "source": "formula"},
    {"key": "ti_user_num", "label": "新增深度种草人群", "category": "种草效果数据", "format": "number", "source": "daily"},
    {"key": "ti_user_price", "label": "新增深度种草人群成本", "category": "种草效果数据", "format": "money", "source": "formula"},
    {"key": "telephone_click", "label": "电话拨打量", "category": "销售线索数据", "format": "number", "source": "daily"},
]

CHENGFENG_PROJECT_CARD_FIELD_DEFS = [
    {"key": "realtime_cost", "label": "实时消耗", "category": "乘风实时基础数据", "format": "money", "source": "realtime", "default": True},
    {"key": "account_balance", "label": "账户余额", "category": "账户数据", "format": "money", "source": "realtime", "default": True},
    {"key": "selected_cost", "label": "所选时间消费", "category": "乘风消耗指标", "format": "money", "source": "daily"},
    {"key": "realtime_impression", "label": "展现量", "category": "乘风实时基础数据", "format": "number", "source": "realtime"},
    {"key": "realtime_click", "label": "点击量", "category": "乘风实时基础数据", "format": "number", "source": "realtime"},
    {"key": "realtime_ctr", "label": "点击率", "category": "乘风实时基础数据", "format": "percent", "source": "realtime"},
    {"key": "realtime_acp", "label": "平均点击成本", "category": "乘风实时基础数据", "format": "money", "source": "realtime"},
    {"key": "realtime_cpm", "label": "平均千次展示费用", "category": "乘风实时基础数据", "format": "money", "source": "realtime"},
    {"key": "realtime_interaction", "label": "互动量", "category": "乘风实时互动数据", "format": "number", "source": "realtime"},
    {"key": "realtime_like_count", "label": "点赞数", "category": "乘风实时互动数据", "format": "number", "source": "realtime"},
    {"key": "realtime_comment_count", "label": "评论数", "category": "乘风实时互动数据", "format": "number", "source": "realtime"},
    {"key": "realtime_collect_count", "label": "收藏数", "category": "乘风实时互动数据", "format": "number", "source": "realtime"},
    {"key": "realtime_follow_count", "label": "关注数", "category": "乘风实时互动数据", "format": "number", "source": "realtime"},
    {"key": "realtime_share_count", "label": "分享数", "category": "乘风实时互动数据", "format": "number", "source": "realtime"},
    {"key": "realtime_action_button_click", "label": "行动按钮点击", "category": "乘风实时互动数据", "format": "number", "source": "realtime"},
    {"key": "realtime_search_cmt_click", "label": "搜索组件点击", "category": "乘风实时搜索组件", "format": "number", "source": "realtime"},
    {"key": "realtime_reserve_pv", "label": "预约量", "category": "乘风实时转化数据", "format": "number", "source": "realtime"},
    {"key": "realtime_live_subscribe_cnt", "label": "直播预约量", "category": "乘风实时直播数据", "format": "number", "source": "realtime"},
    {"key": "realtime_live_watch_cnt", "label": "直播观看量", "category": "乘风实时直播数据", "format": "number", "source": "realtime"},
    {"key": "realtime_live_follow_cnt", "label": "直播新增粉丝", "category": "乘风实时直播数据", "format": "number", "source": "realtime"},
    {"key": "realtime_live_5s_watch_cnt", "label": "直播5秒观看", "category": "乘风实时直播数据", "format": "number", "source": "realtime"},
    {"key": "realtime_live_cmt_cnt", "label": "直播评论数", "category": "乘风实时直播数据", "format": "number", "source": "realtime"},
    {"key": "realtime_live_30s_watch_cnt", "label": "直播30秒观看", "category": "乘风实时直播数据", "format": "number", "source": "realtime"},
    {"key": "realtime_goods_view_num", "label": "商品浏览量", "category": "乘风实时电商数据", "format": "number", "source": "realtime"},
    {"key": "realtime_goods_add_cart_num", "label": "商品加购量", "category": "乘风实时电商数据", "format": "number", "source": "realtime"},
    {"key": "realtime_total_order_num_7d", "label": "7日总下单订单量", "category": "乘风实时电商数据", "format": "number", "source": "realtime"},
    {"key": "realtime_total_order_num_7d_cost", "label": "7日总下单订单成本", "category": "乘风实时电商数据", "format": "money", "source": "formula"},
    {"key": "realtime_total_order_gmv_7d", "label": "7日总下单金额", "category": "乘风实时电商数据", "format": "money", "source": "realtime"},
    {"key": "realtime_total_order_roi_7d", "label": "7日总下单ROI", "category": "乘风实时电商数据", "format": "number", "source": "formula"},
    {"key": "realtime_deal_order_num_7d", "label": "7日成交订单量", "category": "乘风实时电商数据", "format": "number", "source": "realtime"},
    {"key": "realtime_deal_order_gmv_7d", "label": "7日成交GMV", "category": "乘风实时电商数据", "format": "money", "source": "realtime"},
    {"key": "realtime_live_direct_purchase_order_num_24h", "label": "直播直购24h订单", "category": "乘风实时直播成交", "format": "number", "source": "realtime"},
    {"key": "realtime_live_direct_purchase_order_gmv_24h", "label": "直播直购24hGMV", "category": "乘风实时直播成交", "format": "money", "source": "realtime"},
    {"key": "realtime_live_direct_deal_order_num_24h", "label": "直播直成24h订单", "category": "乘风实时直播成交", "format": "number", "source": "realtime"},
    {"key": "realtime_live_direct_deal_order_gmv_24h", "label": "直播直成24hGMV", "category": "乘风实时直播成交", "format": "money", "source": "realtime"},
    {"key": "realtime_new_seller_goods_view_num", "label": "新客商品浏览", "category": "乘风实时新客数据", "format": "number", "source": "realtime"},
    {"key": "realtime_new_seller_deal_order_num_7d", "label": "新客7日成交订单", "category": "乘风实时新客数据", "format": "number", "source": "realtime"},
    {"key": "realtime_new_seller_deal_order_gmv_7d", "label": "新客7日成交GMV", "category": "乘风实时新客数据", "format": "money", "source": "realtime"},
    {"key": "goods_view_num", "label": "商品浏览量", "category": "乘风离线电商数据", "format": "number", "source": "daily"},
    {"key": "total_order_gmv_7d", "label": "7日总GMV", "category": "乘风离线电商数据", "format": "money", "source": "daily"},
    {"key": "deal_order_num_7d", "label": "7日成交订单量", "category": "乘风离线电商数据", "format": "number", "source": "daily"},
    {"key": "live_direct_deal_order_gmv_24h", "label": "直播直成24hGMV", "category": "乘风离线直播成交", "format": "money", "source": "daily"},
    {"key": "new_seller_goods_view_num", "label": "新客商品浏览", "category": "乘风离线新客数据", "format": "number", "source": "daily"},
]

CHENGFENG_PROJECT_CARD_DEFAULT_FIELDS = [
    "realtime_total_order_num_7d",
    "realtime_total_order_num_7d_cost",
    "realtime_total_order_gmv_7d",
    "realtime_total_order_roi_7d",
]

PROJECT_CARD_FIELD_KEYS = {item["key"] for item in PROJECT_CARD_FIELD_DEFS}
CHENGFENG_PROJECT_CARD_FIELD_KEYS = {item["key"] for item in CHENGFENG_PROJECT_CARD_FIELD_DEFS}


def project_card_field_defs(platform=None):
    if platform == "乘风":
        return [dict(item) for item in CHENGFENG_PROJECT_CARD_FIELD_DEFS]
    return [dict(item) for item in PROJECT_CARD_FIELD_DEFS]


def normalize_project_card_fields(raw, platform=None):
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            raw = []
    if not isinstance(raw, list):
        return []
    allowed = CHENGFENG_PROJECT_CARD_FIELD_KEYS if platform == "乘风" else PROJECT_CARD_FIELD_KEYS
    fields = []
    for key in raw:
        key = str(key or "").strip()
        if key in allowed and key not in fields:
            fields.append(key)
    return fields


def get_db():
    conn = sqlite3.connect(DATABASE, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db_connection():
    conn = get_db()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """创建所有表，并处理迁移"""
    conn = get_db()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
    except Exception:
        pass
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'operator',
            real_name TEXT DEFAULT '',
            department TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_name TEXT NOT NULL,
            advertiser_name TEXT DEFAULT '',
            sales_name TEXT DEFAULT '',
            need_content TEXT DEFAULT '',
            marketing_goal TEXT DEFAULT '',
            operator_id INTEGER REFERENCES users(id),
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS sub_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            account_id TEXT NOT NULL,
            account_name TEXT DEFAULT '',
            account_type TEXT NOT NULL DEFAULT 'auto',
            industry TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(project_id, account_id)
        );

        CREATE TABLE IF NOT EXISTS daily_consumption (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            cost_simple REAL DEFAULT 0,
            cost_standard REAL DEFAULT 0,
            cost_square REAL DEFAULT 0,
            cost_total REAL DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(sub_account_id, date)
        );

        CREATE TABLE IF NOT EXISTS oauth_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            access_token TEXT,
            refresh_token TEXT,
            expires_at TEXT,
            refresh_expires_at TEXT,
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS mpi_advertisers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            advertiser_id TEXT NOT NULL UNIQUE,
            advertiser_name TEXT DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS user_todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            content TEXT NOT NULL,
            deadline TEXT,
            done INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS project_handovers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id),
            from_operator_id INTEGER REFERENCES users(id),
            to_operator_id INTEGER REFERENCES users(id),
            handover_time TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS sub_account_handovers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sub_account_id INTEGER NOT NULL REFERENCES sub_accounts(id) ON DELETE CASCADE,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            from_operator_id INTEGER REFERENCES users(id),
            to_operator_id INTEGER REFERENCES users(id),
            handover_time TEXT NOT NULL,
            to_target_type TEXT DEFAULT 'operator',
            to_operator_label TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS project_knowledge (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            source_type TEXT DEFAULT 'file',
            source_name TEXT DEFAULT '',
            source_url TEXT DEFAULT '',
            file_path TEXT DEFAULT '',
            markdown_path TEXT DEFAULT '',
            markdown_content TEXT DEFAULT '',
            llmwiki_json TEXT DEFAULT '',
            wiki_root TEXT DEFAULT '',
            schema_path TEXT DEFAULT '',
            wiki_pages_json TEXT DEFAULT '[]',
            status TEXT DEFAULT 'ready',
            error TEXT DEFAULT '',
            created_by INTEGER REFERENCES users(id),
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS system_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            alert_type TEXT NOT NULL,
            account_id TEXT NOT NULL,
            account_name TEXT DEFAULT '',
            balance REAL DEFAULT 0,
            daily_cost REAL DEFAULT 0,
            message TEXT DEFAULT '',
            resolved INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(alert_type, account_id)
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
            creator_id INTEGER NOT NULL REFERENCES users(id),
            assignee_id INTEGER REFERENCES users(id),
            type TEXT NOT NULL DEFAULT '图文笔记',
            status TEXT NOT NULL DEFAULT '进行中',
            priority TEXT NOT NULL DEFAULT '中',
            start_date TEXT NOT NULL,
            due_date TEXT,
            estimated_hours REAL DEFAULT 0,
            actual_hours REAL DEFAULT 0,
            note_count INTEGER DEFAULT 0,
            parent_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
            note_id TEXT DEFAULT '',
            note_url TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS task_checklists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            done INTEGER DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS mcp_principals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id),
            token_hash TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS mcp_role_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(role, tool_name)
        );

        CREATE TABLE IF NOT EXISTS mcp_data_scopes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role TEXT NOT NULL,
            scope_type TEXT NOT NULL,
            scope_value TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS mcp_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            principal_id INTEGER,
            user_id INTEGER,
            role TEXT DEFAULT '',
            tool_name TEXT DEFAULT '',
            arguments_json TEXT DEFAULT '{}',
            row_count INTEGER DEFAULT 0,
            elapsed_ms INTEGER DEFAULT 0,
            is_error INTEGER DEFAULT 0,
            error_message TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS mcp_document_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_type TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            project_id INTEGER,
            media TEXT DEFAULT '',
            department TEXT DEFAULT '',
            owner_id INTEGER,
            visibility_role TEXT DEFAULT '',
            title TEXT DEFAULT '',
            chunk_index INTEGER NOT NULL,
            chunk_text TEXT NOT NULL,
            token_count INTEGER DEFAULT 0,
            content_hash TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(source_type, source_id, chunk_index, content_hash)
        );

        CREATE TABLE IF NOT EXISTS mcp_document_index (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chunk_id INTEGER NOT NULL REFERENCES mcp_document_chunks(id) ON DELETE CASCADE,
            keywords TEXT DEFAULT '',
            keyword_vector TEXT DEFAULT '{}',
            embedding_model TEXT DEFAULT 'local-hash-v1',
            embedding_ref TEXT DEFAULT '',
            indexed_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(chunk_id)
        );

        CREATE TABLE IF NOT EXISTS xin_role_usage_daily (
            usage_date TEXT NOT NULL,
            role TEXT NOT NULL,
            client TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            username TEXT DEFAULT '',
            real_name TEXT DEFAULT '',
            department TEXT DEFAULT '',
            use_count INTEGER NOT NULL DEFAULT 0,
            first_used_at TEXT DEFAULT (datetime('now','localtime')),
            last_used_at TEXT DEFAULT (datetime('now','localtime')),
            PRIMARY KEY (usage_date, role, client, user_id)
        );
    """)

    # 迁移辅助函数：安全添加列（列已存在则跳过）
    def _add_column(conn, table, column, col_type, default=""):
        try:
            cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
            if column not in cols:
                if default:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type} DEFAULT {default}")
                else:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
        except Exception:
            pass  # 列已存在或迁移失败，跳过

    _add_column(conn, 'projects', 'need_content', 'TEXT', "''")
    _add_column(conn, 'projects', 'marketing_goal', 'TEXT', "''")
    _add_column(conn, 'sub_accounts', 'industry', 'TEXT', "''")
    _add_column(conn, 'users', 'real_name', 'TEXT', "''")
    _add_column(conn, 'users', 'department', 'TEXT', "''")
    _add_column(conn, 'user_todos', 'assigned_by', 'INTEGER', 'NULL')
    _add_column(conn, 'user_todos', 'type', 'TEXT', "'personal'")
    _add_column(conn, 'user_todos', 'read', 'INTEGER', '1')
    _add_column(conn, 'sub_accounts', 'company_name', 'TEXT', "''")
    _add_column(conn, 'sub_accounts', 'virtual_seller_id', 'TEXT', 'NULL')
    _add_column(conn, 'users', 'status', 'TEXT', "'active'")
    _add_column(conn, 'users', 'resigned_at', 'TEXT', 'NULL')
    _add_column(conn, 'projects', 'group_name', 'TEXT', "''")  # 大项目名称
    _add_column(conn, 'projects', 'platform', 'TEXT', "'聚光'")  # 后台平台：聚光/乘风
    _add_column(conn, 'projects', 'media', 'TEXT', "'小红书'")  # 媒体平台：小红书/B站/支付宝
    _add_column(conn, 'projects', 'doc_links', 'TEXT', "'[]'")  # 项目文档链接
    _add_column(conn, 'projects', 'card_fields', 'TEXT', "'[]'")  # 项目速览小卡字段配置
    _add_column(conn, 'projects', 'card_order', 'INTEGER', '0')  # 项目速览小卡排序
    _add_column(conn, 'projects', 'operation_mode', 'TEXT', "'operator'")
    _add_column(conn, 'sub_accounts', 'media', 'TEXT', "'小红书'")
    _add_column(conn, 'sub_accounts', 'external_account_id', 'TEXT', "''")
    _add_column(conn, 'oauth_tokens', 'app_id', 'TEXT', "''")  # 多端口区分
    _add_column(conn, 'oauth_tokens', 'refresh_expires_at', 'TEXT', "''")
    _add_column(conn, 'project_knowledge', 'wiki_root', 'TEXT', "''")
    _add_column(conn, 'project_knowledge', 'schema_path', 'TEXT', "''")
    _add_column(conn, 'project_knowledge', 'wiki_pages_json', 'TEXT', "'[]'")
    _add_column(conn, 'project_handovers', 'to_target_type', 'TEXT', "'operator'")
    _add_column(conn, 'project_handovers', 'to_operator_label', 'TEXT', "''")
    _add_column(conn, 'project_handovers', 'start_date', 'TEXT', "''")
    _add_column(conn, 'project_handovers', 'end_date', 'TEXT', "''")
    _add_column(conn, 'sub_account_handovers', 'project_id', 'INTEGER', '0')
    _add_column(conn, 'sub_account_handovers', 'to_target_type', 'TEXT', "'operator'")
    _add_column(conn, 'sub_account_handovers', 'to_operator_label', 'TEXT', "''")
    _add_column(conn, 'sub_account_handovers', 'start_date', 'TEXT', "''")
    _add_column(conn, 'sub_account_handovers', 'end_date', 'TEXT', "''")
    conn.execute(
        """UPDATE sub_account_handovers
           SET project_id = (
               SELECT sa.project_id FROM sub_accounts sa
               WHERE sa.id = sub_account_handovers.sub_account_id
           )
           WHERE COALESCE(project_id, 0) = 0"""
    )
    conn.execute("UPDATE project_handovers SET start_date = date(handover_time) WHERE COALESCE(start_date, '') = ''")
    conn.execute("UPDATE sub_account_handovers SET start_date = date(handover_time) WHERE COALESCE(start_date, '') = ''")
    _add_column(conn, 'task_note_performance', 'note_title', 'TEXT', "''")
    _add_column(conn, 'task_note_performance', 'note_image', 'TEXT', "''")
    _add_column(conn, 'task_note_performance', 'note_jump_url', 'TEXT', "''")

    # ---- daily_consumption 扩展：存储MPI离线报表的完整字段 ----
    _add_column(conn, 'daily_consumption', 'impression', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'click', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'interaction', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'ctr', 'REAL', '0')
    _add_column(conn, 'daily_consumption', 'leads', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'message_consult', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'msg_leads_num', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'valid_leads', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'like_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'comment_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'collect_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'follow_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'share_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'initiative_message', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'action_button_click', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'search_cmt_click', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'i_user_num', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'ti_user_num', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'telephone_click', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'form_submit', 'INTEGER', '0')
    for field in CHENGFENG_PROJECT_CARD_DAILY_FIELDS:
        if field not in {
            'impression', 'click', 'interaction', 'like_count', 'comment_count', 'collect_count',
            'follow_count', 'share_count', 'action_button_click', 'search_cmt_click',
        }:
            _add_column(conn, 'daily_consumption', field, 'REAL', '0')

    # ---- B站三连指标扩展 ----
    _add_column(conn, 'daily_consumption', 'charged_cost_milli', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'show_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'click_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'comment_click_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'app_wake_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'order_submit_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'video_play_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'video_like_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'video_fav_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'video_coin_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'video_interact_count', 'INTEGER', '0')
    _add_column(conn, 'daily_consumption', 'bili_metrics_json', 'TEXT', "'{}'")
    _add_column(conn, 'daily_consumption', 'alipay_metrics_json', 'TEXT', "'{}'")

    # ---- 内容运营工作台扩展 ----
    _add_column(conn, 'tasks', 'quantity', 'INTEGER', '1')         # 笔记需求数量
    _add_column(conn, 'tasks', 'source', 'TEXT', "'self'")         # 任务来源：self/assigned
    _add_column(conn, 'tasks', 'is_archived', 'INTEGER', '0')      # 归档标记
    _add_column(conn, 'tasks', 'archived_at', 'TEXT', 'NULL')      # 归档时间
    _add_column(conn, 'tasks', 'remark', 'TEXT', "''")             # 任务备注（kos/粉红卫士/雅思等）
    _add_column(conn, 'tasks', 'doc_links', 'TEXT', "'[]'")         # 笔记文档链接 JSON
    _add_column(conn, 'tasks', 'pending_count', 'INTEGER', '0')    # 待发布篇数

    # ---- 创意工作台扩展 ----
    _add_column(conn, 'tasks', 'category', 'TEXT', "'content'")       # content / creative
    _add_column(conn, 'tasks', 'source_task_id', 'INTEGER', 'NULL')   # 关联的内容运营任务
    _add_column(conn, 'tasks', 'workload_weight', 'REAL', '0')        # 工作量权重
    _add_column(conn, 'tasks', 'review_comment', 'TEXT', "''")        # 创意任务审核意见
    _add_column(conn, 'tasks', 'brief_json', 'TEXT', "'{}'")           # 创意需求单结构化字段
    _add_column(conn, 'tasks', 'attachment_links', 'TEXT', "'[]'")     # 创意需求单参考图/视频/文档链接
    _add_column(conn, 'users', 'created_by', 'INTEGER', 'NULL')       # 创建该用户的上级ID
    conn.execute(
        "UPDATE tasks SET status='进行中' WHERE category='creative' AND status='待接单' AND assignee_id IS NOT NULL"
    )
    conn.execute(
        "UPDATE tasks SET status='待分配' WHERE category='creative' AND status='待接单' AND assignee_id IS NULL"
    )

    # B站账号缓存表
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bili_accounts_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id TEXT NOT NULL UNIQUE,
            account_name TEXT DEFAULT '',
            raw_json TEXT DEFAULT '{}',
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS alipay_accounts_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id TEXT NOT NULL UNIQUE,
            account_name TEXT DEFAULT '',
            principal_tag TEXT DEFAULT '',
            raw_json TEXT DEFAULT '{}',
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)

    # 任务协作人表
    conn.execute("""
        CREATE TABLE IF NOT EXISTS task_collaborators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            role TEXT DEFAULT 'collaborator',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(task_id, user_id)
        )
    """)

    # 任务关联关系表
    conn.execute("""
        CREATE TABLE IF NOT EXISTS task_relations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id_a INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            task_id_b INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            relation_type TEXT NOT NULL DEFAULT 'related',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(task_id_a, task_id_b, relation_type)
        )
    """)

    # 笔记表现数据缓存表
    conn.execute("""
        CREATE TABLE IF NOT EXISTS task_note_performance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            note_id TEXT NOT NULL,
            note_title TEXT DEFAULT '',
            note_image TEXT DEFAULT '',
            note_jump_url TEXT DEFAULT '',
            impression INTEGER DEFAULT 0,
            interaction INTEGER DEFAULT 0,
            cost REAL DEFAULT 0,
            ctr REAL DEFAULT 0,
            message_consult INTEGER DEFAULT 0,
            click INTEGER DEFAULT 0,
            sync_status TEXT DEFAULT 'pending',
            sync_message TEXT DEFAULT '等待同步投放数据',
            fetched_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(task_id, note_id)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS task_note_performance_daily (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            note_id TEXT NOT NULL,
            report_date TEXT NOT NULL,
            note_title TEXT DEFAULT '',
            note_image TEXT DEFAULT '',
            note_jump_url TEXT DEFAULT '',
            impression INTEGER DEFAULT 0,
            interaction INTEGER DEFAULT 0,
            cost REAL DEFAULT 0,
            click INTEGER DEFAULT 0,
            message_consult INTEGER DEFAULT 0,
            fetched_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(task_id, note_id, report_date)
        )
    """)

    # 任务活动日志表
    conn.execute("""
        CREATE TABLE IF NOT EXISTS task_activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            action TEXT NOT NULL,
            old_value TEXT DEFAULT '',
            new_value TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)

    # 迁移：mpi_advertisers.advertiser_id 改为 TEXT 类型（支持字符串 virtual_seller_id）
    try:
        adv_cols = conn.execute("PRAGMA table_info(mpi_advertisers)").fetchall()
        if adv_cols and any(r[2] != "TEXT" for r in adv_cols if r[1] == "advertiser_id"):
            conn.execute("DROP TABLE IF EXISTS mpi_advertisers_new")
            conn.execute("""
                CREATE TABLE mpi_advertisers_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    advertiser_id TEXT NOT NULL UNIQUE,
                    advertiser_name TEXT DEFAULT '',
                    updated_at TEXT DEFAULT (datetime('now','localtime'))
                )
            """)
            conn.execute("""
                INSERT OR IGNORE INTO mpi_advertisers_new (id, advertiser_id, advertiser_name, updated_at)
                SELECT id, CAST(advertiser_id AS TEXT), advertiser_name, updated_at FROM mpi_advertisers
            """)
            conn.execute("DROP TABLE mpi_advertisers")
            conn.execute("ALTER TABLE mpi_advertisers_new RENAME TO mpi_advertisers")
            conn.commit()
    except Exception as e:
        conn.rollback()
        import logging
        logging.getLogger(__name__).warning("mpi_advertisers 迁移跳过: %s", e)

    # 清理可能残留的迁移临时表
    try:
        conn.execute("DROP TABLE IF EXISTS mpi_advertisers_new")
    except Exception:
        pass

    for col, default in [
        ('note_title', "TEXT DEFAULT ''"),
        ('note_image', "TEXT DEFAULT ''"),
        ('note_jump_url', "TEXT DEFAULT ''"),
        ('sync_status', "TEXT DEFAULT 'pending'"),
        ('sync_message', "TEXT DEFAULT '等待同步投放数据'"),
    ]:
        try:
            conn.execute(f"ALTER TABLE task_note_performance ADD COLUMN {col} {default}")
        except Exception:
            pass

    conn.commit()  # 确保前面的迁移操作已提交，避免后续建表受影响

    # ---- 人员管理 (HR) 建表 ----
    conn.execute("""
        CREATE TABLE IF NOT EXISTS hr_employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            entry_date TEXT NOT NULL,
            probation_salary REAL DEFAULT 0,
            regular_salary REAL DEFAULT 0,
            regular_date TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            dept TEXT NOT NULL DEFAULT '',
            job TEXT NOT NULL DEFAULT '',
            media TEXT DEFAULT '小红书',
            business TEXT DEFAULT '',
            status TEXT DEFAULT '试用期-在职',
            location TEXT DEFAULT '上海',
            resign_date TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS hr_onboarding_applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            apply_time TEXT NOT NULL,
            person_count INTEGER DEFAULT 1,
            persons_json TEXT NOT NULL,
            mail_content TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS hr_quarter_bonus (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quarter TEXT NOT NULL,
            employee_name TEXT NOT NULL,
            kpi REAL DEFAULT 0,
            bonus REAL DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(quarter, employee_name)
        )
    """)

    # 创建索引（IF NOT EXISTS 确保幂等）
    conn.executescript("""
        CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks(assignee_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
        CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
        CREATE INDEX IF NOT EXISTS idx_sub_accounts_project_id ON sub_accounts(project_id);
        CREATE INDEX IF NOT EXISTS idx_sub_accounts_account_id ON sub_accounts(account_id);
        CREATE INDEX IF NOT EXISTS idx_daily_consumption_sub_date ON daily_consumption(sub_account_id, date);
        CREATE INDEX IF NOT EXISTS idx_daily_consumption_date_sub ON daily_consumption(date, sub_account_id);
        CREATE INDEX IF NOT EXISTS idx_projects_operator_id ON projects(operator_id);
        CREATE INDEX IF NOT EXISTS idx_project_handovers_project_time ON project_handovers(project_id, handover_time);
        CREATE INDEX IF NOT EXISTS idx_sub_account_handovers_sub_time ON sub_account_handovers(sub_account_id, handover_time);
        CREATE INDEX IF NOT EXISTS idx_sub_account_handovers_project ON sub_account_handovers(project_id);
        CREATE INDEX IF NOT EXISTS idx_users_department_id ON users(department, id);
        CREATE INDEX IF NOT EXISTS idx_projects_media_operator ON projects(media, operator_id);
        CREATE INDEX IF NOT EXISTS idx_sub_accounts_media_account ON sub_accounts(media, account_id);
        CREATE INDEX IF NOT EXISTS idx_bili_accounts_cache_account ON bili_accounts_cache(account_id);
        CREATE INDEX IF NOT EXISTS idx_alipay_accounts_cache_account ON alipay_accounts_cache(account_id);
        CREATE INDEX IF NOT EXISTS idx_alipay_accounts_cache_principal ON alipay_accounts_cache(principal_tag);
        CREATE INDEX IF NOT EXISTS idx_tasks_arch_parent_due ON tasks(is_archived, parent_id, due_date);
        CREATE INDEX IF NOT EXISTS idx_tasks_assignee_arch_due ON tasks(assignee_id, is_archived, due_date);
        CREATE INDEX IF NOT EXISTS idx_task_collaborators_user_task ON task_collaborators(user_id, task_id);
        CREATE INDEX IF NOT EXISTS idx_note_perf_task_id ON task_note_performance(task_id);
        CREATE INDEX IF NOT EXISTS idx_note_perf_daily_task_note_date ON task_note_performance_daily(task_id, note_id, report_date);
        CREATE INDEX IF NOT EXISTS idx_note_perf_daily_report_date ON task_note_performance_daily(report_date);
        CREATE INDEX IF NOT EXISTS idx_system_alerts_type ON system_alerts(alert_type, account_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
        CREATE INDEX IF NOT EXISTS idx_tasks_assignee_category ON tasks(assignee_id, category);
        CREATE INDEX IF NOT EXISTS idx_mcp_principals_token ON mcp_principals(token_hash, status);
        CREATE INDEX IF NOT EXISTS idx_mcp_role_permissions_role_tool ON mcp_role_permissions(role, tool_name, enabled);
        CREATE INDEX IF NOT EXISTS idx_mcp_chunks_scope ON mcp_document_chunks(project_id, media, department, owner_id, visibility_role);
        CREATE INDEX IF NOT EXISTS idx_mcp_chunks_source ON mcp_document_chunks(source_type, source_id, chunk_index);
        CREATE INDEX IF NOT EXISTS idx_xin_role_usage_daily_date_role ON xin_role_usage_daily(usage_date, role);
        CREATE INDEX IF NOT EXISTS idx_xin_role_usage_daily_role_client ON xin_role_usage_daily(role, client);
    """)

    conn.execute("INSERT OR IGNORE INTO teams (name) VALUES (?)", ("创意部",))
    conn.execute("INSERT OR IGNORE INTO teams (name) VALUES (?)", (DEPARTMENT_BILI_ALIPAY,))
    conn.execute(
        "UPDATE users SET department=? WHERE role='creative_admin' AND (department IS NULL OR department='' OR department!=?)",
        ("创意部", "创意部"),
    )
    conn.commit()

    conn.close()


def record_xin_role_usage(user_id, username="", real_name="", role="", department="", client="pc", occurred_at=None):
    role = str(role or "").strip()
    client = str(client or "pc").strip().lower()
    if not user_id or not role or client not in ("pc", "mobile"):
        return
    now = occurred_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    usage_date = str(now)[:10]
    with db_connection() as conn:
        conn.execute(
            """
            INSERT INTO xin_role_usage_daily (
                usage_date, role, client, user_id, username, real_name, department,
                use_count, first_used_at, last_used_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(usage_date, role, client, user_id) DO UPDATE SET
                use_count = use_count + 1,
                username = excluded.username,
                real_name = excluded.real_name,
                department = excluded.department,
                last_used_at = excluded.last_used_at
            """,
            (
                usage_date,
                role,
                client,
                int(user_id),
                str(username or ""),
                str(real_name or ""),
                str(department or ""),
                now,
                now,
            ),
        )


def get_xin_role_usage_report(start_date, end_date):
    start_date = str(start_date or date.today().isoformat())[:10]
    end_date = str(end_date or start_date)[:10]
    if start_date > end_date:
        start_date, end_date = end_date, start_date

    conn = get_db()
    try:
        daily_rows = conn.execute(
            """
            SELECT
                usage_date,
                role,
                SUM(CASE WHEN client='pc' THEN use_count ELSE 0 END) AS pc,
                SUM(CASE WHEN client='mobile' THEN use_count ELSE 0 END) AS mobile,
                COUNT(DISTINCT CASE WHEN client='pc' THEN user_id END) AS pc_users,
                COUNT(DISTINCT CASE WHEN client='mobile' THEN user_id END) AS mobile_users,
                COUNT(DISTINCT user_id) AS total_users,
                MAX(last_used_at) AS last_used_at
            FROM xin_role_usage_daily
            WHERE usage_date >= ? AND usage_date <= ?
            GROUP BY usage_date, role
            ORDER BY usage_date DESC, role ASC
            """,
            (start_date, end_date),
        ).fetchall()
        role_rows = conn.execute(
            """
            SELECT
                role,
                SUM(CASE WHEN client='pc' THEN use_count ELSE 0 END) AS pc,
                SUM(CASE WHEN client='mobile' THEN use_count ELSE 0 END) AS mobile,
                COUNT(DISTINCT CASE WHEN client='pc' THEN user_id END) AS pc_users,
                COUNT(DISTINCT CASE WHEN client='mobile' THEN user_id END) AS mobile_users,
                COUNT(DISTINCT user_id) AS total_users,
                MAX(last_used_at) AS last_used_at
            FROM xin_role_usage_daily
            WHERE usage_date >= ? AND usage_date <= ?
            GROUP BY role
            ORDER BY (SUM(use_count)) DESC, role ASC
            """,
            (start_date, end_date),
        ).fetchall()
        user_rows = conn.execute(
            """
            SELECT
                usage_date,
                role,
                user_id,
                username,
                real_name,
                department,
                SUM(CASE WHEN client='pc' THEN use_count ELSE 0 END) AS pc,
                SUM(CASE WHEN client='mobile' THEN use_count ELSE 0 END) AS mobile,
                MAX(last_used_at) AS last_used_at
            FROM xin_role_usage_daily
            WHERE usage_date >= ? AND usage_date <= ?
            GROUP BY usage_date, role, user_id, username, real_name, department
            ORDER BY usage_date DESC, role ASC, last_used_at DESC
            """,
            (start_date, end_date),
        ).fetchall()
        total_user_count = conn.execute(
            """
            SELECT COUNT(DISTINCT user_id) AS count
            FROM xin_role_usage_daily
            WHERE usage_date >= ? AND usage_date <= ?
            """,
            (start_date, end_date),
        ).fetchone()["count"]
    finally:
        conn.close()

    rows = []
    timeline_by_date = {}
    cursor = datetime.strptime(start_date, "%Y-%m-%d").date()
    end_cursor = datetime.strptime(end_date, "%Y-%m-%d").date()
    while cursor <= end_cursor:
        key = cursor.isoformat()
        timeline_by_date[key] = {"date": key, "pc": 0, "mobile": 0, "total": 0}
        cursor += timedelta(days=1)

    for row in daily_rows:
        item = {
            "date": row["usage_date"],
            "role": row["role"],
            "pc": int(row["pc"] or 0),
            "mobile": int(row["mobile"] or 0),
            "total": int((row["pc"] or 0) + (row["mobile"] or 0)),
            "pcUsers": int(row["pc_users"] or 0),
            "mobileUsers": int(row["mobile_users"] or 0),
            "totalUsers": int(row["total_users"] or 0),
            "lastUsedAt": row["last_used_at"] or "",
        }
        rows.append(item)
        bucket = timeline_by_date.setdefault(item["date"], {"date": item["date"], "pc": 0, "mobile": 0, "total": 0})
        bucket["pc"] += item["pc"]
        bucket["mobile"] += item["mobile"]
        bucket["total"] += item["total"]

    roles = []
    for row in role_rows:
        pc = int(row["pc"] or 0)
        mobile = int(row["mobile"] or 0)
        roles.append({
            "role": row["role"],
            "pc": pc,
            "mobile": mobile,
            "total": pc + mobile,
            "pcUsers": int(row["pc_users"] or 0),
            "mobileUsers": int(row["mobile_users"] or 0),
            "totalUsers": int(row["total_users"] or 0),
            "lastUsedAt": row["last_used_at"] or "",
        })

    users = []
    for row in user_rows:
        pc = int(row["pc"] or 0)
        mobile = int(row["mobile"] or 0)
        users.append({
            "date": row["usage_date"],
            "role": row["role"],
            "userId": row["user_id"],
            "username": row["username"] or "",
            "realName": row["real_name"] or "",
            "displayName": row["real_name"] or row["username"] or str(row["user_id"]),
            "department": row["department"] or "",
            "pc": pc,
            "mobile": mobile,
            "total": pc + mobile,
            "lastUsedAt": row["last_used_at"] or "",
        })

    return {
        "range": {"start": start_date, "end": end_date},
        "totals": {
            "pc": sum(item["pc"] for item in rows),
            "mobile": sum(item["mobile"] for item in rows),
            "total": sum(item["total"] for item in rows),
            "roles": len(roles),
            "users": int(total_user_count or 0),
        },
        "roles": roles,
        "rows": rows,
        "users": users,
        "timeline": [timeline_by_date[key] for key in sorted(timeline_by_date)],
    }


def create_mcp_principal(name, user_id, raw_token=None):
    import secrets
    from mcp_auth import hash_mcp_token

    token = raw_token or 'mcp_' + secrets.token_urlsafe(32)
    token_hash = hash_mcp_token(token)
    with db_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO mcp_principals (name, user_id, token_hash, status)
            VALUES (?, ?, ?, 'active')
            """,
            (name, user_id, token_hash),
        )
        principal_id = cur.lastrowid
    return principal_id, token


# ---- 用户相关 ----

def hash_password(password):
    from werkzeug.security import generate_password_hash
    return generate_password_hash(password)


def check_password(password_hash, password):
    """验证密码，兼容旧SHA-256哈希和新的werkzeug哈希"""
    # SHA-256 旧格式：纯64位hex字符串
    if len(password_hash) == 64 and all(c in '0123456789abcdef' for c in password_hash):
        return password_hash == hashlib.sha256(password.encode()).hexdigest()
    # werkzeug 格式（pbkdf2: / scrypt: / argon2: 等）
    from werkzeug.security import check_password_hash as _check
    return _check(password_hash, password)


def create_user(username, password, role="operator", real_name="", department="", created_by=None):
    # real_name 自动同步为 username
    if real_name and not username:
        username = real_name
    with db_connection() as conn:
        conn.execute(
            "INSERT INTO users (username, password_hash, role, real_name, department, created_by) VALUES (?, ?, ?, ?, ?, ?)",
            (username, hash_password(password), role, real_name or username, department, created_by),
        )


def verify_user(username, password):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    conn.close()
    if row and check_password(row["password_hash"], password):
        user = dict(row)
        if user.get("status") == "resigned":
            return None
        # 自动升级旧SHA-256哈希为werkzeug哈希
        if len(row["password_hash"]) == 64:
            try:
                conn2 = get_db()
                conn2.execute(
                    "UPDATE users SET password_hash=? WHERE id=?",
                    (hash_password(password), row["id"]),
                )
                conn2.commit()
                conn2.close()
            except Exception:
                pass
        return user
    return None


def get_all_users():
    conn = get_db()
    rows = conn.execute("SELECT id, username, role, real_name, department, status, created_at FROM users ORDER BY id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_user(user_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_user_by_username(username):
    conn = get_db()
    row = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    return dict(row) if row else None


def update_user(user_id, data):
    """更新用户信息，data: dict with optional keys。修改 real_name 时自动同步 username。"""
    # 如果传了 real_name，同步更新 username
    if 'real_name' in data and data['real_name']:
        data['username'] = data['real_name']
    with db_connection() as conn:
        sets = []
        vals = []
        for k in ['username', 'real_name', 'department', 'role']:
            if k in data:
                sets.append(f"{k}=?")
                vals.append(data[k])
        if 'password' in data and data['password']:
            sets.append("password_hash=?")
            vals.append(hash_password(data['password']))
        if sets:
            vals.append(user_id)
            conn.execute(f"UPDATE users SET {','.join(sets)} WHERE id=?", vals)


def delete_user(user_id):
    with db_connection() as conn:
        conn.execute("DELETE FROM users WHERE id=?", (user_id,))


def get_users_by_department(department):
    """获取某部门的所有用户"""
    conn = get_db()
    rows = conn.execute(
        "SELECT id, username, role, real_name, department, status FROM users WHERE department=? ORDER BY id",
        (department,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_departments():
    """获取所有团队列表"""
    conn = get_db()
    rows = conn.execute("SELECT name FROM teams ORDER BY name").fetchall()
    conn.close()
    return [r[0] for r in rows]


# ---- 项目相关 ----

def create_project(project_name, advertiser_name="", sales_name="",
                   need_content="", marketing_goal="", operator_id=None, platform="聚光", media=MEDIA_XHS):
    with db_connection() as conn:
        cur = conn.execute(
            """INSERT INTO projects
               (project_name, advertiser_name, sales_name, need_content, marketing_goal, operator_id, platform, media)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (project_name, advertiser_name, sales_name, need_content, marketing_goal, operator_id, platform, media),
        )
        return cur.lastrowid


def get_projects(operator_id=None, department=None, media=MEDIA_XHS):
    """
    获取项目列表
    operator_id: 运营优化师只能看自己的
    department: 运营主管可以看本部门所有人的
    media: 媒体平台；默认小红书，传 None 可查全部
    都不传: 超级管理员看全部
    """
    conn = get_db()
    where = []
    params = []
    if media:
        where.append("COALESCE(p.media, '小红书') = ?")
        params.append(media)
    if operator_id:
        project_target_expr = _project_handover_target_expr("date('now','localtime')")
        project_operator_expr = _project_effective_operator_expr("date('now','localtime')")
        target_expr = _handover_target_expr("date('now','localtime')")
        operator_expr = _effective_operator_expr("date('now','localtime')")
        where.append(
            f"""(({project_target_expr} != ? AND {project_operator_expr} = ?)
                 OR EXISTS (
                    SELECT 1 FROM sub_accounts sa
                    WHERE sa.project_id = p.id
                      AND {target_expr} != ?
                      AND {operator_expr} = ?
                 ))"""
        )
        params.extend([HANDOVER_TARGET_SELF, operator_id, HANDOVER_TARGET_SELF, operator_id])
    elif department:
        project_target_expr = _project_handover_target_expr("date('now','localtime')")
        project_operator_expr = _project_effective_operator_expr("date('now','localtime')")
        target_expr = _handover_target_expr("date('now','localtime')")
        operator_expr = _effective_operator_expr("date('now','localtime')")
        where.append(
            f"""(({project_target_expr} != ? AND {project_operator_expr} IN (SELECT id FROM users WHERE department = ?))
                 OR EXISTS (
                    SELECT 1 FROM sub_accounts sa
                    WHERE sa.project_id = p.id
                      AND {target_expr} != ?
                      AND {operator_expr} IN (SELECT id FROM users WHERE department = ?)
                 ))"""
        )
        params.extend([HANDOVER_TARGET_SELF, department, HANDOVER_TARGET_SELF, department])
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    rows = conn.execute(
        f"SELECT p.* FROM projects p {where_sql} ORDER BY p.id DESC",
        params,
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_project(project_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def update_project(project_id, project_name, advertiser_name, sales_name,
                   need_content="", marketing_goal="", operator_id=None, platform=None, media=None):
    fields = {
        "project_name": project_name,
        "advertiser_name": advertiser_name,
        "sales_name": sales_name,
        "need_content": need_content,
        "marketing_goal": marketing_goal,
    }
    if operator_id is not None:
        fields["operator_id"] = operator_id
    if platform is not None:
        fields["platform"] = platform
    if media is not None:
        fields["media"] = media
    sets = ",".join(f"{key}=?" for key in fields)
    vals = list(fields.values()) + [project_id]
    with db_connection() as conn:
        conn.execute(f"UPDATE projects SET {sets} WHERE id=?", vals)


def update_project_card_fields(project_id, card_fields, normalizer=None):
    fields = normalizer(card_fields) if normalizer else normalize_project_card_fields(card_fields)
    with db_connection() as conn:
        conn.execute(
            "UPDATE projects SET card_fields=? WHERE id=?",
            (json.dumps(fields, ensure_ascii=False), project_id),
        )
    return fields


def update_project_card_order(project_ids):
    ids = []
    for project_id in project_ids or []:
        try:
            pid = int(project_id)
        except (TypeError, ValueError):
            continue
        if pid not in ids:
            ids.append(pid)
    with db_connection() as conn:
        for index, pid in enumerate(ids, start=1):
            conn.execute(
                "UPDATE projects SET card_order=? WHERE id=?",
                (index, pid),
            )
    return ids


def delete_project(project_id):
    with db_connection() as conn:
        conn.execute("DELETE FROM projects WHERE id=?", (project_id,))


def set_project_group(project_ids, group_name):
    """批量设置项目的大项目名称"""
    with db_connection() as conn:
        for pid in project_ids:
            conn.execute(
                "UPDATE projects SET group_name=? WHERE id=?",
                (group_name, pid),
            )


def clear_project_group(project_ids):
    """清除项目的大项目关联"""
    with db_connection() as conn:
        for pid in project_ids:
            conn.execute(
                "UPDATE projects SET group_name='' WHERE id=?",
                (pid,),
            )


def create_project_knowledge(project_id, source_type="file", source_name="", source_url="",
                             file_path="", markdown_path="", markdown_content="",
                             llmwiki_json="", wiki_root="", schema_path="", wiki_pages_json="[]",
                             status="ready", error="", created_by=None):
    """保存项目知识库条目，供 EcoreNoteAI 按项目读取。"""
    with db_connection() as conn:
        cur = conn.execute(
            """INSERT INTO project_knowledge
               (project_id, source_type, source_name, source_url, file_path, markdown_path,
                markdown_content, llmwiki_json, wiki_root, schema_path, wiki_pages_json,
                status, error, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (project_id, source_type, source_name, source_url, file_path, markdown_path,
             markdown_content, llmwiki_json, wiki_root, schema_path, wiki_pages_json,
             status, error, created_by),
        )
        return cur.lastrowid


def get_project_knowledge(project_id):
    """获取项目知识库条目。"""
    conn = get_db()
    rows = conn.execute(
        """SELECT id, project_id, source_type, source_name, source_url, file_path,
                  markdown_path, markdown_content, llmwiki_json, wiki_root,
                  schema_path, wiki_pages_json, status, error,
                  created_by, created_at, updated_at
           FROM project_knowledge
           WHERE project_id=?
           ORDER BY id DESC""",
        (project_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_project_knowledge(project_id, knowledge_id):
    """删除项目知识库条目。"""
    with db_connection() as conn:
        cur = conn.execute(
            "DELETE FROM project_knowledge WHERE project_id=? AND id=?",
            (project_id, knowledge_id),
        )
        return cur.rowcount > 0


def get_project_ids_by_groups(group_names):
    """获取具有给定 group_name 的所有项目ID"""
    if not group_names:
        return set()
    conn = get_db()
    placeholders = ",".join("?" for _ in group_names)
    rows = conn.execute(
        f"SELECT id FROM projects WHERE group_name IN ({placeholders})",
        list(group_names),
    ).fetchall()
    conn.close()
    return {r["id"] for r in rows}


def get_project_groups():
    """获取所有大项目分组"""
    conn = get_db()
    rows = conn.execute(
        """SELECT group_name, COUNT(*) as project_count
           FROM projects
           WHERE group_name IS NOT NULL AND group_name != ''
           GROUP BY group_name
           ORDER BY group_name""",
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---- 子账号相关 ----

def create_sub_account(project_id, account_id, account_name, account_type="auto", return_created=False, media=MEDIA_XHS, external_account_id=""):
    with db_connection() as conn:
        cur = conn.execute(
            """INSERT OR IGNORE INTO sub_accounts
               (project_id, account_id, account_name, account_type, media, external_account_id)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (project_id, str(account_id), account_name, account_type, media, external_account_id or ""),
        )
        created = cur.rowcount > 0
        if created:
            sub_id = cur.lastrowid
        else:
            row = conn.execute(
                "SELECT id FROM sub_accounts WHERE project_id=? AND account_id=?",
                (project_id, str(account_id)),
            ).fetchone()
            sub_id = row["id"] if row else 0
        return (sub_id, created) if return_created else sub_id


def get_sub_accounts(project_id):
    operator_expr = _effective_operator_expr("date('now','localtime')")
    target_expr = _handover_target_expr("date('now','localtime')")
    conn = get_db()
    rows = conn.execute(
        f"""SELECT sa.*,
                  CASE WHEN {target_expr}='self' THEN NULL ELSE {operator_expr} END as current_operator_id,
                  {target_expr} as current_target_type,
                  CASE WHEN {target_expr}='self' THEN '自运营' ELSE u.real_name END as current_operator_name,
                  u.department as current_department
           FROM sub_accounts sa
           JOIN projects p ON sa.project_id = p.id
           LEFT JOIN users u ON u.id = {operator_expr}
           WHERE sa.project_id = ?
           ORDER BY sa.id""",
        (project_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_all_sub_accounts(media=MEDIA_XHS):
    conn = get_db()
    where_sql = ""
    params = []
    if media:
        where_sql = "WHERE COALESCE(sa.media, COALESCE(p.media, '小红书')) = ?"
        params.append(media)
    rows = conn.execute(
        f"""SELECT sa.*, p.project_name, p.sales_name, p.need_content, p.marketing_goal, p.platform
           FROM sub_accounts sa
           JOIN projects p ON sa.project_id = p.id
           {where_sql}
           ORDER BY sa.id""",
        params,
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_sub_accounts_by_ids(sub_account_ids, media=None):
    ids = []
    for sid in sub_account_ids or []:
        try:
            ids.append(int(sid))
        except (TypeError, ValueError):
            continue
    if not ids:
        return []
    placeholders = ','.join('?' for _ in ids)
    params = ids[:]
    media_sql = ""
    if media:
        media_sql = " AND COALESCE(sa.media, COALESCE(p.media, '小红书')) = ?"
        params.append(media)
    conn = get_db()
    rows = conn.execute(
        f"""SELECT sa.*, p.project_name, p.sales_name, p.need_content, p.marketing_goal, p.platform
           FROM sub_accounts sa
           JOIN projects p ON sa.project_id = p.id
           WHERE sa.id IN ({placeholders}){media_sql}
           ORDER BY sa.id""",
        params,
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_sub_account_ids_for_role(role, user_id, department="", project_ids=None, filter_operator_id=None, filter_department=None, as_of_date=None):
    """根据角色返回可见的子账号account_id列表，支持按运营人员/部门二次筛选"""
    if as_of_date and re.match(r"^\d{4}-\d{2}-\d{2}$", str(as_of_date)):
        ownership_date_expr = f"'{as_of_date}'"
    else:
        ownership_date_expr = "date('now','localtime')"
    conn = get_db()
    try:
        where = []
        params = []
        if project_ids:
            ids = []
            for pid in project_ids:
                try:
                    ids.append(int(pid))
                except (TypeError, ValueError):
                    continue
            if ids:
                where.append("sa.project_id IN (" + ",".join("?" for _ in ids) + ")")
                params.extend(ids)
            else:
                return []

        if role == "supervisor":
            clauses, clause_params, _operator_expr = _effective_operator_filter(ownership_date_expr, department=department)
            where.extend(clauses)
            params.extend(clause_params)
        elif role not in ("admin", "report_admin"):
            clauses, clause_params, _operator_expr = _effective_operator_filter(ownership_date_expr, operator_id=user_id)
            where.extend(clauses)
            params.extend(clause_params)

        if filter_operator_id or filter_department:
            clauses, clause_params, _operator_expr = _effective_operator_filter(
                ownership_date_expr,
                operator_id=filter_operator_id,
                department=filter_department,
            )
            where.extend(clauses)
            params.extend(clause_params)

        where_sql = "WHERE " + " AND ".join(where) if where else ""
        rows = conn.execute(
            f"""SELECT DISTINCT sa.account_id
                FROM sub_accounts sa
                JOIN projects p ON sa.project_id = p.id
                {where_sql}""",
            params,
        ).fetchall()
        return [r["account_id"] for r in rows]
    finally:
        conn.close()


def get_sub_accounts_by_project(project_id):
    """获取项目下的子账号（含项目信息）"""
    conn = get_db()
    rows = conn.execute(
        """SELECT sa.*, p.project_name, p.sales_name, p.need_content, p.marketing_goal
           FROM sub_accounts sa
           JOIN projects p ON sa.project_id = p.id
           WHERE sa.project_id = ?
           ORDER BY sa.id""",
        (project_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_sub_account(account_id):
    with db_connection() as conn:
        conn.execute("DELETE FROM sub_accounts WHERE id=?", (account_id,))


def update_sub_account_industry(account_id, industry):
    """更新子账号行业"""
    with db_connection() as conn:
        conn.execute("UPDATE sub_accounts SET industry=? WHERE id=?", (industry, account_id))


def update_sub_account_company_name(account_id_str, company_name):
    """根据 account_id 更新广告主主体名称"""
    with db_connection() as conn:
        conn.execute(
            "UPDATE sub_accounts SET company_name=? WHERE account_id=?",
            (company_name, str(account_id_str)),
        )


def batch_create_sub_accounts(project_id, accounts, return_created_ids=False, media=MEDIA_XHS):
    """批量关联子账号到项目，accounts: [{account_id, account_name}]"""
    created_ids = []
    with db_connection() as conn:
        for a in accounts:
            cur = conn.execute(
                """INSERT OR IGNORE INTO sub_accounts
                   (project_id, account_id, account_name, account_type, media, external_account_id)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (project_id, str(a['account_id']), a.get('account_name', ''), a.get('account_type', 'auto'), media, a.get('external_account_id', '')),
            )
            if cur.rowcount > 0:
                created_ids.append(cur.lastrowid)
    if return_created_ids:
        return created_ids


def get_sub_account_ids_for_project_accounts(project_id, account_ids, media=MEDIA_XHS):
    clean_ids = [str(a).strip() for a in account_ids or [] if str(a or "").strip()]
    if not clean_ids:
        return {}
    placeholders = ",".join("?" for _ in clean_ids)
    params = [project_id] + clean_ids
    media_sql = ""
    if media:
        media_sql = " AND COALESCE(sa.media, '小红书') = ?"
        params.append(media)
    conn = get_db()
    rows = conn.execute(
        f"""SELECT sa.id, sa.account_id
            FROM sub_accounts sa
            WHERE sa.project_id = ? AND sa.account_id IN ({placeholders}){media_sql}""",
        params,
    ).fetchall()
    conn.close()
    return {str(r["account_id"]): r["id"] for r in rows}


# ---- 消耗数据相关 ----

def upsert_consumption(sub_account_id, report_date, cost_simple=0, cost_standard=0, cost_square=None,
                        impression=0, click=0, interaction=0, ctr=0, leads=0,
                        message_consult=0, msg_leads_num=0, valid_leads=0, like_count=0, comment_count=0,
                        collect_count=0, follow_count=0, share_count=0, form_submit=0,
                        telephone_click=0, initiative_message=0, action_button_click=0,
                        search_cmt_click=0, i_user_num=0, ti_user_num=0, **extra_metrics):
    """插入或更新某天的消耗数据。cost_square 为 None 表示不更新手动字段。"""
    with db_connection() as conn:
        # 查询现有记录获取 cost_square
        existing = conn.execute(
            "SELECT cost_square FROM daily_consumption WHERE sub_account_id=? AND date=?",
            (sub_account_id, report_date),
        ).fetchone()

        if cost_square is None and existing:
            cost_square = existing["cost_square"] or 0

        cost_square = cost_square or 0
        cost_total = cost_simple + cost_standard + cost_square

        base_values = {
            "sub_account_id": sub_account_id,
            "date": report_date,
            "cost_simple": cost_simple,
            "cost_standard": cost_standard,
            "cost_square": cost_square,
            "cost_total": cost_total,
            "impression": impression,
            "click": click,
            "interaction": interaction,
            "ctr": ctr,
            "leads": leads,
            "message_consult": message_consult,
            "msg_leads_num": msg_leads_num,
            "valid_leads": valid_leads,
            "like_count": like_count,
            "comment_count": comment_count,
            "collect_count": collect_count,
            "follow_count": follow_count,
            "share_count": share_count,
            "telephone_click": telephone_click,
            "initiative_message": initiative_message,
            "action_button_click": action_button_click,
            "search_cmt_click": search_cmt_click,
            "i_user_num": i_user_num,
            "ti_user_num": ti_user_num,
        }
        for field in CHENGFENG_PROJECT_CARD_DAILY_FIELDS:
            if field in base_values:
                continue
            try:
                base_values[field] = float(extra_metrics.get(field) or 0)
            except (TypeError, ValueError):
                base_values[field] = 0
        columns = list(base_values.keys())
        placeholders = ", ".join("?" for _ in columns)
        update_sql = ", ".join(f"{col}=excluded.{col}" for col in columns if col not in {"sub_account_id", "date"})
        conn.execute(
            f"""INSERT INTO daily_consumption ({', '.join(columns)})
               VALUES ({placeholders})
               ON CONFLICT(sub_account_id, date) DO UPDATE SET
                   {update_sql},
                   updated_at=datetime('now','localtime')""",
            tuple(base_values[col] for col in columns),
        )


def upsert_bili_consumption(sub_account_id, report_date, charged_cost_milli=0,
                            show_count=0, click_count=0, form_submit=0, valid_leads=0,
                            comment_click_count=0, app_wake_count=0, order_submit_count=0,
                            video_play_count=0, video_like_count=0, video_fav_count=0,
                            video_coin_count=0, video_interact_count=0, **extra_metrics):
    cost_total = (int(charged_cost_milli or 0) / 100000.0)
    impression = int(show_count or 0)
    click = int(click_count or 0)
    interaction = int(video_interact_count or 0)
    like_count = int(video_like_count or 0)
    collect_count = int(video_fav_count or 0)
    form_submit = int(form_submit or 0)
    valid_leads = int(valid_leads or 0)
    comment_click_count = int(comment_click_count or 0)
    app_wake_count = int(app_wake_count or 0)
    order_submit_count = int(order_submit_count or 0)
    video_play_count = int(video_play_count or 0)
    builtin_metrics = {
        "charged_cost_milli": int(charged_cost_milli or 0),
        "show_count": impression,
        "click_count": click,
        "form_submit": form_submit,
        "valid_leads": valid_leads,
        "comment_click_count": comment_click_count,
        "app_wake_count": app_wake_count,
        "order_submit_count": order_submit_count,
        "video_play_count": video_play_count,
        "video_like_count": like_count,
        "video_fav_count": collect_count,
        "video_coin_count": int(video_coin_count or 0),
        "video_interact_count": interaction,
    }
    bili_metrics = dict(builtin_metrics)
    for key, value in extra_metrics.items():
        try:
            bili_metrics[str(key)] = float(value or 0)
        except (TypeError, ValueError):
            bili_metrics[str(key)] = 0
    ctr = (click / impression * 100) if impression else 0
    with db_connection() as conn:
        conn.execute(
            """INSERT INTO daily_consumption
               (sub_account_id, date, cost_simple, cost_standard, cost_square, cost_total,
                impression, click, interaction, ctr, leads, valid_leads, like_count, collect_count,
                form_submit, charged_cost_milli, show_count, click_count, comment_click_count,
                app_wake_count, order_submit_count, video_play_count, video_like_count,
                video_fav_count, video_coin_count, video_interact_count, bili_metrics_json)
               VALUES (?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(sub_account_id, date) DO UPDATE SET
                   cost_standard=excluded.cost_standard,
                   cost_total=excluded.cost_total,
                   impression=excluded.impression,
                   click=excluded.click,
                   interaction=excluded.interaction,
                   ctr=excluded.ctr,
                   leads=excluded.leads,
                   valid_leads=excluded.valid_leads,
                   like_count=excluded.like_count,
                   collect_count=excluded.collect_count,
                   form_submit=excluded.form_submit,
                   charged_cost_milli=excluded.charged_cost_milli,
                   show_count=excluded.show_count,
                   click_count=excluded.click_count,
                   comment_click_count=excluded.comment_click_count,
                   app_wake_count=excluded.app_wake_count,
                   order_submit_count=excluded.order_submit_count,
                   video_play_count=excluded.video_play_count,
                   video_like_count=excluded.video_like_count,
                   video_fav_count=excluded.video_fav_count,
                   video_coin_count=excluded.video_coin_count,
                   video_interact_count=excluded.video_interact_count,
                   bili_metrics_json=excluded.bili_metrics_json,
                   updated_at=datetime('now','localtime')""",
            (sub_account_id, report_date, cost_total, cost_total, impression, click,
             interaction, ctr, form_submit, valid_leads, like_count, collect_count,
             form_submit, int(charged_cost_milli or 0), impression, click,
             comment_click_count, app_wake_count, order_submit_count, video_play_count,
             like_count, collect_count, int(video_coin_count or 0), interaction,
             json.dumps(bili_metrics, ensure_ascii=False)),
        )


def _metric_float(value, default=0.0):
    if value in (None, ""):
        return default
    try:
        return float(str(value).replace(",", "").replace("%", ""))
    except (TypeError, ValueError):
        return default


def _metric_int(value, default=0):
    try:
        return int(round(_metric_float(value, default)))
    except (TypeError, ValueError):
        return default


def upsert_alipay_consumption(sub_account_id, report_date, cost=0,
                              impression=0, click=0, form_submit=0, valid_leads=0,
                              conv_result=0, **extra_metrics):
    cost_total = round(_metric_float(cost), 4)
    impression = _metric_int(impression)
    click = _metric_int(click)
    form_submit = _metric_int(form_submit)
    valid_leads = _metric_int(valid_leads)
    conv_result = _metric_int(conv_result)
    alipay_metrics = {
        "cost": cost_total,
        "cost_total": cost_total,
        "impression": impression,
        "click": click,
        "form_submit": form_submit,
        "valid_leads": valid_leads,
        "conv_result": conv_result,
        "show_count": impression,
        "click_count": click,
    }
    for key, value in extra_metrics.items():
        key = str(key)
        if key in alipay_metrics:
            continue
        if isinstance(value, (int, float)):
            alipay_metrics[key] = value
            continue
        numeric = _metric_float(value, None)
        alipay_metrics[key] = numeric if numeric is not None else value
    ctr = (click / impression * 100) if impression else 0
    with db_connection() as conn:
        conn.execute(
            """INSERT INTO daily_consumption
               (sub_account_id, date, cost_simple, cost_standard, cost_square, cost_total,
                impression, click, interaction, ctr, leads, valid_leads, form_submit,
                show_count, click_count, alipay_metrics_json)
               VALUES (?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(sub_account_id, date) DO UPDATE SET
                   cost_standard=excluded.cost_standard,
                   cost_total=excluded.cost_total,
                   impression=excluded.impression,
                   click=excluded.click,
                   interaction=excluded.interaction,
                   ctr=excluded.ctr,
                   leads=excluded.leads,
                   valid_leads=excluded.valid_leads,
                   form_submit=excluded.form_submit,
                   show_count=excluded.show_count,
                   click_count=excluded.click_count,
                   alipay_metrics_json=excluded.alipay_metrics_json,
                   updated_at=datetime('now','localtime')""",
            (
                sub_account_id,
                report_date,
                cost_total,
                cost_total,
                impression,
                click,
                conv_result,
                ctr,
                form_submit,
                valid_leads,
                form_submit,
                impression,
                click,
                json.dumps(alipay_metrics, ensure_ascii=False),
            ),
        )


def save_bili_accounts_cache(accounts):
    with db_connection() as conn:
        for account in accounts or []:
            account_id = str(account.get("account_id") or account.get("ad_account_id") or account.get("id") or account.get("advertiser_id") or "").strip()
            if not account_id:
                continue
            account_name = str(account.get("account_name") or account.get("name") or account.get("advertiser_name") or account_id)
            conn.execute(
                """INSERT INTO bili_accounts_cache (account_id, account_name, raw_json, updated_at)
                   VALUES (?, ?, ?, datetime('now','localtime'))
                   ON CONFLICT(account_id) DO UPDATE SET
                     account_name=excluded.account_name,
                     raw_json=excluded.raw_json,
                     updated_at=datetime('now','localtime')""",
                (account_id, account_name, json.dumps(account, ensure_ascii=False)),
            )


def get_bili_accounts_cache_by_ids(account_ids):
    ids = [str(account_id or "").strip() for account_id in account_ids]
    ids = [account_id for account_id in ids if account_id]
    if not ids:
        return []
    conn = get_db()
    try:
        placeholders = ",".join("?" for _ in ids)
        rows = conn.execute(
            f"""SELECT account_id, account_name, raw_json, updated_at
               FROM bili_accounts_cache
               WHERE account_id IN ({placeholders})""",
            ids,
        ).fetchall()
        accounts = []
        for row in rows:
            item = dict(row)
            try:
                raw = json.loads(item.get("raw_json") or "{}")
            except (TypeError, ValueError):
                raw = {}
            if isinstance(raw, dict):
                raw.setdefault("account_id", item.get("account_id"))
                raw.setdefault("account_name", item.get("account_name"))
                accounts.append(raw)
        return accounts
    finally:
        conn.close()


    accounts = accounts or []
    with db_connection() as conn:
        project = conn.execute(
            """SELECT id FROM projects
               WHERE COALESCE(media, ?) = ?
               ORDER BY id LIMIT 1""",
            (MEDIA_XHS, MEDIA_BILI),
        ).fetchone()
        if not project:
            return 0
        count = 0
        for account in accounts:
            account_id = str(account.get("account_id") or account.get("ad_account_id") or account.get("id") or account.get("advertiser_id") or "").strip()
            if not account_id:
                continue
            account_name = str(account.get("account_name") or account.get("name") or account.get("advertiser_name") or account_id)
            cur = conn.execute(
                """INSERT OR IGNORE INTO sub_accounts
                   (project_id, account_id, account_name, account_type, media, external_account_id)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (project["id"], account_id, account_name, "auto", MEDIA_BILI, account_id),
            )
            if cur.rowcount:
                count += 1
        return count


def search_bili_accounts(keyword=""):
    conn = get_db()
    keyword = str(keyword or "").strip()
    if keyword:
        like = f"%{keyword}%"
        rows = conn.execute(
            """SELECT account_id, account_name, raw_json, updated_at
               FROM bili_accounts_cache
               WHERE account_id LIKE ? OR account_name LIKE ?
               ORDER BY updated_at DESC LIMIT 50""",
            (like, like),
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT account_id, account_name, raw_json, updated_at
               FROM bili_accounts_cache
               ORDER BY updated_at DESC LIMIT 50""",
        ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def _alipay_account_identity(account):
    principal_tag = str(account.get("principal_tag") or account.get("principalTag") or "").strip()
    account_id = str(
        account.get("account_id")
        or account.get("principal_id")
        or account.get("principalId")
        or account.get("alipay_pid")
        or account.get("principal_pid")
        or account.get("alipay_oid")
        or account.get("alipayOid")
        or principal_tag
        or ""
    ).strip()
    account_name = str(
        account.get("account_name")
        or account.get("principal_name")
        or account.get("principalName")
        or account.get("name")
        or account.get("alipay_account")
        or account_id
    ).strip()
    return account_id, account_name, principal_tag


def save_alipay_accounts_cache(accounts):
    with db_connection() as conn:
        for account in accounts or []:
            if not isinstance(account, dict):
                continue
            account_id, account_name, principal_tag = _alipay_account_identity(account)
            if not account_id and not principal_tag:
                continue
            account_id = account_id or principal_tag
            raw = dict(account)
            raw.setdefault("account_id", account_id)
            raw.setdefault("account_name", account_name)
            raw.setdefault("principal_tag", principal_tag)
            conn.execute(
                """INSERT INTO alipay_accounts_cache (account_id, account_name, principal_tag, raw_json, updated_at)
                   VALUES (?, ?, ?, ?, datetime('now','localtime'))
                   ON CONFLICT(account_id) DO UPDATE SET
                     account_name=excluded.account_name,
                     principal_tag=excluded.principal_tag,
                     raw_json=excluded.raw_json,
                     updated_at=datetime('now','localtime')""",
                (account_id, account_name, principal_tag, json.dumps(raw, ensure_ascii=False)),
            )


def get_alipay_accounts_cache_by_ids(account_ids):
    ids = [str(account_id or "").strip() for account_id in account_ids]
    ids = [account_id for account_id in ids if account_id]
    if not ids:
        return []
    conn = get_db()
    try:
        placeholders = ",".join("?" for _ in ids)
        rows = conn.execute(
            f"""SELECT account_id, account_name, principal_tag, raw_json, updated_at
               FROM alipay_accounts_cache
               WHERE account_id IN ({placeholders}) OR principal_tag IN ({placeholders})""",
            ids + ids,
        ).fetchall()
        accounts = []
        for row in rows:
            item = dict(row)
            try:
                raw = json.loads(item.get("raw_json") or "{}")
            except (TypeError, ValueError):
                raw = {}
            if isinstance(raw, dict):
                raw.setdefault("account_id", item.get("account_id"))
                raw.setdefault("account_name", item.get("account_name"))
                raw.setdefault("principal_tag", item.get("principal_tag"))
                accounts.append(raw)
        return accounts
    finally:
        conn.close()


def _hydrate_alipay_account_cache_rows(rows):
    accounts = []
    for row in rows:
        item = dict(row)
        try:
            raw = json.loads(item.get("raw_json") or "{}")
        except (TypeError, ValueError):
            raw = {}
        if isinstance(raw, dict):
            raw.update({k: v for k, v in item.items() if k != "raw_json" and v not in (None, "")})
            item = raw
        accounts.append(item)
    return accounts


def search_alipay_accounts(keyword="", limit=50, offset=0, with_total=False):
    conn = get_db()
    keyword = str(keyword or "").strip()
    try:
        limit = max(1, min(500, int(limit or 50)))
    except (TypeError, ValueError):
        limit = 50
    try:
        offset = max(0, int(offset or 0))
    except (TypeError, ValueError):
        offset = 0
    where = ""
    params = []
    if keyword:
        like = f"%{keyword}%"
        where = "WHERE account_id LIKE ? OR account_name LIKE ? OR principal_tag LIKE ? OR raw_json LIKE ?"
        params = [like, like, like, like]
    if with_total:
        total = conn.execute(f"SELECT COUNT(*) AS count FROM alipay_accounts_cache {where}", params).fetchone()["count"]
    else:
        total = None
    if keyword:
        rows = conn.execute(
            f"""SELECT account_id, account_name, principal_tag, raw_json, updated_at
                FROM alipay_accounts_cache
                {where}
                ORDER BY updated_at DESC LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT account_id, account_name, principal_tag, raw_json, updated_at
               FROM alipay_accounts_cache
               ORDER BY updated_at DESC LIMIT ? OFFSET ?""",
            (limit, offset),
        ).fetchall()
    conn.close()
    accounts = _hydrate_alipay_account_cache_rows(rows)
    if with_total:
        return {"items": accounts, "total": total, "limit": limit, "offset": offset, "has_more": offset + len(accounts) < total}
    return accounts


def save_manual_cost(sub_account_id, report_date, cost_square):
    """仅保存合作广场手动消耗"""
    with db_connection() as conn:
        conn.execute(
            """INSERT INTO daily_consumption (sub_account_id, date, cost_square, cost_total)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(sub_account_id, date) DO UPDATE SET
                   cost_square=excluded.cost_square,
                   cost_total=cost_simple + cost_standard + excluded.cost_square,
                   updated_at=datetime('now','localtime')""",
            (sub_account_id, report_date, cost_square, cost_square),
        )


def batch_save_manual_cost(items, report_date):
    """批量保存合作广场消耗。items: [{sub_account_id, cost_square}]"""
    with db_connection() as conn:
        for item in items:
            sub_id = item['sub_account_id']
            sq = float(item.get('cost_square', 0) or 0)

            conn.execute(
                """INSERT INTO daily_consumption (sub_account_id, date, cost_square, cost_total)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(sub_account_id, date) DO UPDATE SET
                       cost_square=excluded.cost_square,
                       cost_total=cost_simple + cost_standard + excluded.cost_square,
                       updated_at=datetime('now','localtime')""",
                (sub_id, report_date, sq, sq),
            )


def get_consumption_report(project_id, report_date):
    """获取某项目某天的消耗报表"""
    conn = get_db()
    rows = conn.execute(
        """SELECT sa.id as sub_id, sa.account_id, sa.account_name, sa.account_type,
                  COALESCE(dc.cost_simple, 0) as cost_simple,
                  COALESCE(dc.cost_standard, 0) as cost_standard,
                  COALESCE(dc.cost_square, 0) as cost_square,
                  (COALESCE(dc.cost_simple, 0) + COALESCE(dc.cost_standard, 0) + COALESCE(dc.cost_square, 0)) as cost_total
           FROM sub_accounts sa
           LEFT JOIN daily_consumption dc ON sa.id = dc.sub_account_id AND dc.date = ?
           WHERE sa.project_id = ?
           ORDER BY sa.id""",
        (report_date, project_id),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _merge_json_metric_payload(item, raw_metrics):
    if not raw_metrics:
        return item
    try:
        metrics = json.loads(raw_metrics)
    except (TypeError, ValueError):
        metrics = {}
    if isinstance(metrics, dict):
        for key, value in metrics.items():
            if key not in item or item.get(key) in (None, ""):
                item[key] = value
    return item


def _merge_bili_json_metrics(rows):
    result = []
    for row in rows:
        item = dict(row)
        item = _merge_json_metric_payload(item, item.pop("bili_metrics_json", None))
        item = _merge_json_metric_payload(item, item.pop("alipay_metrics_json", None))
        result.append(item)
    return result


def _sum_json_metric_payload(totals, raw_metrics):
    if raw_metrics:
        try:
            metric_rows = json.loads(raw_metrics)
        except (TypeError, ValueError):
            metric_rows = []
        if isinstance(metric_rows, dict):
            metric_rows = [metric_rows]
        if isinstance(metric_rows, list):
            for metrics in metric_rows:
                if not isinstance(metrics, dict):
                    continue
                for key, value in metrics.items():
                    try:
                        totals[key] = totals.get(key, 0) + float(value or 0)
                    except (TypeError, ValueError):
                        totals.setdefault(key, 0)
    return totals


def _sum_bili_json_metrics(rows):
    result = []
    for row in rows:
        item = dict(row)
        totals = {}
        totals = _sum_json_metric_payload(totals, item.pop("bili_metrics_json", None))
        totals = _sum_json_metric_payload(totals, item.pop("alipay_metrics_json", None))
        for key, value in totals.items():
            if key not in item or item.get(key) in (None, ""):
                item[key] = value
        result.append(item)
    return result


def _with_bili_ratio_fields(rows):
    result = []
    for row in rows:
        item = dict(row)
        if (item.get("media") or MEDIA_XHS) in (MEDIA_BILI, MEDIA_ALIPAY):
            show_count = float(item.get("show_count") or 0)
            click_count = float(item.get("click_count") or 0)
            cost_total = float(item.get("cost_total") or 0)
            item["click_rate"] = (click_count / show_count * 100) if show_count else 0
            item["cost_per_click"] = (cost_total / click_count) if click_count else 0
            item["average_cost_per_thousand"] = (cost_total / show_count * 1000) if show_count else 0
            item["form_submit_cost"] = (cost_total / float(item.get("form_submit") or item.get("leads") or 0)) if (item.get("form_submit") or item.get("leads")) else 0
            item["valid_leads_cost"] = (cost_total / float(item.get("valid_leads") or 0)) if item.get("valid_leads") else 0
            item["comment_click_cost"] = (cost_total / float(item.get("comment_click_count") or 0)) if item.get("comment_click_count") else 0
            item["app_wake_cost"] = (cost_total / float(item.get("app_wake_count") or 0)) if item.get("app_wake_count") else 0
            item["order_submit_cost"] = (cost_total / float(item.get("order_submit_count") or 0)) if item.get("order_submit_count") else 0
            item["video_play_cost"] = (cost_total / float(item.get("video_play_count") or 0)) if item.get("video_play_count") else 0
            item["video_interact_cost"] = (cost_total / float(item.get("video_interact_count") or item.get("interaction") or 0)) if (item.get("video_interact_count") or item.get("interaction")) else 0
        result.append(item)
    return result


def get_latest_bili_consumption_date(project_id=None, project_ids=None, operator_id=None, department=None, filter_operator_id=None, not_after=None):
    where_clauses = ["COALESCE(sa.media, ?) = ?"]
    params = [MEDIA_XHS, MEDIA_BILI]

    if project_id:
        where_clauses.append("sa.project_id = ?")
        params.append(project_id)

    if project_ids:
        ids = [int(pid) for pid in project_ids if pid]
        if ids:
            placeholders = ",".join("?" for _ in ids)
            where_clauses.append(f"sa.project_id IN ({placeholders})")
            params.extend(ids)

    if not_after:
        where_clauses.append("dc.date <= ?")
        params.append(not_after)

    attribution_clauses, attribution_params, _operator_expr = _effective_operator_filter(
        "dc.date",
        operator_id=operator_id,
        department=department,
        filter_operator_id=filter_operator_id,
    )
    where_clauses.extend(attribution_clauses)
    params.extend(attribution_params)

    where_sql = " WHERE " + " AND ".join(where_clauses)
    conn = get_db()
    row = conn.execute(
        f"""SELECT dc.date AS latest_date
           FROM daily_consumption dc
           JOIN sub_accounts sa ON sa.id = dc.sub_account_id
           JOIN projects p ON p.id = sa.project_id
           {where_sql}
             AND (COALESCE(dc.cost_total, 0) > 0 OR COALESCE(dc.charged_cost_milli, 0) > 0)
           GROUP BY dc.date
           ORDER BY COUNT(DISTINCT sa.project_id) DESC, dc.date DESC
           LIMIT 1""",
        params,
    ).fetchone()
    conn.close()
    return row["latest_date"] if row and row["latest_date"] else None



def _handover_active_clause(alias, date_expr):
    start_expr = f"date(COALESCE(NULLIF({alias}.start_date, ''), {alias}.handover_time))"
    end_expr = f"NULLIF({alias}.end_date, '')"
    return (
        f"{start_expr} <= date({date_expr}) "
        f"AND ({end_expr} IS NULL OR date({end_expr}) >= date({date_expr}))"
    )


def _handover_order(alias):
    return f"date(COALESCE(NULLIF({alias}.start_date, ''), {alias}.handover_time)) DESC, {alias}.handover_time DESC, {alias}.id DESC"


def _handover_target_expr(date_expr):
    sub_active = _handover_active_clause("sah", date_expr)
    project_active = _handover_active_clause("ph", date_expr)
    return f"""COALESCE((
        SELECT sah.to_target_type FROM sub_account_handovers sah
        WHERE sah.sub_account_id = sa.id AND {sub_active}
        ORDER BY {_handover_order("sah")} LIMIT 1
    ), (
        SELECT ph.to_target_type FROM project_handovers ph
        WHERE ph.project_id = p.id AND {project_active}
        ORDER BY {_handover_order("ph")} LIMIT 1
    ), 'operator')"""


def _effective_operator_expr(date_expr):
    sub_active = _handover_active_clause("sah", date_expr)
    project_active = _handover_active_clause("ph", date_expr)
    return f"""COALESCE((
        SELECT sah.to_operator_id FROM sub_account_handovers sah
        WHERE sah.sub_account_id = sa.id AND {sub_active}
        ORDER BY {_handover_order("sah")} LIMIT 1
    ), (
        SELECT ph.to_operator_id FROM project_handovers ph
        WHERE ph.project_id = p.id AND {project_active}
        ORDER BY {_handover_order("ph")} LIMIT 1
    ), (SELECT ph0.from_operator_id FROM project_handovers ph0
        WHERE ph0.project_id = p.id
        ORDER BY ph0.handover_time ASC, ph0.id ASC LIMIT 1
    ), p.operator_id)"""


def _project_handover_target_expr(date_expr):
    project_active = _handover_active_clause("ph", date_expr)
    return f"""COALESCE((
        SELECT ph.to_target_type FROM project_handovers ph
        WHERE ph.project_id = p.id AND {project_active}
        ORDER BY {_handover_order("ph")} LIMIT 1
    ), COALESCE(p.operation_mode, 'operator'))"""


def _project_effective_operator_expr(date_expr):
    project_active = _handover_active_clause("ph", date_expr)
    return f"""COALESCE((
        SELECT ph.to_operator_id FROM project_handovers ph
        WHERE ph.project_id = p.id AND {project_active}
        ORDER BY {_handover_order("ph")} LIMIT 1
    ), (SELECT ph0.from_operator_id FROM project_handovers ph0
        WHERE ph0.project_id = p.id
        ORDER BY ph0.handover_time ASC, ph0.id ASC LIMIT 1
    ), p.operator_id)"""


def _effective_operator_filter(date_expr, operator_id=None, department=None, filter_operator_id=None):
    target_expr = _handover_target_expr(date_expr)
    operator_expr = _effective_operator_expr(date_expr)
    clauses = [f"{target_expr} != ?"]
    params = [HANDOVER_TARGET_SELF]
    if operator_id:
        clauses.append(f"{operator_expr} = ?")
        params.append(operator_id)
    elif department:
        clauses.append(f"{operator_expr} IN (SELECT id FROM users WHERE department = ?)")
        params.append(department)
    if filter_operator_id:
        clauses.append(f"{operator_expr} = ?")
        params.append(filter_operator_id)
    return clauses, params, operator_expr


def _consumption_cost_expr(media=MEDIA_XHS, dc_alias="dc", project_alias="p"):
    """统一消耗口径：付费媒体和乘风端口读总消耗，其他小红书端口读三类消耗相加。"""
    if media in (MEDIA_BILI, MEDIA_ALIPAY):
        return f"COALESCE({dc_alias}.cost_total, 0)"
    return (
        f"CASE WHEN COALESCE({project_alias}.platform, '') = '乘风' "
        f"THEN COALESCE({dc_alias}.cost_total, 0) "
        f"ELSE (COALESCE({dc_alias}.cost_simple, 0) + COALESCE({dc_alias}.cost_standard, 0) + COALESCE({dc_alias}.cost_square, 0)) END"
    )


def get_full_report(report_date, project_id=None, operator_id=None, department=None, filter_operator_id=None, media=MEDIA_XHS):
    """
    获取完整消耗报表
    operator_id: 运营优化师 -> 只看自己的项目
    department: 运营主管 -> 看本部门所有人的项目
    filter_operator_id: 按特定人员筛选（主管/管理员用）
    media: 媒体平台；默认小红书，传 None 可查全部
    都不传 -> 看全部
    """
    conn = get_db()
    where_clauses = []
    params = [report_date, report_date]

    if media:
        where_clauses.append("COALESCE(sa.media, COALESCE(p.media, '小红书')) = ?")
        params.append(media)

    if project_id:
        where_clauses.append("sa.project_id = ?")
        params.append(project_id)

    attribution_clauses, attribution_params, operator_expr = _effective_operator_filter("report_ctx.attribution_date", operator_id, department, filter_operator_id)
    where_clauses.extend(attribution_clauses)
    params.extend(attribution_params)

    where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    cost_expr = _consumption_cost_expr(media)

    rows = conn.execute(
        f"""SELECT sa.id as sub_id, sa.account_id, sa.account_name, sa.industry, sa.company_name,
                   p.id as project_id, p.project_name, p.sales_name,
                   p.need_content, p.marketing_goal, {operator_expr} as operator_id, p.media,
                   u.real_name as operator_name, u.department,
                   COALESCE(dc.cost_simple, 0) as cost_simple,
                   COALESCE(dc.cost_standard, 0) as cost_standard,
                   COALESCE(dc.cost_square, 0) as cost_square,
                   {cost_expr} as cost_total,
                   COALESCE(NULLIF(dc.show_count, 0), dc.impression, 0) as show_count,
                   COALESCE(NULLIF(dc.click_count, 0), dc.click, 0) as click_count,
                   COALESCE(dc.video_like_count, dc.like_count, 0) as video_like_count,
                   COALESCE(dc.video_fav_count, dc.collect_count, 0) as video_fav_count,
                   COALESCE(dc.video_coin_count, 0) as video_coin_count,
                   COALESCE(NULLIF(dc.video_interact_count, 0), dc.interaction, 0) as video_interact_count,
                   COALESCE(NULLIF(dc.interaction, 0), dc.video_interact_count, 0) as interaction,
                   COALESCE(dc.leads, 0) as leads,
                   COALESCE(dc.message_consult, 0) as message_consult,
                   COALESCE(NULLIF(dc.form_submit, 0), dc.leads, 0) as form_submit,
                   COALESCE(dc.valid_leads, 0) as valid_leads,
                   COALESCE(dc.comment_click_count, 0) as comment_click_count,
                   COALESCE(dc.app_wake_count, 0) as app_wake_count,
                   COALESCE(dc.order_submit_count, 0) as order_submit_count,
                   COALESCE(dc.video_play_count, 0) as video_play_count,
                   COALESCE(dc.initiative_message, 0) as initiative_message,
                   COALESCE(dc.msg_leads_num, 0) as msg_leads_num,
                   COALESCE(dc.charged_cost_milli, 0) as charged_cost_milli,
                   COALESCE(dc.bili_metrics_json, '{{}}') as bili_metrics_json,
                   COALESCE(dc.alipay_metrics_json, '{{}}') as alipay_metrics_json
            FROM sub_accounts sa
            JOIN projects p ON sa.project_id = p.id
            LEFT JOIN daily_consumption dc ON sa.id = dc.sub_account_id AND dc.date = ?
            JOIN (SELECT ? AS attribution_date) report_ctx
            LEFT JOIN users u ON u.id = {operator_expr}
            {where_sql}
            ORDER BY u.department, operator_id, p.id, sa.id""",
        params,
    ).fetchall()
    conn.close()
    return _with_bili_ratio_fields(_merge_bili_json_metrics(rows))


def get_range_report(start_date, end_date, project_id=None, operator_id=None, department=None, filter_operator_id=None, media=MEDIA_XHS):
    """
    获取日期范围消耗报表（聚合合计）
    start_date/end_date: 日期范围，SUM所有天的消耗
    """
    conn = get_db()
    where_clauses = ["dc.date >= ?", "dc.date <= ?"]
    params = [start_date, end_date]

    if media:
        where_clauses.append("COALESCE(sa.media, COALESCE(p.media, '小红书')) = ?")
        params.append(media)

    if project_id:
        where_clauses.append("sa.project_id = ?")
        params.append(project_id)

    attribution_clauses, attribution_params, operator_expr = _effective_operator_filter("dc.date", operator_id, department, filter_operator_id)
    where_clauses.extend(attribution_clauses)
    params.extend(attribution_params)

    where_sql = " WHERE " + " AND ".join(where_clauses)
    cost_expr = _consumption_cost_expr(media)

    rows = conn.execute(
        f"""SELECT sa.id as sub_id, sa.account_id, sa.account_name, sa.industry, sa.company_name,
                   p.id as project_id, p.project_name, p.sales_name,
                   p.need_content, p.marketing_goal, {operator_expr} as operator_id, p.media,
                   u.real_name as operator_name, u.department,
                   SUM(COALESCE(dc.cost_simple, 0)) as cost_simple,
                   SUM(COALESCE(dc.cost_standard, 0)) as cost_standard,
                   SUM(COALESCE(dc.cost_square, 0)) as cost_square,
                   SUM({cost_expr}) as cost_total,
                   SUM(COALESCE(NULLIF(dc.show_count, 0), dc.impression, 0)) as show_count,
                   SUM(COALESCE(NULLIF(dc.click_count, 0), dc.click, 0)) as click_count,
                   SUM(COALESCE(dc.video_like_count, dc.like_count, 0)) as video_like_count,
                   SUM(COALESCE(dc.video_fav_count, dc.collect_count, 0)) as video_fav_count,
                   SUM(COALESCE(dc.video_coin_count, 0)) as video_coin_count,
                   SUM(COALESCE(NULLIF(dc.video_interact_count, 0), dc.interaction, 0)) as video_interact_count,
                   SUM(COALESCE(NULLIF(dc.interaction, 0), dc.video_interact_count, 0)) as interaction,
                   SUM(COALESCE(dc.leads, 0)) as leads,
                   SUM(COALESCE(dc.message_consult, 0)) as message_consult,
                   SUM(COALESCE(NULLIF(dc.form_submit, 0), dc.leads, 0)) as form_submit,
                   SUM(COALESCE(dc.valid_leads, 0)) as valid_leads,
                   SUM(COALESCE(dc.comment_click_count, 0)) as comment_click_count,
                   SUM(COALESCE(dc.app_wake_count, 0)) as app_wake_count,
                   SUM(COALESCE(dc.order_submit_count, 0)) as order_submit_count,
                   SUM(COALESCE(dc.video_play_count, 0)) as video_play_count,
                   SUM(COALESCE(dc.initiative_message, 0)) as initiative_message,
                   SUM(COALESCE(dc.msg_leads_num, 0)) as msg_leads_num,
                   SUM(COALESCE(dc.charged_cost_milli, 0)) as charged_cost_milli,
                   '[' || GROUP_CONCAT(COALESCE(NULLIF(dc.bili_metrics_json, ''), '{{}}')) || ']' as bili_metrics_json,
                   '[' || GROUP_CONCAT(COALESCE(NULLIF(dc.alipay_metrics_json, ''), '{{}}')) || ']' as alipay_metrics_json
            FROM sub_accounts sa
            JOIN projects p ON sa.project_id = p.id
            JOIN daily_consumption dc ON sa.id = dc.sub_account_id
            LEFT JOIN users u ON u.id = {operator_expr}
            {where_sql}
            GROUP BY sa.id, operator_id
            ORDER BY u.department, operator_id, p.id, sa.id""",
        params,
    ).fetchall()
    conn.close()
    return _with_bili_ratio_fields(_sum_bili_json_metrics(rows))


def get_admin_stats():
    """管理员全局统计"""
    conn = get_db()
    month_start = date.today().replace(day=1).isoformat()

    stats = {
        "total_projects": conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0],
        "total_accounts": conn.execute("SELECT COUNT(*) FROM sub_accounts").fetchone()[0],
        "yesterday_cost": conn.execute(
            "SELECT COALESCE(SUM(COALESCE(cost_simple, 0) + COALESCE(cost_standard, 0) + COALESCE(cost_square, 0)),0) FROM daily_consumption WHERE date=date('now','-1 day')"
        ).fetchone()[0],
        "month_cost": conn.execute(
            "SELECT COALESCE(SUM(COALESCE(cost_simple, 0) + COALESCE(cost_standard, 0) + COALESCE(cost_square, 0)),0) FROM daily_consumption WHERE date >= ?",
            (month_start,),
        ).fetchone()[0],
    }
    conn.close()
    return stats


def get_admin_overview():
    """管理员项目概览"""
    conn = get_db()
    rows = conn.execute(
        """SELECT p.id, p.project_name as project, p.advertiser_name as advertiser, p.sales_name as sales,
                  COALESCE(SUM((COALESCE(dc.cost_simple, 0) + COALESCE(dc.cost_standard, 0) + COALESCE(dc.cost_square, 0))), 0) as total_cost
           FROM projects p
           LEFT JOIN sub_accounts sa ON sa.project_id = p.id
           LEFT JOIN daily_consumption dc ON dc.sub_account_id = sa.id
           GROUP BY p.id
           ORDER BY p.id DESC"""
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_yesterday_cost_for_user(operator_id):
    """获取运营用户昨日总消耗"""
    attribution_clauses, attribution_params, _operator_expr = _effective_operator_filter("dc.date", operator_id=operator_id)
    cost_expr = _consumption_cost_expr(MEDIA_XHS)
    conn = get_db()
    row = conn.execute(
        f"""SELECT COALESCE(SUM({cost_expr}), 0) as total
           FROM projects p
           JOIN sub_accounts sa ON sa.project_id = p.id
           JOIN daily_consumption dc ON dc.sub_account_id = sa.id
           WHERE dc.date = date('now','-1 day') AND {' AND '.join(attribution_clauses)}""",
        attribution_params,
    ).fetchone()
    conn.close()
    return row["total"] if row else 0


# ---- OAuth Token ----

def save_token(access_token, refresh_token, expires_in, app_id="", refresh_token_expires_in=None, refresh_expires_at=None):
    """保存OAuth token，按 app_id 隔离存储"""
    expires_at = (datetime.now() + timedelta(seconds=expires_in)).isoformat()
    if refresh_expires_at is None and refresh_token_expires_in:
        try:
            refresh_expires_at = (datetime.now() + timedelta(seconds=int(refresh_token_expires_in))).isoformat()
        except (TypeError, ValueError):
            refresh_expires_at = None
    with db_connection() as conn:
        conn.execute("DELETE FROM oauth_tokens WHERE app_id=?", (app_id,))
        conn.execute(
            """INSERT INTO oauth_tokens
               (access_token, refresh_token, expires_at, refresh_expires_at, app_id)
               VALUES (?, ?, ?, ?, ?)""",
            (access_token, refresh_token, expires_at, refresh_expires_at or "", app_id),
        )


def get_token(app_id=""):
    """获取指定端口的 access_token"""
    conn = get_db()
    row = conn.execute("SELECT * FROM oauth_tokens WHERE app_id=? ORDER BY id DESC LIMIT 1", (app_id,)).fetchone()
    conn.close()
    if not row:
        return None
    return dict(row)


def get_refresh_token(app_id=""):
    conn = get_db()
    row = conn.execute("SELECT refresh_token FROM oauth_tokens WHERE app_id=? ORDER BY id DESC LIMIT 1", (app_id,)).fetchone()
    conn.close()
    return row["refresh_token"] if row else None


# ---- MPI 广告主缓存 ----

def _first_text(data, *keys):
    for key in keys:
        value = data.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _normalise_advertiser_row(data):
    advertiser_id = _first_text(data, "advertiser_id", "virtual_seller_id", "brand_user_id")
    advertiser_name = _first_text(
        data,
        "advertiser_name",
        "virtual_seller_name",
        "name",
        "brand_user_name",
        "company_name",
    )
    if not advertiser_id:
        return None
    return advertiser_id, advertiser_name


def save_advertisers(advertisers):
    """保存MPI广告主列表到缓存"""
    with db_connection() as conn:
        for a in advertisers:
            # 确保 advertiser_id 转换为字符串（支持 integer 和 virtual_seller_id）
            normalized = _normalise_advertiser_row(a)
            if not normalized:
                continue
            adv_id, adv_name = normalized
            conn.execute(
                "INSERT OR REPLACE INTO mpi_advertisers (advertiser_id, advertiser_name, updated_at) VALUES (?, ?, datetime('now','localtime'))",
                (adv_id, adv_name),
            )


def search_advertisers(keyword=""):
    """搜索缓存的广告主列表（mpi_advertisers + 已关联的 sub_accounts，含 virtual_seller_id）"""
    conn = get_db()
    if keyword:
        # 先从 mpi_advertisers 搜索
        rows = conn.execute(
            """SELECT * FROM mpi_advertisers
               WHERE advertiser_id LIKE ? OR advertiser_name LIKE ?
               ORDER BY advertiser_id""",
            (f'%{keyword}%', f'%{keyword}%'),
        ).fetchall()
        # 收集已匹配的 ID
        matched_ids = {str(r["advertiser_id"]) for r in rows}
        # 也收集 sub_accounts 中的 virtual_seller_id
        vsid_rows = conn.execute(
            """SELECT DISTINCT virtual_seller_id FROM sub_accounts
               WHERE virtual_seller_id LIKE ? AND virtual_seller_id NOT IN ({})""".format(
                   ",".join("?" for _ in matched_ids) if matched_ids else "''",
               ),
            (f'%{keyword}%',) + tuple(matched_ids),
        ).fetchall()
        for vr in vsid_rows:
            matched_ids.add(str(vr["virtual_seller_id"]))

        # 从 sub_accounts 补充搜索（确保所有已关联子账号可搜到）
        sub_rows = conn.execute(
            """SELECT DISTINCT sa.account_id AS advertiser_id, sa.account_name AS advertiser_name
               FROM sub_accounts sa
               WHERE (CAST(sa.account_id AS TEXT) LIKE ? OR sa.account_name LIKE ?
               OR sa.company_name LIKE ? OR sa.virtual_seller_id LIKE ?)
               AND CAST(sa.account_id AS TEXT) NOT IN ({})
               ORDER BY sa.account_id""".format(
                   ",".join("?" for _ in matched_ids) if matched_ids else "''",
               ),
            (f'%{keyword}%', f'%{keyword}%', f'%{keyword}%', f'%{keyword}%') + tuple(matched_ids),
        ).fetchall()
        result = [dict(r) for r in rows] + [dict(r) for r in sub_rows]
    else:
        rows = conn.execute(
            "SELECT * FROM mpi_advertisers ORDER BY advertiser_id LIMIT 200"
        ).fetchall()
        result = [dict(r) for r in rows]
    conn.close()
    return result


def get_all_advertisers():
    """获取全部缓存的广告主"""
    conn = get_db()
    rows = conn.execute("SELECT * FROM mpi_advertisers ORDER BY advertiser_id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_advertiser(advertiser_id):
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM mpi_advertisers WHERE advertiser_id=? ORDER BY id DESC LIMIT 1",
        (str(advertiser_id),),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def save_advertisers_from_sub_accounts(sub_accounts):
    """将子账号API返回的数据缓存到 mpi_advertisers（增量，不删除现有数据）"""
    save_advertisers(sub_accounts)


# ---- 项目交接 ----

def _handover_start_date(handover_time, start_date=None):
    return str(start_date or handover_time or "")[:10]


def _handover_is_current_open_window(start_date, end_date):
    today = datetime.now().strftime("%Y-%m-%d")
    return (not start_date or start_date <= today) and not end_date


def create_project_handover(project_id, from_operator_id, to_operator_id, handover_time, to_target_type=HANDOVER_TARGET_OPERATOR, start_date=None, end_date=None):
    """创建项目交接记录"""
    to_target_type = to_target_type or HANDOVER_TARGET_OPERATOR
    to_operator_label = HANDOVER_SELF_LABEL if to_target_type == HANDOVER_TARGET_SELF else ""
    start_date = _handover_start_date(handover_time, start_date)
    end_date = str(end_date or "")[:10]
    with db_connection() as conn:
        conn.execute(
            """INSERT INTO project_handovers
               (project_id, from_operator_id, to_operator_id, handover_time, to_target_type, to_operator_label, start_date, end_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (project_id, from_operator_id, to_operator_id, handover_time, to_target_type, to_operator_label, start_date, end_date),
        )
        if to_target_type == HANDOVER_TARGET_SELF and _handover_is_current_open_window(start_date, end_date):
            conn.execute("UPDATE projects SET operation_mode = ? WHERE id = ?", (HANDOVER_TARGET_SELF, project_id))
        elif to_target_type == HANDOVER_TARGET_OPERATOR and _handover_is_current_open_window(start_date, end_date):
            conn.execute("UPDATE projects SET operator_id = ?, operation_mode = ? WHERE id = ?", (to_operator_id, HANDOVER_TARGET_OPERATOR, project_id))


def get_project_handovers(project_id):
    """获取项目交接历史"""
    conn = get_db()
    rows = conn.execute(
        """SELECT ph.*, u1.real_name as from_operator_name,
                  CASE WHEN ph.to_target_type='self' THEN COALESCE(NULLIF(ph.to_operator_label,''), '自运营') ELSE u2.real_name END as to_operator_name
           FROM project_handovers ph
           LEFT JOIN users u1 ON ph.from_operator_id = u1.id
           LEFT JOIN users u2 ON ph.to_operator_id = u2.id
           WHERE ph.project_id = ?
           ORDER BY date(COALESCE(NULLIF(ph.start_date, ''), ph.handover_time)) DESC, ph.handover_time DESC, ph.id DESC""",
        (project_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_sub_account_handover(sub_account_id, from_operator_id, to_operator_id, handover_time, to_target_type=HANDOVER_TARGET_OPERATOR, start_date=None, end_date=None):
    """创建子账号交接记录；只影响该子账号的归属，不修改项目负责人。"""
    to_target_type = to_target_type or HANDOVER_TARGET_OPERATOR
    to_operator_label = HANDOVER_SELF_LABEL if to_target_type == HANDOVER_TARGET_SELF else ""
    start_date = _handover_start_date(handover_time, start_date)
    end_date = str(end_date or "")[:10]
    with db_connection() as conn:
        row = conn.execute(
            "SELECT project_id FROM sub_accounts WHERE id = ?",
            (sub_account_id,),
        ).fetchone()
        if not row:
            raise ValueError("子账号不存在")
        conn.execute(
            """INSERT INTO sub_account_handovers
               (sub_account_id, project_id, from_operator_id, to_operator_id, handover_time, to_target_type, to_operator_label, start_date, end_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                sub_account_id,
                row["project_id"],
                from_operator_id,
                to_operator_id,
                handover_time,
                to_target_type,
                to_operator_label,
                start_date,
                end_date,
            ),
        )


def get_sub_account_handovers(sub_account_id):
    """获取子账号交接历史。"""
    conn = get_db()
    rows = conn.execute(
        """SELECT sah.*, sa.account_id, sa.account_name, p.project_name,
                  u1.real_name as from_operator_name,
                  CASE WHEN sah.to_target_type='self' THEN COALESCE(NULLIF(sah.to_operator_label,''), '自运营') ELSE u2.real_name END as to_operator_name
           FROM sub_account_handovers sah
           JOIN sub_accounts sa ON sah.sub_account_id = sa.id
           JOIN projects p ON p.id = COALESCE(NULLIF(sah.project_id, 0), sa.project_id)
           LEFT JOIN users u1 ON sah.from_operator_id = u1.id
           LEFT JOIN users u2 ON sah.to_operator_id = u2.id
           WHERE sah.sub_account_id = ?
           ORDER BY date(COALESCE(NULLIF(sah.start_date, ''), sah.handover_time)) DESC, sah.handover_time DESC, sah.id DESC""",
        (sub_account_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def project_has_effective_owner(project_id, operator_id=None, department=None):
    """判断项目或其子账号在当前口径下是否归属于指定运营/部门。"""
    if not operator_id and not department:
        return False
    project_target_expr = _project_handover_target_expr("date('now','localtime')")
    project_operator_expr = _project_effective_operator_expr("date('now','localtime')")
    project_clauses = [f"{project_target_expr} != ?"]
    project_params = [HANDOVER_TARGET_SELF]
    if operator_id:
        project_clauses.append(f"{project_operator_expr} = ?")
        project_params.append(operator_id)
    else:
        project_clauses.append(f"{project_operator_expr} IN (SELECT id FROM users WHERE department = ?)")
        project_params.append(department)

    sub_clauses, sub_params, _operator_expr = _effective_operator_filter(
        "date('now','localtime')",
        operator_id=operator_id,
        department=department,
    )
    conn = get_db()
    row = conn.execute(
        f"""SELECT 1
           FROM projects p
           WHERE p.id = ?
             AND (
                ({' AND '.join(project_clauses)})
                OR EXISTS (
                    SELECT 1 FROM sub_accounts sa
                    WHERE sa.project_id = p.id AND {' AND '.join(sub_clauses)}
                )
             )
           LIMIT 1""",
        [project_id] + project_params + sub_params,
    ).fetchone()
    conn.close()
    return bool(row)


def get_operator_at_time(project_id, target_time):
    """获取指定时间点的项目运营（考虑交接历史）"""
    conn = get_db()
    try:
        # 先检查是否有在该时间之前的交接记录
        rows = conn.execute(
            """SELECT to_operator_id FROM project_handovers
               WHERE project_id = ?
                 AND date(COALESCE(NULLIF(start_date, ''), handover_time)) <= date(?)
                 AND (NULLIF(end_date, '') IS NULL OR date(end_date) >= date(?))
               ORDER BY date(COALESCE(NULLIF(start_date, ''), handover_time)) DESC, handover_time DESC, id DESC LIMIT 1""",
            (project_id, target_time, target_time),
        ).fetchall()
        if rows:
            return rows[0]["to_operator_id"]
        # 没有交接记录，返回项目当前运营
        row = conn.execute("SELECT operator_id FROM projects WHERE id = ?", (project_id,)).fetchone()
        return row["operator_id"] if row else None
    finally:
        conn.close()


def can_delete_user(user_id):
    """检查用户是否可以删除（无关联项目、子账户、消耗）"""
    conn = get_db()
    # 检查关联的项目
    proj_count = conn.execute("SELECT COUNT(*) FROM projects WHERE operator_id = ?", (user_id,)).fetchone()[0]
    if proj_count > 0:
        conn.close()
        return False, f"该用户关联了 {proj_count} 个项目，请先转移或删除项目"

    # 检查关联的子账户（通过项目）
    current_clauses, current_params, _operator_expr = _effective_operator_filter("date('now','localtime')", operator_id=user_id)
    sub_count = conn.execute(
        f"""SELECT COUNT(*) FROM sub_accounts sa
           JOIN projects p ON sa.project_id = p.id
           WHERE {' AND '.join(current_clauses)}""",
        current_params,
    ).fetchone()[0]
    if sub_count > 0:
        conn.close()
        return False, f"该用户关联了 {sub_count} 个子账户，请先删除"

    # 检查是否有历史消耗数据
    history_clauses, history_params, _operator_expr = _effective_operator_filter("dc.date", operator_id=user_id)
    consumption_exists = conn.execute(
        f"""SELECT EXISTS(
               SELECT 1 FROM daily_consumption dc
               JOIN sub_accounts sa ON dc.sub_account_id = sa.id
               JOIN projects p ON sa.project_id = p.id
               WHERE {' AND '.join(history_clauses)}
                 AND {_consumption_cost_expr(MEDIA_XHS)} > 0
           )""",
        history_params,
    ).fetchone()[0]
    if consumption_exists:
        conn.close()
        return False, "该用户有历史消耗数据，无法删除。请先设置为离职状态"

    conn.close()
    return True, ""


def delete_user(user_id):
    """删除用户，同时清理关联数据：解绑笔记表现、活动日志、协作者、待办、任务引用"""
    with db_connection() as conn:
        # 找出该用户关联的所有任务ID
        task_ids = [r[0] for r in conn.execute(
            "SELECT id FROM tasks WHERE assignee_id = ? OR creator_id = ?", (user_id, user_id)
        ).fetchall()]

        if task_ids:
            placeholders = ",".join("?" * len(task_ids))
            # 删除笔记表现数据（解绑笔记）
            conn.execute(f"DELETE FROM task_note_performance WHERE task_id IN ({placeholders})", task_ids)
            # 删除任务活动日志
            conn.execute(f"DELETE FROM task_activity_log WHERE task_id IN ({placeholders})", task_ids)
            # 删除任务协作者
            conn.execute(f"DELETE FROM task_collaborators WHERE task_id IN ({placeholders})", task_ids)
            # 删除任务本身
            conn.execute(f"DELETE FROM tasks WHERE id IN ({placeholders})", task_ids)

        # 删除用户待办
        conn.execute("DELETE FROM user_todos WHERE user_id=?", (user_id,))
        # 删除用户
        conn.execute("DELETE FROM users WHERE id=?", (user_id,))


def set_user_status(user_id, status, resigned_at=None):
    """设置用户状态（active/resigned）"""
    valid_statuses = ["active", "resigned"]
    if status not in valid_statuses:
        raise ValueError(f"无效的状态值: {status}，必须是 {valid_statuses} 之一")
    with db_connection() as conn:
        if status == "resigned" and resigned_at:
            conn.execute("UPDATE users SET status = ?, resigned_at = ? WHERE id = ?", (status, resigned_at, user_id))
        else:
            conn.execute("UPDATE users SET status = ? WHERE id = ?", (status, user_id))


def get_user_status(user_id):
    """获取用户状态"""
    conn = get_db()
    row = conn.execute("SELECT status FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return row["status"] if row else "active"


# ---- 待办事项 ----

def get_user_todos(user_id):
    """获取用户的待办事项，按截止时间倒序"""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM user_todos WHERE user_id=? ORDER BY done ASC, deadline IS NULL, deadline ASC, id DESC",
        (user_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_todo(user_id, content, deadline=None):
    """创建待办事项"""
    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO user_todos (user_id, content, deadline) VALUES (?, ?, ?)",
        (user_id, content, deadline),
    )
    conn.commit()
    tid = cursor.lastrowid
    conn.close()
    return tid


def get_todo(todo_id):
    """获取单条待办事项"""
    conn = get_db()
    row = conn.execute("SELECT * FROM user_todos WHERE id=?", (todo_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def update_todo(todo_id, **kwargs):
    """更新待办事项"""
    fields = []
    params = []
    for k in ("content", "deadline", "done", "read", "type"):
        if k in kwargs:
            fields.append(f"{k}=?")
            params.append(kwargs[k])
    if not fields:
        return
    params.append(todo_id)
    conn = get_db()
    conn.execute(f"UPDATE user_todos SET {','.join(fields)} WHERE id=?", params)
    conn.commit()
    conn.close()


def delete_todo(todo_id):
    """删除待办事项"""
    conn = get_db()
    conn.execute("DELETE FROM user_todos WHERE id=?", (todo_id,))
    conn.commit()
    conn.close()


def create_assigned_todo(user_id, content, assigned_by, deadline=None, todo_type='assigned'):
    """创建分配给目标用户的待办/提醒（默认未读）"""
    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO user_todos (user_id, content, deadline, assigned_by, type, read) VALUES (?, ?, ?, ?, ?, 0)",
        (user_id, content, deadline, assigned_by, todo_type),
    )
    conn.commit()
    tid = cursor.lastrowid
    conn.close()
    return tid


def get_unread_todo_count(user_id):
    """获取未读分配待办数量"""
    conn = get_db()
    row = conn.execute(
        "SELECT COUNT(*) as cnt FROM user_todos WHERE user_id=? AND read=0",
        (user_id,),
    ).fetchone()
    conn.close()
    return row["cnt"] if row else 0


def mark_todo_read(todo_id):
    """标记待办为已读"""
    conn = get_db()
    conn.execute("UPDATE user_todos SET read=1 WHERE id=?", (todo_id,))
    conn.commit()
    conn.close()


def get_assigned_todos(assigner_id):
    """获取某人分配出去的所有待办"""
    conn = get_db()
    rows = conn.execute(
        """SELECT ut.*, u.real_name as target_name
           FROM user_todos ut
           LEFT JOIN users u ON ut.user_id=u.id
           WHERE ut.assigned_by=?
           ORDER BY ut.created_at DESC""",
        (assigner_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---- 系统状态 ----

def get_system_status():
    """获取系统状态：所有端口Token信息、最后同步时间"""
    conn = get_db()
    # 获取所有端口的 token
    token_rows = conn.execute(
        "SELECT access_token, refresh_token, expires_at, updated_at, app_id FROM oauth_tokens ORDER BY id DESC"
    ).fetchall()
    last_consumption = conn.execute(
        "SELECT MAX(updated_at) as last_sync FROM daily_consumption"
    ).fetchone()
    last_bili_consumption = conn.execute(
        """SELECT MAX(dc.updated_at) as last_sync
           FROM daily_consumption dc
           JOIN sub_accounts sa ON dc.sub_account_id=sa.id
           WHERE COALESCE(sa.media, '小红书') = ?""",
        (MEDIA_BILI,),
    ).fetchone()
    last_alipay_consumption = conn.execute(
        """SELECT MAX(dc.updated_at) as last_sync
           FROM daily_consumption dc
           JOIN sub_accounts sa ON dc.sub_account_id=sa.id
           WHERE COALESCE(sa.media, '小红书') = ?""",
        (MEDIA_ALIPAY,),
    ).fetchone()
    conn.close()

    # 按端口组织 token 状态
    def _make_token_status(row):
        status = {"has_token": False, "is_valid": False, "expires_at": None, "updated_at": None, "app_id": ""}
        if row:
            status["has_token"] = bool(row["access_token"])
            status["updated_at"] = row["updated_at"]
            status["expires_at"] = row["expires_at"]
            status["app_id"] = row["app_id"] or ""
            if row["expires_at"]:
                try:
                    expires = datetime.fromisoformat(str(row["expires_at"]))
                    status["is_valid"] = expires > datetime.now()
                except (ValueError, TypeError):
                    status["is_valid"] = False
        return status

    # 分离不同端口：按 app_id 精确匹配，避免旧记录覆盖新记录
    port1 = None
    port2 = None
    port3 = None
    bili_token = None
    fallback_bili_token = None
    xhs_app_ids = {str(XHS_APP_ID), str(XHS_APP_ID_2), str(XHS_APP_ID_3)}
    bili_client_id = str(runtime_config.BILI_CLIENT_ID or "")
    alipay_app_id = str(getattr(runtime_config, "ALIPAY_APP_ID", "") or "")
    for row in token_rows:
        r = dict(row)
        aid = str(r.get("app_id") or "")
        if aid == str(XHS_APP_ID):
            if not port1:
                port1 = _make_token_status(r)
        elif aid == str(XHS_APP_ID_2):
            if not port2:
                port2 = _make_token_status(r)
        elif aid == str(XHS_APP_ID_3):
            if not port3:
                port3 = _make_token_status(r)
        elif aid == bili_client_id and bili_client_id:
            if not bili_token:
                bili_token = _make_token_status(r)
        elif aid and aid not in xhs_app_ids:
            if not fallback_bili_token:
                fallback_bili_token = _make_token_status(r)

    if not bili_token:
        bili_token = fallback_bili_token

    bili_has_env_token = bool(runtime_config.BILI_ACCESS_TOKEN)
    bili_has_db_token = bool(bili_token and bili_token.get("has_token"))
    bili_is_valid = bool(bili_has_env_token or (bili_token and bili_token.get("is_valid")))
    alipay_has_env_token = bool(getattr(runtime_config, "ALIPAY_APP_AUTH_TOKEN", "") or getattr(runtime_config, "ALIPAY_APP_ID", ""))
    alipay_has_private_key = bool(getattr(runtime_config, "ALIPAY_PRIVATE_KEY", ""))
    alipay_is_valid = bool(alipay_app_id and alipay_has_private_key and (getattr(runtime_config, "ALIPAY_APP_AUTH_TOKEN", "") or getattr(runtime_config, "ALIPAY_BIZ_TOKEN", "")))

    return {
        "token": port1 or _make_token_status(None),  # 默认端口（兼容前端）
        "token_port2": port2,  # 第二端口
        "token_port3": port3,  # 第三端口
        "bili": {
            "name": "B站三连",
            "has_token": bool(bili_has_env_token or bili_has_db_token),
            "is_valid": bili_is_valid,
            "base_url": BILI_BASE_URL,
            "adp_version": BILI_ADP_VERSION,
            "last_sync": dict(last_bili_consumption)["last_sync"] if last_bili_consumption and dict(last_bili_consumption)["last_sync"] else None,
        },
        "alipay": {
            "name": "支付宝广告",
            "has_token": bool(alipay_has_env_token),
            "is_valid": alipay_is_valid,
            "base_url": getattr(runtime_config, "ALIPAY_GATEWAY_URL", ""),
            "adp_version": getattr(runtime_config, "ALIPAY_API_VERSION", "1.0"),
            "last_sync": dict(last_alipay_consumption)["last_sync"] if last_alipay_consumption and dict(last_alipay_consumption)["last_sync"] else None,
        },
        "last_sync": dict(last_consumption)["last_sync"] if last_consumption and dict(last_consumption)["last_sync"] else None,
    }


# ---- 团队管理 ----

def get_teams_with_stats(media=MEDIA_XHS):
    """获取所有团队及统计信息"""
    conn = get_db()
    media_join = "AND COALESCE(p.media, '小红书') = ?" if media else ""
    params = [media] if media else []
    rows = conn.execute(
        f"""SELECT t.name as department,
                  COUNT(DISTINCT CASE WHEN u.role != 'report_admin' THEN u.id END) as member_count,
                  COUNT(DISTINCT p.id) as project_count,
                  COALESCE(SUM((COALESCE(dc.cost_simple, 0) + COALESCE(dc.cost_standard, 0) + COALESCE(dc.cost_square, 0))), 0) as total_cost
           FROM teams t
           LEFT JOIN users u ON u.department = t.name AND u.role != 'report_admin'
           LEFT JOIN projects p ON p.operator_id = u.id {media_join}
           LEFT JOIN sub_accounts sa ON sa.project_id = p.id
           LEFT JOIN daily_consumption dc ON dc.sub_account_id = sa.id
           GROUP BY t.name
           ORDER BY t.name""",
        params,
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_team_consumption(department, days=7, start_date=None, end_date=None, media=MEDIA_XHS):
    """获取某团队指定时间段的每日消耗"""
    conn = get_db()
    if not start_date or not end_date:
        days = max(int(days or 1), 1)
        start_date = (date.today() - timedelta(days=days)).isoformat()
        end_date = date.today().isoformat()
    where = ["dc.date >= ?", "dc.date <= ?"]
    params = [start_date, end_date]
    if media:
        where.append("COALESCE(sa.media, COALESCE(p.media, '小红书')) = ?")
        params.append(media)
    attribution_clauses, attribution_params, _operator_expr = _effective_operator_filter("dc.date", department=department)
    where.extend(attribution_clauses)
    params.extend(attribution_params)
    cost_expr = _consumption_cost_expr(media)
    rows = conn.execute(
        f"""SELECT dc.date, COALESCE(SUM({cost_expr}), 0) as cost
           FROM daily_consumption dc
           JOIN sub_accounts sa ON dc.sub_account_id = sa.id
           JOIN projects p ON sa.project_id = p.id
           WHERE {' AND '.join(where)}
           GROUP BY dc.date
           ORDER BY dc.date""",
        params,
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_individual_consumption(department=None, days=7, start_date=None, end_date=None, media=MEDIA_XHS):
    """获取按个人分组的消耗数据，含项目数和子账号数"""
    conn = get_db()
    if not start_date or not end_date:
        days = max(int(days or 1), 1)
        start_date = (date.today() - timedelta(days=days)).isoformat()
        end_date = date.today().isoformat()

    target_expr = _handover_target_expr("dc.date")
    operator_expr = _effective_operator_expr("dc.date")
    where = ["dc.date >= ?", "dc.date <= ?", f"{target_expr} != ?"]
    params = [start_date, end_date, HANDOVER_TARGET_SELF]
    if media:
        where.append("COALESCE(sa.media, COALESCE(p.media, '小红书')) = ?")
        params.append(media)
    if department:
        where.append("u.department = ?")
        params.append(department)
    else:
        where.append("u.department IS NOT NULL AND u.department != ''")
    cost_expr = _consumption_cost_expr(media)
    rows = conn.execute(
        f"""SELECT {operator_expr} as user_id, u.real_name, u.real_name as operator_name, u.department,
                  COALESCE(GROUP_CONCAT(DISTINCT NULLIF(p.sales_name, '')), '') as sales_names,
                  COALESCE(SUM({cost_expr}), 0) as total_cost,
                  COUNT(DISTINCT p.id) as project_count,
                  COUNT(DISTINCT sa.id) as sub_account_count
           FROM daily_consumption dc
           JOIN sub_accounts sa ON dc.sub_account_id = sa.id
           JOIN projects p ON sa.project_id = p.id
           LEFT JOIN users u ON u.id = {operator_expr}
           WHERE {' AND '.join(where)}
             AND u.role != 'report_admin'
             AND u.status = 'active'
           GROUP BY user_id
           ORDER BY total_cost DESC""",
        params,
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_team_projects(department):
    """获取某团队的项目列表"""
    target_expr = _handover_target_expr("date('now','localtime')")
    operator_expr = _effective_operator_expr("date('now','localtime')")
    conn = get_db()
    rows = conn.execute(
        f"""SELECT p.*, u.real_name as operator_name
           FROM projects p
           LEFT JOIN users u ON p.operator_id = u.id
           WHERE (COALESCE(p.operation_mode, 'operator') != ? AND p.operator_id IN (SELECT id FROM users WHERE department = ?))
              OR EXISTS (
                   SELECT 1 FROM sub_accounts sa
                   WHERE sa.project_id = p.id
                     AND {target_expr} != ?
                     AND {operator_expr} IN (SELECT id FROM users WHERE department = ?)
              )
           ORDER BY p.id DESC""",
        (HANDOVER_TARGET_SELF, department, HANDOVER_TARGET_SELF, department),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_project_consumption_by_range(days=7, department=None, start_date=None, end_date=None, media=MEDIA_XHS):
    """获取按项目分组的消耗数据（用于数据分析视图）"""
    conn = get_db()
    if not start_date or not end_date:
        days = max(int(days or 1), 1)
        start_date = (date.today() - timedelta(days=days)).isoformat()
        end_date = date.today().isoformat()

    where = ["dc.date >= ?", "dc.date <= ?"]
    params = [start_date, end_date]
    if department:
        attribution_clauses, attribution_params, operator_expr = _effective_operator_filter("dc.date", department=department)
    else:
        attribution_clauses, attribution_params, operator_expr = _effective_operator_filter("dc.date")
    where.extend(attribution_clauses)
    params.extend(attribution_params)
    if media:
        where.append("COALESCE(sa.media, COALESCE(p.media, '小红书')) = ?")
        params.append(media)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    cost_expr = _consumption_cost_expr(media)

    rows = conn.execute(
        f"""SELECT p.id as project_id, p.project_name, p.sales_name,
                   {operator_expr} as operator_id,
                   u.real_name as operator_name, u.department,
                   COALESCE(SUM({cost_expr}), 0) as total_cost
            FROM projects p
            JOIN sub_accounts sa ON sa.project_id = p.id
            JOIN daily_consumption dc ON dc.sub_account_id = sa.id
            LEFT JOIN users u ON u.id = {operator_expr}
            {where_sql}
            GROUP BY p.id, operator_id
            ORDER BY total_cost DESC""",
        params,
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_department_supervisor(department):
    """获取某团队的在职主管姓名"""
    conn = get_db()
    row = conn.execute(
        "SELECT real_name FROM users WHERE department=? AND role='supervisor' AND status='active' LIMIT 1",
        (department,),
    ).fetchone()
    conn.close()
    return row["real_name"] if row else None


def get_department_projects_with_consumption(department, start_date, end_date, media=None):
    """获取某团队所有项目及其在指定日期范围的消耗，按大项目名称或项目名称前缀合并"""
    conn = get_db()
    where_clauses = ["dc.date >= ?", "dc.date <= ?"]
    params = [start_date, end_date]
    if media:
        where_clauses.append("COALESCE(p.media, '小红书') = ?")
        where_clauses.append("COALESCE(sa.media, COALESCE(p.media, '小红书')) = ?")
        params.extend([media, media])
    attribution_clauses, attribution_params, operator_expr = _effective_operator_filter("dc.date", department=department)
    where_clauses.extend(attribution_clauses)
    params.extend(attribution_params)
    where_sql = " WHERE " + " AND ".join(where_clauses)
    cost_expr = _consumption_cost_expr(media)
    # 优先使用 group_name（大项目），如果没有则提取项目名称前缀（去掉"-运营名"）
    rows = conn.execute(
        f"""SELECT
            CASE
                WHEN p.group_name IS NOT NULL AND p.group_name != ''
                THEN p.group_name
                WHEN INSTR(p.project_name, '-') > 0
                THEN SUBSTR(p.project_name, 1, INSTR(p.project_name, '-') - 1)
                ELSE p.project_name
            END as project_name,
            MAX(p.sales_name) as sales_name,
            SUM({cost_expr}) as total_cost
           FROM projects p
           JOIN sub_accounts sa ON sa.project_id = p.id
           JOIN daily_consumption dc ON dc.sub_account_id = sa.id
           LEFT JOIN users u ON u.id = {operator_expr}
           {where_sql}
           GROUP BY
            CASE
                WHEN p.group_name IS NOT NULL AND p.group_name != ''
                THEN p.group_name
                WHEN INSTR(p.project_name, '-') > 0
                THEN SUBSTR(p.project_name, 1, INSTR(p.project_name, '-') - 1)
                ELSE p.project_name
            END
           ORDER BY total_cost DESC""",
        params,
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_team(name):
    """创建团队"""
    with db_connection() as conn:
        try:
            conn.execute("INSERT INTO teams (name) VALUES (?)", (name,))
        except Exception:
            raise ValueError(f"团队「{name}」已存在")
    return True


def delete_team(name):
    """删除团队（清空该部门下所有用户的department字段，并删除团队记录）"""
    with db_connection() as conn:
        conn.execute("UPDATE users SET department = '' WHERE department = ?", (name,))
        conn.execute("DELETE FROM teams WHERE name = ?", (name,))


# ---- 子账号唯一性绑定检查 ----

def is_sub_account_bound(account_id, exclude_project_id=None, media=MEDIA_XHS):
    """检查 account_id 是否已绑定到其他运营者的项目。返回绑定的项目信息或None。"""
    conn = get_db()
    query = """
        SELECT sa.id, sa.project_id, p.project_name, u.real_name as operator_name
        FROM sub_accounts sa
        JOIN projects p ON sa.project_id = p.id
        LEFT JOIN users u ON p.operator_id = u.id
        WHERE sa.account_id = ?
    """
    params = [account_id]
    if media:
        query += " AND COALESCE(sa.media, COALESCE(p.media, '小红书')) = ?"
        params.append(media)
    if exclude_project_id:
        query += " AND sa.project_id != ?"
        params.append(exclude_project_id)
    row = conn.execute(query, params).fetchone()
    conn.close()
    return dict(row) if row else None


def get_project_with_owner(project_id):
    """获取项目信息及运营者归属，用于权限校验"""
    conn = get_db()
    row = conn.execute(
        """SELECT p.*, u.real_name as operator_name, u.department, u.id as operator_user_id
           FROM projects p
           LEFT JOIN users u ON p.operator_id = u.id
           WHERE p.id = ?""",
        (project_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def get_sub_account_owner(sub_account_id):
    """获取子账号当前有效运营者信息，用于权限校验。"""
    operator_expr = _effective_operator_expr("date('now','localtime')")
    target_expr = _handover_target_expr("date('now','localtime')")
    conn = get_db()
    row = conn.execute(
        f"""SELECT sa.id as sub_id,
                  sa.project_id,
                  p.operator_id as project_operator_id,
                  {operator_expr} as operator_id,
                  {target_expr} as target_type,
                  u.department
           FROM sub_accounts sa
           JOIN projects p ON sa.project_id = p.id
           LEFT JOIN users u ON u.id = {operator_expr}
           WHERE sa.id = ?""",
        (sub_account_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


# ---- 系统提醒（余额不足等） ----

def upsert_system_alert(alert_type, account_id, account_name, balance, daily_cost, message):
    """插入或更新系统提醒（相同 alert_type+account_id 视为同一条）"""
    conn = get_db()
    conn.execute(
        """INSERT INTO system_alerts (alert_type, account_id, account_name, balance, daily_cost, message, resolved)
           VALUES (?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT(alert_type, account_id) DO UPDATE SET
             balance=excluded.balance, daily_cost=excluded.daily_cost,
             message=excluded.message, resolved=0, created_at=datetime('now','localtime')""",
        (alert_type, account_id, account_name, balance, daily_cost, message),
    )
    conn.commit()
    conn.close()


def resolve_system_alert(alert_type, account_id):
    """标记提醒已解决"""
    conn = get_db()
    conn.execute(
        "UPDATE system_alerts SET resolved=1 WHERE alert_type=? AND account_id=?",
        (alert_type, account_id),
    )
    conn.commit()
    conn.close()


def get_active_system_alerts():
    """获取所有未解决的系统提醒"""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM system_alerts WHERE resolved=0 ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def clear_resolved_alerts():
    """清除已解决的提醒（保留最近24小时）"""
    conn = get_db()
    conn.execute(
        "DELETE FROM system_alerts WHERE resolved=1 AND created_at < datetime('now','localtime','-1 day')"
    )
    conn.commit()
    conn.close()


def get_7day_daily_cost(account_id):
    """获取指定账号最近7天的日均消耗"""
    return get_7day_daily_cost_map([account_id]).get(str(account_id), 0.0)


def get_7day_daily_cost_map(account_ids):
    """批量获取账号最近7天日均消耗，避免 dashboard 逐账号查询。"""
    from datetime import date, timedelta
    ids = [str(account_id) for account_id in account_ids if account_id]
    if not ids:
        return {}

    placeholders = ",".join("?" for _ in ids)
    start = (date.today() - timedelta(days=7)).isoformat()
    conn = get_db()
    rows = conn.execute(
        f"""SELECT sa.account_id,
                   COALESCE(SUM((COALESCE(dc.cost_simple, 0) + COALESCE(dc.cost_standard, 0) + COALESCE(dc.cost_square, 0))), 0) as total,
                   COUNT(DISTINCT dc.date) as days
            FROM sub_accounts sa
            LEFT JOIN daily_consumption dc ON dc.sub_account_id = sa.id AND dc.date >= ?
            WHERE sa.account_id IN ({placeholders})
            GROUP BY sa.account_id""",
        (start, *ids),
    ).fetchall()
    conn.close()
    result = {}
    for row in rows:
        days = row["days"] or 0
        result[str(row["account_id"])] = round((row["total"] or 0) / days, 2) if days else 0.0
    return result


# ---- 任务管理（内容运营工作台） ----

def create_task(title, description, project_id, creator_id, assignee_id=None,
               task_type='图文笔记', priority='中', start_date=None, due_date=None,
               estimated_hours=0, note_count=0, parent_id=None,
               quantity=1, source='self', remark='', doc_links='[]', note_id='', note_links_text=''):
    """创建任务"""
    from datetime import date
    if not start_date:
        start_date = date.today().isoformat()
    note_entries = extract_xhs_note_entries(note_links_text or note_id)
    normalized_note_id = ",".join(e["note_id"] for e in note_entries) if note_entries else str(note_id or "").strip()
    note_url = note_entries[0]["note_url"] if note_entries else build_xhs_pc_note_url(normalized_note_id.split(",", 1)[0])
    with db_connection() as conn:
        cur = conn.execute(
            """INSERT INTO tasks
               (title, description, project_id, creator_id, assignee_id,
                type, status, priority, start_date, due_date,
                estimated_hours, note_count, parent_id, quantity, source, remark, doc_links, note_id, note_url)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (title, description, project_id, creator_id, assignee_id or creator_id,
             task_type, '进行中', priority, start_date, due_date,
             estimated_hours, note_count, parent_id, quantity, source, remark, doc_links, normalized_note_id, note_url),
        )
        return cur.lastrowid


def get_task(task_id):
    """获取单个任务（含项目名、创建人、负责人）"""
    conn = get_db()
    row = conn.execute(
        """SELECT t.*,
                  p.project_name,
                  c.real_name as creator_name,
                  a.real_name as assignee_name,
                  a.role as assignee_role
           FROM tasks t
           LEFT JOIN projects p ON t.project_id = p.id
           LEFT JOIN users c ON t.creator_id = c.id
           LEFT JOIN users a ON t.assignee_id = a.id
           WHERE t.id = ?""",
        (task_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def update_task(task_id, **kwargs):
    """更新任务字段"""
    allowed = {'title', 'description', 'project_id', 'assignee_id', 'type',
               'status', 'priority', 'start_date', 'due_date',
               'estimated_hours', 'actual_hours', 'note_count', 'note_id',
               'parent_id', 'quantity', 'source', 'is_archived', 'archived_at',
               'remark', 'doc_links', 'pending_count', 'category', 'workload_weight',
               'source_task_id', 'review_comment', 'description', 'brief_json', 'attachment_links'}
    sets = []
    vals = []
    entries = extract_xhs_note_entries(kwargs.get('note_links_text', '')) if 'note_links_text' in kwargs else []
    for k in allowed:
        if k in kwargs:
            sets.append(f"{k}=?")
            vals.append(kwargs[k])
    # 自动生成 note_url
    if 'note_id' in kwargs and kwargs['note_id']:
        first_note_id = str(kwargs['note_id']).split(',', 1)[0].strip()
        first_entry = next((e for e in entries if e["note_id"] == first_note_id), None)
        note_url = first_entry["note_url"] if first_entry else build_xhs_pc_note_url(first_note_id)
        sets.append("note_url=?")
        vals.append(note_url)
    elif 'note_id' in kwargs and not kwargs['note_id']:
        sets.append("note_url=?")
        vals.append('')
    if sets:
        sets.append("updated_at=datetime('now','localtime')")
        vals.append(task_id)
        with db_connection() as conn:
            conn.execute(f"UPDATE tasks SET {','.join(sets)} WHERE id=?", vals)


def delete_task(task_id):
    """删除任务（级联删除所有子任务及其笔记表现数据）"""
    with db_connection() as conn:
        # 递归查找所有后代任务ID
        descendants = [task_id]
        queue = [task_id]
        while queue:
            current = queue.pop(0)
            children = conn.execute(
                "SELECT id FROM tasks WHERE parent_id=?", (current,)
            ).fetchall()
            for child in children:
                descendants.append(child['id'])
                queue.append(child['id'])
        # 批量删除笔记表现数据
        placeholders = ','.join('?' for _ in descendants)
        conn.execute(f"DELETE FROM task_note_performance WHERE task_id IN ({placeholders})", descendants)
        # 批量删除所有后代任务
        conn.execute(f"DELETE FROM tasks WHERE id IN ({placeholders})", descendants)


def delete_subtask(task_id):
    """删除单个子任务，同时减少父任务的 quantity"""
    with db_connection() as conn:
        task = conn.execute("SELECT parent_id FROM tasks WHERE id=?", (task_id,)).fetchone()
        if task and task['parent_id']:
            conn.execute("UPDATE tasks SET quantity = MAX(quantity - 1, 0) WHERE id=?", (task['parent_id'],))
        # 删除关联的笔记表现数据
        conn.execute("DELETE FROM task_note_performance WHERE task_id=?", (task_id,))
        conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))


def get_tasks(filters=None):
    """通用任务查询，支持多种筛选条件"""
    if filters is None:
        filters = {}
    conn = get_db()
    where = []
    params = []
    if 'assignee_id' in filters and filters['assignee_id']:
        where.append("t.assignee_id=?")
        params.append(filters['assignee_id'])
    if 'assignee_ids' in filters and filters['assignee_ids']:
        assignee_ids = list(filters['assignee_ids'])
        where.append(f"t.assignee_id IN ({','.join('?' for _ in assignee_ids)})")
        params.extend(assignee_ids)
    if 'creator_id' in filters and filters['creator_id']:
        where.append("t.creator_id=?")
        params.append(filters['creator_id'])
    if 'project_id' in filters and filters['project_id']:
        pids = str(filters['project_id']).split(',')
        where.append(f"t.project_id IN ({','.join('?' for _ in pids)})")
        params.extend(pids)
    if 'status' in filters and filters['status']:
        where.append("t.status=?")
        params.append(filters['status'])
    if 'priority' in filters and filters['priority']:
        where.append("t.priority=?")
        params.append(filters['priority'])
    if 'type' in filters and filters['type']:
        where.append("t.type=?")
        params.append(filters['type'])
    if 'parent_id' in filters:
        where.append("t.parent_id=?")
        params.append(filters['parent_id'])
    if 'due_before' in filters and filters['due_before']:
        where.append("t.due_date<=?")
        params.append(filters['due_before'])
    if 'due_after' in filters and filters['due_after']:
        where.append("t.due_date>=?")
        params.append(filters['due_after'])
    if 'task_date_after' in filters and filters['task_date_after']:
        where.append("date(COALESCE(t.due_date, t.created_at))>=date(?)")
        params.append(filters['task_date_after'])
    if 'task_date_before' in filters and filters['task_date_before']:
        where.append("date(COALESCE(t.due_date, t.created_at))<=date(?)")
        params.append(filters['task_date_before'])
    if 'search' in filters and filters['search']:
        where.append("t.title LIKE ?")
        params.append(f"%{filters['search']}%")
    if 'no_parent' in filters and filters['no_parent']:
        where.append("t.parent_id IS NULL")
    if 'category' in filters and filters['category']:
        where.append("t.category=?")
        params.append(filters['category'])
    if not filters.get('include_archived'):
        where.append("t.is_archived=0")
    if 'is_archived' in filters and filters.get('is_archived') == 1:
        where.append("t.is_archived=1")
    where_clause = (" AND ".join(where)) if where else "1=1"
    sql = f"""WITH subtask_counts AS (
                    SELECT parent_id, COUNT(*) AS subtask_count
                    FROM tasks
                    WHERE parent_id IS NOT NULL
                    GROUP BY parent_id
                ), checklist_counts AS (
                    SELECT task_id,
                           SUM(CASE WHEN done=1 THEN 1 ELSE 0 END) AS checklist_done,
                           COUNT(*) AS checklist_total
                    FROM task_checklists
                    GROUP BY task_id
                )
             SELECT t.*,
                    p.project_name,
                    c.real_name as creator_name,
                    a.real_name as assignee_name,
                    a.role as assignee_role,
                    COALESCE(sc.subtask_count, 0) as subtask_count,
                    COALESCE(cc.checklist_done, 0) as checklist_done,
                    COALESCE(cc.checklist_total, 0) as checklist_total
             FROM tasks t
             LEFT JOIN projects p ON t.project_id = p.id
             LEFT JOIN users c ON t.creator_id = c.id
             LEFT JOIN users a ON t.assignee_id = a.id
             LEFT JOIN subtask_counts sc ON sc.parent_id = t.id
             LEFT JOIN checklist_counts cc ON cc.task_id = t.id
             WHERE {where_clause}
             ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
                      t.due_date ASC,
                      CASE t.priority WHEN '高' THEN 1 WHEN '中' THEN 2 ELSE 3 END,
                      t.created_at DESC"""
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_tasks_by_tab(tab, user_id):
    """按标签页获取任务（today/week 包含自建、分配和协作）"""
    from datetime import date, timedelta
    today = date.today()
    if tab == 'today':
        td = today.isoformat()
        return _get_user_tasks_by_date(user_id, td, td)
    elif tab == 'week':
        monday = today - timedelta(days=today.weekday())
        sunday = monday + timedelta(days=6)
        return _get_user_tasks_by_date(user_id, monday.isoformat(), sunday.isoformat())
    elif tab == 'created':
        return get_tasks({'creator_id': user_id})
    elif tab == 'collab':
        return get_collaborator_tasks(user_id)
    elif tab == 'archived':
        return get_archived_tasks(user_id)
    elif tab == 'parent':
        return get_tasks({'creator_id': user_id, 'no_parent': True})
    else:
        return get_tasks({'assignee_id': user_id})


def _get_user_tasks_by_date(user_id, start_date, end_date):
    """获取用户相关的任务（自建+分配+协作），按日期范围过滤"""
    conn = get_db()
    rows = conn.execute(
        """SELECT t.*, p.project_name,
                  c.real_name as creator_name, a.real_name as assignee_name,
                  (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id=t.id) as subtask_count
           FROM tasks t
           LEFT JOIN projects p ON t.project_id = p.id
           LEFT JOIN users c ON t.creator_id = c.id
           LEFT JOIN users a ON t.assignee_id = a.id
           WHERE t.is_archived=0
           AND (t.parent_id IS NULL OR t.parent_id=0)
           AND (t.creator_id=? OR t.assignee_id=?
                OR t.id IN (SELECT tc.task_id FROM task_collaborators tc WHERE tc.user_id=?))
           AND t.due_date BETWEEN ? AND ?
           ORDER BY CASE t.priority WHEN '高' THEN 1 WHEN '中' THEN 2 ELSE 3 END,
                    t.created_at DESC""",
        (user_id, user_id, user_id, start_date, end_date),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---- 任务清单 ----

def create_checklist_item(task_id, title, sort_order=0):
    with db_connection() as conn:
        cur = conn.execute(
            "INSERT INTO task_checklists (task_id, title, sort_order) VALUES (?,?,?)",
            (task_id, title, sort_order),
        )
        return cur.lastrowid


def get_checklist_items(task_id):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM task_checklists WHERE task_id=? ORDER BY sort_order, id",
        (task_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def update_checklist_item(item_id, **kwargs):
    allowed = {'title', 'done', 'sort_order', 'task_id'}
    sets = []
    vals = []
    for k in allowed:
        if k in kwargs:
            sets.append(f"{k}=?")
            vals.append(kwargs[k])
    if sets:
        vals.append(item_id)
        with db_connection() as conn:
            conn.execute(f"UPDATE task_checklists SET {','.join(sets)} WHERE id=?", vals)


def delete_checklist_item(item_id):
    with db_connection() as conn:
        conn.execute("DELETE FROM task_checklists WHERE id=?", (item_id,))


# ---- 统计 ----

def get_task_stats(user_id=None):
    """任务统计：全部/进行中/已完成/已取消/待发布/已逾期（仅统计父任务）"""
    conn = get_db()
    today = date.today().isoformat()
    base = "AND (parent_id IS NULL OR parent_id=0)"
    if user_id:
        sql = f"""SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status='进行中' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN status='已完成' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status='已取消' THEN 1 ELSE 0 END) as cancelled,
            SUM(CASE WHEN status IN ('待发布','发布中') THEN 1 ELSE 0 END) as publishing,
            SUM(CASE WHEN status='进行中' AND due_date < ? THEN 1 ELSE 0 END) as overdue
            FROM tasks WHERE assignee_id=? {base}"""
        row = conn.execute(sql, (today, user_id)).fetchone()
    else:
        sql = f"""SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status='进行中' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN status='已完成' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status='已取消' THEN 1 ELSE 0 END) as cancelled,
            SUM(CASE WHEN status IN ('待发布','发布中') THEN 1 ELSE 0 END) as publishing,
            SUM(CASE WHEN status='进行中' AND due_date < ? THEN 1 ELSE 0 END) as overdue
            FROM tasks WHERE 1=1 {base}"""
        row = conn.execute(sql, (today,)).fetchone()
    conn.close()
    return dict(row) if row else {'total': 0, 'in_progress': 0, 'completed': 0, 'cancelled': 0, 'publishing': 0, 'overdue': 0}


def get_task_distribution(user_id=None, start_date=None, end_date=None):
    """优先级和状态分布（仅父任务），支持时间范围筛选"""
    conn = get_db()
    parent_filter = "AND (parent_id IS NULL OR parent_id=0)"
    params = []
    user_filter = ""
    if user_id:
        user_filter = "AND assignee_id=?"
        params.append(user_id)
    date_filter = ""
    if start_date:
        date_filter += " AND created_at >= ?"
        params.append(start_date)
    if end_date:
        date_filter += " AND created_at <= ?"
        params.append(end_date + " 23:59:59")
    rows = conn.execute(
        f"SELECT priority, status FROM tasks WHERE 1=1 {user_filter} {parent_filter} {date_filter}",
        params,
    ).fetchall()
    conn.close()
    priority_dist = {}
    status_dist = {}
    for r in rows:
        p, s = r['priority'], r['status']
        priority_dist[p] = priority_dist.get(p, 0) + 1
        status_dist[s] = status_dist.get(s, 0) + 1
    return {'priority': priority_dist, 'status': status_dist}


def get_task_completion_trend(days=30, user_id=None):
    """每日完成任务数趋势（仅父任务）"""
    from datetime import date, timedelta
    start = (date.today() - timedelta(days=days)).isoformat()
    conn = get_db()
    parent_filter = "AND (t.parent_id IS NULL OR t.parent_id=0)"
    if user_id:
        rows = conn.execute(
            f"""SELECT DATE(t.updated_at) as date, COUNT(*) as count
               FROM tasks t WHERE t.status='已完成' AND t.assignee_id=?
               {parent_filter}
               AND DATE(t.updated_at) >= ?
               GROUP BY DATE(t.updated_at) ORDER BY date""",
            (user_id, start),
        ).fetchall()
    else:
        rows = conn.execute(
            f"""SELECT DATE(t.updated_at) as date, COUNT(*) as count
               FROM tasks t WHERE t.status='已完成'
               {parent_filter}
               AND DATE(t.updated_at) >= ?
               GROUP BY DATE(t.updated_at) ORDER BY date""",
            (start,),
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_workload_summary(user_id=None):
    """按用户统计工作量（仅父任务）"""
    conn = get_db()
    parent_filter = "AND (t.parent_id IS NULL OR t.parent_id=0)"
    if user_id:
        rows = conn.execute(
            f"""SELECT u.id as user_id, u.real_name as user_name,
                  COUNT(*) as total_tasks,
                  SUM(CASE WHEN t.status='进行中' THEN 1 ELSE 0 END) as in_progress,
                  SUM(CASE WHEN t.status='已完成' THEN 1 ELSE 0 END) as completed,
                  SUM(CASE WHEN t.status IN ('待发布','发布中') THEN 1 ELSE 0 END) as publishing,
                  COALESCE(SUM(t.estimated_hours),0) as total_estimated_hours,
                  COALESCE(SUM(t.actual_hours),0) as total_actual_hours
               FROM users u
               JOIN tasks t ON t.assignee_id = u.id
               WHERE u.id=? {parent_filter}
               GROUP BY u.id""",
            (user_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            f"""SELECT u.id as user_id, u.real_name as user_name,
                  COUNT(*) as total_tasks,
                  SUM(CASE WHEN t.status='进行中' THEN 1 ELSE 0 END) as in_progress,
                  SUM(CASE WHEN t.status='已完成' THEN 1 ELSE 0 END) as completed,
                  SUM(CASE WHEN t.status IN ('待发布','发布中') THEN 1 ELSE 0 END) as publishing,
                  COALESCE(SUM(t.estimated_hours),0) as total_estimated_hours,
                  COALESCE(SUM(t.actual_hours),0) as total_actual_hours
               FROM users u
               JOIN tasks t ON t.assignee_id = u.id
               WHERE 1=1 {parent_filter}
               GROUP BY u.id""",
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_content_operators():
    """获取所有内容运营用户"""
    conn = get_db()
    rows = conn.execute(
        "SELECT id, real_name, username FROM users WHERE role='content_operator' AND status='active' ORDER BY id"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_assignable_users():
    """获取可分配的用户（内容运营+其他活跃用户）"""
    conn = get_db()
    rows = conn.execute(
        "SELECT id, real_name, username, role FROM users WHERE status='active' ORDER BY role, real_name"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---- 内容管理 ----

def get_weekly_workload_by_operator(week_offset=0, start_date=None, end_date=None, status=None):
    """获取指定周各内容运营的工作量统计"""
    from datetime import date, timedelta
    today = date.today()
    if start_date and end_date:
        range_start, range_end = start_date, end_date
    else:
        monday = today - timedelta(days=today.weekday()) + timedelta(weeks=week_offset)
        sunday = monday + timedelta(days=6)
        range_start, range_end = monday.isoformat(), sunday.isoformat()

    status_sql = " AND t.status=?" if status else ""
    params = [today.isoformat(), range_start, range_end]
    if status:
        params.append(status)
    conn = get_db()
    rows = conn.execute(
        f"""SELECT u.id as operator_id, u.real_name as operator_name,
                  COUNT(*) as task_count,
                  COALESCE(SUM(t.quantity), 0) as total_quantity,
                  SUM(CASE WHEN t.status='已完成' THEN 1 ELSE 0 END) as completed,
                  SUM(CASE WHEN t.status='进行中' THEN 1 ELSE 0 END) as in_progress,
                  SUM(CASE WHEN t.status='待发布' THEN 1 ELSE 0 END) as pending_publish,
                  SUM(CASE WHEN t.due_date < ? AND t.status IN ('进行中','待发布') THEN 1 ELSE 0 END) as overdue,
                  COALESCE(SUM(CASE WHEN t.status='已完成' THEN t.quantity ELSE 0 END), 0) as completed_qty,
                  COALESCE(SUM(CASE WHEN t.status='待发布' THEN COALESCE(t.pending_count,0) ELSE 0 END), 0) as pending_qty,
                  COALESCE(SUM(CASE WHEN t.status='进行中' THEN t.quantity - COALESCE(t.pending_count,0) ELSE 0 END), 0) as inprogress_qty,
                  SUM(CASE WHEN t.type='图文笔记' THEN t.quantity ELSE 0 END) as type_image,
                  SUM(CASE WHEN t.type='文案+图片提需' THEN t.quantity ELSE 0 END) as type_copy_image,
                  SUM(CASE WHEN t.type='视频笔记' THEN t.quantity ELSE 0 END) as type_video,
                  SUM(CASE WHEN t.type='修改笔记' THEN t.quantity ELSE 0 END) as type_modify,
                  SUM(CASE WHEN t.type='内容规划' THEN t.quantity ELSE 0 END) as type_plan,
                  SUM(CASE WHEN t.type='Demo' THEN t.quantity ELSE 0 END) as type_demo
           FROM users u
           JOIN tasks t ON t.assignee_id = u.id
           WHERE u.role='content_operator' AND u.status='active'
             AND t.is_archived=0
             AND COALESCE(NULLIF(t.due_date,''), t.start_date) BETWEEN ? AND ?
             {status_sql}
           GROUP BY u.id, u.real_name
           ORDER BY u.real_name""",
        params,
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_operator_weekly_tasks(operator_id, week_offset=0, start_date=None, end_date=None):
    """获取指定运营指定周的任务列表"""
    from datetime import date, timedelta
    today = date.today()
    if start_date and end_date:
        range_start, range_end = start_date, end_date
    else:
        monday = today - timedelta(days=today.weekday()) + timedelta(weeks=week_offset)
        sunday = monday + timedelta(days=6)
        range_start, range_end = monday.isoformat(), sunday.isoformat()
    return get_tasks({
        'assignee_id': operator_id,
        'due_after': range_start,
        'due_before': range_end,
    })


def get_next_week_content_plan():
    """获取下周所有内容任务"""
    from datetime import date, timedelta
    today = date.today()
    next_monday = today - timedelta(days=today.weekday()) + timedelta(weeks=1)
    next_sunday = next_monday + timedelta(days=6)

    conn = get_db()
    rows = conn.execute(
        """SELECT t.id, t.title, t.type, t.quantity, t.priority, t.status, t.due_date,
                  p.project_name,
                  u.real_name as assignee_name, u.id as assignee_id
           FROM tasks t
           LEFT JOIN projects p ON t.project_id = p.id
           LEFT JOIN users u ON t.assignee_id = u.id
           WHERE t.is_archived=0 AND (t.parent_id IS NULL OR t.parent_id=0)
             AND t.due_date BETWEEN ? AND ?
           ORDER BY p.project_name, u.real_name, t.due_date""",
        (next_monday.isoformat(), next_sunday.isoformat()),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def batch_reassign_tasks(task_ids, new_assignee_id):
    """批量转移任务给新负责人"""
    conn = get_db()
    placeholders = ','.join('?' for _ in task_ids)
    conn.execute(
        f"UPDATE tasks SET assignee_id=?, updated_at=datetime('now','localtime') WHERE id IN ({placeholders})",
        [new_assignee_id] + list(task_ids),
    )
    conn.commit()
    conn.close()

def get_project_workload(week_offset=0, start_date=None, end_date=None, status=None):
    """按项目聚合任务进度，用于内容管理项目进度Tab"""
    from datetime import date, timedelta
    today = date.today()
    if start_date and end_date:
        range_start, range_end = start_date, end_date
    else:
        monday = today - timedelta(days=today.weekday()) + timedelta(weeks=week_offset)
        sunday = monday + timedelta(days=6)
        range_start, range_end = monday.isoformat(), sunday.isoformat()
    status_sql = " AND t.status=?" if status else ""
    params = [today.isoformat(), range_start, range_end]
    if status:
        params.append(status)
    conn = get_db()
    rows = conn.execute(
        f"""SELECT p.id as project_id, p.project_name,
                  COUNT(*) as task_count,
                  COALESCE(SUM(t.quantity),0) as total_quantity,
                  SUM(CASE WHEN t.status='已完成' THEN 1 ELSE 0 END) as completed,
                  SUM(CASE WHEN t.status='进行中' THEN 1 ELSE 0 END) as in_progress,
                  SUM(CASE WHEN t.status='待发布' THEN 1 ELSE 0 END) as pending_publish,
                  SUM(CASE WHEN t.due_date < ? AND t.status IN ('进行中','待发布') THEN 1 ELSE 0 END) as overdue,
                  COALESCE(SUM(CASE WHEN t.status='已完成' THEN t.quantity ELSE 0 END),0) as completed_qty,
                  COALESCE(SUM(CASE WHEN t.status='待发布' THEN COALESCE(t.pending_count,0) ELSE 0 END),0) as pending_qty
           FROM projects p
           JOIN tasks t ON t.project_id = p.id AND t.is_archived=0
             AND (t.parent_id IS NULL OR t.parent_id=0)
             AND COALESCE(NULLIF(t.due_date,''), t.start_date) BETWEEN ? AND ?
             {status_sql}
           GROUP BY p.id, p.project_name
           ORDER BY p.project_name""",
        params,
    ).fetchall()
    projects = [dict(r) for r in rows]
    conn.close()
    for proj in projects:
        proj['tasks'] = get_project_schedule_tasks(proj['project_id'], range_start, range_end, status=status)
    return projects

def get_project_schedule_tasks(project_id, start_date, end_date, status=None):
    status_sql = " AND t.status=?" if status else ""
    params = [project_id, start_date, end_date]
    if status:
        params.append(status)
    conn = get_db()
    rows = conn.execute(
        f"""SELECT t.*, p.project_name, u.real_name AS assignee_name
           FROM tasks t
           LEFT JOIN projects p ON t.project_id = p.id
           LEFT JOIN users u ON t.assignee_id = u.id
           WHERE t.project_id=? AND t.is_archived=0 AND (t.parent_id IS NULL OR t.parent_id=0)
             AND COALESCE(NULLIF(t.due_date,''), t.start_date) BETWEEN ? AND ?
             {status_sql}
           ORDER BY COALESCE(NULLIF(t.due_date,''), t.start_date), t.id""",
        params,
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_subtree_progress(task_id):
    """计算任务的完成进度（基于子任务完成数/总子任务数）"""
    conn = get_db()
    total = conn.execute("SELECT COUNT(*) FROM tasks WHERE parent_id=?", (task_id,)).fetchone()[0]
    if total == 0:
        task = conn.execute("SELECT status FROM tasks WHERE id=?", (task_id,)).fetchone()
        conn.close()
        return 100 if task and task['status'] == '已完成' else 0
    completed = conn.execute(
        "SELECT COUNT(*) FROM tasks WHERE parent_id=? AND status='已完成'", (task_id,)
    ).fetchone()[0]
    conn.close()
    return round(completed / total * 100)


# ---- 归档 ----

def archive_task(task_id):
    with db_connection() as conn:
        conn.execute(
            "UPDATE tasks SET is_archived=1, archived_at=datetime('now','localtime') WHERE id=?",
            (task_id,),
        )


def unarchive_task(task_id):
    with db_connection() as conn:
        conn.execute("UPDATE tasks SET is_archived=0, archived_at=NULL WHERE id=?", (task_id,))


def get_archived_tasks(user_id=None):
    conn = get_db()
    base_sql = """SELECT t.*, p.project_name,
                  c.real_name as creator_name, a.real_name as assignee_name,
                  (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id=t.id) as subtask_count
           FROM tasks t
           LEFT JOIN projects p ON t.project_id = p.id
           LEFT JOIN users c ON t.creator_id = c.id
           LEFT JOIN users a ON t.assignee_id = a.id
           WHERE t.is_archived=1"""
    if user_id:
        rows = conn.execute(base_sql + " AND (t.creator_id=? OR t.assignee_id=?) ORDER BY t.archived_at DESC",
                            (user_id, user_id)).fetchall()
    else:
        rows = conn.execute(base_sql + " ORDER BY t.archived_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---- 协作人 ----

def add_task_collaborator(task_id, user_id, role='collaborator'):
    with db_connection() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO task_collaborators (task_id, user_id, role) VALUES (?,?,?)",
            (task_id, user_id, role),
        )


def remove_task_collaborator(task_id, user_id):
    with db_connection() as conn:
        conn.execute("DELETE FROM task_collaborators WHERE task_id=? AND user_id=?", (task_id, user_id))


def get_task_collaborators(task_id):
    conn = get_db()
    rows = conn.execute(
        """SELECT tc.id, tc.task_id, tc.user_id, tc.role, tc.created_at,
                  u.real_name, u.username
           FROM task_collaborators tc
           JOIN users u ON tc.user_id = u.id WHERE tc.task_id=?""",
        (task_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_collaborator_tasks(user_id):
    """获取用户作为协作者参与的所有任务"""
    conn = get_db()
    rows = conn.execute(
        """SELECT t.*, p.project_name,
                  c.real_name as creator_name, a.real_name as assignee_name,
                  (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id=t.id) as subtask_count
           FROM tasks t
           JOIN task_collaborators tc ON tc.task_id = t.id
           LEFT JOIN projects p ON t.project_id = p.id
           LEFT JOIN users c ON t.creator_id = c.id
           LEFT JOIN users a ON t.assignee_id = a.id
           WHERE tc.user_id=? AND t.is_archived=0
           ORDER BY t.created_at DESC""",
        (user_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---- 任务关联 ----

def add_task_relation(task_id_a, task_id_b, relation_type='related'):
    with db_connection() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO task_relations (task_id_a, task_id_b, relation_type) VALUES (?,?,?)",
            (task_id_a, task_id_b, relation_type),
        )


def remove_task_relation(relation_id):
    with db_connection() as conn:
        conn.execute("DELETE FROM task_relations WHERE id=?", (relation_id,))


def get_task_relations(task_id):
    conn = get_db()
    rows = conn.execute(
        """SELECT tr.*, t.title as related_title, t.status as related_status
           FROM task_relations tr
           JOIN tasks t ON (CASE WHEN tr.task_id_a=? THEN tr.task_id_b ELSE tr.task_id_a END) = t.id
           WHERE tr.task_id_a=? OR tr.task_id_b=?""",
        (task_id, task_id, task_id),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def _quote_ident(name):
    return '"' + str(name).replace('"', '""') + '"'


def _note_report_columns():
    from column_defs import ALL_COLUMNS
    return [col for col in ALL_COLUMNS if "creativity" in (col.get("level") or [])]


def _note_column_sql_type(col):
    fmt = col.get("format")
    if fmt in {"text", "link"} or col.get("aggregate") == "skip":
        return "TEXT DEFAULT ''"
    return "REAL DEFAULT 0"


def _to_float(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _note_formula_value(formula, row):
    import ast
    tree = ast.parse(str(formula or "0"), mode="eval")

    def eval_node(node):
        if isinstance(node, ast.Expression):
            return eval_node(node.body)
        if isinstance(node, ast.BinOp):
            left = eval_node(node.left)
            right = eval_node(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return 0 if right == 0 else left / right
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -eval_node(node.operand)
        if isinstance(node, ast.Name):
            return _to_float(row.get(node.id))
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        raise ValueError("unsupported formula")

    try:
        return round(eval_node(tree), 4)
    except Exception:
        return 0


def _apply_note_formula_columns(row):
    if "fee" in row:
        row["cost"] = _to_float(row.get("fee"))
    elif "cost" in row:
        row["fee"] = _to_float(row.get("cost"))
    for col in _note_report_columns():
        if col.get("aggregate") == "formula" and col.get("formula"):
            row[col["key"]] = _note_formula_value(col.get("formula"), row)
    if _to_float(row.get("impression")) > 0:
        row["ctr"] = round(_to_float(row.get("click")) / _to_float(row.get("impression")) * 100, 2)
    return row


def _ensure_note_performance_columns(conn):
    base_columns = [
        ('note_title', "TEXT DEFAULT ''"),
        ('note_image', "TEXT DEFAULT ''"),
        ('note_jump_url', "TEXT DEFAULT ''"),
        ('sync_status', "TEXT DEFAULT 'pending'"),
        ('sync_message', "TEXT DEFAULT '等待同步投放数据'"),
    ]
    for table in ("task_note_performance", "task_note_performance_daily"):
        for col, default in base_columns:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {_quote_ident(col)} {default}")
            except Exception:
                pass
        for col_def in _note_report_columns():
            key = col_def.get("key")
            if not key or key in {"id", "task_id", "report_date", "fetched_at"}:
                continue
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {_quote_ident(key)} {_note_column_sql_type(col_def)}")
            except Exception:
                pass
        try:
            conn.execute(f"UPDATE {table} SET fee=cost WHERE COALESCE(fee, 0)=0 AND COALESCE(cost, 0)!=0")
        except Exception:
            pass


def save_note_links(task_id, note_entries):
    if not note_entries:
        return
    with db_connection() as conn:
        _ensure_note_performance_columns(conn)
        for entry in note_entries:
            note_id = entry.get("note_id", "")
            note_url = preserve_note_url(note_id, entry.get("note_url", ""))
            if not note_id or not note_url:
                continue
            conn.execute("""
                INSERT INTO task_note_performance
                    (task_id, note_id, note_title, note_image, note_jump_url, impression, interaction, cost, ctr, message_consult, click, sync_status, sync_message)
                VALUES (?, ?, '', '', ?, 0, 0, 0, 0, 0, 0, 'pending', '等待同步投放数据')
                ON CONFLICT(task_id, note_id) DO UPDATE SET
                    note_jump_url=excluded.note_jump_url,
                    sync_status=CASE WHEN sync_status='synced' THEN sync_status ELSE 'pending' END,
                    sync_message=CASE WHEN sync_status='synced' THEN sync_message ELSE '等待同步投放数据' END,
                    fetched_at=datetime('now','localtime')
            """, (task_id, note_id, note_url))


def _note_entries_from_task_note_id(note_id_text):
    entries = extract_xhs_note_entries(note_id_text)
    if entries:
        return entries
    return []


def ensure_task_note_placeholders(task_id):
    task = get_task(task_id)
    if not task or not task.get("note_id"):
        return []
    entries = _note_entries_from_task_note_id(task.get("note_id"))
    if entries:
        save_note_links(task_id, entries)
    return entries


def mark_note_performance_missing(task_id, note_id, message="未在投放报表中匹配到数据"):
    note_url = preserve_note_url(note_id)
    with db_connection() as conn:
        _ensure_note_performance_columns(conn)
        conn.execute("""
            INSERT INTO task_note_performance
                (task_id, note_id, note_title, note_image, note_jump_url, impression, interaction, cost, ctr, message_consult, click, sync_status, sync_message)
            VALUES (?, ?, '', '', ?, 0, 0, 0, 0, 0, 0, 'not_found', ?)
            ON CONFLICT(task_id, note_id) DO UPDATE SET
                note_jump_url=CASE WHEN task_note_performance.note_jump_url LIKE '%xsec_token=%'
                    THEN task_note_performance.note_jump_url ELSE excluded.note_jump_url END,
                sync_status=CASE WHEN task_note_performance.sync_status='synced'
                    THEN task_note_performance.sync_status ELSE 'not_found' END,
                sync_message=CASE WHEN task_note_performance.sync_status='synced'
                    THEN task_note_performance.sync_message ELSE excluded.sync_message END,
                fetched_at=datetime('now','localtime')
        """, (task_id, note_id, note_url, message))


def get_note_performance_refresh_task_ids(start_date=None, end_date=None, project_id=None,
                                          operator_id=None, user_id=None,
                                          allowed_project_ids=None, limit=20,
                                          stale_hours=6, scan_limit=200):
    has_project_acl = allowed_project_ids is not None
    allowed_project_ids = set(allowed_project_ids or [])
    conn = get_db()
    _ensure_note_performance_columns(conn)
    where = ["t.status='已完成'", "COALESCE(t.note_id, '') != ''"]
    params = []
    if project_id:
        where.append("t.project_id=?")
        params.append(project_id)
    elif has_project_acl:
        if not allowed_project_ids:
            conn.close()
            return []
        placeholders = ",".join("?" for _ in allowed_project_ids)
        where.append(f"t.project_id IN ({placeholders})")
        params.extend(sorted(allowed_project_ids))
    if operator_id:
        where.append("t.assignee_id=?")
        params.append(operator_id)
    if user_id:
        where.append("(t.assignee_id=? OR t.creator_id=? OR p.operator_id=? OR t.id IN (SELECT tc.task_id FROM task_collaborators tc WHERE tc.user_id=?))")
        params.extend([user_id, user_id, user_id, user_id])
    params.append(int(scan_limit))
    tasks = conn.execute(
        f"""SELECT t.id, t.note_id
            FROM tasks t
            LEFT JOIN projects p ON p.id=t.project_id
            WHERE {' AND '.join(where)}
            ORDER BY t.updated_at DESC, t.id DESC
            LIMIT ?""",
        params,
    ).fetchall()
    now = datetime.now()
    refresh_ids = []
    for task in tasks:
        entries = _note_entries_from_task_note_id(task["note_id"])
        note_ids = {entry["note_id"].strip().lower() for entry in entries if entry.get("note_id")}
        if not note_ids:
            continue
        daily_params = [task["id"]]
        daily_filter = ""
        if start_date:
            daily_filter += " AND report_date >= ?"
            daily_params.append(start_date)
        if end_date:
            daily_filter += " AND report_date <= ?"
            daily_params.append(end_date)
        daily_rows = conn.execute(
            f"SELECT DISTINCT lower(note_id) as note_id FROM task_note_performance_daily WHERE task_id=?{daily_filter}",
            daily_params,
        ).fetchall()
        daily_ids = {row["note_id"] for row in daily_rows if row["note_id"]}
        status_rows = conn.execute(
            "SELECT lower(note_id) as note_id, sync_status, fetched_at FROM task_note_performance WHERE task_id=?",
            (task["id"],),
        ).fetchall()
        status_map = {row["note_id"]: dict(row) for row in status_rows if row["note_id"]}
        needs_refresh = False
        for note_id in note_ids:
            if note_id in daily_ids:
                continue
            status = status_map.get(note_id, {})
            if status.get("sync_status") == "not_found" and status.get("fetched_at"):
                try:
                    fetched_at = datetime.fromisoformat(str(status["fetched_at"]).replace(" ", "T"))
                    if (now - fetched_at).total_seconds() < stale_hours * 3600:
                        continue
                except Exception:
                    pass
            needs_refresh = True
            break
        if needs_refresh:
            refresh_ids.append(task["id"])
            if len(refresh_ids) >= limit:
                break
    conn.close()
    return refresh_ids


# ---- 笔记表现缓存 ----

def _note_report_date(data):
    return data.get('report_date') or data.get('date') or data.get('stat_date') or data.get('time') or date.today().isoformat()


def _note_data_value(data, key, col_def=None):
    if key == "cost":
        return float(data.get("cost", data.get("fee", 0)) or 0)
    if key == "fee":
        return float(data.get("fee", data.get("cost", 0)) or 0)
    if key == "creativity_name":
        return data.get("creativity_name") or data.get("note_title") or ""
    if key == "time":
        return _note_report_date(data)
    value = data.get(key, "")
    fmt = (col_def or {}).get("format")
    if fmt in {"text", "link"} or (col_def or {}).get("aggregate") == "skip":
        return "" if value is None else str(value)
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0


def save_note_performance(task_id, note_id, data, note_title='', note_image='', note_jump_url=''):
    """保存笔记表现数据缓存"""
    note_jump_url = preserve_note_url(note_id, note_jump_url)
    report_date = _note_report_date(data)
    note_title = note_title or data.get("note_title") or data.get("creativity_name") or ""
    note_columns = _note_report_columns()
    metric_values = {col["key"]: _note_data_value(data, col["key"], col) for col in note_columns if col.get("key")}
    metric_values["note_id"] = note_id
    metric_values["note_url"] = preserve_note_url(note_id, data.get("note_url") or data.get("note_jump_url") or note_jump_url)
    metric_values["creativity_name"] = metric_values.get("creativity_name") or note_title
    metric_values["time"] = report_date
    impression = float(metric_values.get('impression') or 0)
    click = float(metric_values.get('click') or 0)
    fee = float(metric_values.get('fee') or metric_values.get('cost') or 0)
    metric_values["cost"] = fee
    metric_values["fee"] = fee
    metric_values["ctr"] = round(click / impression * 100, 2) if impression > 0 else float(metric_values.get('ctr') or 0)
    with db_connection() as conn:
        _ensure_note_performance_columns(conn)
        columns = ["task_id", "note_id", "report_date", "note_title", "note_image", "note_jump_url"] + list(metric_values.keys())
        columns = list(dict.fromkeys(columns))
        values = []
        for col in columns:
            if col == "task_id":
                values.append(task_id)
            elif col == "note_id":
                values.append(note_id)
            elif col == "report_date":
                values.append(report_date)
            elif col == "note_title":
                values.append(note_title)
            elif col == "note_image":
                values.append(note_image)
            elif col == "note_jump_url":
                values.append(note_jump_url)
            else:
                values.append(metric_values.get(col, ""))
        assignments = []
        for col in columns:
            if col in {"task_id", "note_id", "report_date"}:
                continue
            if col in {"note_title", "note_image"}:
                assignments.append(f"{_quote_ident(col)}=COALESCE(NULLIF(excluded.{_quote_ident(col)},''), {_quote_ident(col)})")
            elif col == "note_jump_url":
                assignments.append(f"{_quote_ident(col)}=CASE WHEN {_quote_ident(col)} LIKE '%xsec_token=%' THEN {_quote_ident(col)} ELSE COALESCE(NULLIF(excluded.{_quote_ident(col)},''), {_quote_ident(col)}) END")
            else:
                assignments.append(f"{_quote_ident(col)}=excluded.{_quote_ident(col)}")
        assignments.append("fetched_at=datetime('now','localtime')")
        conn.execute(
            f"""INSERT INTO task_note_performance_daily
                ({', '.join(_quote_ident(col) for col in columns)})
               VALUES ({', '.join('?' for _ in columns)})
               ON CONFLICT(task_id, note_id, report_date) DO UPDATE SET
                {', '.join(assignments)}""",
            values,
        )

        summary_columns = [col for col in columns if col != "report_date"] + ["sync_status", "sync_message"]
        summary_values = [values[columns.index(col)] for col in summary_columns if col not in {"sync_status", "sync_message"}] + ["synced", "已同步投放数据"]
        summary_assignments = [assignment for assignment in assignments if "fetched_at=" not in assignment]
        summary_assignments.extend(["sync_status='synced'", "sync_message='已同步投放数据'", "fetched_at=datetime('now','localtime')"])
        conn.execute(
            f"""INSERT INTO task_note_performance
                ({', '.join(_quote_ident(col) for col in summary_columns)})
               VALUES ({', '.join('?' for _ in summary_columns)})
               ON CONFLICT(task_id, note_id) DO UPDATE SET
                {', '.join(summary_assignments)}""",
            summary_values,
        )


def _note_daily_date_filter(start_date, end_date, params):
    date_filter = ""
    if start_date:
        date_filter += " AND npd.report_date >= ?"
        params.append(start_date)
    if end_date:
        date_filter += " AND npd.report_date <= ?"
        params.append(end_date)
    return date_filter


def _note_performance_group_select():
    selects = [
        "MIN(npd.id) as id",
        "npd.task_id",
        "npd.note_id",
        "COALESCE(NULLIF(MAX(npd.note_title), ''), '') as note_title",
        "COALESCE(NULLIF(MAX(npd.note_image), ''), '') as note_image",
        "COALESCE(NULLIF(MAX(npd.note_jump_url), ''), '') as note_jump_url",
    ]
    added = {"id", "task_id", "note_id", "note_title", "note_image", "note_jump_url"}
    for col in _note_report_columns():
        key = col.get("key")
        if not key or key in added or key == "cost":
            continue
        q = _quote_ident(key)
        if col.get("aggregate") in {"skip", None} or col.get("format") in {"text", "link"}:
            selects.append(f"COALESCE(NULLIF(MAX(npd.{q}), ''), '') as {q}")
        elif col.get("aggregate") == "avg":
            selects.append(f"COALESCE(AVG(npd.{q}),0) as {q}")
        elif col.get("aggregate") == "formula":
            selects.append(f"0 as {q}")
        else:
            selects.append(f"COALESCE(SUM(npd.{q}),0) as {q}")
        added.add(key)
    if "fee" not in added:
        selects.append("COALESCE(SUM(npd.fee),0) as fee")
    selects.extend([
        "COALESCE(SUM(npd.fee),0) as cost",
        "MIN(npd.report_date) as report_start_date",
        "MAX(npd.report_date) as report_end_date",
        "MAX(npd.fetched_at) as fetched_at",
        "'synced' as sync_status",
        "'已同步投放数据' as sync_message",
    ])
    return ",\n              ".join(selects)


def _note_pending_placeholder_select(alias="tnp"):
    selects = [
        f"{alias}.id as id",
        f"{alias}.task_id",
        f"{alias}.note_id",
        f"COALESCE({alias}.note_title, '') as note_title",
        f"COALESCE({alias}.note_image, '') as note_image",
        f"COALESCE({alias}.note_jump_url, '') as note_jump_url",
    ]
    added = {"id", "task_id", "note_id", "note_title", "note_image", "note_jump_url"}
    for col in _note_report_columns():
        key = col.get("key")
        if not key or key in added or key == "cost":
            continue
        q = _quote_ident(key)
        if col.get("aggregate") in {"skip", None} or col.get("format") in {"text", "link"}:
            selects.append(f"COALESCE({alias}.{q}, '') as {q}")
        else:
            selects.append(f"COALESCE({alias}.{q}, 0) as {q}")
        added.add(key)
    selects.extend([
        f"COALESCE({alias}.fee, 0) as cost",
        "'' as report_start_date",
        "'' as report_end_date",
        f"{alias}.fetched_at",
        f"COALESCE({alias}.sync_status, 'pending') as sync_status",
        f"COALESCE({alias}.sync_message, '等待同步投放数据') as sync_message",
    ])
    return ",\n              ".join(selects)


def _note_pending_placeholder_where(alias="tnp"):
    return f"""COALESCE({alias}.sync_status, 'pending') != 'synced'
              AND COALESCE({alias}.note_id, '') != ''
              AND NOT EXISTS (
                  SELECT 1 FROM task_note_performance_daily npd_existing
                  WHERE npd_existing.task_id = {alias}.task_id
                    AND lower(npd_existing.note_id) = lower({alias}.note_id)
              )"""


def get_note_performance(task_id, start_date=None, end_date=None):
    conn = get_db()
    _ensure_note_performance_columns(conn)
    conn.commit()
    params = [task_id]
    date_filter = _note_daily_date_filter(start_date, end_date, params)
    rows = conn.execute(
        f"""SELECT {_note_performance_group_select()}
            FROM task_note_performance_daily npd
            WHERE npd.task_id=? {date_filter}
            GROUP BY npd.task_id, npd.note_id
            ORDER BY cost DESC""",
        params,
    ).fetchall()
    pending_rows = conn.execute(
        f"""SELECT {_note_pending_placeholder_select()}
            FROM task_note_performance tnp
            WHERE tnp.task_id=? AND {_note_pending_placeholder_where()}
            ORDER BY cost DESC""",
        (task_id,),
    ).fetchall()
    if not rows and not pending_rows and not start_date and not end_date:
        rows = conn.execute(
            "SELECT * FROM task_note_performance WHERE task_id=? ORDER BY cost DESC", (task_id,)
        ).fetchall()
    conn.close()
    return _dedupe_note_performance_rows([*rows, *pending_rows])


def _dedupe_note_performance_rows(rows):
    deduped = {}
    for row in rows:
        item = dict(row)
        note_id = str(item.get("note_id") or "").strip()
        if not note_id:
            key = f"row:{item.get('id') or item.get('task_id') or len(deduped)}"
        else:
            key = note_id.lower()
        item = _apply_note_formula_columns(item)
        current = deduped.get(key)
        if not current or float(item.get("cost") or 0) > float(current.get("cost") or 0):
            deduped[key] = item
    return list(deduped.values())


def _task_note_id_count(note_id_text):
    raw = str(note_id_text or "").strip()
    if not raw:
        return 0
    ids = {entry["note_id"].strip().lower() for entry in extract_xhs_note_entries(raw) if entry.get("note_id")}
    if not ids:
        ids = {part.strip().lower() for part in re.split(r"[,，;；\s]+", raw) if part.strip()}
    return len(ids)


def _content_task_output_quantity(task):
    try:
        quantity = max(int(task.get("quantity") or 1), 1)
    except (TypeError, ValueError):
        quantity = 1
    try:
        pending_count = max(int(task.get("pending_count") or 0), 0)
    except (TypeError, ValueError):
        pending_count = 0
    note_count = _task_note_id_count(task.get("note_id"))
    status = task.get("status") or ""
    if status == "已完成":
        return max(quantity, pending_count, note_count)
    if status in ("待发布", "发布中"):
        return max(pending_count, note_count)
    return max(pending_count, note_count)


def _note_dashboard_task_quantity_summary(conn, start_date=None, end_date=None, project_id=None, operator_id=None):
    date_expr = "COALESCE(NULLIF(t.due_date, ''), t.start_date)"
    where = [
        "u.role='content_operator'",
        "u.status='active'",
        "t.is_archived=0",
        "(t.parent_id IS NULL OR t.parent_id=0)",
    ]
    params = []
    if start_date:
        where.append(f"{date_expr} >= ?")
        params.append(start_date)
    if end_date:
        where.append(f"{date_expr} <= ?")
        params.append(end_date)
    if project_id:
        where.append("t.project_id = ?")
        params.append(project_id)
    if operator_id:
        where.append("t.assignee_id = ?")
        params.append(operator_id)
    rows = conn.execute(
        f"""SELECT u.id as assignee_id,
                  u.real_name as operator_name,
                  COUNT(*) as task_count,
                  COALESCE(SUM(t.quantity), 0) as note_count
           FROM tasks t
           JOIN users u ON t.assignee_id = u.id
           WHERE {' AND '.join(where)}
           GROUP BY u.id, u.real_name""",
        params,
    ).fetchall()
    summary = {}
    for row in rows:
        item = dict(row)
        aid = item.get("assignee_id")
        summary[aid] = {
            "assignee_id": aid,
            "operator_name": item.get("operator_name"),
            "note_count": int(item.get("note_count") or 0),
            "task_count": int(item.get("task_count") or 0),
        }
    return summary


def _has_note_daily_rows(conn):
    row = conn.execute("SELECT 1 FROM task_note_performance_daily LIMIT 1").fetchone()
    return row is not None


def get_project_note_performance(project_id, start_date=None, end_date=None, user_id=None, sort_by="cost", sort_dir="desc"):
    """获取项目下已完成任务的笔记表现数据，支持时间范围和用户过滤"""
    conn = get_db()
    _ensure_note_performance_columns(conn)
    conn.commit()
    params = [project_id]
    date_filter = _note_daily_date_filter(start_date, end_date, params)
    user_filter = ""
    if user_id:
        user_filter = " AND (t.assignee_id=? OR t.creator_id=? OR p.operator_id=? OR t.id IN (SELECT tc.task_id FROM task_collaborators tc WHERE tc.user_id=?))"
        params.extend([user_id, user_id, user_id, user_id])
    has_daily_rows = _has_note_daily_rows(conn)
    rows = []
    pending_rows = []
    if has_daily_rows:
        rows = conn.execute(
            f"""SELECT t.id as task_id, t.title, t.note_id as task_note_id, t.assignee_id,
                      p.operator_id,
                      opt.real_name as operator_name,
                      opt.real_name as optimizer_name,
                      t.assignee_id as content_operator_id,
                      u.real_name as assignee_name,
                      u.real_name as content_operator_name,
                      {_note_performance_group_select()}
               FROM tasks t
               JOIN task_note_performance_daily npd ON npd.task_id = t.id
               LEFT JOIN users u ON t.assignee_id = u.id
               LEFT JOIN projects p ON t.project_id = p.id
               LEFT JOIN users opt ON p.operator_id = opt.id
               WHERE t.project_id=? AND t.status='已完成' AND t.note_id IS NOT NULL AND t.note_id != ''
               {date_filter}{user_filter}
               GROUP BY npd.task_id, npd.note_id
               ORDER BY cost DESC""",
            params,
        ).fetchall()
        pending_params = [project_id]
        pending_user_filter = ""
        if user_id:
            pending_user_filter = user_filter
            pending_params.extend([user_id, user_id, user_id, user_id])
        pending_rows = conn.execute(
            f"""SELECT t.id as task_id, t.title, t.note_id as task_note_id, t.assignee_id,
                      p.operator_id,
                      opt.real_name as operator_name,
                      opt.real_name as optimizer_name,
                      t.assignee_id as content_operator_id,
                      u.real_name as assignee_name,
                      u.real_name as content_operator_name,
                      {_note_pending_placeholder_select()}
               FROM tasks t
               JOIN task_note_performance tnp ON tnp.task_id = t.id
               LEFT JOIN users u ON t.assignee_id = u.id
               LEFT JOIN projects p ON t.project_id = p.id
               LEFT JOIN users opt ON p.operator_id = opt.id
               WHERE t.project_id=? AND t.status='已完成' AND t.note_id IS NOT NULL AND t.note_id != ''
               AND {_note_pending_placeholder_where()}
               {pending_user_filter}
               ORDER BY cost DESC""",
            pending_params,
        ).fetchall()
    if not rows and not pending_rows and not has_daily_rows:
        fallback_params = [project_id]
        fallback_user_filter = ""
        if user_id:
            fallback_user_filter = " AND (t.assignee_id=? OR t.creator_id=? OR p.operator_id=? OR t.id IN (SELECT tc.task_id FROM task_collaborators tc WHERE tc.user_id=?))"
            fallback_params.extend([user_id, user_id, user_id, user_id])
        rows = conn.execute(
            f"""SELECT t.id as task_id, t.title, t.note_id as task_note_id, tnp.note_id, t.assignee_id,
                      p.operator_id,
                      opt.real_name as operator_name,
                      opt.real_name as optimizer_name,
                      t.assignee_id as content_operator_id,
                      u.real_name as assignee_name,
                      u.real_name as content_operator_name,
                      tnp.*
               FROM tasks t
               LEFT JOIN task_note_performance tnp ON tnp.task_id = t.id
               LEFT JOIN users u ON t.assignee_id = u.id
               LEFT JOIN projects p ON t.project_id = p.id
               LEFT JOIN users opt ON p.operator_id = opt.id
               WHERE t.project_id=? AND t.status='已完成' AND t.note_id IS NOT NULL AND t.note_id != ''
               {fallback_user_filter}
               ORDER BY tnp.cost DESC""",
            fallback_params,
        ).fetchall()
    conn.close()
    result = _dedupe_note_performance_rows([*rows, *pending_rows])
    sort_key = sort_by if sort_by in {"cost", "impression", "interaction", "ctr", "message_consult", "click"} else "cost"
    reverse = str(sort_dir or "desc").lower() != "asc"
    result.sort(key=lambda row: float(row.get(sort_key) or 0), reverse=reverse)
    return result


def get_note_performance_dashboard(start_date=None, end_date=None, project_id=None, operator_id=None, sort_by="cost", sort_dir="desc"):
    """内容运营笔记表现看板：按运营聚合笔记消耗数据，含明细列表"""
    conn = get_db()
    _ensure_note_performance_columns(conn)
    conn.commit()
    params = []
    filters = ""
    filters += _note_daily_date_filter(start_date, end_date, params)
    if project_id:
        filters += " AND t.project_id = ?"
        params.append(project_id)
    if operator_id:
        filters += " AND t.assignee_id = ?"
        params.append(operator_id)

    has_daily_rows = _has_note_daily_rows(conn)
    detail_rows = []
    pending_detail_rows = []
    if has_daily_rows:
        detail_rows = conn.execute(
            f"""SELECT t.title as task_title,
                       t.assignee_id,
                       t.assignee_id as content_operator_id,
                       u.real_name as operator_name,
                       u.real_name as content_operator_name,
                       opt.real_name as optimizer_name,
                       p.project_name,
                       p.id as project_id,
                       {_note_performance_group_select()}
                FROM task_note_performance_daily npd
                JOIN tasks t ON npd.task_id = t.id
                LEFT JOIN users u ON t.assignee_id = u.id
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN users opt ON p.operator_id = opt.id
                WHERE t.status='已完成'
                {filters}
                GROUP BY npd.task_id, npd.note_id""",
            params,
        ).fetchall()
        pending_params = []
        pending_filters = ""
        if project_id:
            pending_filters += " AND t.project_id = ?"
            pending_params.append(project_id)
        if operator_id:
            pending_filters += " AND t.assignee_id = ?"
            pending_params.append(operator_id)
        pending_detail_rows = conn.execute(
            f"""SELECT t.title as task_title,
                       t.assignee_id,
                       t.assignee_id as content_operator_id,
                       u.real_name as operator_name,
                       u.real_name as content_operator_name,
                       opt.real_name as optimizer_name,
                       p.project_name,
                       p.id as project_id,
                       {_note_pending_placeholder_select()}
                FROM task_note_performance tnp
                JOIN tasks t ON tnp.task_id = t.id
                LEFT JOIN users u ON t.assignee_id = u.id
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN users opt ON p.operator_id = opt.id
                WHERE t.status='已完成'
                AND {_note_pending_placeholder_where()}
                {pending_filters}""",
            pending_params,
        ).fetchall()
    if not detail_rows and not pending_detail_rows and not has_daily_rows:
        fallback_params = []
        fallback_filters = ""
        if project_id:
            fallback_filters += " AND t.project_id = ?"
            fallback_params.append(project_id)
        if operator_id:
            fallback_filters += " AND t.assignee_id = ?"
            fallback_params.append(operator_id)
        detail_rows = conn.execute(
            f"""SELECT t.title as task_title,
                       tnp.task_id,
                       tnp.note_id,
                       tnp.note_title,
                       tnp.note_image,
                       tnp.note_jump_url,
                       tnp.impression,
                       tnp.interaction,
                       tnp.cost,
                       tnp.ctr,
                       tnp.message_consult,
                       tnp.click,
                       '' as report_start_date,
                       '' as report_end_date,
                       tnp.fetched_at,
                       tnp.sync_status,
                       tnp.sync_message,
                       t.assignee_id,
                       t.assignee_id as content_operator_id,
                       u.real_name as operator_name,
                       u.real_name as content_operator_name,
                       opt.real_name as optimizer_name,
                       p.project_name,
                       p.id as project_id
                FROM task_note_performance tnp
                JOIN tasks t ON tnp.task_id = t.id
                LEFT JOIN users u ON t.assignee_id = u.id
                LEFT JOIN projects p ON t.project_id = p.id
                LEFT JOIN users opt ON p.operator_id = opt.id
                WHERE t.status='已完成'
                {fallback_filters}""",
            fallback_params,
        ).fetchall()
    details = _dedupe_note_performance_rows([*detail_rows, *pending_detail_rows])
    sort_key = sort_by if sort_by in {"cost", "impression", "interaction", "ctr", "message_consult", "click"} else "cost"
    reverse = str(sort_dir or "desc").lower() != "asc"
    details.sort(key=lambda row: float(row.get(sort_key) or 0), reverse=reverse)
    task_quantity_summary = _note_dashboard_task_quantity_summary(
        conn,
        start_date=start_date,
        end_date=end_date,
        project_id=project_id,
        operator_id=operator_id,
    )
    summary_map = {}
    for aid, task_summary in task_quantity_summary.items():
        summary_map[aid] = {
            "assignee_id": aid,
            "operator_name": task_summary.get("operator_name"),
            "note_count": task_summary.get("note_count") or 0,
            "task_count": task_summary.get("task_count") or 0,
            "task_ids": set(),
            "total_impression": 0,
            "total_interaction": 0,
            "total_cost": 0.0,
            "total_message_consult": 0,
            "total_click": 0,
            "_task_quantity_loaded": True,
            "_detail_note_count": 0,
        }
    for item in details:
        aid = item.get("assignee_id")
        entry = summary_map.setdefault(aid, {
            "assignee_id": aid,
            "operator_name": item.get("operator_name"),
            "note_count": 0,
            "task_ids": set(),
            "total_impression": 0,
            "total_interaction": 0,
            "total_cost": 0.0,
            "total_message_consult": 0,
            "total_click": 0,
            "_task_quantity_loaded": False,
            "_detail_note_count": 0,
        })
        entry["_detail_note_count"] += 1
        if item.get("task_id"):
            entry["task_ids"].add(item.get("task_id"))
        entry["total_impression"] += int(item.get("impression") or 0)
        entry["total_interaction"] += int(item.get("interaction") or 0)
        entry["total_cost"] += float(item.get("cost") or 0)
        entry["total_message_consult"] += int(item.get("message_consult") or 0)
        entry["total_click"] += int(item.get("click") or 0)
    summary = []
    for entry in summary_map.values():
        entry["task_count"] = max(int(entry.get("task_count") or 0), len(entry.pop("task_ids")))
        entry.pop("_detail_note_count", None)
        entry.pop("_task_quantity_loaded", None)
        entry["total_ctr"] = round(entry["total_click"] * 100.0 / entry["total_impression"], 2) if entry["total_impression"] else 0
        summary.append(entry)
    summary.sort(key=lambda row: row.get("total_cost") or 0, reverse=True)

    conn.close()
    return {"summary": summary, "details": details}


# ---- 活动日志 ----

def log_task_activity(task_id, user_id, action, old_value='', new_value=''):
    with db_connection() as conn:
        conn.execute(
            "INSERT INTO task_activity_log (task_id, user_id, action, old_value, new_value) VALUES (?,?,?,?,?)",
            (task_id, user_id, action, old_value, new_value),
        )


def get_task_activity(task_id):
    conn = get_db()
    rows = conn.execute(
        """SELECT tal.*, u.real_name as user_name FROM task_activity_log tal
           JOIN users u ON tal.user_id = u.id
           WHERE tal.task_id=? ORDER BY tal.created_at DESC""",
        (task_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---- 扩展统计 ----

def get_workspace_dashboard(user_id=None, role=None, start_date=None, end_date=None):
    """工作台仪表盘数据，支持时间范围筛选"""
    conn = get_db()
    base = "AND (parent_id IS NULL OR parent_id=0) AND t.is_archived=0"
    today = date.today().isoformat()
    user_filter = ""
    params = []
    if user_id and role == 'content_operator':
        user_filter = "AND (t.creator_id=? OR t.assignee_id=? OR t.id IN (SELECT tc.task_id FROM task_collaborators tc WHERE tc.user_id=?))"
        params = [user_id, user_id, user_id]

    date_filter = ""
    if start_date:
        date_filter += " AND t.created_at >= ?"
        params.append(start_date)
    if end_date:
        date_filter += " AND t.created_at <= ?"
        params.append(end_date + " 23:59:59")

    sql = f"""SELECT
        COUNT(*) as total,
        SUM(CASE WHEN t.status='已完成' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN t.status='待发布' THEN 1 ELSE 0 END) as pending_publish,
        SUM(CASE WHEN t.status IN ('待发布','发布中') THEN 1 ELSE 0 END) as publishing,
        SUM(CASE WHEN t.status IN ('进行中','待发布') AND t.due_date < ? THEN 1 ELSE 0 END) as overdue,
        SUM(CASE WHEN t.status='进行中' THEN 1 ELSE 0 END) as in_progress
        FROM tasks t WHERE 1=1 {base} {user_filter} {date_filter}"""
    row = conn.execute(sql, [today] + params).fetchone()
    conn.close()
    d = dict(row) if row else {'total': 0, 'completed': 0, 'pending_publish': 0, 'publishing': 0, 'overdue': 0, 'in_progress': 0}
    d['pending_publish'] = d.get('pending_publish', 0)
    return d


def get_tasks_by_date_range(user_id, start_date, end_date):
    """获取指定日期范围的任务（日历视图）"""
    conn = get_db()
    rows = conn.execute(
        """SELECT t.*, p.project_name,
                  c.real_name as creator_name, a.real_name as assignee_name
           FROM tasks t
           LEFT JOIN projects p ON t.project_id = p.id
           LEFT JOIN users c ON t.creator_id = c.id
           LEFT JOIN users a ON t.assignee_id = a.id
           WHERE t.is_archived=0
           AND (t.creator_id=? OR t.assignee_id=?
                OR t.id IN (SELECT tc.task_id FROM task_collaborators tc WHERE tc.user_id=?))
           AND ((t.start_date BETWEEN ? AND ?) OR (t.due_date BETWEEN ? AND ?)
                OR (t.start_date <= ? AND t.due_date >= ?))
           ORDER BY t.due_date""",
        (user_id, user_id, user_id, start_date, end_date, start_date, end_date, start_date, end_date),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_department_task_stats():
    """部门级任务看板统计"""
    conn = get_db()
    rows = conn.execute(
        """SELECT u.department,
            COUNT(*) as total,
            SUM(CASE WHEN t.status='进行中' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN t.status='待发布' THEN 1 ELSE 0 END) as pending_publish,
            SUM(CASE WHEN t.status IN ('待发布','发布中') THEN 1 ELSE 0 END) as publishing,
            SUM(CASE WHEN t.status='已完成' THEN 1 ELSE 0 END) as completed
           FROM tasks t
           JOIN users u ON t.assignee_id = u.id
           WHERE t.is_archived=0 AND (t.parent_id IS NULL OR t.parent_id=0)
           GROUP BY u.department"""
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_all_note_performance(start_date=None, end_date=None, user_id=None, sort_by="cost", sort_dir="desc"):
    """获取已完成任务的笔记表现数据（按项目分组），支持时间范围和用户过滤"""
    conn = get_db()
    _ensure_note_performance_columns(conn)
    conn.commit()
    params = []
    date_filter = _note_daily_date_filter(start_date, end_date, params)
    user_filter = ""
    if user_id:
        user_filter = " AND (t.assignee_id=? OR t.creator_id=? OR p.operator_id=? OR t.id IN (SELECT tc.task_id FROM task_collaborators tc WHERE tc.user_id=?))"
        params.extend([user_id, user_id, user_id, user_id])
    has_daily_rows = _has_note_daily_rows(conn)
    rows = []
    pending_rows = []
    if has_daily_rows:
        rows = conn.execute(
            f"""SELECT t.id as task_id, t.title, t.note_id as task_note_id, t.type, t.project_id,
                      p.project_name, p.operator_id,
                      u.real_name as operator_name,
                      u.real_name as optimizer_name,
                      a.real_name as assignee_name,
                      a.id as content_operator_id,
                      a.real_name as content_operator_name,
                      {_note_performance_group_select()}
               FROM tasks t
               JOIN task_note_performance_daily npd ON npd.task_id = t.id
               LEFT JOIN projects p ON p.id = t.project_id
               LEFT JOIN users u ON p.operator_id = u.id
               LEFT JOIN users a ON t.assignee_id = a.id
               WHERE t.status='已完成' AND t.note_id IS NOT NULL AND t.note_id != ''
               {date_filter}{user_filter}
               GROUP BY npd.task_id, npd.note_id
               ORDER BY p.project_name, cost DESC""",
            params,
        ).fetchall()
        pending_params = []
        pending_user_filter = ""
        if user_id:
            pending_user_filter = user_filter
            pending_params.extend([user_id, user_id, user_id, user_id])
        pending_rows = conn.execute(
            f"""SELECT t.id as task_id, t.title, t.note_id as task_note_id, t.type, t.project_id,
                      p.project_name, p.operator_id,
                      u.real_name as operator_name,
                      u.real_name as optimizer_name,
                      a.real_name as assignee_name,
                      a.id as content_operator_id,
                      a.real_name as content_operator_name,
                      {_note_pending_placeholder_select()}
               FROM tasks t
               JOIN task_note_performance tnp ON tnp.task_id = t.id
               LEFT JOIN projects p ON p.id = t.project_id
               LEFT JOIN users u ON p.operator_id = u.id
               LEFT JOIN users a ON t.assignee_id = a.id
               WHERE t.status='已完成' AND t.note_id IS NOT NULL AND t.note_id != ''
               AND {_note_pending_placeholder_where()}
               {pending_user_filter}
               ORDER BY p.project_name, cost DESC""",
            pending_params,
        ).fetchall()
    if not rows and not pending_rows and not has_daily_rows:
        fallback_params = []
        fallback_user_filter = ""
        if user_id:
            fallback_user_filter = " AND (t.assignee_id=? OR t.creator_id=? OR p.operator_id=? OR t.id IN (SELECT tc.task_id FROM task_collaborators tc WHERE tc.user_id=?))"
            fallback_params.extend([user_id, user_id, user_id, user_id])
        rows = conn.execute(
            f"""SELECT t.id as task_id, t.title, t.note_id as task_note_id, tnp.note_id, t.type, t.project_id,
                      p.project_name, p.operator_id,
                      u.real_name as operator_name,
                      u.real_name as optimizer_name,
                      a.real_name as assignee_name,
                      a.id as content_operator_id,
                      a.real_name as content_operator_name,
                      tnp.note_title, tnp.note_image, tnp.note_jump_url,
                      tnp.impression, tnp.interaction, tnp.cost, tnp.ctr, tnp.message_consult, tnp.click,
                      tnp.fetched_at, tnp.sync_status, tnp.sync_message
               FROM tasks t
               LEFT JOIN task_note_performance tnp ON tnp.task_id = t.id
               LEFT JOIN projects p ON p.id = t.project_id
               LEFT JOIN users u ON p.operator_id = u.id
               LEFT JOIN users a ON t.assignee_id = a.id
               WHERE t.status='已完成' AND t.note_id IS NOT NULL AND t.note_id != ''
               {fallback_user_filter}
               ORDER BY p.project_name, tnp.cost DESC""",
            fallback_params,
        ).fetchall()
    conn.close()
    result = _dedupe_note_performance_rows([*rows, *pending_rows])
    sort_key = sort_by if sort_by in {"cost", "impression", "interaction", "ctr", "message_consult", "click"} else "cost"
    reverse = str(sort_dir or "desc").lower() != "asc"
    result.sort(key=lambda row: (str(row.get("project_name") or ""), -float(row.get(sort_key) or 0) if reverse else float(row.get(sort_key) or 0)))
    return result


# ---- 人员管理 (HR) ----

def create_hr_employee(data):
    """新增员工。data 是 dict，键对应 hr_employees 列名。返回 lastrowid。"""
    cols = ['name', 'entry_date', 'probation_salary', 'regular_salary', 'regular_date',
            'phone', 'dept', 'job', 'media', 'business', 'status', 'location', 'resign_date']
    with db_connection() as conn:
        cur = conn.execute(
            f"INSERT INTO hr_employees ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
            [data.get(c, '') for c in cols],
        )
        return cur.lastrowid


def get_hr_employees(status=None, dept=None, job=None, location=None, business=None, search=None):
    """查询员工列表，支持多条件筛选。search 匹配 name/phone/business。"""
    conn = get_db()
    where, params = [], []
    if status:
        if isinstance(status, list):
            placeholders = ','.join('?' for _ in status)
            where.append(f"status IN ({placeholders})")
            params.extend(status)
        else:
            where.append("status=?"); params.append(status)
    if dept:
        if isinstance(dept, list):
            placeholders = ','.join('?' for _ in dept)
            where.append(f"dept IN ({placeholders})")
            params.extend(dept)
        else:
            where.append("dept=?"); params.append(dept)
    if job:
        if isinstance(job, list):
            placeholders = ','.join('?' for _ in job)
            where.append(f"job IN ({placeholders})")
            params.extend(job)
        else:
            where.append("job=?"); params.append(job)
    if location:
        if isinstance(location, list):
            placeholders = ','.join('?' for _ in location)
            where.append(f"location IN ({placeholders})")
            params.extend(location)
        else:
            where.append("location=?"); params.append(location)
    if business:
        where.append("business=?"); params.append(business)
    if search:
        where.append("(name LIKE ? OR phone LIKE ? OR business LIKE ?)")
        kw = f"%{search}%"
        params.extend([kw, kw, kw])
    sql = "SELECT * FROM hr_employees"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY CASE dept WHEN '运营一部' THEN 1 WHEN '运营二部' THEN 2 WHEN '运营三部' THEN 3 WHEN '运营四部' THEN 4 WHEN '创意部' THEN 99 ELSE 50 END, CASE WHEN job='主管' THEN 0 ELSE 1 END, id ASC"
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    seen = set()
    result = []
    for r in rows:
        d = dict(r)
        key = (d.get('name', ''), d.get('status', ''))
        if key not in seen:
            seen.add(key)
            result.append(d)
    return result


def get_hr_employee(eid):
    """按 id 获取单个员工，返回 dict 或 None。"""
    conn = get_db()
    row = conn.execute("SELECT * FROM hr_employees WHERE id=?", (eid,)).fetchone()
    conn.close()
    return dict(row) if row else None


def update_hr_employee(eid, data):
    """更新员工字段。data 是需要更新的字段 dict。"""
    allowed = {'name', 'entry_date', 'probation_salary', 'regular_salary', 'regular_date',
               'phone', 'dept', 'job', 'media', 'business', 'status', 'location', 'resign_date'}
    sets, vals = [], []
    for k in allowed:
        if k in data:
            sets.append(f"{k}=?")
            vals.append(data[k])
    if sets:
        sets.append("updated_at=datetime('now','localtime')")
        vals.append(eid)
        with db_connection() as conn:
            conn.execute(f"UPDATE hr_employees SET {','.join(sets)} WHERE id=?", vals)


def delete_hr_employee(eid):
    """硬删除员工。"""
    with db_connection() as conn:
        conn.execute("DELETE FROM hr_employees WHERE id=?", (eid,))


def get_hr_resigned_employees(dept=None):
    """获取离职员工，可按部门过滤。"""
    conn = get_db()
    if dept:
        rows = conn.execute("SELECT * FROM hr_employees WHERE status='离职' AND dept=? ORDER BY id DESC", (dept,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM hr_employees WHERE status='离职' ORDER BY id DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def import_hr_employees_from_json(json_data):
    """从 JSON 数组批量导入员工。pSalary/rSalary 支持 str/number → float，resignDate/resign → resign_date。
    跳过缺少必填字段的记录。返回 (imported_count, error_count)。"""
    imported, errors = 0, 0
    for item in json_data:
        name = item.get('name', '').strip()
        entry_date = item.get('entryDate', '').strip() or item.get('entry', '').strip() or item.get('entry_date', '').strip()
        if not name or not entry_date:
            errors += 1
            continue
        try:
            prob = float(item.get('pSalary', item.get('probation_salary', 0) or 0))
        except (ValueError, TypeError):
            prob = 0
        try:
            reg = float(item.get('rSalary', item.get('regular_salary', 0) or 0))
        except (ValueError, TypeError):
            reg = 0
        resign_date = item.get('resignDate', '') or item.get('resign', '') or ''
        data = {
            'name': name,
            'entry_date': entry_date,
            'probation_salary': prob,
            'regular_salary': reg,
            'regular_date': item.get('regularDate', item.get('regular', '')) or item.get('regular_date', '') or '',
            'phone': str(item.get('phone', '')),
            'dept': item.get('dept', item.get('department', '')) or '',
            'job': item.get('job', item.get('position', '')) or '',
            'media': item.get('media', '小红书') or '小红书',
            'business': item.get('business', '') or '',
            'status': item.get('status', '试用期-在职') or '试用期-在职',
            'location': item.get('location', '上海') or '上海',
            'resign_date': str(resign_date),
        }
        try:
            create_hr_employee(data)
            imported += 1
        except Exception:
            errors += 1
    return imported, errors


def create_hr_application(data):
    """新增入职申请。返回 lastrowid。"""
    with db_connection() as conn:
        cur = conn.execute(
            "INSERT INTO hr_onboarding_applications (apply_time, person_count, persons_json, mail_content) VALUES (?,?,?,?)",
            (data.get('apply_time', ''), data.get('person_count', 1),
             data.get('persons_json', ''), data.get('mail_content', '')),
        )
        return cur.lastrowid


def get_hr_applications():
    """获取所有入职申请，按 id 倒序。"""
    conn = get_db()
    rows = conn.execute("SELECT * FROM hr_onboarding_applications ORDER BY id DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_hr_application(aid):
    """获取单个入职申请。"""
    conn = get_db()
    row = conn.execute("SELECT * FROM hr_onboarding_applications WHERE id=?", (aid,)).fetchone()
    conn.close()
    return dict(row) if row else None


def update_hr_application(aid, data):
    """更新入职申请字段。"""
    allowed = {'apply_time', 'person_count', 'persons_json', 'mail_content'}
    sets, vals = [], []
    for k in allowed:
        if k in data:
            sets.append(f"{k}=?")
            vals.append(data[k])
    if sets:
        vals.append(aid)
        with db_connection() as conn:
            conn.execute(f"UPDATE hr_onboarding_applications SET {','.join(sets)} WHERE id=?", vals)


def delete_hr_application(aid):
    """删除入职申请。"""
    with db_connection() as conn:
        conn.execute("DELETE FROM hr_onboarding_applications WHERE id=?", (aid,))


def create_hr_employees_from_application(aid):
    """根据入职申请批量创建员工。解析 persons_json，salTry*1000→probation_salary，salReg*1000→regular_salary，
    自动计算 regular_date = entry_date + 6个月。返回创建数量。"""
    import json
    conn = get_db()
    row = conn.execute("SELECT * FROM hr_onboarding_applications WHERE id=?", (aid,)).fetchone()
    if not row:
        conn.close()
        return 0
    persons = json.loads(row['persons_json'])
    apply_time = row['apply_time'][:10]  # 取日期部分
    count = 0
    for p in persons:
        name = p.get('name', '').strip()
        entry_date = p.get('entryDate', apply_time).strip()
        if not name:
            continue
        try:
            prob = float(p.get('salTry', 0) or 0) * 1000
        except (ValueError, TypeError):
            prob = 0
        try:
            reg = float(p.get('salReg', 0) or 0) * 1000
        except (ValueError, TypeError):
            reg = 0
        # 自动计算转正日期 = 入职日期 + 6个月
        try:
            dt = datetime.strptime(entry_date, '%Y-%m-%d')
            month = dt.month + 6
            year = dt.year + (month - 1) // 12
            month = (month - 1) % 12 + 1
            max_day = calendar.monthrange(year, month)[1]
            regular_date = f"{year}-{month:02d}-{min(dt.day, max_day):02d}"
        except (ValueError, TypeError):
            regular_date = ''
        try:
            conn.execute(
                "INSERT INTO hr_employees (name,entry_date,probation_salary,regular_salary,regular_date,"
                "phone,dept,job,media,business,status,location) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (name, entry_date, prob, reg, regular_date,
                 p.get('phone', ''), p.get('dept', ''), p.get('job', ''),
                 p.get('media', '小红书'), p.get('business', ''),
                 '试用期-在职', p.get('location', '上海')),
            )
            count += 1
        except Exception:
            pass
    conn.commit()
    conn.close()
    return count


def save_hr_quarter_bonus(quarter, data):
    """保存季度奖金数据。data: [{employee_name, kpi, bonus}]。使用 INSERT OR REPLACE 处理唯一约束。"""
    with db_connection() as conn:
        for item in data:
            conn.execute(
                "INSERT OR REPLACE INTO hr_quarter_bonus (quarter, employee_name, kpi, bonus, updated_at) "
                "VALUES (?,?,?,?,datetime('now','localtime'))",
                (quarter, item.get('employee_name', ''), item.get('kpi', 0), item.get('bonus', 0)),
            )


def get_hr_quarter_bonus(quarter):
    """获取某季度奖金数据。"""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM hr_quarter_bonus WHERE quarter=? ORDER BY employee_name", (quarter,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_hr_dashboard_stats(dept=None, job=None, location=None):
    """HR 仪表盘统计（仅在职员工），返回 5 个 ECharts 图表数据。"""
    rows = get_hr_employees(status=["试用期-在职", "正式工-在职", "正式-在职"], dept=dept, job=job, location=location)

    # 1. 部门人数
    dept_map = {}
    # 2. 职位分布
    job_map = {}
    # 3. 地区分布
    loc_map = {}
    # 4. 状态分布
    status_map = {}
    # 5. 地区+职位的薪资分布
    sal_loc_job = {}  # key: "location|job" → {"prob": [salaries], "reg": [salaries]}

    for r in rows:
        r = dict(r)
        dept_map[r['dept'] or '未分配'] = dept_map.get(r['dept'] or '未分配', 0) + 1
        job_map[r['job'] or '未分配'] = job_map.get(r['job'] or '未分配', 0) + 1
        loc_map[r['location'] or '未分配'] = loc_map.get(r['location'] or '未分配', 0) + 1
        status_map[r['status'] or '未知'] = status_map.get(r['status'] or '未知', 0) + 1
        key = f"{r['location'] or '未分配'}|{r['job'] or '未分配'}"
        if key not in sal_loc_job:
            sal_loc_job[key] = {'prob': [], 'reg': []}
        sal_loc_job[key]['prob'].append(r['probation_salary'] or 0)
        sal_loc_job[key]['reg'].append(r['regular_salary'] or 0)

    def _avg(lst):
        return round(sum(lst) / len(lst), 2) if lst else 0

    salary_labels, salary_values, salary_colors = [], [], []
    color_palette = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4']
    ci = 0
    for loc_job, sals in sal_loc_job.items():
        salary_labels.append(loc_job.replace('|', '/'))
        avg_val = _avg(sals['prob'] + sals['reg'])
        salary_values.append(avg_val)
        salary_colors.append(color_palette[ci % len(color_palette)])
        ci += 1

    return {
        'total_headcount': sum(dept_map.values()),
        'job_total': sum(job_map.values()),
        'dept_headcount': {'labels': list(dept_map.keys()), 'values': list(dept_map.values())},
        'job_distribution': {'labels': list(job_map.keys()), 'values': list(job_map.values())},
        'location_distribution': {'labels': list(loc_map.keys()), 'values': list(loc_map.values())},
        'status_distribution': {'labels': list(status_map.keys()), 'values': list(status_map.values())},
        'salary_by_loc_job': {'labels': salary_labels, 'values': salary_values, 'colors': salary_colors},
    }


# ---- 创意工作台 ----

CREATIVE_TASK_TYPES = {
    '落地页':    {'weight': 10},
    '设计外层':  {'weight': 1.5},
    '拼图外层':  {'weight': 1},
    '小说外层':  {'weight': 0.5},
    '找图':      {'weight': 0.2},
    '设计轮播':  {'weight': 4},
    '二等轮播':  {'weight': 3},
    '三等轮播':  {'weight': 2},
    'PPT':       {'weight': 10},
    '修改素材':  {'weight': 0.1},
}

CREATIVE_STATUS_PENDING = '待接单'
CREATIVE_STATUS_UNASSIGNED = '待分配'
CREATIVE_STATUS_PROGRESS = '进行中'
CREATIVE_STATUS_DONE = '已完成'
CREATIVE_STATUS_CANCELLED = '已取消'


def creative_type_names(task_type):
    """Return normalized creative task type names from a blank/single/multi value."""
    if isinstance(task_type, (list, tuple, set)):
        raw = ",".join(str(v or "") for v in task_type)
    else:
        raw = str(task_type or "")
    for sep in ("，", "、", "|", "/", "\n", "\t"):
        raw = raw.replace(sep, ",")
    seen = set()
    names = []
    for item in raw.split(","):
        name = item.strip()
        if name and name not in seen:
            seen.add(name)
            names.append(name)
    return names


def creative_task_weight(task_type, quantity=1):
    try:
        qty = max(int(quantity or 1), 1)
    except (TypeError, ValueError):
        qty = 1
    unit_weight = sum(CREATIVE_TASK_TYPES.get(name, {}).get('weight', 0) for name in creative_type_names(task_type))
    return unit_weight * qty


def creative_completion_data(task):
    try:
        brief = json.loads((task or {}).get('brief_json') or '{}')
    except Exception:
        brief = {}
    completion = brief.get('completion') if isinstance(brief, dict) else {}
    return completion if isinstance(completion, dict) else {}


def creative_completed_quantity(task):
    completion = creative_completion_data(task)
    try:
        return int(completion.get('completed_quantity') or 0)
    except (TypeError, ValueError):
        return 0


def _creative_date_only(value):
    raw = str(value or '').strip()
    return raw[:10] if len(raw) >= 10 else ''


def _creative_calendar_bounds(task):
    start = _creative_date_only(task.get('start_date')) or _creative_date_only(task.get('created_at')) or _creative_date_only(task.get('due_date'))
    completion = creative_completion_data(task)
    done_date = _creative_date_only(completion.get('submitted_at'))
    due = _creative_date_only(task.get('due_date'))
    end = done_date if task.get('status') == CREATIVE_STATUS_DONE and done_date else (due or start)
    if start and end and end < start:
        end = start
    return start, end


def _decorate_creative_calendar_task(task):
    item = dict(task)
    start, end = _creative_calendar_bounds(item)
    completion = creative_completion_data(item)
    try:
        completed_quantity = int(completion.get('completed_quantity') or 0)
    except (TypeError, ValueError):
        completed_quantity = 0
    item['calendar_start'] = start
    item['calendar_end'] = end
    item['completed_quantity'] = completed_quantity
    item['completion_breakdown'] = completion.get('breakdown') if isinstance(completion.get('breakdown'), dict) else {}
    return item


def _creative_calendar_rows(filters, start_date, end_date):
    rows = get_tasks(filters)
    result = []
    for task in rows:
        item = _decorate_creative_calendar_task(task)
        start = item.get('calendar_start')
        end = item.get('calendar_end')
        if not start or not end:
            continue
        if start <= end_date and end >= start_date:
            result.append(item)
    return result


def create_creative_task(title, task_type, project_id, creator_id, assignee_id,
                         priority='中', due_date=None, quantity=1, remark='', source_task_id=None,
                         description='', doc_links='[]', brief_json='{}', attachment_links='[]'):
    from datetime import date as _date
    task_type = ",".join(creative_type_names(task_type))
    weight = creative_task_weight(task_type, quantity)
    status = CREATIVE_STATUS_PROGRESS if assignee_id else CREATIVE_STATUS_UNASSIGNED
    source = 'assigned' if assignee_id else 'request'
    with db_connection() as conn:
        cur = conn.execute(
            """INSERT INTO tasks
               (title, description, project_id, creator_id, assignee_id,
                type, status, priority, start_date, due_date,
                quantity, source, remark, doc_links, category, source_task_id, workload_weight,
                brief_json, attachment_links)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (title, description, project_id, creator_id, assignee_id,
             task_type, status, priority, _date.today().isoformat(), due_date,
             quantity, source, remark, doc_links, 'creative', source_task_id, weight,
             brief_json, attachment_links),
        )
        return cur.lastrowid


def get_creative_tasks(filters=None):
    if filters is None:
        filters = {}
    filters['category'] = 'creative'
    return get_tasks(filters)


def update_creative_task(task_id, **kwargs):
    if 'type' in kwargs or 'quantity' in kwargs:
        current = get_task(task_id) or {}
        task_type = kwargs.get('type', current.get('type'))
        quantity = kwargs.get('quantity', current.get('quantity') or 1)
        if 'type' in kwargs:
            kwargs['type'] = ",".join(creative_type_names(task_type))
            task_type = kwargs['type']
        kwargs['workload_weight'] = creative_task_weight(task_type, quantity)
    if 'assignee_id' in kwargs:
        current = get_task(task_id) or {}
        if kwargs.get('assignee_id'):
            if current.get('status') in (CREATIVE_STATUS_UNASSIGNED, CREATIVE_STATUS_PENDING):
                kwargs['status'] = CREATIVE_STATUS_PROGRESS
            kwargs['source'] = 'assigned'
        elif current.get('status') not in (CREATIVE_STATUS_DONE, CREATIVE_STATUS_CANCELLED):
            kwargs['status'] = CREATIVE_STATUS_UNASSIGNED
            kwargs['source'] = 'request'
    update_task(task_id, **kwargs)


def delete_creative_task(task_id):
    delete_task(task_id)


def cancel_creative_task(task_id, reason=''):
    task = get_task(task_id) or {}
    remark = task.get('remark') or ''
    reason = str(reason or '').strip()
    if reason:
        marker = f"撤销原因：{reason}"
        remark = f"{remark}\n{marker}".strip() if marker not in remark else remark
    update_task(task_id, status=CREATIVE_STATUS_CANCELLED, remark=remark)


def restore_creative_task(task_id):
    task = get_task(task_id) or {}
    if not task or task.get('status') != CREATIVE_STATUS_CANCELLED:
        return False
    next_status = CREATIVE_STATUS_PROGRESS if task.get('assignee_id') else CREATIVE_STATUS_UNASSIGNED
    source = 'assigned' if task.get('assignee_id') else 'request'
    update_task(task_id, status=next_status, source=source)
    return True


def accept_creative_task(task_id):
    update_task(task_id, status=CREATIVE_STATUS_PROGRESS)


def submit_creative_task(task_id, description='', completion=None):
    submit_creative_task_progress(task_id, description, completion=completion, final=True)


def submit_creative_task_progress(task_id, description='', completion=None, final=False):
    kwargs = {'status': CREATIVE_STATUS_DONE if final else CREATIVE_STATUS_PROGRESS, 'description': description}
    if completion is not None:
        task = get_task(task_id) or {}
        try:
            brief = json.loads(task.get('brief_json') or '{}')
        except Exception:
            brief = {}
        previous = brief.get('completion') if isinstance(brief.get('completion'), dict) else {}
        submissions = previous.get('submissions') if isinstance(previous.get('submissions'), list) else []
        if not submissions and previous.get('completed_quantity'):
            submissions = [{
                'completed_quantity': previous.get('completed_quantity') or 0,
                'breakdown': previous.get('breakdown') if isinstance(previous.get('breakdown'), dict) else {},
                'description': previous.get('description') or '',
                'submitted_at': previous.get('submitted_at') or '',
            }]
        submissions.append(completion)
        total_completed = 0
        breakdown_total = {}
        for item in submissions:
            try:
                qty = int((item or {}).get('completed_quantity') or 0)
            except (TypeError, ValueError):
                qty = 0
            total_completed += max(qty, 0)
            item_breakdown = (item or {}).get('breakdown')
            if isinstance(item_breakdown, dict):
                for name, count in item_breakdown.items():
                    try:
                        parsed = int(count or 0)
                    except (TypeError, ValueError):
                        parsed = 0
                    if parsed > 0:
                        breakdown_total[name] = breakdown_total.get(name, 0) + parsed
        brief['completion'] = {
            'completed_quantity': total_completed,
            'breakdown': breakdown_total,
            'description': completion.get('description') or '',
            'submitted_at': completion.get('submitted_at') or '',
            'submissions': submissions,
        }
        kwargs['brief_json'] = json.dumps(brief, ensure_ascii=False)
    update_task(task_id, **kwargs)


def get_creative_dashboard(admin_id, start_date=None, end_date=None):
    staff_ids = get_creative_staff_ids()
    conn = get_db()
    where = "WHERE category='creative' AND is_archived=0"
    params = []
    if start_date:
        where += " AND date(COALESCE(due_date, created_at)) >= date(?)"
        params.append(start_date)
    if end_date:
        where += " AND date(COALESCE(due_date, created_at)) <= date(?)"
        params.append(end_date)
    row = conn.execute(
        f"""SELECT COUNT(*) as total,
                   SUM(CASE WHEN status='待分配' THEN 1 ELSE 0 END) as unassigned,
                   SUM(CASE WHEN status='待接单' THEN 1 ELSE 0 END) as pending,
                   SUM(CASE WHEN status='进行中' THEN 1 ELSE 0 END) as in_progress,
                   SUM(CASE WHEN status='已完成' THEN 1 ELSE 0 END) as completed,
                   SUM(CASE WHEN status='已取消' THEN 1 ELSE 0 END) as cancelled,
                   COALESCE(SUM(CASE WHEN status!='已取消' THEN workload_weight ELSE 0 END), 0) as total_weight
            FROM tasks
            {where}""",
        params,
    ).fetchone()
    conn.close()
    return {
        'total': row['total'] or 0, 'unassigned': row['unassigned'] or 0, 'pending': row['pending'] or 0,
        'in_progress': row['in_progress'] or 0,
        'completed': row['completed'] or 0,
        'cancelled': row['cancelled'] or 0,
        'total_weight': round(row['total_weight'] or 0, 1), 'staff_count': len(staff_ids),
    }


def get_creative_staff_workload(admin_id, start_date=None, end_date=None):
    from datetime import date, timedelta
    today = date.today()
    if not start_date or not end_date:
        week_start = today - timedelta(days=(today.weekday() + 1) % 7)
        week_end = week_start + timedelta(days=6)
        start_date, end_date = week_start.isoformat(), week_end.isoformat()
    conn = get_db()
    rows = conn.execute(
        """SELECT u.id as user_id, u.real_name as user_name, u.role,
                  COUNT(t.id) as task_count,
                  COALESCE(SUM(t.workload_weight), 0) as total_weight,
                  COALESCE(SUM(CASE WHEN t.status='已完成' THEN 1 ELSE 0 END), 0) as completed,
                  COALESCE(SUM(CASE WHEN t.status='已取消' THEN 1 ELSE 0 END), 0) as cancelled,
                  COALESCE(SUM(CASE WHEN t.status='待分配' THEN 1 ELSE 0 END), 0) as pending,
                  COALESCE(SUM(CASE WHEN t.status='进行中' THEN 1 ELSE 0 END), 0) as in_progress,
                  COALESCE(SUM(CASE WHEN t.status='已完成' THEN t.workload_weight ELSE 0 END), 0) as completed_weight,
                  COALESCE(SUM(CASE WHEN t.due_date < ? AND t.status IN ('待分配','进行中') THEN 1 ELSE 0 END), 0) as overdue
           FROM users u
           LEFT JOIN tasks t ON t.assignee_id = u.id AND t.category='creative' AND t.is_archived=0
             AND t.status != '已取消'
             AND date(COALESCE(t.due_date, t.created_at)) BETWEEN date(?) AND date(?)
           WHERE u.role IN ('designer','editor')
             AND COALESCE(u.department, '') IN ('', '创意部')
             AND u.status='active'
           GROUP BY u.id, u.real_name, u.role
           ORDER BY u.role, u.real_name""",
        (today.isoformat(), start_date, end_date),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_creative_staff_tasks(admin_id, assignee_id=None, start_date=None, end_date=None, status=None, task_type=None):
    staff_ids = get_creative_staff_ids()
    if assignee_id:
        if int(assignee_id) not in staff_ids:
            return []
        filters = {'category': 'creative', 'assignee_id': assignee_id}
    else:
        filters = {'category': 'creative'}
    if start_date:
        filters['task_date_after'] = start_date
    if end_date:
        filters['task_date_before'] = end_date
    if status:
        filters['status'] = status
    rows = get_tasks(filters)
    if task_type:
        rows = [row for row in rows if task_type in creative_type_names(row.get('type'))]
    return rows


def get_creative_my_tasks(user_id, status=None):
    filters = {'assignee_id': user_id, 'category': 'creative'}
    if status:
        filters['status'] = status
    return get_tasks(filters)


def get_creative_my_requests(user_id, status=None):
    filters = {'creator_id': user_id, 'category': 'creative'}
    if status:
        filters['status'] = status
    return get_tasks(filters)


def get_creative_my_stats(user_id):
    conn = get_db()
    row = conn.execute(
        """SELECT COUNT(*) as total,
                  COALESCE(SUM(workload_weight), 0) as total_weight,
                  SUM(CASE WHEN status='待分配' THEN 1 ELSE 0 END) as pending,
                  SUM(CASE WHEN status='进行中' THEN 1 ELSE 0 END) as in_progress,
                  SUM(CASE WHEN status='已完成' THEN 1 ELSE 0 END) as completed,
                  COALESCE(SUM(CASE WHEN status='已完成' THEN workload_weight ELSE 0 END), 0) as completed_weight
           FROM tasks
           WHERE category='creative' AND is_archived=0 AND assignee_id=?""",
        (user_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else {}


def get_creative_calendar(admin_id, start_date, end_date):
    return [
        task for task in _creative_calendar_rows({'category': 'creative'}, start_date, end_date)
        if task.get('status') != CREATIVE_STATUS_CANCELLED
    ]


def get_creative_my_calendar(user_id, start_date, end_date):
    return [
        task for task in _creative_calendar_rows({'assignee_id': user_id, 'category': 'creative'}, start_date, end_date)
        if task.get('status') != CREATIVE_STATUS_CANCELLED
    ]


def get_creative_staff_ids(active_only=True):
    conn = get_db()
    sql = "SELECT id FROM users WHERE role IN ('designer','editor') AND COALESCE(department, '') IN ('', '创意部')"
    params = []
    if active_only:
        sql += " AND status='active'"
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [r['id'] for r in rows]


def get_creative_staff(admin_id=None, active_only=False):
    conn = get_db()
    sql = """SELECT id, username, real_name, role, status, department, created_at
             FROM users
             WHERE role IN ('designer','editor')
               AND COALESCE(department, '') IN ('', '创意部')"""
    params = []
    if active_only:
        sql += " AND status='active'"
    sql += " ORDER BY role, real_name"
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def batch_assign_creative_tasks(task_ids, assignee_id):
    conn = get_db()
    placeholders = ','.join('?' for _ in task_ids)
    conn.execute(
        f"""UPDATE tasks
            SET assignee_id=?,
                status=CASE WHEN status IN ('待分配','待接单') THEN '进行中' ELSE status END,
                source='assigned',
                updated_at=datetime('now','localtime')
            WHERE id IN ({placeholders})""",
        [assignee_id] + list(task_ids),
    )
    conn.commit()
    conn.close()


def get_hr_employees_for_cost(start_date, end_date):
    """获取在指定期间内在职的员工。判断条件：
    - entry_date <= end_date
    - (resign_date 为空 OR resign_date > start_date)
    - status != '离职'（或离职日期在 start_date 之后）
    返回 list of dicts。
    """
    conn = get_db()
    rows = conn.execute(
        """SELECT * FROM hr_employees
           WHERE entry_date <= ?
             AND (resign_date = '' OR resign_date IS NULL OR resign_date > ?)
             AND status != '离职'
           ORDER BY id""",
        (end_date, start_date),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
