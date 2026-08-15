---
name: ego-browser
description: Browser automation candidate using ego lite on macOS or pinned Playwright MCP with system Edge on Windows; both remain setup-required.
whenToUse: Do not invoke this candidate until its platform acceptance and isolation gates pass.
metadata:
  eMateCapability: browser
  adapter: skill-cli
  setupRequiredPlatforms:
    - darwin
    - win32
  upstreamCommit: c46a439e7fbad90ad33dbea6c6af329b6009809f
---

# ego-browser

This is a thin DeepSeek Harness adapter for the external `ego-browser` command supplied by the ego lite application. Use only the Harness Bash Tool and its existing permission/approval path. Do not create another REST endpoint, WebSocket, CDP transport, browser store, router, Tool dispatcher, or background service.

## Platform gate

- macOS: stop before invoking any command and return `EGO_BROWSER_RUNTIME_UNVERIFIED`. Installation alone is insufficient until real startup, permission, task-space isolation, cleanup, interaction, and download acceptance passes.
- Windows: stop before invoking any command and return `PLAYWRIGHT_MCP_EDGE_UNVERIFIED`. Microsoft Playwright MCP `v0.0.78` with system Edge is the selected candidate, but it is not mounted until real Windows and project-isolation validation pass. See `references/windows-playwright-mcp.md`.
- Every other platform: stop before invoking any command and return `EGO_BROWSER_UNSUPPORTED_PLATFORM`. Do not use WSL, system Chrome, Playwright, or another browser as a silent fallback.
- A missing command on macOS is `EGO_BROWSER_NOT_INSTALLED`, not a reason to download or install software automatically. Read `references/install.md`; completing setup does not change the public status before acceptance evidence is recorded.

## Invocation

Run browser operations through a single Harness Bash Tool call using the upstream CLI form:

```bash
ego-browser nodejs <<'EOF'
const task = await useOrCreateTaskSpace('short task name')
cliLog('task space id: ' + task.id)
await openOrReuseTab('https://example.com', { wait: true, timeout: 20 })
cliLog(await snapshotText())
EOF
```

The heredoc body runs in the ego runtime. Browser helpers are supplied by that command; do not import Puppeteer, Playwright, or the ego-lite source package.

## Operating rules

1. Create one short task-space name for the user goal and reuse its returned numeric ID across follow-up operations. Do not mix unrelated user goals in one task space.
2. Observe before acting. Prefer `snapshotText()` and stable locators for ordinary DOM pages. Use screenshots plus coordinate/keyboard actions for canvas-like or heavily virtualized editors. Use `js()` or `cdp()` only for browser state or operations the helpers do not cover.
3. After navigation, input, click, upload, or page mutation, observe again before reporting success. Re-snapshot before reusing a transient `@N` reference.
4. Treat existing login state and page data as user-owned. Request explicit confirmation before purchases, submissions, messages, deletions, permission changes, or other externally consequential actions.
5. When the page requires login, CAPTCHA, passkey, or manual confirmation, hand control to the user through the ego task-space handoff helper. Do not seize control back until the user explicitly confirms continuation.
6. Complete the task space only after the result is verified. Use `completeTaskSpace(id, { keep: false })` unless the user asks to keep the exact live page open or must continue manually.
7. Emit relevant results with `cliLog(...)`. Do not claim completion from an empty command result or an unverified click.

Common helpers include `listTaskSpaces`, `useOrCreateTaskSpace`, `claimTaskSpace`, `handOffTaskSpace`, `takeOverTaskSpace`, `completeTaskSpace`, `listTabs`, `openOrReuseTab`, `gotoAndWait`, `snapshotText`, `captureScreenshot`, `click`, `fillInput`, `typeText`, `pressKey`, `uploadFile`, `waitForElement`, `js`, `cdp`, and `cliLog`.
