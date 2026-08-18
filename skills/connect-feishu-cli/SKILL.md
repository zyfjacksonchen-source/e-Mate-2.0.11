---
name: connect-feishu-cli
description: Connect e-Mate to Feishu through the public feishu-cli Agent Skills and its QR/device authorization. Use when the user asks to connect 飞书, Feishu CLI, Lark documents, messages, drive, calendar, tasks, mail, or other Feishu OpenAPI capabilities while letting the Agent install and configure everything except the user's scan and permission approval.
---

# Connect Feishu CLI

Use the installed `skill_find` and `skill_install` tools. Do not use an e-Mate built-in Feishu connector, ask for an App ID or App Secret, or put a token in chat.

## Workflow

1. Call `skill_find` for `feishu cli auth create app` with owner `riba2534`. Select the `feishu-cli-platform` Skill from `riba2534/feishu-cli`; do not substitute a webhook-only Skill.
2. If it is not loaded, call `skill_install` with source `riba2534/feishu-cli`, skill `feishu-cli-platform`, and the scope appropriate to the user's request. After installation, load that Skill and follow its current CLI installation and security instructions.
3. Let the Agent run `feishu-cli config create-app --save`. Present the CLI's one-time authorization page/code and pause only for the user to scan and approve creation of the personal Agent application. Never print the saved App Secret.
4. Let the Agent run the Device Flow login for the minimum domains/scopes needed by the original request. Pause only for the user's scan/sign-in and consent. If tenant administration must approve an application scope, navigate to the visible permission page with native Computer Use and ask the user only for that approval.
5. Run the CLI's current doctor, auth-status, and scope preflight commands. A QR scan alone is not completion: continue until the CLI reports a valid application and user authorization.
6. For the requested business domain, call `skill_find` again with owner `riba2534`, install the matching `feishu-cli-*` Skill from the same repository, load it, and complete one real requested operation. Use documents for docs, messaging for chats, storage for Drive/Wiki, data for Sheet/Bitable, work for calendar/tasks/approval, and the corresponding current domain Skill for mail, meetings, or visual work.

Keep all CLI configuration and refresh tokens in the CLI's own local store. On cancellation or denied scopes, report the exact provider state and do not claim the connection works.
