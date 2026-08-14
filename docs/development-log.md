# Development log

Entries are append-only. Each entry records verified facts, decisions, evidence, and remaining blockers so later work cannot silently redefine the target.

## 2026-08-14 — S00 source and release baseline

### Goal

Create the independent 2.0.7 repository, freeze the two source inputs, and establish a reproducible path to the first installable package without modifying either source repository.

### Verified facts

- DeepSeek Harness source is clean at `47f943859bef60e4160492346772ded9b24f765a`, version `0.1.0-rc.5`, MIT.
- e-Mate 2.0.5 source is clean at `564a6b6c1d43fb6831dd4a5cd8026e472f063311`, MIT.
- The planned GitHub repository did not exist in the connected installation when checked.
- npm publishes DeepSeek Harness `0.1.0-rc.2`, `0.1.0-rc.3`, and `0.1.0-rc.6`, but not the required `0.1.0-rc.5` package family.
- The exact `rc.5` source includes its own release packer and packed-install verifier. Therefore the implementation must build the dependency closure from the pinned source rather than silently consume `rc.6`.

### Decision

Keep the new repository as an overlay with the exact Harness source pinned as a Git submodule. Build release inputs from that source. Do not change the source pin to satisfy registry availability.

### Blockers

- The final npm publication layout for the unpublished `rc.5` dependency family still needs a packed-consumer proof before the public package can be published.
- Platform Office/OCR/Chromium runtime artifacts do not yet exist.

### Next action

Pin the upstream submodule, add a target-drift check, and implement the smallest `@e-mate/dsh` CLI/profile path that can boot the exact source from a development checkout.

## 2026-08-14 — Product naming correction

### Goal correction

The product remains **e-Mate 2.0.7**. “Harness” describes only the pinned DeepSeek runtime foundation and is not part of the product name.

### Applied change

- Renamed the public repository from `zyfjacksonchen-source/e-Mate-Harness` to `zyfjacksonchen-source/e-Mate`.
- Updated the local Git remote to the canonical renamed repository.
- Kept the technical npm contract `@e-mate/dsh@2.0.7` and executable `e-mate` unchanged.

### Drift rule

Repository titles, UI labels, documentation headings, package descriptions, health responses, and release pages must use `e-Mate`; references to DeepSeek Harness are allowed only when explaining the underlying technical architecture or source pin.
