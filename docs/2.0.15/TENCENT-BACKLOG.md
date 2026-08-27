# e-Mate 2.0.15 Tencent feedback backlog

> T17 read-only intake. This maps the one authoritative feedback source to existing owners and evidence. It is not a product fix, candidate, installation receipt, release checklist, or release claim.

## Authoritative source boundary

- Sole authoritative source: `file_id=VwnSnZLbANDI`, title `E-Mate 功能测试反馈（内容）`, source sheet `BB08J2`, connector-reported size `202 x 29`.
- Local read-only export: `e-mate-functional-feedback.xlsx`, `4,308,342` bytes, SHA-256 `b2bdcb80418e53364cee1b48b5e96031584950e31641f0369649d793468acf26`.
- The export was parsed read-only as OOXML with the user-authorized Python standard-library path. It was not edited, recalculated, exported, or overwritten; no Tencent Docs MCP call was used for this intake.
- The workbook contains one worksheet named `工作表1`. It serializes 23 non-empty rows: one header, two merged version rows, and 20 feedback rows. The actual non-empty field range is `A1:M23`; stored worksheet dimension `G24` is stale and includes style-only blank `G24`.
- Merged ranges are `A2:AC2`, `A19:AC19`, `H1:I1`, and `K1:L1`. Blank cells remain blank below. Embedded images are retained only as image-only evidence locations and were not OCR-inferred.
- Source modification time is not recoverable from the export. OOXML core timestamp `2026-08-27T21:50:59Z` is recorded as export time only and is not relabelled as Tencent source modification time.
- `e-mate-image-feedback.xlsx` is user-declared obsolete old-version input and is excluded in full. No content, row, field, media, count, classification, root cause, mapping, or product conclusion from it is present here.

## Recomputed classification

| Classification | Raw rows | Meaning |
| --- | ---: | --- |
| P0 | 8 | Blocks a core path, risks durable state/correctness, or is already a named P0 contract |
| P1 | 5 | Material functional failure with a bounded owner |
| P2 | 1 | Quality/performance issue that is not itself release admission |
| DUPLICATE | 4 | Fully covered by a canonical shared-root entry below |
| NEEDS_EVIDENCE | 2 | Text is insufficient to select or close one root cause |
| **Total** | **20** | 16 canonical entries after shared-root deduplication |

Table-side text such as “已提pr”, “已解决”, “成功了”, or a suggested workaround never closes an item. The strongest current evidence is source/component evidence; app-directory, installed, real-account/provider, exact-byte, update/rollback, and public receipts remain OPEN unless explicitly named.

## Canonical root-cause backlog

| Canonical ID | Priority | Canonical invariant / root cause to prove | Unique owner and T05-T16 mapping | Raw reverse map | Current release evidence and OPEN acceptance |
| --- | --- | --- | --- | --- | --- |
| CAN-01-SETTINGS-CLOSE | P1 | Settings close control must use native caption-safe geometry and remain mouse/keyboard reachable. | T13 Shell Settings + Desktop caption geometry; T18 installed acceptance. | `FUNC-2012-01` | T13 has no evidence at `release/2.0.15@8f9e52a`. OPEN: macOS/Windows app-dir/installed hitbox, keyboard, theme and 100/125/150% checks. |
| CAN-02-PICKER-CAPABILITY | P0 | `host.pickDirectory` must resolve one native DirectoryPicker and attach exactly one Workspace; composed `browse` is not the capability. | Desktop native provider/WorkspaceRegistry; T16 Better Sidebar consumer; T18 exact installed bytes. | `FUNC-2012-02` | Historical source-gate text cannot close the formally reopened P0. T16 has no committed evidence. OPEN: Windows-first, then macOS selection/cancel/ACL/junction/restart receipts. |
| CAN-03-SESSION-DURABILITY | P0 | Creating, listing, selecting and reopening Sessions must preserve distinct durable IDs and one atomic route/projection without loss, overwrite, stale commit, or disappearance. | Pinned rc.7 Session/Workspace owner; T13 Shell route/projection; T02 smoke; T18 installed acceptance. | `FUNC-2012-03`, `FUNC-2012-06`, `FUNC-2012-08`, `FUNC-2012-15`, `FUNC-2012-16` | T11 native Composer host is merged at source/component level, but T13 evidence is absent and this does not prove Windows cross-day/multi-session/direct-row incidents. OPEN: two distinct IDs, 30 rounds, cross-day/cold restart and per-row reopen on exact bytes. |
| CAN-04-REMEMBERED-LOGIN | P1 | A valid remembered identity lease must recover through the existing OS credential store after app/OS restart without a second auth store. | T10 identity/model-policy; T18 real-account Keychain/DPAPI acceptance. | `FUNC-2012-04` | T10 source/local fixtures passed; real-account, app-dir and installed readback remain OPEN. |
| CAN-05-SEND-REVISION | P0 | Send must target the visible current Session revision exactly once; a new Session may not show an unusable Composer. | Pinned rc.7 Session/Composer; T11 native Composer host seam; T13 final Shell integration; T02/T18 terminal smoke. | `FUNC-2012-05` | T11 source/component host evidence is merged; T13 evidence is absent. OPEN: installed success/failure/late response, unique terminal event and restart. |
| CAN-06-MODEL-AVAILABILITY | P0 | The Session-selected model must reconcile with the authenticated managed catalog without disappearing or silently switching. | T10 model capability/policy; T18 installed real-account acceptance. | `FUNC-2012-07` | T10 source/local fixtures passed only. OPEN: Windows incident reproduction, real managed catalog, restart/update persistence and typed unavailable state. |
| CAN-07-LOGOUT | P1 | Logout must revoke through the one typed identity path and remove local effective login even when remote completion is unknown. | T10 identity; T18 real-account/keystore acceptance. | `FUNC-2012-09` | T10 source/local identity lifecycle evidence exists; installed Keychain/DPAPI denial/restart and remote receipt remain OPEN. |
| CAN-08-SCHEDULE-ROUTE | P1 | `/schedules` must render only Schedule chrome; Session title/composer controls cannot leak into the standalone route. | T06 Schedule projection + T13 Shell route; T18 installed route loop. | `FUNC-2012-10` | T06 source/component projection passed; T13 evidence is absent. OPEN: app-dir and installed 30-round route isolation. |
| CAN-09-PICGEN-TERMINAL | P0 | Image generation must select native `imagegen` and end in a real Job/Attachment or bounded typed failure, never narration-only success. | T05 Tool/Image routing; T15 Attachment/Vision boundary; T18 real provider and installed acceptance. | `FUNC-2012-11` | T05 and T15 are merged with source/component evidence. App-dir, real provider, installed bytes, target runtime and 2/4 capacity proof remain OPEN. |
| CAN-10-PICEDIT-VERIFICATION | P0 | Image edit completion requires exact source Attachment, distinct output, edit receipt and semantic verification; narration is insufficient. | T05 receipt/source resolution + T15 Vision/OCR verification; T18 real provider/installed acceptance. | `FUNC-2012-12` | T05 and T15 source/component evidence is merged. Target CPython, app-dir, real provider and installed semantic receipts remain OPEN. |
| CAN-11-SCHEDULE-CREATE-DUE | P0 | `schedule_create/list/delete` and native dispatch must persist, execute once when due, and recover across restart with one scheduler. | T06 native Schedule; T05 Tool visibility; T18 installed due/update/rollback acceptance. | `FUNC-2012-13` | T06 and T05 source/component fixtures passed. OPEN: real app-dir Agent interaction, installed create/read/delete/restart/due on exact bytes. |
| CAN-12-FEISHU-INTERFERENCE | NEEDS_EVIDENCE | e-Mate running reportedly prevents a Feishu cloud document opening, but the launch surface, URI, browser/app ownership and failure event are unspecified. | Proposed owner: T15 Find Skill/connector boundary after reproduction; Desktop owner only if native URL lifecycle is proven. | `FUNC-2012-14` | T15 is merged at source/component level, but no current evidence selects the first violating owner. Required: exact link type, opening app/browser, expected handler, secret-free logs, and e-Mate on/off reproduction. |
| CAN-13-FEISHU-DELIVERY | P1 | Feishu delivery must use the fixed connector/native Skill lifecycle and produce a real auth/operation receipt or typed blocker. | T15 C07 Find Skill/connectors; T18 real-account installed acceptance. | `FUNC-2013-01` | T15 source/component evidence is merged and explicitly leaves real Feishu/Tencent authentication, operation, app-dir and installed receipts OPEN. |
| CAN-14-PIC-LATENCY | P2 | Image generation latency/throughput must be measured over real provider Jobs without adding a second queue or retry loop. | T05 native Job routing; T18 optional performance diagnostic and real-provider acceptance. | `FUNC-2013-02` | T05 proves source/component routing and one-output capacity only. No real-provider latency sample is accepted; performance remains diagnostic, not release admission. |
| CAN-15-UPDATER-STALE-VERSION | P0 | Confirmed update must stage through the one updater transaction, restart into the selected exact version, and report rollback/failure truthfully. | T09 Desktop updater; T18 exact predecessor/update/rollback acceptance. | `FUNC-2013-03` | T09 is locally source-tested only. Table-side “成功了” after an external installer suggestion is not native updater evidence. Real predecessor, macOS/Windows installed and failed-health rollback remain OPEN. |
| CAN-16-PICREAD-UNKNOWN | NEEDS_EVIDENCE | “读取图片内容” has no textual problem description; two embedded images cannot be interpreted as the missing claim without OCR/user confirmation. | Proposed owner: T15 Vision only after expected/observed behavior is supplied. | `FUNC-2013-04` | T15 source/component work is merged, but the row supplies no claim to verify. OPEN: original textual symptom, selected model, input route, expected output and terminal receipt. |

## Raw feedback and reverse mapping

`∅` means the source cell is blank. The source header merges `H:I` as “问题图示/录屏” and `K:L` as “中台反馈”; values below preserve their original column positions. Embedded media bytes were not copied into the repository.

| Ref | Version / original no. | Reporter | Time | Platform | Test content | Test artifact | Original problem description | Visual/recording | Original adjustment / middle-platform / user feedback | Class | Canonical |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FUNC-2012-01 | 2.0.12 / 1 | tutu | 8.24 | win | 设置按钮 | 无 | 点进设置界面右上角很难点击退出 | embedded image at H3 | 调整建议 `∅`; 中台 `下一个版本会进行修复`; 用户 `∅` | P1 | CAN-01-SETTINGS-CLOSE |
| FUNC-2012-02 | 2.0.12 / 2 | 内容 | 8.24 | `∅` | `∅` | 无 | 添加项目文件夹失败 | embedded image at H4 | 调整建议 `∅`; 中台 `已提pr`; 用户 `∅` | P0 | CAN-02-PICKER-CAPABILITY |
| FUNC-2012-03 | 2.0.12 / 3 | 内容+中台 | 8.24 | `∅` | `∅` | 无 | 创建新的会话会出现丢失情况 | `∅` | 调整建议 `∅`; 中台 `已提pr`; 用户 `∅` | P0 | CAN-03-SESSION-DURABILITY |
| FUNC-2012-04 | 2.0.12 / 4 | 殷瑛 | 8.24 | macOS 26.6.2 | 登录后台 | 无 | 勾选了保持登录，但下次登录仍需要重新输入账户密码 | embedded image at H6 | 调整建议 `∅`; 中台 `待定可能会绕过 安全性考虑`; 用户 `∅` | P1 | CAN-04-REMEMBERED-LOGIN |
| FUNC-2012-05 | 2.0.12 / 5 | 殷瑛 | 8.24 | macOS 26.6.2 | 开新会话 | 无 | 新会话窗口无法发送消息 | 录屏2026-08-24 14.55.23.mov | 调整建议 `∅`; 中台 K=`已提pr`, L=`还是要修下 完整性检查 避免组件漏掉`; 用户 `已解决` | P0 | CAN-05-SEND-REVISION |
| FUNC-2012-06 | 2.0.12 / 6 | 殷瑛 | 8.24 | macOS 26.6.2 | 开新会话 | 无 | 点击新任务，不出现新会话窗口 | `∅` | 调整建议 `∅`; 中台 `已提pr`; 用户 `∅` | DUPLICATE | CAN-03-SESSION-DURABILITY |
| FUNC-2012-07 | 2.0.12 / 7 | 乐乐 | 8.24 | win11 | 开新会话 | 无 | 会话中没有模型可选 | embedded image at H9 | 调整建议 `∅`; 中台 `已提pr`; 用户 `∅` | P0 | CAN-06-MODEL-AVAILABILITY |
| FUNC-2012-08 | 2.0.12 / 8 | 乐乐 | 8.24 | win11 | 打开界面 | 无 | 历史对话中最近的一个对话丢失 | `∅` | 调整建议 `∅`; 中台 `已提pr`; 用户 `∅` | DUPLICATE | CAN-03-SESSION-DURABILITY |
| FUNC-2012-09 | 2.0.12 / 9 | 乐乐 | 8.24 | win11 | 退出按钮 | 无 | 无法退出登录 | embedded image at H11 | 调整建议 `∅`; 中台 K=`网络不稳定，可以取消重试  /右下角小图标退出重登`, L=`已提pr`; 用户 `∅` | P1 | CAN-07-LOGOUT |
| FUNC-2012-10 | 2.0.12 / 10 | 孟醒 | 8.24 | win11 | 定时任务 | 无 | 点击定时任务，左上角出现了会话标题 | embedded image at H12 | 调整建议 `∅`; 中台 `已提pr`; 用户 `∅` | P1 | CAN-08-SCHEDULE-ROUTE |
| FUNC-2012-11 | 2.0.12 / 11 | 殷瑛 | 8.24 | macOS 26.6.2 | 笔记生产 | https://qdsb-yixin.feishu.cn/docx/LuOMdeLNdofNIxxQh73cCM6unRh | 图片产出不了 | embedded image at H13 | 调整建议 `∅`; 中台 `codex也会有这个问题，已提pr`; 用户 `∅` | P0 | CAN-09-PICGEN-TERMINAL |
| FUNC-2012-12 | 2.0.12 / 12 | 殷瑛 | 8.24 | macOS 26.6.2 | 改图 | image-only at F14 | 提示已将图片中的 3 处“武汉”全部改为“成都”，但实际并没有 | 录屏2026-08-24 16.50.21.mov; image-only at I14 | 调整建议 `∅`; 中台 `已提pr`; 用户 `∅` | P0 | CAN-10-PICEDIT-VERIFICATION |
| FUNC-2012-13 | 2.0.12 / 13 | 孟醒 | 8.24 | win11 | 定时功能 | 无 | 点击创建显示错误 | embedded image at H15 | 调整建议 `∅`; 中台 `已提pr`; 用户 `∅` | P0 | CAN-11-SCHEDULE-CREATE-DUE |
| FUNC-2012-14 | 2.0.12 / 14 | 乐乐 | 8.25 | win11 | 外部软件 | 无 | e-Mate打开中，飞书的云文档打不开，关闭后就能打开 | embedded image at H16 | 调整建议 `∅`; 中台 `待根因`; 用户 `∅` | NEEDS_EVIDENCE | CAN-12-FEISHU-INTERFERENCE |
| FUNC-2012-15 | 2.0.12 / 15 | 小吉好困 | 8.25 | `∅` | 新任务 | 开启两个对话 | 运行中无法同时开启两个/多个新任务 | embedded image at H17 | 调整建议 `∅`; 中台 `已提pr`; 用户 `∅` | DUPLICATE | CAN-03-SESSION-DURABILITY |
| FUNC-2012-16 | 2.0.12 / 16 | 孟醒 | 8.26 | win11 | 点击旧会话 | 继续对话 | 点击近期/之前的会话会出现闪退到会话页且会话出现消失的情况 | 7c67525d37247fa2b3f873baea71e4e9_raw.mp4 | 调整建议 `∅`; 中台 `共性问题已经定位`; 用户 `∅` | DUPLICATE | CAN-03-SESSION-DURABILITY |
| FUNC-2013-01 | 2.0.13 / 1 | 孟醒 | 8.27 | win11 | 笔记生成 | 飞书交付 | 无法连接飞书进行交付 | embedded image at H20 | 调整建议/中台/用户 `∅` | P1 | CAN-13-FEISHU-DELIVERY |
| FUNC-2013-02 | 2.0.13 / 2 | 内容 | 8.27 | `∅` | 生图 | 生图 | 生图比较慢 | `∅` | 调整建议/中台/用户 `∅` | P2 | CAN-14-PIC-LATENCY |
| FUNC-2013-03 | 2.0.13 / 3 | 内容 | 8.27 | `∅` | 更新 | 更新版本 | 对话框交流或者退出更新都还是老版本    x5 | `∅` | 调整建议 `∅`; 中台 `可以尝试下载workbuddy帮忙安装一下E-Mate`; 用户 `成功了` | P0 | CAN-15-UPDATER-STALE-VERSION |
| FUNC-2013-04 | 2.0.13 / 4 | 内容 | 8.27 | `∅` | 读取图片内容 | `∅` | `∅` | two embedded images at H23/I23 | 调整建议/中台/用户 `∅` | NEEDS_EVIDENCE | CAN-16-PICREAD-UNKNOWN |

## Current T05-T16 evidence ceiling

| Ticket | At current `release/2.0.15@8f9e52a` | Admission ceiling relevant to this backlog |
| --- | --- | --- |
| T05 | Merged; source/component fixture passed | No app-dir, installed, real provider or 2/4 image capacity acceptance |
| T06 | Merged; source/component fixture passed | No real app-dir Agent interaction or installed create/list/delete/restart/due receipt |
| T07 | Merged; source/local deterministic fixtures passed | Real accounts, public Worker, app-dir and installed remain OPEN |
| T08 | Merged source work; not directly mapped by these rows | No feedback row is assigned to Share |
| T09 | Merged; local source tested | Real predecessor update, health-failure rollback and cross-platform installed UI remain OPEN |
| T10 | Merged; source/local fixtures passed | Real account/catalog/grant/keystore and installed readback remain OPEN |
| T11 | Merged; source/component and native Composer host checks passed | Does not close Session/send incidents; app-dir/installed remain OPEN |
| T12 | Merged; source/component checks passed | No unique feedback root assigned; complete Profile app-dir and installed modes remain OPEN |
| T13 | No committed evidence | All mapped Shell/navigation/settings rows remain OPEN |
| T14 | Merged; source asset tested | No feedback row maps to icon; installed surfaces remain OPEN |
| T15 | Merged; source/component and CP-03 checks passed | Target CPython, complete Profile app-dir, real connectors/TCC/provider and installed bytes remain OPEN; current Harness gitlink is not bound by immutable Base v7 |
| T16 | No committed evidence | Picker consumer and other T16 acceptance remain OPEN |

## T00 handoff suggestions (not edited here)

- Update STATUS/UR17 only after merging this exact T17 commit; do not mark any product row fixed.
- Add a follow-up only after CAN-12 receives a reproduction packet; CAN-13 remains T15/T18 real connector acceptance; CAN-15 remains T09/T18 installed updater acceptance.
- Keep CAN-02, CAN-03, CAN-05, CAN-06, CAN-09, CAN-10 and CAN-11 in the P0 gate until their named app-dir/installed/real-provider receipts exist.
- Preserve the sole-source/read-only receipt in `docs/2.0.15/evidence/T17.json`; do not copy embedded media bytes or call table-side status an acceptance receipt.
