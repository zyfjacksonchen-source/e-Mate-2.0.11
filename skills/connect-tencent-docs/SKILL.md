---
name: connect-tencent-docs
description: Connect Tencent Docs to e-Mate through the official remote MCP endpoint and OAuth PKCE. Use when the user asks to read, create, edit, search, or manage 腾讯文档 and wants the Agent to perform installation while the user only signs in, scans, and authorizes.
---

# Connect Tencent Docs

Use the existing `mcp_manage` tool and DSH's native `dsh-mcp-client`. Never ask for an access token, authorization code, client secret, or callback URL in chat.

## Workflow

1. Call `mcp_manage` with `action: "list"`. If `tencent_docs` already has `active: true`, use its tools.
2. Otherwise call:

   ```json
   {
     "action": "install",
     "name": "tencent_docs",
     "transport": "streamable-http",
     "url": "https://docs.qq.com/openapi/mcp",
     "auth": "oauth",
     "oauthScope": "docs:read docs:write"
   }
   ```

3. `mcp_manage` opens the provider page and owns protected-resource discovery, dynamic client registration, Authorization Code + PKCE, callback validation, token storage, and refresh. Pause only while the user signs in or scans and approves the displayed scopes.
4. Call `mcp_manage` with `action: "list"` again. Continue only when `tencent_docs` reports `authorized: true` and `active: true` and real `mcp__tencent_docs__*` tools are present.
5. Complete the user's original Tencent Docs request with those MCP tools. A successful authorization page alone is not completion; at least one requested read or write must succeed.

If OAuth is cancelled or the provider refuses the scopes, report that exact state and leave no partial MCP definition or credential behind.
