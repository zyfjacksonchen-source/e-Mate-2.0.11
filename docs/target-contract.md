# e-Mate 2.0.15 target contract

This is the active repository contract. It supersedes historical release-train notes, evidence matrices, and retired publication flows.

## Identity and pins

- Product name: `e-Mate`
- Product version: `2.0.15`
- Repository: `zyfjacksonchen-source/e-Mate-2.0.11`
- Harness: `zyfjacksonchen-source/deepseek-harness@32728743c28911bcd4279f79fe9c43ee7aacfb6d`
- Harness version: `0.1.0-rc.7`
- Upstream Harness reference: `deepseek-ai/deepseek-harness@99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- Desktop reference: `anywhere-labs/deepseek-harness-desktop@6074088f5b660206e404b3591fab51fb99c69add`
- Base contract: `e-mate-desktop-profile-v15-dsh-32728743c289`
- Product UI reference: `zyfjacksonchen-source/ECoreX@564a6b6c1d43fb6831dd4a5cd8026e472f063311`

All maintained application source is TypeScript/TSX. Generated JavaScript and packaged assets are build output, not a second implementation.

## Ownership

Pinned DSH rc.7 owns the Agent Loop, Sessions, durable events, model calls, Tools, approvals, attachments, Jobs, schedules, Skills, plugin loading, workspace state, and persistence. e-Mate extends those owners through existing Cordis/Profile seams and does not clone them.

Pinned `deepseek-harness-desktop` owns the Electron lifecycle. `desktop/e-mate-desktop` is e-Mate's sole build, package, install, replacement, relaunch, and update implementation. There is no root release coordinator, alternate installer, Profile hot updater, schema-2 publication system, custom health rollback, or fallback desktop shell.

## Product adaptations

Allowed e-Mate adaptations are branding, the product Profile, enterprise identity and model policy, asynchronous redacted audit, native platform adapters required by packaged Electron, and unsigned-distribution presentation. A change outside those bounds must first prove that the pinned native owner cannot represent the requirement.

Natural-language update requests only trigger `desktopUpdates.runInteractiveUpdate()`. Background, tray, Settings, and Agent requests share the same Desktop lifecycle and the same version/download endpoints.

## Build and delivery

- Development uses Node 24.x, root `pnpm@11.7.0`, and the Desktop Yarn lock.
- macOS packaging uses `corepack yarn --cwd desktop dist:mac` on macOS.
- Windows packaging uses `corepack yarn --cwd desktop dist:win` on the signed-in Codex Remote Windows host.
- GitHub Actions may validate source and run Desktop checks; it is not an installer producer or release transport.
- macOS and Windows installers are intentionally unsigned. Documentation and UI must state that truthfully and must not emulate signing or notarization.
- macOS installs and replaces the canonical `/Applications/e-Mate.app`. Windows uses the canonical assisted NSIS installation and shortcut locations. Neither platform leaves a second application copy after successful replacement.
- Online update accepts only a strictly newer stable SemVer. Same-version replacement uses the official manual download page.
- Exact installer bytes must pass install, in-place replacement, and launch checks on both platforms before publication. Public immutable objects are uploaded and read back before the version pointer is activated.

## Compatibility boundaries

- DSH `0.1.0-rc.7` is fixed. rc.8 packages, peers, fixtures, or inferred behavior are rejected.
- Existing user data is read and mutated only through native DSH owners. Legacy imports remain read-only at their source.
- Enterprise services may authenticate, apply bounded model/search policy, lease credentials, and append redacted audit. They never execute local Tools, mutate Sessions, install Skills, or control the Desktop updater.
- Browser plugins use Harness Connection, services, events, and slots. They do not open a parallel WebSocket/SSE transport or manufacture Session, Tool, approval, retry, or completion state.

## Evidence boundary

Source, candidate, installed, and public-production truth are separate. Tests and fixtures prove only their named boundary. Missing platform bytes, installation evidence, or public readback remain open rather than being replaced with an assertion, waiver, or historical receipt.
