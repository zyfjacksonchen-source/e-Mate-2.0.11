# Source receipt

## Existing Darwin owner (behavior preserved)

- Repository: `https://github.com/Anionex/dsh-computer-use`
- Commit: `76bfe8607f61945c1cbb84e73976e601100c13a2`
- Version: `0.1.0`
- License: MIT (notice retained in `LICENSE`)
- Native helper SHA-256: `ebccd1026d1d5767c04b956a4dacfc63a5b9143a9092a94b8cf2d5e1b725e7ab`

The e-Mate adapter changes package/client identity, explicit-turn activation, capability projection, and packaging only. The Darwin backend, service, Tools, Skill, Settings, approvals, artifacts, native sources, and helper remain owned by this exact Anionex source.

## Windows primitive provenance

- Repository: `https://github.com/jing-hy/computer-user`
- Commit: `2fbf383b49fe08e466d4d1caba659fb42b61de6b`
- License: MIT (notice retained in `LICENSE`)
- Audited candidate files/blobs:
  - `LICENSE` — `86e71c1095046ee74104b31fa4cd74b291fa03cf`
  - `src/capture.ps1` — `c26f3aec9e5ae7056567b8a9668676f5b721a7d4`
  - `src/input.ps1` — `c3b980cd0295f2e01b83ac7bd444404e7f80e1c3`
  - `src/ps.js` — `4f0ff5cbd663fd68737a3afdc0f5238540022ac9`
  - `tests/computer-user.test.js` — `0fec82640327f556d119d9777e18ae1a640fa3b9`
  - `tests/output-guard.test.js` — `5484ed08bb170dfe510a0abd2e9d03f06c6e3382`

Incorporated adaptations in `native/windows/dsh-computer-use-helper.ps1` are limited to: DPI-awareness setup from `capture.ps1` lines 15–19; the `CopyFromScreen` primitive from lines 42–49, restricted here to the exact validated HWND frame and host-allocated path; and the bounded key-name mapping idea from `input.ps1` lines 58–83. No candidate JavaScript, plugin registration, config/settings, client, Skill, Tool registry, process-global approval Set, `computer_set_mode`, raw `spawn`, arbitrary output path, or LLM output guard is incorporated. `src/ps.js` and both candidate test files were audited but contributed no runtime code.

The maintained Windows host code is TypeScript. The single packaged PowerShell helper is invoked through `ctx.subprocess` using bounded JSON stdin/stdout and an integrity manifest. Native executable path, process-start, and HWND facts stay in a backend `WeakMap`; public application identities expose only an opaque normalized-path hash, PID, and name. Windows installed-machine evidence remains OPEN until a later authorized native build and real-machine test.
