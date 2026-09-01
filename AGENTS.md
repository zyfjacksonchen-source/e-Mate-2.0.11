# e-Mate repository rules

These rules are the repository's highest-priority engineering contract. Historical notes and evidence do not override them.

## First principle: native DSH first

1. Read `desktop/e-mate-desktop/base-contract.json` before changing runtime behavior. The only accepted Harness baseline is `@deepseek-ai/dsh@0.1.0-rc.7`, repository commit `32728743c28911bcd4279f79fe9c43ee7aacfb6d`. The only accepted Desktop reference is `anywhere-labs/deepseek-harness-desktop@6074088f5b660206e404b3591fab51fb99c69add`.
2. Trace the complete rc.7 native path before adding code. Reuse its Agent Loop, Session, event projection, Tool, approval, Job, Skill, workspace, storage, settings, plugin, slot, and lifecycle owners. Fix a shared native defect at its owner when possible; keep an e-Mate adapter only for a real product-specific difference.
3. Never infer native behavior from a floating branch, another release candidate, a newer DSH version, or a historical e-Mate implementation. Do not add a second Host, Agent Loop, transport, Session store, Tool registry, updater, package manager, or fallback path.

## Sole Desktop owner

`desktop/e-mate-desktop` is the only owner of Electron startup, build, platform packaging, installation, replacement, relaunch, and online update. Its implementation follows the pinned `deepseek-harness-desktop` lifecycle; e-Mate changes are limited to branding, the product Profile, enterprise policy, platform-required adapters, and truthful unsigned-distribution behavior.

- Build and verify through the existing Desktop workspace only: `corepack yarn --cwd desktop check`, `corepack yarn --cwd desktop dist:mac`, and `corepack yarn --cwd desktop dist:win`.
- macOS builds locally. Windows builds on the already signed-in Codex Remote Windows machine. Do not introduce SSH, GitHub Actions artifacts, a root release coordinator, or another packaging wrapper as a fallback.
- Keep the macOS package unsigned and unnotarized unless real signing credentials are deliberately introduced. The supported flow downloads the DMG, lets the user grant trust, and replaces `/Applications/e-Mate.app` in place.
- Keep the Windows package on the native assisted NSIS path. New install and replacement use the same canonical installation directory and shortcut set.
- Tray, background, Settings, and natural-language update requests converge on the same Desktop update lifecycle. Natural language may trigger `desktopUpdates.runInteractiveUpdate()` only; it must not own URLs, download, verification, installation, replacement, or rollback logic.
- Online update accepts only a strictly newer stable version. Same-version replacement and migration from older unsupported readers use the official manual download page, not a second feed.

## Source and extension boundaries

- Keep e-Mate product behavior in existing Profile plugins, Cordis services, Harness Tools, and client slots. Prefer deletion to wrappers and positive reuse to compatibility shims.
- Preserve exact dependency pins and lockfiles. `pnpm@11.7.0` and DSH `0.1.0-rc.7` are fixed; any rc.8 DSH dependency is a contract failure.
- Generated build output, installers, local run receipts, caches, and acceptance screenshots do not belong in source control.
- Historical documents are context only. Current code, `base-contract.json`, this file, and `docs/target-contract.md` define the active repository contract.

## Verification and release truth

- Match verification to the change. Run the narrow owner test first; run the Desktop platform check when build, packaging, install, or update behavior changes.
- Source success is not installer success. Installer success is not installed replacement success. Installed success is not public release success. Report each boundary honestly.
- A release is complete only after the exact macOS and Windows bytes install, replace in place, launch, and are read back from the official public download surface. Publish immutable bytes first and activate the version pointer last.
- Do not restore removed schema-2 signing orchestration, Profile hot-update publication, custom health rollback, local-flow coordinators, performance admission, or parallel package/update paths.

## Worktree hygiene

- Work in the named repository worktree, not `/Users/mac/e-mate` itself.
- Never discard another worktree's uncommitted changes. Remove old worktrees only after proving them clean; build output and dependency caches are rebuildable.
- Before pushing, inspect `git status`, the actual diff, and the focused checks. Push the exact committed source branch without inventing release evidence.
