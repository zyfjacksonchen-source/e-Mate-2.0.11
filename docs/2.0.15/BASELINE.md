# e-Mate 2.0.15 baseline

Verified on 2026-08-27. This document separates repository source, candidate evidence and public production state. A later source change or public-pointer change requires a new readback before dispatch.

## Authority and workpack

| Item | Verified fact |
| --- | --- |
| Canonical repository | `https://github.com/zyfjacksonchen-source/e-Mate-2.0.11.git` |
| Workpack ZIP SHA-256 | `81ef2d4a62c040ad21074c857f10938a835d94c81b1fc0967575728aa35ac752` |
| Workpack manifest | Every listed file, document, ticket, index and reference image passed SHA-256 verification |
| Workpack baseline | commit `4474939fe186739a7745584c6589e55695302cb2`, tree `489fcfbc93d0fd582cbd760156bd5ea12b53e3e3` |
| Current canonical source | commit `5f8c54db7b76276c14f1938c970df155f4e6fd80`, tree `992143d0f5fbbd15ade365ec6d36a3d8e88126f8` |
| Integration branch start | local `release/2.0.15` at the current canonical source |

No matching clean local checkout of the canonical URL was found before cloning. The temporary execution-pack directory was not treated as a repository and its unrelated files were not inspected.

## Difference from the workpack baseline

`origin/main` is one commit ahead of the workpack baseline:

```text
5f8c54d fix: restore 2.0.14 runtime and update contracts
73 files changed, 786 insertions, 183 deletions
```

The delta is material and is not silently inherited as an accepted release:

- checked-in product packages advanced from 2.0.13 to 2.0.14;
- Tool Search/ImageGen routing, packaged Find Skill launch inputs and Main/Preload Renderer bootstrap changed;
- the existing macOS updater gained an exact 2.0.12 legacy-request bridge while preserving the modern path;
- the 2.0.14 target/slice contracts and release bindings changed;
- Base/Harness/Desktop pins did not change;
- no 2.0.14 installed-acceptance or production-release receipt was added to the repository log.

Consequences for 2.0.15:

1. `5f8c54d…` is the source baseline because the user explicitly required current `origin/main`.
2. Public 2.0.13 remains the production predecessor until a newer exact public receipt is verified.
3. The 2.0.14 source changes must be audited as existing implementation. T05, T09 and T15 must not recreate them or treat source/CI success as installed closure.
4. T18 must re-read public pointers immediately before freeze. It may not assume that this 2026-08-27 snapshot is still current.

## 2.0.14 task handoff provenance

The user transferred the changes, conclusions and remaining progress from Codex task `01a02e48-f61f-7352-bc86-b5ec8771d46c` (title `e-Mate 2.0.13-14`) to this 2.0.15 coordinator. That task is historical context, not a second source checkout: its last readable long turn was interrupted and referenced an older dirty 2.0.13 development worktree.

The accepted 2.0.14 implementation is instead fixed by repository evidence:

- `a4fd5170888513e30ea73a915c335fc8c87546f3` restored the existing capability-routing, packaged Find Skill launch and Main/Preload Renderer-bootstrap contracts;
- `4bfe0c333348dceead6d7e7b4b4f5b1639468dc8` added the exact 2.0.12 macOS request-envelope bridge while preserving the 2.0.13-and-later bound updater path;
- the tree of `4bfe0c3…` is byte-identical to the squashed protected-main source `5f8c54db7b76276c14f1938c970df155f4e6fd80` (`992143d0f5fbbd15ade365ec6d36a3d8e88126f8`). No old dirty worktree needs to be copied or cherry-picked.

The handoff therefore maps to existing 2.0.15 owners rather than reopening a parallel 2.0.14 train: T05 audits and extends Tool/Image/Search routing, T09 owns updater transactions and compatibility, and T15 owns the remaining runtime/connector and native image-intake acceptance. The old task's broader Pet, Cowart, browser and other pre-scope proposals are not inherited as completed work and do not override the current T00–T18 work orders.

The release conclusion remains unchanged: 2.0.14 source and CI/preparation evidence existed, but no complete Profile release, installed acceptance or public 2.0.14 pointer was produced. Public production remains the exact 2.0.13 receipts below until T18 verifies otherwise.

## Base, pins and inventory

| Item | Current source fact |
| --- | --- |
| Checked-in source version | `2.0.14` |
| Target version | `2.0.15` (version bump deferred to T18) |
| Base contract | `e-mate-desktop-profile-v7-dsh-b2b1650b01f0` |
| Schedule protocol floor | `1` |
| Harness | `0.1.0-rc.7 @ b2b1650b01f0ee88d81837a9b5c050f9f763f606` |
| Desktop reference | `6074088f5b660206e404b3591fab51fb99c69add` |
| Inventory | 16 rows: 13 portable Profile, 3 platform Profile |
| Blocked inventory row | `@e-mate/dsh-plugin-xin-assistant`, package still at `2.0.12`, three `vendor-native` targets |
| Public active components | 15 components; xin-assistant is not present in the public desired states |

The fresh T00 clone intentionally did not initialize submodule working directories. Gitlink facts were read from the canonical tree: the Harness gitlink exactly matches the Base contract. Any implementation worktree must initialize only the required pinned submodules before using them as native evidence.

## Accepted public 2.0.13 receipts

Live no-cache readback on 2026-08-27 from the repository-pinned public origin `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev` returned:

| Public object | Version/source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `desktop/signed/latest.json` | `2.0.13` / `6f63b5238d5874a1973a5ce0c1c9f832d277c865` | 2,961 | `d26b9ffb5f30531bc5de6c9f66aab47c3718248e2ff109d82cd3a763f0c02887` |
| `desktop/latest.json` | identical to signed pointer | 2,961 | `d26b9ffb5f30531bc5de6c9f66aab47c3718248e2ff109d82cd3a763f0c02887` |
| desired state `darwin-arm64` | release `2.0.13`, sequence 1, 15 components | 10,579 | `ef84577746222d8696a9c438dafe0876aeecd1433942a6b0ac65a632ecc5a462` |
| desired state `darwin-x64` | release `2.0.13`, sequence 1, 15 components | 10,567 | `374318de4e0a459abd73541c7c0de4ed7388218146d164982d21dbc2bc37bd9d` |
| desired state `win32-x64` | release `2.0.13`, sequence 1, 15 components | 10,503 | `beef5d1ddc380c4177d177dc0134acd1bf3a5960caa49b835c8f6dd972cfb6c1` |

All three desired states bind the same v7 Base contract and Harness pin above. The repository development log also records the exact 2.0.13 installer and GitHub artifact receipts; this live readback confirms that those public pointer identities remain active.

## Current 2.0.14 truth stage

| Evidence | Result | Truth allowed |
| --- | --- | --- |
| exact-source main CI `33048904190` | success at `5f8c54d…` | source checks and CI candidate bytes exist; branch-protection acceptance was not inferred |
| Desktop release preparation `33050842397` | success | admission-pending Desktop artifact exists; not released |
| Profile release `33050840728` | failed | no complete signed Profile publication bundle |
| release coordinator `33050810288` | failed because Profile release failed | no completed release-state chain |
| public manual `v2.0.14/latest.json` | HTTP 404 | no public 2.0.14 manual manifest |
| signed/legacy pointers | still exact 2.0.13 bytes | 2.0.14 is not production released |

The Profile release failed before publication with `Profile current desired-state snapshot is invalid`. The checked-in snapshot identifies older 2.0.12 objects, while live public desired states identify the 2.0.13 objects listed above. This is a named T01 release-input defect and a T18 release blocker; T00 does not repair it or write production state.

## Baseline decision

The 2.0.15 source baseline is closed at `5f8c54d…` with a clean working tree and an explicit source/public split. It is safe to perform T01/T02/T03 planning and narrow source work after the T00 commit. Formal installed/predecessor acceptance and publication remain blocked until their own ticket gates close; no current evidence authorizes a 2.0.15 candidate or production write.
