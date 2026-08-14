# e-Mate

e-Mate 2.0.7 is a browser-first, local-running product built on the exact DeepSeek Harness source revision recorded in [`docs/target-contract.md`](docs/target-contract.md). Harness is the technical runtime foundation, not the product name.

The repository is under active implementation. It does not yet publish an accepted npm artifact. Progress and blockers are recorded in [`docs/development-log.md`](docs/development-log.md); an unchecked slice must not be described as complete.

## Frozen product boundaries

- The DeepSeek Harness Agent Loop, session log, LLM path, tool scheduler, jobs, and persistence core stay unchanged.
- The enterprise service is limited to login/authentication, model-policy delivery, and asynchronous audit observation.
- The runtime remains local. No enterprise endpoint may control local tools, plugins, jobs, or sessions.
- The deliverable is an npm package and local web process. It is not an Electron or Tauri application.

## Status

Run `pnpm check:target` to verify that source pins and release identity have not drifted.
