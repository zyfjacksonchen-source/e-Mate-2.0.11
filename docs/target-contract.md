# e-Mate Desktop 2.0.16 target contract

This is the active repository contract. It supersedes historical release-train notes, evidence matrices, and retired publication flows.

## Identity and pins

- Product name: `e-Mate`
- Product version: `2.0.16`
- GitHub repository: `zyfjacksonchen-source/e-Mate-desktop`
- DSH package baseline: `@deepseek-ai/dsh@0.1.0-rc.7`
- Harness: `zyfjacksonchen-source/deepseek-harness@32728743c28911bcd4279f79fe9c43ee7aacfb6d`
- Desktop reference: `anywhere-labs/deepseek-harness-desktop@6074088f5b660206e404b3591fab51fb99c69add`

All maintained application source is TypeScript/TSX. Generated JavaScript and packaged assets are build output, not a second implementation.

## Governance

The main agent is the sole supervisory manager. It assigns the worktree, baseline, mutually exclusive write sets, and work orders; reviews and integrates changes; enforces evidence gates; and owns installed acceptance, release, and rollback decisions.

Subagents may change only their assigned write set and run the narrowest relevant test. They do not independently expand scope, change versions, build or package installers, install, deploy, push, clean, integrate, or decide release-contract outcomes.

## Ownership

Pinned DSH rc.7 owns the Agent Loop, Sessions, durable events, model calls, Tools, approvals, attachments, Jobs, schedules, Skills, plugin loading, workspace state, and persistence. e-Mate extends those owners through existing Cordis/Profile seams and does not clone them.

Pinned DSH and `deepseek-harness-desktop` are the only native standards. There is no parallel UI, store, router, transport, Host, Agent Loop, updater, package manager, or fallback. Delete divergent paths and return callers to their native owner.

Pinned `deepseek-harness-desktop` owns the Electron lifecycle. `desktop/e-mate-desktop` is e-Mate's sole build, package, install, replacement, relaunch, and update implementation. There is no root release coordinator, alternate installer, Profile hot updater, schema-2 publication system, custom health rollback, or fallback desktop shell.

## Product adaptations

Allowed e-Mate adaptations are branding, the product Profile, enterprise identity and model policy, asynchronous redacted audit, native platform adapters required by packaged Electron, and unsigned-distribution presentation. A change outside those bounds must first prove that the pinned native owner cannot represent the requirement.

Natural-language update requests only trigger `desktopUpdates.runInteractiveUpdate()`. Background, tray, Settings, and Agent requests share the same Desktop lifecycle and the same version/download endpoints.

## Build and delivery

- Development uses Node 24.x, root `pnpm@11.7.0`, and the Desktop Yarn lock.
- Main-agent-authorized macOS packaging uses `corepack yarn --cwd desktop dist:mac` locally on macOS.
- Main-agent-authorized Windows packaging uses `corepack yarn --cwd desktop dist:win` on the already signed-in Codex Remote Windows host. SSH is not a packaging, GUI acceptance, or installed-evidence path.
- GitHub `e-Mate-desktop` stores source identity, review, and source CI. GitHub Actions, artifacts, tags, and releases are not installer production, installed acceptance, or the public release transport.
- Cloudflare/R2 is the public-production delivery boundary. Immutable objects must be uploaded and read back before official version and platform pointers are activated.
- macOS and Windows installers are intentionally unsigned. Documentation and UI must state that truthfully and must not emulate signing or notarization.
- macOS installs and replaces the canonical `/Applications/e-Mate.app`. Windows uses the canonical assisted NSIS installation and shortcut locations. Neither platform leaves a second application copy after successful replacement.
- Online update accepts only a strictly newer stable SemVer. Same-version replacement uses the official manual download page.
- Exact installer bytes must pass install, in-place replacement, and launch checks on both platforms before publication.

## Compatibility boundaries

- DSH `0.1.0-rc.7` is fixed. rc.8 packages, peers, fixtures, or inferred behavior are rejected.
- Existing user data is read and mutated only through native DSH owners. Legacy imports remain read-only at their source.
- Enterprise services may authenticate, apply bounded model/search policy, lease credentials, and append redacted audit. They never execute local Tools, mutate Sessions, install Skills, or control the Desktop updater.
- Browser plugins use Harness Connection, services, events, and slots. They do not open a parallel WebSocket/SSE transport or manufacture Session, Tool, approval, retry, or completion state.

## Evidence gates

1. **Source:** the reviewed source diff and its named focused checks. It proves no installer bytes.
2. **Candidate:** exact source provenance, fixed pins, installer bytes, and hashes from authorized native builds for each platform. It proves no installation.
3. **Installed:** those exact bytes install, replace in place, and launch on local macOS and the logged-in Codex Remote Windows machine. It proves no public activation.
4. **Public production:** immutable Cloudflare/R2 objects plus the official version and platform pointers are activated and read back. GitHub state is not a substitute.

Every gate fails closed at the first missing or mismatched fact. Tests and fixtures prove only their named boundary; another candidate, historical receipts, waivers, or narrative approval cannot fill a gap. This contract defines the `2.0.16` source target and makes no claim that installed acceptance, release, or rollback has occurred.
