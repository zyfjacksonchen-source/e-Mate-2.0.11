# Source and compatibility receipt

- Catalog repository: <https://github.com/dsh-external/dsh-browser-panel>
- Catalog repository status: unavailable (HTTP 404 when verified on 2026-08-15).
- npm package status: no verifiable `dsh-browser-panel` package when verified on 2026-08-15.
- Upstream source included: none.
- Clean-room implementation: e-Mate status adapter only; no browser-control implementation.
- Harness version: `@deepseek-ai/dsh@0.1.0-rc.5`.
- Harness commit: `47f943859bef60e4160492346772ded9b24f765a`.
- Host seam: loopback `ctx.connection.rpc.handle`.
- Browser seam: `conversation.view` plus `ctx.connection.rpc.call`.
- Windows candidate: `@playwright/mcp@0.0.78` with system Edge.
- Windows blocker: pinned rc.5 MCP Client has empty capabilities, only a static boot-time `cwd`, one standing preset mount shared by joined Sessions, and no Session/project-bound workspace-root path; real Windows acceptance is pending. Report only `setup-required / PLAYWRIGHT_MCP_EDGE_UNVERIFIED`.
- macOS provider state: `setup-required / EGO_BROWSER_RUNTIME_UNVERIFIED` pending real runtime acceptance.
- Explicit exclusions: standalone REST/WebSocket, independent Store/Router, browser subprocess/runtime, model configuration, synthetic browser events.
