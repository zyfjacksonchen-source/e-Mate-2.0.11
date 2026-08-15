# Windows Edge candidate: setup required

Windows browser automation is intentionally disabled with `PLAYWRIGHT_MCP_EDGE_UNVERIFIED`.

The audited candidate is Microsoft `@playwright/mcp@0.0.78` (`v0.0.78`, commit `5f8fc00210b27b4407c375b59cda4838045d429c`, Apache-2.0) using the installed system Edge channel via the fixed argument `--browser msedge`.

Do not invoke or install it from this skill. In particular, do not use `npx`, `@latest`, `install-browser`, `--allow-unrestricted-file-access`, `--no-sandbox`, `--config`, `--init-page`, `--init-script`, custom environment variables, HTTP, or WebSocket transport. Do not download Chromium.

## Why activation is blocked

DeepSeek Harness rc.5 already has the correct subprocess boundary: `@deepseek-ai/dsh-mcp-client` can spawn a fixed stdio server with a scrubbed environment and register its discovered tools through `ctx.tools`. It should be reused after validation.

However, rc.5 initializes the MCP client with empty capabilities and registers no roots handler. Its plugin config accepts only a static process-start `cwd`, injects only `tools`, and never receives `WorkspaceRegistry`, Session, or `agent.session.header.cwd`. The Web `standard` Agent preset is a standing composition mounted once per preset id and shared by every joined session, not an instance per project. ACP also rejects non-empty `mcpServers`. There is therefore no target-native path that can initialize one Playwright MCP instance with the active canonical project root or bind its browser state to that Session. Real Windows 10/11 x64 plus system Edge behavior is also unverified.

Activation requires both gates:

1. a future pinned Harness version provides an active canonical project root to an MCP client instance whose lifetime is actually Session/project-bound, with a regression showing two projects never share profile, cookies, downloads, or pages; and
2. a clean Windows acceptance run proves system Edge starts without package installation, browser download, or a system Chromium dependency.

Until then, return the blocker code and do not approximate the capability.
