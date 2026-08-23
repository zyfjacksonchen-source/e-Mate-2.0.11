# Source

This component is repository-owned TypeScript built on the Chrome DevTools Protocol exposed by the user's installed Google Chrome. It starts that installed browser with a dedicated `$DSH_HOME/runtime/cdp-chrome` profile and loopback-only debugging port. It carries no browser binary, extension, Playwright runtime, MCP subprocess, or remotely downloaded executable.
