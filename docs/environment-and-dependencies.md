# Environment and dependencies

## User environment

e-Mate 2.0.11 is an Electron desktop application derived from the pinned `deepseek-harness-desktop` reference. Users install one platform package from the official R2-backed download page; they do not install or run the development CLI.

- macOS 13+ on arm64 or x64, delivered as one Universal DMG.
- Windows 10/11 x64, delivered as one NSIS installer.
- Linux is not a release target.
- The application contains its own Node/Electron runtime, pinned Harness closure, pnpm service shim and CPython 3.12.14 carrier. Users do not need Node, npm, pnpm, Python, Xcode, MSVC, Rust or signing tools.
- The 2.0.11 formal packages are unsigned. macOS is completely ad-hoc sealed but neither Developer ID signed nor notarized; Windows has no Authenticode identity. The download page must state this truthfully and expose the immutable artifact SHA-256.
- Browser control uses the user's existing Chrome through an explicit loopback CDP endpoint. No extension, developer mode, load-unpacked path, bundled browser or runtime download is permitted.

## Development environment

- Node 24.x from `.nvmrc`.
- Corepack with exact `pnpm@11.7.0` from the root `packageManager` field.
- Desktop uses its pinned Yarn 4.18.0 project and lock.
- Harness is exactly `zyfjacksonchen-source/deepseek-harness@b2b1650b01f0ee88d81837a9b5c050f9f763f606`, declared `0.1.0-rc.7`, based on upstream `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`.
- Base CI builds that clean Harness source once, records the emitted-library hashes in the Base SDK, and materializes those same libraries into the Desktop Yarn closure before packaging; platform jobs restore the SDK instead of rebuilding or using stale registry bytes.
- Desktop lifecycle is traced to `anywhere-labs/deepseek-harness-desktop@6074088f5b660206e404b3591fab51fb99c69add`.
- Main source is TypeScript/TSX. Browser bundles use the pinned Harness `clientBundle` preset; generated JavaScript is not a second source implementation.
- The root lock owns Base/CLI inputs. Every accepted Profile component owns a separate frozen `pnpm-lock.yaml`, is installed outside the root workspace, and ships that lock plus its signed runtime closure.

## Release topology

| Artifact | Ownership | Update behavior |
| --- | --- | --- |
| `@e-mate/desktop@2.0.11` | Electron carrier, pinned Harness, native lifecycle, updater trust root, packaged Python and platform helpers | Base lane only |
| Portable Profile component | One DSH Host/Client plugin, generated assets and bundled non-Base dependencies | Plugin-only delta after full generation composition |
| Platform Profile component | Computer Use or Vision target closure bound to exact OS/arch/runtime/signing tuple | Per-target plugin delta after native matrix |
| Signed desired state | Complete accepted component set and exact Base/Harness contract | Activated last per target |
| `desktop/latest.json` | Frozen exact 2.0.12 compatibility tombstone for legacy v6 parsers | Never advanced beyond 2.0.12 |
| `desktop/manual/v<version>/latest.json` | Create-only signed Base installer identity for formal manual bootstrap | Published and publicly read back before the active pointer |
| `desktop/signed/latest.json` | Base v7 active signed installer identity | CAS-activated last after installer acceptance |

`packages/dsh/profile/component-inventory.json` is the only accepted component roster. The CLI bundle copier, Desktop bootstrap, impact classifier, release emitter and full-generation composer consume that file. Xin Assistant is explicitly blocked from 2.0.11.

The Base exposes only enumerated ABI imports. A component cannot resolve an undeclared Base package, sibling component or parent `node_modules`; relative, absolute and `file:` imports must remain inside that component. Portable payloads contain no native binary, including binaries hidden inside archives. Platform payloads bind the target tuple and every native path/binary identity.

Vision uses the fixed Desktop CPython 3.12.14 ABI but owns its target-specific Pillow, NumPy and vtracer wheel closure. The component installs only the signed local wheelhouse with `--no-index`, `--find-links` and `--require-hashes`; runtime network installation or moving those dependencies into Base is forbidden.

## CI and release lanes

`scripts/change-impact.mjs` is the fail-closed lane authority:

- A compatible component source/test/dependency-lock change selects Plugin-only. CI builds/tests only the changed component, merges it with the immutable accepted set for all three targets, then boots the Host and Web Loader without building an installer.
- Harness/Desktop ABI, permissions, updater, Electron/native helper, shared Profile input, root/Desktop lock, packaging/signing or incompatible contract changes select Base. Base CI builds the installers and runs all accepted platform components against the new Base SDK on their native target matrix.
- Unknown or incomplete provenance selects Base. Workflow-local path lists and manual labels cannot downgrade it.

Publication never rebuilds accepted bytes. The protected workflow consumes an exact successful main CI run, production-signs Profile metadata, uploads only missing commit-scoped immutable objects, verifies authenticated and public bytes/SHA-256, rechecks the expected current pointer, and activates desired state last. Base v7 follows the same order through a create-only version manifest and the signed active pointer; legacy `desktop/latest.json` remains the exact 2.0.12 tombstone. A CI-only `mac-smoke` artifact is permanently ineligible.

## Capability and permission boundaries

| Capability | Native path | e-Mate constraint |
| --- | --- | --- |
| Search | DSH Tool/MCP/Credentials | Fixed HTTPS provider and one-way credential write; no runtime `npx` download |
| CDP browser | DSH Tools, approval and Session binding | Explicit loopback endpoint; no extension or browser download |
| Computer Use | Pinned plugin lease/confirmation path | `allowAllApps`, exact app grants or interactive lease only; Full Access is not a grant |
| Vision/OCR | Pinned Vision Skill/Tools/Web/client surfaces | Read-only enterprise Responses model route and signed offline Python dependency closure |
| Skill discovery | `find-skill` `skill_find` only | All mutations go through Skill Hub |
| Skill lifecycle | DSH Skill provider, typed Tools/Jobs and per-slug WAL | Exact version/SHA, native provider readback and restart reconciliation |
| External MCP | Pinned MCP client and explicit local consent | No secret in browser/Agent data; persistent stdio is a separate OS-user authority, never inherited from Full Access |

The DSH sandbox policy, DSH approval policy, OS privacy/TCC, credentials and plugin-owned authorization are separate domains. `danger-full-access` changes only effects defined by the sandbox contract. `approval/policy: never` rejects approval-required actions. Product mutations outside `ctx.approval` require an exact direct user action or native `UserQuestions` receipt and remain confined to their own resource.

## Mutable state and credentials

Mutable data resolves through explicit configuration, `DSH_HOME`, then `~/.dsh`. It never lives in the application bundle or immutable generation store. Sessions, attachments, workspace memory, component generations, recovery WALs, credentials references and audit outbox remain under the resolved data root.

macOS secrets use Keychain and Windows secrets use CurrentUser DPAPI. Files, Profile manifests, desired state, browser state, Agent arguments/results, logs and audit contain only non-secret credential IDs or redacted facts. The enterprise sidecar provides only authentication, model-policy delivery and asynchronous redacted audit; loss of that service cannot silently rewrite the local runtime, while enterprise model use still fails closed.

## Upgrade invariants

The installed Base verifies its own release identity, Harness ABI and bundled baseline. A component update downloads only missing content-addressed bytes, materializes a complete inactive generation on the same volume, atomically selects it for restart and commits only after Renderer health. Timeout, loader failure, content mismatch or incompatible contract restores the last-known-good generation.

Manual and natural-language updates share the same typed Desktop transaction. The Agent never synthesizes shell, npm/pnpm or restart commands. An rc.7-only component offered to an rc.6 Base returns `base-required` before any component download.
