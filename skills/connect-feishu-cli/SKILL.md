---
name: connect-feishu-cli
description: Connect e-Mate to Feishu through the official Lark/Feishu CLI, its Agent Skills, and browser authorization. Use when the user asks to connect 飞书, Feishu CLI, Lark documents, messages, drive, calendar, tasks, mail, or other Feishu OpenAPI capabilities while letting the Agent install and configure everything except the user's browser approval.
---

# Connect Feishu CLI

Use the installed `skill_find` and `skill_install` tools. Do not use an e-Mate built-in Feishu connector, ask for an App ID or App Secret, or put a token in chat.

## Workflow

1. Call `skill_install` with source `larksuite/cli`, skill `lark-shared`, and the scope appropriate to the user's request. The source is the official public CLI and already trusted, so do not depend on web search, a second Skill Hub search, or a webhook-only substitute. Load `lark-shared` after installation.
2. Invoke the official CLI through e-Mate's packaged runtime as `pnpm dlx @larksuite/cli@latest <arguments>`. Do not require `node`, `npm`, `npx`, or `lark-cli` on the public PATH, and do not use `sudo`, Go, a source checkout, or a hand-built downloader. Verify it first with `pnpm dlx @larksuite/cli@latest --version`.
3. Run `pnpm dlx @larksuite/cli@latest config init --new` in the background. Present only the CLI's one-time authorization page and pause only for the user to approve creation of the personal Agent application in the browser. Never print or request the saved App Secret.
4. Run `pnpm dlx @larksuite/cli@latest auth login` for the minimum domains/scopes needed by the original request. Use `--recommend` only when the user asked for broad access. Run it in the background, present the CLI's authorization page, and pause only for the user's browser consent. If tenant administration must approve an application scope, navigate to the visible permission page with native Computer Use and ask the user only for that approval.
5. Run `pnpm dlx @larksuite/cli@latest auth status` and the matching scope preflight. Browser approval alone is not completion: continue until the CLI reports a valid application and user authorization.
6. For the requested business domain, install the matching official `lark-*` Skill from `larksuite/cli`, load it, and complete one real requested operation. Use `lark-doc`, `lark-im`, `lark-drive`, `lark-sheets`, `lark-base`, `lark-calendar`, `lark-task`, `lark-mail`, or the corresponding current official Skill. Use `skill_find` only when the current domain Skill name is unknown.

Keep all CLI configuration and refresh tokens in the CLI's own local store. On cancellation or denied scopes, report the exact provider state and do not claim the connection works.
