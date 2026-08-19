# e-Mate development rules

Read `docs/target-contract.md` and the latest entry in `docs/development-log.md` before changing code. A change that contradicts the target contract is invalid even when it makes a local test pass.

## First development rule: use native DSH Creation Mode first

- For any behavior that can live in the DSH plugin plane, begin in the shipped rc.7 `cordis` preset (“创造模式”): load its `cordis-plugin-development` or `editing-cordis-compositions` skill, inspect the live Host/Client Services, Events, Tools, and Slots through `cordis_inspect_*`, then prove the smallest reversible Host/Client package with the native define/run/stop/undefine lifecycle before writing a permanent implementation. Do not guess a Harness seam from screenshots or add a parallel runtime path.
- Creation Mode is the development inner loop, not a release format or admission bypass. Its dynamic packages are process-memory experiments, disappear on restart, and must never be copied directly into a release. A successful experiment is reimplemented as the smallest ordinary repository Profile plugin, bound to the exact Base/Harness contract, and then passes its component tests, composition check, signed immutable artifact, atomic generation switch, renderer-health acknowledgement, and rollback gate.
- Preserve the complete DSH shipped preset root (`standard`, `code`, `minimal`, and `cordis`) exactly as the matching `deepseek-harness-desktop` base does. The e-Mate persona may shadow `standard` in a separate managed root; it must not replace or edit the shipped root. `cordis` is explicit opt-in and must never become the ordinary session default.
- Treat Creation Mode as shell-equivalent trust. It may inspect and temporarily extend an explicitly selected local development session, but it receives no release credentials, signing keys, Feed activation authority, or silent production enablement. If a change belongs to Electron lifecycle, native packaging/signing, updater trust, or another Base-only plane that Creation Mode cannot represent, record that reason and follow the pinned Desktop reference instead of fabricating a plugin.
- Every development-log slice for a plugin-plane change records the inspected native seam, the temporary experiment or the reason it was unnecessary, the permanent plugin that replaced it, and the narrow gate that proves no dynamic package or second path entered the release.

## Non-negotiable boundaries

- Keep the DeepSeek Harness core at the bounded target fork commit recorded in `docs/target-contract.md` (currently `df78045a127e32cb5b942defba52c539590d1596`); add e-Mate behavior through profiles, plugins, client slots, or generated distribution assets.
- Keep the enterprise surface limited to identity, model policy, and asynchronous audit. It must not control local tools, plugins, jobs, sessions, or capability availability.
- Render only real Harness events and plugin presentation metadata. Do not create fake activity events or hardcode tool names in the central chat UI.
- Preserve the model mapping and image-model fallback recorded in the target contract.
- Treat old e-Mate/ECoreX databases as read-only sources. Never resurrect cache-only deleted conversations.
- Missing credentials, test accounts, platform artifacts, or upstream packages are blockers. Do not replace them with approximate behavior or weaken acceptance.
- Reuse the `anywhere-labs/deepseek-harness-desktop` Electron/Cordis packaging and lifecycle. Desktop-only adapters such as formal packaging and auto-update belong in `desktop/e-mate-desktop`; do not add another desktop shell, Host, session transport, Agent loop, or updater protocol.

## Desktop startup contract

- macOS and Windows must keep the same upstream startup order: packaged Electron becomes ready, resolves the fixed local profile, boots the in-process Cordis Host, loads its loopback Web surface, and shows the native window. Do not replace this with a launcher service, CLI subprocess, external browser carrier, or parallel local server.
- A warm launch must never copy, install, hash the full tree of, or mutate the managed profile. The managed profile may be repaired only when its versioned installation receipt or a narrow critical-file check fails. Windows command shims may be atomically refreshed, but must not execute pnpm or DSH during application startup.
- Keep network requests, update checks/downloads, obsolete-install cleanup, CDP endpoint checks, Accessibility setup, Skill installation, and other optional maintenance outside the first-interactive-window critical path. Failures in those tasks must not delay or blank the local shell.
- Measure startup from launching the installed application to a visible, AX-readable, clickable Harness surface. Measure renderer health separately; do not use a process-alive check, a loading screen, or direct execution from a compressed DMG as an interactive-start proxy.
- Every release candidate must use the exact immutable macOS and Windows artifacts intended for publication. On release hardware, run one clean installed launch and three sequential warm launches per platform. Clean launch must be at most 10 seconds; warm-launch p75 must be at most 5 seconds and no warm launch may exceed 8 seconds. Record raw timings in `docs/development-log.md`; any regression or missing platform evidence blocks release.
- The release gate must also prove macOS arm64 reaches the interactive Harness shell, x86_64/Rosetta reaches Electron native readiness with the complete x86_64 inventory, and Windows x64 reaches renderer health. Rosetta is a compatibility probe, not an Intel startup-performance proxy; native Intel performance evidence must run on Intel hardware when required. Architecture health cannot substitute for the startup budgets above.

## Incremental release contract

- Natural-language update remains a first-class Agent operation. “检查更新”, “更新插件”, and “更新 e-Mate” must route through the one typed `e_mate_desktop_update` Tool and the existing native Desktop update service; never synthesize npm/pnpm/CLI commands, add a keyword matcher, or create a second updater. The explicit user request authorizes the signed metadata check; the native confirmation must show release version, changed components, compatibility, and remaining bytes before any component payload is downloaded and before restart is scheduled.
- Update selection is component-first and Base-fallback. A compatible signed Profile generation downloads only missing content-addressed components, is rechecked after confirmation, stages atomically, restarts, and commits only on Renderer health. `base-required` must trigger the existing Base-release check; if no compatible Base is published, report the block without staging either path.
- The one repository change-impact classifier is the authority for CI, test, and release lanes. Unknown paths, malformed input, unavailable merge bases, or incomplete component metadata fail closed to `base`; do not duplicate its path rules in workflow YAML.
- `plugin-only` is a proved property, not a label. It is valid only for independently packaged official Profile components whose exact base/Harness compatibility and production inputs are unchanged outside those component roots. A plugin-only job must emit evidence that Desktop, Harness, shared Profile, locks, packaging, updater, native helpers, permissions, and third-party state were untouched.
- A plugin incompatible with the installed base is never installed speculatively. Select a compatible Base release first; if no signed compatible base exists, block the update. Compatibility is an explicit allowlist of tested contract ids, never `>=`, caret, tag, rc-name, or other SemVer inference.
- Official updates stage a complete Profile generation, preserve the third-party overlay, switch atomically on a separately confirmed restart, and commit only after the existing renderer-health acknowledgement. Keep the 2.0.10 Desktop installer/update path and native platform gates intact for Base releases.
- Determine the affected release stages from the actual diff before dispatching CI. Reuse an already accepted immutable artifact when its product inputs are unchanged; a test, documentation, release-verifier, or single-platform change must not trigger unrelated platform or carrier rebuilds.
- Rerun only the failed or affected stage. A full cross-platform rebuild is allowed only when shared runtime code, the managed profile, bundled dependencies, lockfiles, packaging inputs, or artifact provenance changed, or when existing evidence cannot prove the artifact is unchanged and accepted.
- Reused artifacts must keep their original commit, workflow run, byte count, and SHA-256 provenance. Release workflows must verify that provenance before composition and must never relabel old bytes as a newer commit. Feed or `latest.json` activation remains the final atomic step after every selected artifact passes its own gate.

## Work loop

1. Name the active slice in the development log.
2. Record newly verified facts before changing the implementation when they affect the architecture or release path.
3. Implement the smallest end-to-end path for the slice.
4. Run the narrowest test that proves the path, then its composition check.
5. Record commands, outcomes, remaining gaps, and the next slice.

The main agent owns acceptance. A child agent may repair one documented failure, but the main agent must rerun the failed scenario before closing it.
