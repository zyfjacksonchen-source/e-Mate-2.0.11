# Source provenance

- Upstream: `https://github.com/vibeinging/dsh-tool-search`
- Reviewed commit: `265ce76eda21b211dc4a4c8f30d73a6826f035ca`
- License: MIT, copyright 2026 whiteicey

e-Mate retains the upstream native `ToolRuntime.restrict()` and lexical ranking design. The rc.7 adapter removes the upstream custom `tool-search/selection` Session event, restores from the native `request/header.tools` snapshot, rebuilds from the live inherited Tool view on `tools/change`, and never adds `tool_describe`, `tool_call`, a proxy registry, or another dispatcher.

