# e-Mate 2.0.15 decisions and ownership

## Binding decisions

### D001 — Source and production are separate facts

`release/2.0.15` starts from clean canonical source `5f8c54d…`. Public production remains exact 2.0.13. A successful 2.0.14 source CI or Desktop-manifest preparation does not promote 2.0.14 to installed or production truth.

### D002 — Native owners remain unique

Session/Workspace, Tool registry, Schedule, Skill provider, Jobs, chat nodes/settings and Desktop lifecycle remain owned by the pinned rc.7/Base seams. e-Mate may change the admitted Profile component or Desktop adapter that already owns a projection; no ticket may add a parallel model, store, transport, dispatcher, scheduler, updater or transcript.

### D003 — Worktrees are created at dispatch, not in advance

The release and T00 worktrees exist. T01–T17 worktrees are created only when their dependency gate opens, from the then-current `release/2.0.15` tip. One ticket has one branch and one worktree; no uncommitted directory is shared.

### D004 — Unlisted paths fail closed

A ticket may edit only its active scope below. Directory entries include descendants. If a root cause requires an unlisted path, the worker records a dependency and stops; the integration owner assigns or transfers that exact path before editing. Descriptive globs from the workpack are not dispatch authority.

### D005 — Evidence cannot claim a later truth stage

Each ticket writes only `docs/2.0.15/evidence/Txx.json`. Mock/fixture evidence may prove a narrow contract but cannot produce `INSTALLED_E2E_PASSED`. Only exact installed bytes and real service/account receipts may advance that state. Only T18 may write production state.

### D006 — C16 retirement requires a new Base contract identity

`@deepseek-ai/dsh-launch-environment` remains in the immutable v7 Base contract but no retained component imports it after T04. Do not weaken the union validator or silently mutate v7. T18 must create an honestly versioned successor Base contract and rebind every retained component before RC admission; until then the strict inventory failure is a release blocker, not a T04 regression.

## Exclusive static scopes

| Ticket | Exact owned paths while active |
| --- | --- |
| T00 / integration owner | `docs/2.0.15/BASELINE.md`, `docs/2.0.15/STATUS.md`, `docs/2.0.15/DECISIONS.md`, `docs/target-contract.md`, append-only `docs/development-log.md` after worker handoff |
| T01 | `.github/workflows/`; `scripts/change-impact.mjs`, `scripts/change-impact.test.mjs`, `scripts/component-release.mjs`, `scripts/component-release.test.mjs`, `scripts/release-coordinator.mjs`, `scripts/release-coordinator.test.mjs`, `scripts/release-source.mjs`, `scripts/release.mjs`, `scripts/release.test.mjs`, `scripts/profile-release.mjs`, `scripts/profile-release.test.mjs`, `scripts/publish-profile-r2.mjs`, `scripts/publish-profile-r2.test.mjs`, `scripts/desktop-admission.mjs`, `scripts/desktop-admission.test.mjs`, `scripts/build-harness-runtime.mjs`, `artifacts/release/profile-current-snapshot.json`; new `docs/2.0.15/CI.md` |
| T02 | new `scripts/smoke/`, new `tests/smoke/`, new ticket-specific fixtures under those roots; `docs/2.0.15/REGRESSION-MATRIX.md` after T00 handoff |
| T03 | new `docs/2.0.15/AUDIT-COMPONENTS.md`, `docs/2.0.15/AUDIT-USER-FLOWS.md`, `docs/2.0.15/AUDIT-TECH-DEBT.md`; optional single `scripts/audit-2.0.15.mjs` only |
| T04 | `packages/dsh-plugin-xin-assistant/`, `packages/dsh/profile/component-inventory.json`, `packages/dsh/src/e-mate.ts`, `desktop/e-mate-desktop/src/e-mate-profile.ts`, `desktop/e-mate-desktop/scripts/verify-packaged-runtime.ts`, `desktop/e-mate-desktop/tests/e-mate-profile.spec.ts`, `desktop/e-mate-desktop/tests/e-mate-profile-win.spec.ts`, `desktop/e-mate-desktop/tests/profile-component.spec.ts`, `desktop/e-mate-desktop/tests/verify-packaged-runtime.spec.ts`, `.gitattributes`, `pnpm-lock.yaml`, `scripts/base-sdk.mjs`, `scripts/stage-desktop-profile-artifact.mjs`, `scripts/sync-emate-plugin-bundles.mjs` |
| T05 | `packages/dsh-plugin-tool-search/`, `packages/dsh/src/profile/agent-operations.ts`, `packages/dsh/src/profile/image-generation.ts`, `packages/dsh/profile/cordis.patch.yml` |
| T06 | `packages/dsh-plugin-schedules/`; new `packages/dsh/profile/plugins/emate-shell/src/client/schedules-page.tsx`, `packages/dsh/profile/plugins/emate-shell/src/client/schedules-page.module.css`, `packages/dsh/profile/plugins/emate-shell/tests/schedules-page.client.spec.tsx` |
| T07 | `packages/dsh-plugin-skill-hub/`, `enterprise/apps/skill-hub-worker/`, `docs/skill-hub-compatibility.md` |
| T08 | `packages/dsh/src/profile/share.ts`, `packages/dsh/profile/plugins/emate-shell/src/client/session-share.tsx`, `packages/dsh/profile/plugins/emate-shell/src/client/session-share.module.css`, `packages/dsh/profile/plugins/emate-shell/tests/session-share.client.spec.tsx`, `enterprise/apps/share-worker/` |
| T09 | `desktop/e-mate-desktop/src/agent-update.ts`, `desktop/e-mate-desktop/src/electron-runtime.ts`, `desktop/e-mate-desktop/src/mac-update-helper.ts`, `desktop/e-mate-desktop/src/mac-update-installer.ts`, `desktop/e-mate-desktop/src/main.ts`, `desktop/e-mate-desktop/src/preload.ts`, `desktop/e-mate-desktop/src/profile-update.ts`, `desktop/e-mate-desktop/src/update-checker.ts`, `desktop/e-mate-desktop/src/update-download.ts`, `desktop/e-mate-desktop/src/update-presentation.ts`, `desktop/e-mate-desktop/src/updates.ts`, `desktop/e-mate-desktop/src/windows-acl-runner.ts`, `desktop/e-mate-desktop/src/windows-update-installer.ts`, `desktop/e-mate-desktop/src/windows-volume-diagnostics.ts`, `desktop/e-mate-desktop/build/windows-update-transaction.ps1`, `desktop/e-mate-desktop/build/installer.nsh`, `desktop/e-mate-desktop/tests/agent-update.spec.ts`, `desktop/e-mate-desktop/tests/electron-runtime.spec.ts`, `desktop/e-mate-desktop/tests/mac-update-installer.spec.ts`, `desktop/e-mate-desktop/tests/profile-update.spec.ts`, `desktop/e-mate-desktop/tests/update-checker.spec.ts`, `desktop/e-mate-desktop/tests/update-download.spec.ts`, `desktop/e-mate-desktop/tests/updates.spec.ts`, `desktop/e-mate-desktop/tests/windows-update-installer.spec.ts`, `desktop/e-mate-desktop/tests/windows-update-transaction.spec.ts`, `desktop/e-mate-desktop/tests/windows-volume-diagnostics.spec.ts` |
| T10 | `packages/dsh/src/profile/identity/`, `enterprise/apps/analytics-api/`, `enterprise/apps/model-gateway/src/postgres-usage-store.ts`, `enterprise/apps/model-gateway/src/server.ts`, `enterprise/apps/model-gateway/src/production.ts`, `enterprise/apps/model-gateway/src/index.ts`, new `enterprise/apps/model-gateway/src/activity-contract.ts`, `enterprise/apps/model-gateway/tests/model-gateway-contract.test.ts`, `enterprise/apps/model-gateway/tests/production-configuration.test.ts`, new `enterprise/apps/model-gateway/tests/postgres-usage-store.test.ts`, new `enterprise/apps/model-gateway/tests/activity-contract.test.ts` |
| T11 | `packages/dsh/profile/plugins/emate-shell/src/client/account.tsx`, `packages/dsh/profile/plugins/emate-shell/src/client/account.module.css`, `packages/dsh/profile/plugins/emate-shell/src/client/home.module.css`, new `packages/dsh/profile/plugins/emate-shell/src/client/quick-templates.tsx`, `packages/dsh/profile/plugins/emate-shell/src/client/quick-templates.module.css`, `packages/dsh/profile/plugins/emate-shell/src/client/usage-heatmap.tsx`, `packages/dsh/profile/plugins/emate-shell/src/client/usage-heatmap.module.css`, new `packages/dsh/profile/plugins/emate-shell/tests/quick-templates.client.spec.tsx`, `packages/dsh/profile/plugins/emate-shell/tests/usage-heatmap.client.spec.tsx`, `packages/dsh/profile/plugins/emate-shell/tests/account-home.client.spec.tsx` |
| T12 | `packages/dsh/profile/plugins/emate-shell/src/client/activity-fold.tsx`, `packages/dsh/profile/plugins/emate-shell/src/client/activity-fold.module.css`, new `packages/dsh/profile/plugins/emate-shell/src/client/message-mode-settings.tsx`, `packages/dsh/profile/plugins/emate-shell/src/client/message-mode-settings.module.css`, `packages/dsh/profile/plugins/emate-shell/tests/activity-fold.client.spec.tsx`, new `packages/dsh/profile/plugins/emate-shell/tests/message-mode-settings.client.spec.tsx` |
| T13 | `packages/dsh/profile/plugins/emate-shell/src/client/sidebar.tsx`, `packages/dsh/profile/plugins/emate-shell/src/client/sidebar.module.css`, `packages/dsh/profile/plugins/emate-shell/src/client/settings-chrome.tsx`, `packages/dsh/profile/plugins/emate-shell/src/client/settings-chrome.module.css`, `packages/dsh/profile/plugins/emate-shell/src/client/composer-connectors.tsx`, `packages/dsh/profile/plugins/emate-shell/src/client/composer-connectors.module.css`, `packages/dsh/profile/plugins/emate-shell/tests/sidebar-home-fidelity.client.spec.tsx`, `packages/dsh/profile/plugins/emate-shell/tests/sidebar-settings-route.client.spec.tsx`, `packages/dsh/profile/plugins/emate-shell/tests/composer-205.client.spec.tsx`, `packages/dsh/profile/plugins/emate-shell/tests/header-controls.client.spec.tsx` |
| T14 | `desktop/e-mate-desktop/build/app-icon.png`, `desktop/e-mate-desktop/build/app-icon-mac.png`, `desktop/e-mate-desktop/scripts/generate-mac-app-icon.mjs`, new `desktop/e-mate-desktop/build/icon.iconset/`, `desktop/e-mate-desktop/build/icon.icns`, `desktop/e-mate-desktop/build/icon.ico`, `desktop/e-mate-desktop/tests/tray-icons.spec.ts`, new `desktop/e-mate-desktop/tests/app-icon.spec.ts` |
| T15 | `packages/dsh-plugin-cdp/`, `packages/dsh-plugin-computer-use/`, `packages/dsh-plugin-find-skill/`, `packages/dsh-plugin-vision-toolkit/` |
| T16 | `packages/dsh-plugin-better-sidebar/`, `packages/dsh-plugin-file-import/`, `packages/dsh-plugin-genui/`, `packages/dsh-plugin-glass-composer/`, `packages/dsh-plugin-mcp-manage/`, `packages/dsh-plugin-memory-evolve/`, `packages/dsh-plugin-office-skills/` |
| T17 | `docs/2.0.15/TENCENT-BACKLOG.md` only; any mapped product fix becomes a separately assigned exact lease and is not implied by T17 |
| T18 | `docs/2.0.15/RELEASE-NOTES.md`, `docs/2.0.15/evidence/T18.json`, and only the exact freeze-lease paths enumerated below; no workflow implementation and no product redesign |

Every ticket additionally owns only its distinct `docs/2.0.15/evidence/Txx.json`.

## Sequential leases for shared files

These files are never edited concurrently. A lease transfers only after the earlier owner is merged and its worktree is clean.

| Exact path | Lease order |
| --- | --- |
| `packages/dsh/profile/plugins/emate-shell/src/client/home.tsx` | T06 extraction → T11 Home |
| `packages/dsh/profile/plugins/emate-shell/src/client/index.ts` | T06 registration → T11 registration → T12 registration → T13 final navigation integration |
| `packages/dsh/profile/plugins/emate-shell/src/client/header-controls.tsx` and `header-controls.module.css` | T08 Share state → T13 final header layout |
| `packages/dsh/test/e-mate.test.mjs` | T04 absence coverage → T05 routing coverage; later tickets use ticket-specific test files unless reassigned |
| `package.json` | T01 scripts → T18 version-only freeze |
| `desktop/e-mate-desktop/package.json` | T14 icon configuration → T18 version-only freeze; T09 must not edit it |
| `pnpm-lock.yaml` | T04 retirement → T18 only if the final version bump materially changes it |
| `packages/dsh/package.json`; `packages/dsh/profile/plugins/emate-shell/package.json`; `packages/dsh-plugin-better-sidebar/package.json`; `packages/dsh-plugin-cdp/package.json`; `packages/dsh-plugin-computer-use/package.json`; `packages/dsh-plugin-file-import/package.json`; `packages/dsh-plugin-find-skill/package.json`; `packages/dsh-plugin-genui/package.json`; `packages/dsh-plugin-glass-composer/package.json`; `packages/dsh-plugin-mcp-manage/package.json`; `packages/dsh-plugin-memory-evolve/package.json`; `packages/dsh-plugin-office-skills/package.json`; `packages/dsh-plugin-schedules/package.json`; `packages/dsh-plugin-skill-hub/package.json`; `packages/dsh-plugin-tool-search/package.json`; `packages/dsh-plugin-vision-toolkit/package.json` | owning T05/T06/T07/T15/T16 ticket → T18 version-only freeze |
| `packages/dsh/src/update.ts`; `packages/dsh/src/profile/target-runtime.ts`; `packages/dsh/src/profile/health.ts`; `packages/dsh/src/profile/identity/enterprise-provider.ts`; `packages/dsh/src/e-mate.ts`; `scripts/build-harness-runtime.mjs`; `scripts/check-target.mjs`; `scripts/release-source.mjs`; `scripts/release.mjs`; `scripts/sync-emate-plugin-bundles.mjs`; `desktop/e-mate-desktop/base-contract.json`; `packages/dsh/profile/component-inventory.json`; `docs/target-contract.md` | current functional owner → T18 version/contract-only freeze after P0 closure |
| `desktop/e-mate-desktop/tests/electron-runtime.spec.ts`; `desktop/e-mate-desktop/tests/mac-update-installer.spec.ts`; `enterprise/apps/model-gateway/tests/model-gateway-contract.test.ts`; `packages/dsh-plugin-computer-use/test/contract.test.mjs`; `packages/dsh-plugin-find-skill/test/contract.test.mjs`; `packages/dsh-plugin-mcp-manage/test/contract.test.mjs`; `packages/dsh-plugin-vision-toolkit/test/contract.test.mjs`; `packages/dsh/test/e-mate.test.mjs`; `scripts/change-impact.test.mjs`; `scripts/release-coordinator.test.mjs`; `scripts/release.test.mjs` | current functional owner → T18 version-assertion-only freeze |
| `docs/2.0.15/REGRESSION-MATRIX.md` | T00 seed → T02 executable matrix; T18 consumes without redesign |
| `docs/2.0.15/RELEASE-NOTES.md` | T00 non-claiming stub → T18 final user-facing notes |

`packages/dsh/profile/component-inventory.json` is T04-only and freezes immediately after xin retirement. T15/T16 may not add components. `scripts/change-impact*` remains T01-only; T04 supplies required retirement cases to T01 rather than editing the classifier concurrently.

## Merge gates

- T03 inventory must precede T04 deletion.
- T05 contract must precede T06/T07 and be consumed, not reimplemented.
- T06 must release `home.tsx` before T11. T11 must release the settings/index seam before T12. T12 must release it before T13.
- T08 must release Header controls before T13.
- T01 must release CI/package-script and icon-cache contracts before T09/T14.
- T18 acquires version leases only after all product worktrees are clean and all P0 installed gates are satisfied.
