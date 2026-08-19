# @e-mate/dsh-plugin-search-mcp

This e-Mate package adapts `gxpppp/dsh-search-mcp` commit `9562b966d2fe058676fe3163533d003c6913d7cc` to the pinned upstream `0.1.0-rc.7` services.

It registers the upstream `search-mcp` Web provider, keeps the native `web_search` Tool, disables the built-in DeepSeek search provider through a bundle patch, and stores only credential references in Settings. Credential values remain in the Harness Credentials provider and are resolved once per search.

The adapter does not provide `web_fetch`. Search traffic is restricted to the pinned HTTPS endpoints and fixed authentication fields for Tavily, Brave, Exa, and Perplexity. Arbitrary URLs, local commands, stdio transports, and runtime package downloads are not accepted; other MCP servers remain owned by the native `dsh-mcp-client` path managed by `@e-mate/dsh-plugin-mcp-manage`. Missing providers, tools, or credentials fail closed through `WebError`.

Harness services must resolve from e-Mate's pinned `0.1.0-rc.7` runtime. Do not install rc.6 packages to satisfy them.
