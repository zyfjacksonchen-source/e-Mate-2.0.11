# Upstream source record

- Repository: <https://github.com/citrolabs/ego-lite>
- Commit: `c46a439e7fbad90ad33dbea6c6af329b6009809f`
- Upstream component: `skills/ego-browser`
- Upstream license: MIT, copyright 2026 CitroLabs.
- Adaptation: reduced the upstream instruction set to the public DeepSeek Harness Skill and Bash seams, removed automatic application download/install behavior, made the macOS-only support explicit, and added a Windows/other-platform fail-closed result. No ego-browser runtime source or closed-source application binary is included.

## Audited Windows Edge candidate (not distributed or activated)

- Official repository: <https://github.com/microsoft/playwright-mcp>
- Tag/package: `v0.0.78` / `@playwright/mcp@0.0.78`
- Commit: `5f8fc00210b27b4407c375b59cda4838045d429c`
- License: Apache-2.0, copyright Microsoft Corporation.
- Package integrity: `sha512-XLTUeA6mEN9sQ+hJ4dfG8EIkDbxS0K3Trc2RBkUJuf02TgE2FQRNTMtq/aJfhyRMINsRl/Ybc4sxcWLtFn4/TQ==`.
- Exact dependencies: `playwright@1.62.0-alpha-1783623505000` and `playwright-core@1.62.0-alpha-1783623505000`.
- npm lifecycle audit: registry metadata for all three exact packages contains no `preinstall`, `install`, or `postinstall` script. Their installation downloads JavaScript packages, not a Chromium browser. The MCP CLI has a separate `install-browser` command, which this adapter forbids and never invokes.
- Intended transport after validation: the pinned Harness rc.5 `@deepseek-ai/dsh-mcp-client` stdio seam, fixed to `--browser msedge`; never `npx`, `latest`, HTTP, WebSocket, arbitrary command/env, `install-browser`, or a bundled Chromium platform package.
- Current blocker: rc.5 creates its MCP Client with `capabilities: {}`, registers no roots handler, injects only `tools`, and accepts only a static boot-time `cwd`. The Web standard preset is one standing mount per preset id, shared by joined Sessions, and ACP rejects non-empty `mcpServers`; neither WorkspaceRegistry nor `agent.session.header.cwd` reaches MCP initialization. A target-native Session/project-bound browser instance therefore cannot be configured. Real Windows/Edge execution has also not been verified. Windows remains `PLAYWRIGHT_MCP_EDGE_UNVERIFIED`, with no MCP client row or runtime dependency added.

No Microsoft source or binary is copied into this package. Apache-2.0 redistribution files become required only if a future validated slice actually distributes that dependency or derived source.
