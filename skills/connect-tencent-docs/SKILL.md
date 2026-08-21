---
name: connect-tencent-docs
description: Connect Tencent Docs to e-Mate through its official remote MCP endpoint and secure browser token handoff. Use when the user asks to read, create, edit, search, or manage 腾讯文档 and wants the Agent to perform installation while the user only signs in, scans, and authorizes.
---

# Connect Tencent Docs

Use the existing `mcp_manage` tool and DSH's native `dsh-mcp-client`. Never ask for an access token, authorization code, client secret, or callback URL in chat.

The MCP definition and credential are device-global. A new e-Mate session must reuse an existing `authorized: true, active: true` connection; reauthorization is valid only after the provider reports expiry, revocation, or missing scope.

## Workflow

1. Call `mcp_manage` with `action: "list"`. If `tencent_docs` already has `active: true`, use its tools.
2. Otherwise call:

   ```json
   {
     "action": "install",
     "name": "tencent_docs"
   }
   ```

3. `mcp_manage` opens the official Tencent Docs MCP page. Pause only while the user signs in or scans and clicks the page's Copy action, then ask them to select “已复制，连接” in e-Mate. The plugin reads the system clipboard directly into DSH Credentials; the Token never enters the prompt, tool arguments, result, or chat.
4. Call `mcp_manage` with `action: "list"` again. Continue only when `tencent_docs` reports `authorized: true` and `active: true` and real `mcp__tencent_docs__*` tools are present.
5. Complete the user's original Tencent Docs request with those MCP tools. A successful authorization page alone is not completion; at least one requested read or write must succeed.

If OAuth is cancelled or the provider refuses the scopes, report that exact state and leave no partial MCP definition or credential behind.
