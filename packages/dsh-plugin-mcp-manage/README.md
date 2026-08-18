# @e-mate/dsh-plugin-mcp-manage

Codex-like management plane for external MCP connections. Non-secret definitions use DSH Settings; bearer and OAuth credentials use DSH Credentials; every active connection is mounted through the official `@deepseek-ai/dsh-mcp-client` plugin.

For OAuth MCP servers, the plugin reuses the official MCP TypeScript SDK for protected-resource discovery, dynamic client registration, Authorization Code + PKCE, refresh-token rotation, and the fixed loopback callback. It opens the provider page through the DSH subprocess boundary, so authorization URLs, codes, and tokens never enter Agent arguments or results. Install, connect, and removal require the native user-question interaction, and success is reported only after real MCP tools are registered.

The companion `dsh_plugin_manage` tool is a thin model-facing adapter over Desktop's packaged `dsh plugin`/pnpm service. It accepts only `github:owner/repo#<40-character commit>` sources, requires confirmation, checks that the package became a profile bundle, preserves the dependency across managed profile repair, and then requests an orderly Desktop restart. It does not add another plugin loader.
