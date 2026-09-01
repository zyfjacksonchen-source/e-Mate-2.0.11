export const MAX_VERSION_BYTES = 4 * 1024;

const VERSION_ENDPOINT = "https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/version.json";
const DOWNLOADS = Object.freeze([
  Object.freeze({
    target: "macos-universal",
    platform: "macos",
    label: "macOS Universal",
    url: "https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/downloads/mac",
  }),
  Object.freeze({
    target: "windows-x64",
    platform: "windows",
    label: "Windows x64",
    url: "https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/downloads/windows",
  }),
]);
const STABLE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export function normalizeVersionIndex(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)
    || Object.keys(raw).length !== 1 || typeof raw.version !== "string"
    || !STABLE_VERSION.test(raw.version)) {
    throw new Error("版本信息格式无效");
  }
  return Object.freeze({ version: raw.version, downloads: DOWNLOADS });
}

export function parseVersionIndexText(payload) {
  if (typeof payload !== "string" || new TextEncoder().encode(payload).byteLength > MAX_VERSION_BYTES) {
    throw new Error("版本信息过大");
  }
  return normalizeVersionIndex(JSON.parse(payload));
}

export function targetFromPlatformSignals(source = "") {
  source = String(source).toLowerCase();
  if (/iphone|ipad|ipod/.test(source)) return null;
  if (/mac/.test(source)) return "macos-universal";
  return /win/.test(source) ? "windows-x64" : null;
}

export function isMacDesktop(source = "") {
  source = String(source).toLowerCase();
  return /mac/.test(source) && !/iphone|ipad|ipod/.test(source);
}

export function macInstallGuideHref(target) {
  return target === "macos-universal" ? "./install-macos.html?target=macos-universal" : "./install-macos.html";
}

async function loadIndex() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(VERSION_ENDPOINT, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`version endpoint HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_VERSION_BYTES) throw new Error("版本信息过大");
    return parseVersionIndexText(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

function preferredPlatform(target) {
  if (target?.startsWith("windows")) return "windows";
  if (target?.startsWith("macos")) return "macos";
  return null;
}

function setPlatform(platform) {
  const known = platform === "macos" || platform === "windows";
  document.querySelectorAll("[data-platform]").forEach((button) => {
    button.setAttribute("aria-pressed", String(known && button.dataset.platform === platform));
  });
  document.querySelectorAll("[data-download-target]").forEach((card) => {
    card.hidden = known && card.dataset.downloadPlatform !== platform;
  });
}

function setPrimary(index, target) {
  const link = document.querySelector("[data-primary-download]");
  const label = link?.querySelector("[data-primary-label]");
  const detail = document.querySelector("[data-primary-detail]");
  if (!link || !label || !detail) return;
  const download = index.downloads.find((item) => item.target === target);
  link.classList.remove("is-disabled");
  link.removeAttribute("aria-disabled");
  if (!download) {
    label.textContent = "选择下载版本";
    link.href = "#download-options";
    detail.textContent = "请选择与你的电脑匹配的系统";
    return;
  }
  label.textContent = "立即下载";
  link.href = download.url;
  detail.textContent = `已为你识别 ${download.label} · ${index.version}`;
}

function renderIndex(index, target) {
  const [major, minor] = index.version.split(".");
  const featureNav = document.querySelector("[data-feature-nav]");
  if (featureNav) featureNav.textContent = `${major}.${minor} 新功能`;
  const releaseLabel = document.querySelector("[data-release-label]");
  if (releaseLabel) releaseLabel.textContent = `当前版本 ${index.version} · macOS 与 Windows 均未签名`;
  const firstLaunchHelp = document.querySelector("[data-first-launch-help]");
  if (firstLaunchHelp) firstLaunchHelp.textContent = "安装包未签名；macOS 首次打开请使用本页的允许命令。";

  const grid = document.querySelector("[data-downloads]");
  if (!grid) return;
  grid.replaceChildren();
  for (const download of index.downloads) {
    const card = document.createElement("article");
    card.className = `download-card${download.target === target ? " is-recommended" : ""}`;
    card.dataset.downloadTarget = download.target;
    card.dataset.downloadPlatform = download.platform;
    const title = document.createElement("h3");
    title.textContent = download.label;
    const meta = document.createElement("small");
    meta.textContent = `${index.version} · 未签名`;
    const body = document.createElement("p");
    body.textContent = download.platform === "macos"
      ? "同时适用于 Apple 芯片与 Intel 芯片 Mac。"
      : "适用于 64 位 Windows 电脑。";
    const link = document.createElement("a");
    link.className = "download-link";
    link.href = download.url;
    link.textContent = "下载安装包";
    link.setAttribute("aria-label", `下载 ${download.label}`);
    card.append(title, meta, body, link);
    if (download.platform === "macos") {
      const guide = document.createElement("a");
      guide.className = "download-link";
      guide.href = macInstallGuideHref(download.target);
      guide.textContent = "查看 macOS 未签名安装图解";
      card.append(guide);
    }
    grid.append(card);
  }

  setPlatform(preferredPlatform(target));
  setPrimary(index, target);
  document.querySelectorAll("[data-mac-install-guide]").forEach((link) => {
    link.href = macInstallGuideHref(target);
  });
  document.querySelectorAll("[data-platform]").forEach((button) => {
    button.addEventListener("click", () => {
      const platform = button.dataset.platform;
      setPlatform(platform);
      setPrimary(index, platform === "windows" ? "windows-x64" : "macos-universal");
      document.querySelector("#download-options")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderFailure() {
  const primary = document.querySelector("[data-primary-download]");
  const label = primary?.querySelector("[data-primary-label]");
  if (primary && label) {
    label.textContent = "暂时无法下载";
    primary.classList.add("is-disabled");
    primary.setAttribute("aria-disabled", "true");
  }
  const detail = document.querySelector("[data-primary-detail]");
  if (detail) detail.textContent = "发布信息尚未准备好，请稍后刷新";
  const grid = document.querySelector("[data-downloads]");
  if (grid) grid.innerHTML = '<article class="download-card"><h3>下载信息暂不可用</h3><p>请稍后刷新页面。</p></article>';
}

if (typeof document !== "undefined") {
  const platformSource = `${navigator.userAgentData?.platform || ""} ${navigator.platform || ""} ${navigator.userAgent || ""}`;
  const target = targetFromPlatformSignals(platformSource);
  document.querySelectorAll("[data-mac-install-guide]").forEach((link) => {
    link.hidden = !isMacDesktop(platformSource);
  });
  document.querySelectorAll("[data-copy-macos-command]").forEach((copy) => {
    copy.addEventListener("click", async () => {
      const card = copy.closest(".download-card");
      const status = card?.querySelector("[data-copy-status]");
      const command = card?.querySelector("[data-macos-command-line]")?.textContent || "";
      try {
        await navigator.clipboard.writeText(command);
        if (status) status.textContent = "已复制，请粘贴到终端运行。";
      } catch {
        if (status) status.textContent = "复制失败，请手动选择上方命令。";
      }
    });
  });
  if (document.querySelector("[data-downloads]")) loadIndex().then((index) => renderIndex(index, target)).catch(renderFailure);
}
