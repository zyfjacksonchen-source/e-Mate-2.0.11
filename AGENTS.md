# e-Mate development rules

Read `docs/target-contract.md` and the latest entry in `docs/development-log.md` before changing code. A change that contradicts the target contract is invalid even when it makes a local test pass.

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
- Keep network requests, update checks/downloads, obsolete-install cleanup, browser-extension setup, Accessibility setup, Skill installation, and other optional maintenance outside the first-interactive-window critical path. Failures in those tasks must not delay or blank the local shell.
- Measure startup from launching the installed application to a visible, AX-readable, clickable Harness surface. Measure renderer health separately; do not use a process-alive check, a loading screen, or direct execution from a compressed DMG as an interactive-start proxy.
- Every release candidate must use the exact immutable macOS and Windows artifacts intended for publication. On release hardware, run one clean installed launch and three sequential warm launches per platform. Clean launch must be at most 10 seconds; warm-launch p75 must be at most 5 seconds and no warm launch may exceed 8 seconds. Record raw timings in `docs/development-log.md`; any regression or missing platform evidence blocks release.
- The release gate must also prove macOS arm64 and x86_64/Rosetta renderer health and Windows x64 renderer health. Architecture health may complete after the interactive window, but it cannot substitute for the startup budgets above.

## Incremental release contract

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
