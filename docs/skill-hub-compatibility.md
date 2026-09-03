# e-Mate 2.0.16 Skill Hub 与 DSH Skill 合同

## 1. 一个市场、一个运行时、一个组件

e-Mate 保留一个公开目录与不可变版本模型，不创建第二套市场、ZIP 格式或 Skill Store。2.0.16 的适配面只有一个随 Desktop 打包的 Profile 组件 `@e-mate/dsh-plugin-skill-hub`；Host 事务、Agent Tools、Harness Connection RPC 和界面必须以同一版本构建。

权威参考仍是：

- 服务端实现：`enterprise/apps/skill-hub-worker`；
- Host、Agent 与客户端投影：`packages/dsh-plugin-skill-hub`；
- 用户流程：当前 Profile 的原生 Harness Connection、Job、Skill provider 与客户端 slot；
- 本地解析与调用：固定 rc.7 的 `@deepseek-ai/dsh-skill-filesystem`、`ctx.skills` 与 `@deepseek-ai/dsh-tool-skill`。

| 对象 | 运行方式 | 安装位置 | 发布边界 |
|---|---|---|---|
| Skill Hub ZIP | DSH Skill provider 与 `skill` Tool | `$DSH_HOME/skills/<slug>/` | Markdown 指令及相对资源；不能携带 Cordis JS 或原生可执行文件 |
| Cordis 插件 | DSH Profile/Cordis guard | Desktop 内置 Profile | 独立组件 ABI、权限与构建验证 |
| Desktop Base | deepseek-harness-desktop rc.7 封装 | 应用安装目录 | 只提供稳定系统、窗口、更新和 Profile seam |

## 2. 同一条用户链路

```text
用户自然语言 / Skill Hub 页面
  -> 固定 DSH Agent Tool 或 Harness Connection /emate.skillHub
  -> @e-mate/dsh-plugin-skill-hub
  -> emateIdentity 认证的 Skill Hub HTTPS API
  -> ZIP 摘要与供应链校验
  -> 每 slug 锁 + 持久 WAL + 原子目录切换
  -> 固定 rc.7 DSH provider readback
  -> DSH Job 终态与 receipt/inventory 投影
```

浏览器不得直连 Hub、持有 bearer、读取宿主绝对路径或另建任务总线。聊天端不得按关键词执行分支；Agent 只能从以下类型化 Tool schema 选择动作：

- 只读：`e_mate_skill_hub_search`、`e_mate_skill_hub_detail`、`e_mate_skill_hub_inventory`；
- 共享 Skill：`e_mate_skill_hub_download`、`install`、`update`、`enable`、`disable`、`uninstall`；
- 当前用户发布：`e_mate_skill_hub_publish`、`e_mate_skill_hub_delete_publication`。

所有 mutation 都由当前 Agent 所有的原生 DSH Job 执行。Tool 会先解析精确 slug、版本和 SHA-256，再通过 `ctx.userQuestions` 展示目标；发布只接受原生 provider 当前可见的已安装 slug，或当前会话文件导入链产生的精确 `.e-mate/imports/*.zip` identity，不接受任意主机路径。候选 ZIP 必须先由固定 rc.7 `FileSystemSkillProvider` 成功解析；确认同时绑定规范内容摘要和实际 ZIP 字节摘要，确认后字节变化即拒绝上传。删除 Tool 只接收用户/模型选择的 slug/version，必须先从 `GET /publications/mine` 按当前身份回读精确 owned publication，再展示服务端摘要并执行删除；模型不能提供或猜测所有权摘要。删除发布不等于本地卸载。

## 3. 线上 API 合同

- `GET /skills`：服务端处理 query/category/tag/source、1–100 条 keyset 分页；`next_cursor` 是用 Worker author key 签名并绑定完整过滤条件的 opaque cursor，客户端不得解码、改写、跨查询复用或只取首页后本地假过滤。
- `GET /skills/{slug}`：返回当前 latest 卡片和 1–100 条不可变版本历史，版本历史使用独立且绑定 slug 的签名 opaque cursor。
- `GET /skills/{slug}/versions/{version}`：按精确不可变版本读取卡片，安装、更新、降级和下载不能依赖有限详情页中的本地查找。
- `GET /skills/{slug}/versions/{version}/package`：目录卡片与 `X-Skill-Content-SHA256` 使用规范内容/CAS 摘要；客户端必须重新解析下载 ZIP 并计算同一内容摘要。ZIP 原始字节另算 `archive_sha256`，只用于本地下载凭证和发布确认，不能与内容摘要混用。
- `GET /publications/mine`：无参数或精确 slug/version 都只列当前身份的活动发布；tombstone 版本不再作为可删除目标返回。删除响应丢失由原始稳定 request ID 和服务端 mutation receipt 重放，不重新取得或猜测 owner digest。
- `POST /skills`：发布当前用户选择且已通过原生 DSH parser 的声明式 Skill；服务端再次解析真实 slug/version，不信任客户端声明。一个 slug 的首版原子绑定发布者，后续版本必须属于同一账号，其他账号不能劫持 latest。
- `DELETE /skills/{slug}/versions/{version}`：只为当前身份拥有且 SHA-256 完全相等的版本写删除终态，不覆盖或改写已发布字节。
- 安装意图的 consume/complete 必须绑定身份、登录 Session、slug、version 和 digest。安装与 completion token 的服务端摘要都混入不可逆 Session ref，原始 token 不进入数据库；另一个 Session 即使取得原始 token 也不能 consume/complete。intent、claim、complete、reconcile 回执都显示精确 version、content digest 和 publisher；相同 completion receipt 的相同终态必须幂等，`POST /install-intents/reconcile` 必须可区分 `claimed|installed|failed`，供客户端在响应丢失或重启后对账。
- publish/delete 的 `client_request_id` 由动作和精确不可变目标确定性生成；ZIP 文件顺序/时间固定，原始 ZIP 摘要只参与用户确认，不进入远端幂等身份。响应丢失后重试必须复用同一 ID，服务端对相同请求返回同一终态，对 ID 复用于其他目标则拒绝。

T07 只验证当前仓库 Worker、组件源码和内存 D1/R2 deterministic fixture：包括签名分页、精确版本读取、不可变发布/删除、跨账号拒绝、Session 绑定的一次性安装凭证、受限流式解压、CAS 字节复验和 typed failure。它没有部署或修改公网 Worker、D1/R2、真实账号或公开数据。公网 Worker 版本、远端 schema、两账号回读和 exact component generation 均为 `OPEN_T18`；本地 fixture 不能冒充生产闭环。

## 4. 本地生命周期事务

每个 slug 的 `install/update/enable/disable/uninstall` 共享一个进程内串行器和 `$DSH_HOME/e-mate/skill-hub/transactions/<slug>` 持久 WAL；同一 `DSH_HOME` 的并发进程通过事务目录争用同一个所有者。步骤如下：

1. 从严格目录投影选择 exact slug/version/digest；不支持当前运行时的候选在下载后、安装前失败。
2. 下载到 mode-0600 缓存，校验长度、响应摘要、本地摘要和 ZIP 边界。
3. 解压到候选目录，由固定 rc.7 `FileSystemSkillProvider` 解析并回读唯一 `SKILL.md`；第二套 frontmatter parser 不能作为提交依据。
4. 安装/更新先取得远端 completion receipt，再原子切换候选；固定 `ctx.skills` 必须从目标路径读到相同 Skill，才可提交本地 receipt。
5. 远端 completion 明确接受后清理上代；明确拒绝则恢复上代。响应未知时立即恢复上代、保留 WAL，并返回 `recovery-pending`，绝不报告 completed/killed。
6. 重启扫描 WAL，向服务端 reconcile；只有远端确认为 installed 才重新激活候选，否则保持上代或继续 pending。
7. disable/uninstall 先原子移入受管隔离目录，确认原生 provider 已不可见后提交；enable 反向切换并要求原生 provider 可见。

远端 `publish/delete` 在发出请求前把稳定 request ID、精确 slug/version/content digest、发布所需 category/ZIP 或删除所需 publisher 写入 `$DSH_HOME/e-mate/skill-hub/remote-mutations`。明确 4xx 会清理 WAL 并失败；断网、取消时响应未知、限流或 5xx 保留 `recovery-pending`。重启或同一自然语言动作重试时只重放该 WAL 中的原始字节和请求 ID，收到匹配终态收据后才清理；不会重新解释模型参数或把未知完成报告为成功。Worker 和 Host/Job 使用同一 typed failure 词表：`auth|network|conflict|integrity|recovery|native-provider`；RPC 失败与 Job 终态保留 code，不只剩自由文本。

`install` 只允许首次安装或同版本同摘要幂等复核；已有不同版本必须明确调用 `update`。降级只有 `allow_downgrade=true` 且确认框显示目标旧版本时允许。一个失败事务不能回滚另一个已返回成功的较新事务。

“已安装”页以 Skill Hub receipt inventory 为所有权真相，再叠加原生 provider readiness；当前会话 `skill.list` 不能替代它。页面重载通过原生 Jobs registry 重绑 active/recent UI Job，终态后重新读取 inventory。下载返回随机凭证，最多 32 个、五分钟有效；HEAD 不消费，首次成功 GET 后删除，响应前再次校验 SHA-256，组件启动/卸载时清除残留缓存。

## 5. ZIP 与发布安全边界

- 压缩包、条目数、单文件和总解压字节均有上限；deflate 按流读取并在超过 central-directory 声明或单文件预算时立即取消，不先把未知膨胀量完整装入内存；拒绝路径穿越、绝对路径、重复规范路径、链接、设备文件、加密条目和嵌套归档。
- 根目录必须有唯一 `SKILL.md`，name 为 DSH 接受的 kebab-case，version 为不可变 SemVer；原生 DSH parser 的 invocation/readiness 结论优先。
- 拒绝可执行位、native binary、安装脚本、package lifecycle 与伪装 Cordis 包。
- 发布只接受已安装 Skill 的受管 slug，或当前会话 `.e-mate/imports` 下经 realpath/普通文件/硬链接/大小/TOCTOU 复验的 ZIP identity；Agent Tool 不接受模型提供的任意本机路径。
- 摘要、slug、version、分类、来源、许可证、上传者和服务端时间进入不可变记录。同 slug/version 不同摘要必须拒绝。
- Hub 内容不是产品插件，安装它不会扩大 DSH Tool、Approval、sandbox 或 Computer Use 权限。

## 6. 企业边界

Skill Hub 是用户主动使用的产品能力，不属于管理端的 `emate.identity`、`emate.modelPolicy` 或 `emate.audit` 控制面。管理端只提供鉴权并可接收脱敏结果审计；不得静默安装、启停、升级、卸载、删除发布或把 ZIP 推送到设备。控制面或审计不可用不能删除已接受的本地 Skill，也不能把 receipt 当成工具授权。

## 7. 构建与验收

Skill Hub Host、Agent、RPC 和 UI 作为同一个 Desktop 内置 Profile 组件构建。变更必须验证固定 rc.7 ABI、原生 parser/provider、Agent Tool/Job、并发、取消、崩溃恢复、界面 remount 和一次性下载行为，并随完整 Desktop Profile 通过启动检查。

线上关闭仍需真实账号证明发布者所有权、跨用户搜索和安装、原生 `skill`/Agent 调用、更新、禁用、重启、启用、卸载及 owned-publication 删除。源码或 fixture 通过不能替代线上和安装态证据。
