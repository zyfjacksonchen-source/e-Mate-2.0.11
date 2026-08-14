# e-Mate 2.0.7 target contract

This file is the implementation source of truth. Development records may add evidence but may not weaken these obligations.

## Identity and source pins

- Product name: `e-Mate`
- Repository: `zyfjacksonchen-source/e-Mate`
- Release: `@e-mate/dsh@2.0.7`
- Executable: `e-mate`
- Harness source: `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`
- Harness source version: `0.1.0-rc.5`
- Browser shell source: e-Mate 2.0.5 at `564a6b6c1d43fb6831dd4a5cd8026e472f063311`
- Chat interaction source: Codex prototype `019ff665-d721-79a0-869d-338f086cf529`
- “Harness” identifies the pinned technical foundation only and must not be used as the product or UI name.

## Product boundaries

- Local Harness owns execution, sessions, tools, jobs, plugins, memory, schedules, and artifacts.
- The enterprise sidecar owns only login/authentication, model-policy delivery, and asynchronous redacted audit ingestion.
- The product ships as npm plus a loopback web server, with an overwrite-safe desktop shortcut. It ships no desktop application.
- The browser frontend is responsive from 320px and contains no Win/macOS window-chrome compensation.
- The central chat UI derives activity from real durable/live events and plugin render metadata; it contains no tool-name dispatch table.

## Model policy

| Public id | Provider model | Reasoning |
| --- | --- | --- |
| `ecorex-chat` | `gpt-5.6-luna` | `max` |
| `ecorex-gpt-5.6-sol` | `gpt-5.6-sol` | `medium` |
| `ecorex-deepseek-v4-pro` | `deepseek-v4-flash` | `max` |
| `ecorex-gemini-3.1-pro` | `gemini-3.1-pro-high` | `medium` |
| `ecorex-doubao-seed-2.0-pro` | `doubao-seed-2-0-pro-260215` | `medium` |

Image routing remains `gpt-image-2` locally, `gpt-image-2-pro` primary, `gpt-image-2` fallback, and `gpt-image-2-edit` for edits. The tenant policy may allow several chat models, while one session selects one active model.

## Shipped plugin roster

The user-visible capability center contains image generation/editing, Office, OCR, Browser, Feishu, Tencent Docs, WeChat, and DingTalk. Schedule, memory, dream distillation, and autonomous learning are local system plugins rather than extra capability-center cards.

## Compatibility and delivery

- Import only authoritative, non-deleted old e-Mate/ECoreX sessions; preserve sources unchanged and make import idempotent.
- User data stays under the resolved `$DSH_HOME`; npm installation directories are read-only code/resources.
- Supported release platforms are macOS 13+ arm64/x64 and Windows 10/11 x64.
- Keep the existing download, admin, and audit URLs unchanged.
- Release activation requires clean npm installation, automated checks, performance evidence, and Computer Use acceptance.
