# Source receipt

- Upstream: <https://github.com/Lum1104/dsh-browser>
- Commit: `01f0b216b1bde88b5f9c6575ce9fb922db6fd8fb`
- License: MIT
- Verified: 2026-08-16
- Upstream checks: Host 96/96, extension 146/146, typecheck and build passed.
- Upstream real E2E did not pass: after the extension connected, the created Session was not present in its dedicated Workspace (`sessionIds=[]`). e-Mate therefore removed the upstream side-panel Session/Workspace wrapper and binds every Tool directly to the real rc.5 `exec.agent.id`.

Adaptation: the MIT page/content action implementation is retained. The rc.6 gateway RPC, event pump, extension chat/session/settings UI and extension-owned approval system are excluded. The remaining WebSocket is only the browser-extension carrier; e-Mate uses target rc.5 Tools, approval events, Session identity and WebUI renderers.
