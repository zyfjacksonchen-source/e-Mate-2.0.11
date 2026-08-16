# @e-mate/dsh-plugin-search-mcp

This e-Mate package adapts `gxpppp/dsh-search-mcp` commit `9562b966d2fe058676fe3163533d003c6913d7cc` to the pinned upstream `0.1.0-rc.5` services.

It registers the upstream `search-mcp` Web provider, keeps the native `web_search` Tool, disables the built-in DeepSeek search provider through a bundle patch, and stores only credential references in Settings. Credential values remain in the Harness Credentials provider and are resolved once per search. Stdio MCP processes receive an allowlisted environment instead of the complete host environment.

The adapter does not provide `web_fetch`. A configured HTTP or stdio MCP endpoint is required; missing endpoints, tools, or credentials fail closed through `WebError`.

Harness `0.1.0-rc.5` service packages are not available from the public npm registry. They are optional peer dependencies here and must resolve from e-Mate's pinned, prebuilt Harness runtime. Do not install rc.6 packages to satisfy them.
