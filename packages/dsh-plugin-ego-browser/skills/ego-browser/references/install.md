# External ego lite prerequisite

The `ego-browser` command is supplied by the separately distributed ego lite application, not by e-Mate and not by this npm package.

Candidate setup for e-Mate 2.0.7:

1. The host must be macOS.
2. The user reviews and installs ego lite from <https://lite.ego.app/>.
3. The user completes the application's first-run onboarding.
4. The user ensures the application-provided `ego-browser` command is available to the login shell used by e-Mate.

This adapter does not download a DMG, remove quarantine attributes, modify `PATH`, launch an installer, or bypass macOS security prompts. Windows is blocked by the pinned upstream platform contract; do not replace ego-browser with another automation implementation.

Installation is not readiness evidence. Until a real macOS acceptance run proves startup, permissions, task-space isolation, cleanup, interaction, and downloads, the adapter remains `setup-required / EGO_BROWSER_RUNTIME_UNVERIFIED` and is not model- or user-invocable.
