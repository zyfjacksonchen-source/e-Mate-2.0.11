const MAX_INDEX_BYTES = 64 * 1024;
const VERSION = "2.0.12";
const BASE_CONTRACT_ID = "e-mate-desktop-profile-v7-dsh-e13ce9d95303";
const SCHEDULE_PROTOCOL_FLOOR = 1;
const R2_ORIGIN = "https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev";
const DESKTOP_MANIFEST_URL = "https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/latest.json";
const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_COMMIT = /^[0-9a-f]{40}$/;
const TARGETS = Object.freeze({
  "windows-x64": Object.freeze({ platform: "windows", architecture: "x64", label: "Windows x64" }),
  "macos-universal": Object.freeze({ platform: "macos", architecture: "universal", label: "macOS Universal" }),
});

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 格式无效`);
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  expected = [...expected].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} 字段无效`);
  }
}

function safeText(value, label, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`${label} 格式无效`);
  return value;
}

export function normalizeDownloadIndex(raw) {
  const manifest = object(raw, "桌面发布清单");
  exactKeys(manifest, ["schema_version", "version", "source_commit", "base_contract_id", "schedule_protocol_floor", "artifacts"], "桌面发布清单");
  if (manifest.schema_version !== 1 || manifest.version !== VERSION || !SOURCE_COMMIT.test(manifest.source_commit)
    || manifest.base_contract_id !== BASE_CONTRACT_ID || manifest.schedule_protocol_floor !== SCHEDULE_PROTOCOL_FLOOR) {
    throw new Error("桌面发布清单身份无效");
  }
  const artifacts = object(manifest.artifacts, "桌面制品");
  exactKeys(artifacts, ["darwin", "win32"], "桌面制品");
  const downloads = [
    releaseArtifact(artifacts.darwin, manifest.source_commit, "macos-universal", "e-Mate-2.0.12-mac-universal.dmg"),
    releaseArtifact(artifacts.win32, manifest.source_commit, "windows-x64", "e-Mate-2.0.12-win-x64-Setup.exe"),
  ];
  return Object.freeze({
    version: manifest.version,
    source_commit: manifest.source_commit,
    base_contract_id: manifest.base_contract_id,
    schedule_protocol_floor: manifest.schedule_protocol_floor,
    distribution_mode: "adhoc-unsigned-release",
    downloads: Object.freeze(downloads),
  });
}

function releaseArtifact(raw, sourceCommit, targetId, fileName) {
  const artifact = object(raw, "桌面制品");
  exactKeys(artifact, ["url", "bytes", "sha256", "build_source_commit", "build_run_id"], "桌面制品");
  if (artifact.url !== `${R2_ORIGIN}/desktop/releases/v${VERSION}/${sourceCommit}/${fileName}`
    || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || !SHA256.test(artifact.sha256)
    || !SOURCE_COMMIT.test(artifact.build_source_commit) || !/^[1-9][0-9]*$/.test(artifact.build_run_id)) {
    throw new Error("桌面制品身份无效");
  }
  const target = TARGETS[targetId];
  return Object.freeze({
    target: targetId,
    platform: target.platform,
    architecture: target.architecture,
    file_name: fileName,
    url: artifact.url,
    size_bytes: artifact.bytes,
    sha256: artifact.sha256,
    build_source_commit: artifact.build_source_commit,
    build_run_id: artifact.build_run_id,
    label: target.label,
  });
}

export function installationTrustCopy(index) {
  if (index.distribution_mode !== "adhoc-unsigned-release") return null;
  const windowsSigned = index.downloads.some((item) => item.target === "windows-x64" && item.authenticode?.status === "verified");
  return windowsSigned
    ? Object.freeze({ release: "Windows 已签名 · macOS 正式未签名（ad-hoc）", help: "Windows 安装包已验证数字签名；macOS 没有 Developer ID 签名或公证，请按图解只允许这一个 App。" })
    : Object.freeze({ release: "正式未签名（ad-hoc）", help: "当前正式版没有 Developer ID 签名或公证，请按图解只允许这一个 App。" });
}

export function downloadSources(index, target) {
  const download = index.downloads.find((item) => item.target === target);
  return download ? Object.freeze([download.url]) : [];
}

export function targetFromPlatformSignals({ source = "", architecture = "", renderer = "" }) {
  source = String(source).toLowerCase();
  if (/iphone|ipad|ipod/.test(source)) return null;
  if (/mac/.test(source)) return "macos-universal";
  return /win/.test(source) ? "windows-x64" : null;
}

export function macInstallGuideHref(target) {
  return target === "macos-universal" ? "./install-macos.html?target=macos-universal" : "./install-macos.html";
}

export function isMacDesktop({ source = "" } = {}) {
  source = String(source).toLowerCase();
  return /mac/.test(source) && !/iphone|ipad|ipod/.test(source);
}

async function detectTarget() {
  const source = `${navigator.platform || ""} ${navigator.userAgent || ""}`;
  let architecture = "";
  try {
    architecture = (await navigator.userAgentData?.getHighEntropyValues?.(["architecture"]))?.architecture || "";
  } catch {}
  let renderer = "";
  try {
    const context = document.createElement("canvas").getContext("webgl");
    const extension = context?.getExtension("WEBGL_debug_renderer_info");
    renderer = extension ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL) : "";
  } catch {}
  return targetFromPlatformSignals({ source, architecture, renderer });
}

async function fetchIndex(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`download index HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_INDEX_BYTES) throw new Error("下载索引过大");
    const payload = await response.text();
    if (new TextEncoder().encode(payload).byteLength > MAX_INDEX_BYTES) throw new Error("下载索引过大");
    return normalizeDownloadIndex(JSON.parse(payload));
  } finally {
    clearTimeout(timeout);
  }
}

async function loadIndex() {
  return fetchIndex(DESKTOP_MANIFEST_URL);
}

function formatBytes(value) {
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value / 1024 / 1024)} MB`;
}

function preferredPlatform(target) {
  if (target?.startsWith("windows")) return "windows";
  if (target?.startsWith("macos")) return "macos";
  const source = `${navigator.platform || ""} ${navigator.userAgent || ""}`;
  if (/iphone|ipad|ipod/i.test(source)) return null;
  if (/mac/i.test(source)) return "macos";
  return /win/i.test(source) ? "windows" : null;
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
    link.removeAttribute("download");
    detail.textContent = "请选择与你的电脑匹配的系统和芯片";
    return;
  }
  const [preferred] = downloadSources(index, target);
  label.textContent = "立即下载";
  link.href = preferred;
  link.download = download.file_name;
  detail.textContent = `已为你识别 ${download.label} · ${index.version}`;
}

function renderIndex(index, target) {
  const [major, minor] = index.version.split(".");
  const featureNav = document.querySelector("[data-feature-nav]");
  if (featureNav) featureNav.textContent = `${major}.${minor} 新功能`;
  const trustCopy = installationTrustCopy(index);
  const releaseLabel = document.querySelector("[data-release-label]");
  if (releaseLabel) releaseLabel.textContent = `当前版本 ${index.version}${trustCopy ? ` · ${trustCopy.release}` : ""}`;
  const firstLaunchHelp = document.querySelector("[data-first-launch-help]");
  if (firstLaunchHelp && trustCopy) firstLaunchHelp.textContent = trustCopy.help;
  const grid = document.querySelector("[data-downloads]");
  if (!grid) return;
  grid.replaceChildren();
  for (const download of index.downloads) {
    const sources = downloadSources(index, download.target);
    const card = document.createElement("article");
    card.className = `download-card${download.target === target ? " is-recommended" : ""}`;
    card.dataset.downloadTarget = download.target;
    card.dataset.downloadPlatform = download.platform;
    const title = document.createElement("h3");
    title.textContent = download.label;
    const meta = document.createElement("small");
    meta.textContent = `${index.version} · ${formatBytes(download.size_bytes)}`;
    const body = document.createElement("p");
    body.textContent = download.platform === "macos" ? "同时适用于 Apple 芯片与 Intel 芯片 Mac。" : "适用于 64 位 Windows 电脑。";
    const link = document.createElement("a");
    link.className = "download-link";
    link.href = sources[0];
    link.download = download.file_name;
    link.textContent = "下载安装包";
    link.setAttribute("aria-label", `下载 ${download.label}`);
    card.append(title, meta, body);
    card.append(link);
    if (download.platform === "macos") {
      const digest = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "核对 SHA-256";
      const value = document.createElement("code");
      value.textContent = download.sha256;
      digest.append(summary, value);
      card.append(digest);
      const guide = document.createElement("a");
      guide.className = "download-link";
      guide.href = macInstallGuideHref(download.target);
      guide.textContent = "查看 macOS 未签名安装图解";
      card.append(guide);
    }
    grid.append(card);
  }
  const platform = preferredPlatform(target);
  setPlatform(platform);
  setPrimary(index, target);
  document.querySelectorAll("[data-mac-install-guide]").forEach((link) => { link.href = macInstallGuideHref(target); });
  document.querySelectorAll("[data-platform]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextPlatform = button.dataset.platform;
      setPlatform(nextPlatform);
      const nextTarget = nextPlatform === "windows" ? "windows-x64" : target?.startsWith("macos") ? target : null;
      setPrimary(index, nextTarget);
      document.querySelector("#download-options")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderFailure() {
  const primary = document.querySelector("[data-primary-download]");
  const label = primary?.querySelector("[data-primary-label]");
  if (primary && label) { label.textContent = "暂时无法下载"; primary.classList.add("is-disabled"); primary.setAttribute("aria-disabled", "true"); }
  const detail = document.querySelector("[data-primary-detail]");
  if (detail) detail.textContent = "发布信息尚未准备好，请稍后刷新";
  const grid = document.querySelector("[data-downloads]");
  if (grid) grid.innerHTML = '<article class="download-card"><h3>下载信息暂不可用</h3><p>请稍后刷新页面。</p></article>';
}

if (typeof document !== "undefined") {
  const source = `${navigator.userAgentData?.platform || ""} ${navigator.platform || ""} ${navigator.userAgent || ""}`;
  document.querySelectorAll("[data-mac-install-guide]").forEach((link) => { link.hidden = !isMacDesktop({ source }); });
  const guideTarget = new URLSearchParams(location.search).get("target");
  const guideCopy = guideTarget === "macos-universal"
    ? { title: "macOS 安装 e-Mate", package: "此 Universal 安装包同时适用于 Apple 与 Intel 芯片，请只使用官方下载页。" }
    : null;
  if (guideCopy) {
    const title = document.querySelector("[data-mac-guide-title]");
    const packageNote = document.querySelector("[data-mac-guide-package]");
    if (title) title.textContent = guideCopy.title;
    if (packageNote) packageNote.textContent = guideCopy.package;
  }
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
  if (document.querySelector("[data-downloads]")) {
    Promise.all([loadIndex(), detectTarget()]).then(([index, target]) => renderIndex(index, target)).catch(renderFailure);
  }
}
