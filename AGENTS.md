# e-Mate Harness development rules

Read `docs/target-contract.md` and the latest entry in `docs/development-log.md` before changing code. A change that contradicts the target contract is invalid even when it makes a local test pass.

## Non-negotiable boundaries

- Keep the DeepSeek Harness core at commit `47f943859bef60e4160492346772ded9b24f765a`; add e-Mate behavior through profiles, plugins, client slots, or generated distribution assets.
- Keep the enterprise surface limited to identity, model policy, and asynchronous audit. It must not control local tools, plugins, jobs, sessions, or capability availability.
- Render only real Harness events and plugin presentation metadata. Do not create fake activity events or hardcode tool names in the central chat UI.
- Preserve the model mapping and image-model fallback recorded in the target contract.
- Treat old e-Mate/ECoreX databases as read-only sources. Never resurrect cache-only deleted conversations.
- Missing credentials, test accounts, platform artifacts, or upstream packages are blockers. Do not replace them with approximate behavior or weaken acceptance.
- Do not add Electron, Tauri, signing, notarization, or desktop auto-update code.

## Work loop

1. Name the active slice in the development log.
2. Record newly verified facts before changing the implementation when they affect the architecture or release path.
3. Implement the smallest end-to-end path for the slice.
4. Run the narrowest test that proves the path, then its composition check.
5. Record commands, outcomes, remaining gaps, and the next slice.

The main agent owns acceptance. A child agent may repair one documented failure, but the main agent must rerun the failed scenario before closing it.

