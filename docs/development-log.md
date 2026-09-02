# Development log

## 2026-09-02: native lifecycle consolidation

- The active source is `release/2.0.16` and remains pinned to DSH `0.1.0-rc.7@4da69d7c3522ee51de12822c917c503a124f7a7d` and Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`.
- `desktop/e-mate-desktop` is the sole Electron build, package, install, replacement, and update owner. The earlier local-flow, schema-2 publication, Profile hot-update, custom installer, and custom rollback implementations are retired.
- Natural-language update remains a trigger into the same Desktop interactive update lifecycle; it does not contain download or install logic.
- macOS remains an unsigned local build. Windows remains an unsigned native build on the signed-in Codex Remote Windows host. GitHub Actions validates source but does not produce release installers.
- Historical release-train contracts, evidence snapshots, acceptance images, and obsolete packaging scripts were removed from the active source tree. Exact source, candidate, installed, and public evidence remain separate.
