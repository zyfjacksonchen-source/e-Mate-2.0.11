# e-Mate Skill Hub → Harness Skill Provider 兼容合同

## 1. 不重建市场

e-Mate 2.0.7 保留 e-Mate 2.0.5 已实现的 Skill Hub 行为和线上数据模型。公开目录继续支持用户上传、其他用户发现、查看版本、下载和本机安装。2.0.7 不创建第二套市场、第二种 Skill ZIP 或第二个 Skill Store。

旧实现的权威来源：

- 服务端注册表：`upstream/e-mate-2.0.5/ecorex/control_plane/skill_hub.py`
- 客户端投影校验：`upstream/e-mate-2.0.5/desktop/src/v1/api/skillHubRuntimeContract.ts`
- 能力中心交互：`upstream/e-mate-2.0.5/desktop/src/v1/components/SkillsWorkspace.tsx`
- 运行接口：`/api/v1/skill-hub/skills...`
- 注册表、Runtime、传输和种子包测试：`test_skill_hub_registry.py`、`test_skill_hub_runtime_api.py`、`test_skill_hub_transport.py`、`test_skill_hub_seed_gate.py`

## 2. 两种对象不可混淆

| 对象 | 运行方式 | 安装位置 | 权限 |
|---|---|---|---|
| Skill Hub ZIP | Harness `skill-filesystem` + `tool-skill` | `$DSH_HOME/skills/<slug>/` | Markdown 指令和相对资源；调用能力仍受 Harness Tool/Approval 约束 |
| Cordis JS 插件 | Harness dynamic Cordis runner/guard | 目标项目定义的动态包存储 | 必须单独审批、隔离和登记服务/slot/tool 权限 |
| e-Mate 内置能力插件 | profile 固定组合 | npm 只读资源 + `$DSH_HOME` 插件状态 | 产品版本哈希和发布验收 |

Skill Hub 的 `.zip` 不能携带并激活任意 Cordis Host/Client JavaScript。把两者混成一个“万能插件包”会绕过目标项目已有的 Guard 和用户审批，明确禁止。

## 3. 浏览器与 Host 通路

```text
SkillsWorkspace or Harness Agent Skill Hub Tool
  → e-Mate Skill Hub Host service
  → browser calls use Harness Connection RPC: /emate.skillHub/<endpoint>
  → Agent calls target ctx.tools registrations; mutations use ctx.jobs
  → e-Mate Host adapter
  → 已有 Skill Hub HTTPS API
  → 哈希/投影/身份校验
  → 原子安装到 $DSH_HOME/skills
  → Harness skill-filesystem watcher 自动刷新目录
```

浏览器代码不得直接 `fetch()` Hub、保存企业 bearer 或建立自己的重连/下载状态总线。目录、详情、发布意图、安装进度和错误通过 Harness 既有 Connection/Job/Slot 数据投影展示。

聊天端也不做“在线更新”“安装某 Skill”等关键词匹配。Agent Loop 依据 `e_mate_skill_hub_search|download|install|publish` 的目标 Tool schema 选择操作；目标对象必须作为结构化参数传入。Tool 调用、审批、后台 Job、失败和终态继续写入 Harness 真实会话事件，聊天 renderer 不按这些工具名写分支。

## 4. 保留的线上合同

- `GET /api/v1/skill-hub/skills`：搜索、分类、标签、原始来源。
- `GET /api/v1/skill-hub/skills/{slug}`：详情和版本历史。
- `GET /api/v1/skill-hub/skills/{slug}/versions/{version}/package`：不可变 ZIP，响应摘要必须等于目录 `package_sha256`。
- `POST /api/v1/skill-hub/skills`：认证用户发布 ZIP；服务端解析真实 slug/version，不信任浏览器声明。
- 同一 slug + version 不可覆盖；包内容、版本、上传者、来源和审计记录不可在原地改写。
- Agent 发布只能引用当前会话已授权的 Harness attachment/artifact ID，不接受模型生成的任意本机路径；下载也返回 Harness artifact/HTTP 下载对象，而不是向浏览器暴露宿主绝对路径。

2.0.7 Host adapter 只处理本机身份代理、摘要校验、安装 receipt 和本地目录切换。中央注册表仍由已有 Skill Hub 服务负责，不归企业管理端插件控制面。

## 5. 安装事务

1. 取得目录中选定的 `slug/version/package_sha256`。
2. 创建一次性安装意图，绑定账号、租约、设备实例、slug、version 和摘要。
3. 下载到 `$DSH_HOME/e-mate/cache/skill-hub/<intent>.zip.part`。
4. 校验传输长度、响应摘要和本地 SHA-256。
5. 在隔离临时目录中检查 ZIP，再解析 `SKILL.md` frontmatter。
6. 确认 frontmatter name/version 与目录对象匹配，且 Harness 能解析该 Skill。
7. 写完整安装 receipt 后，原子切换 `$DSH_HOME/skills/<slug>`。
8. 由 `skill-filesystem` watcher 刷新；Host 读取真实目录确认已可发现。
9. 任一步失败都删除临时文件并保持旧版本原样。

Agent 调用时，步骤 2–9 由一个所有者绑定到当前 Agent 的 Harness Job 执行。Tool 先完成参数、身份租约和目标版本预检，再调用 `ctx.jobs.start`；取消通过 Job hooks 传播到网络请求和临时目录清理。前端关闭或刷新不会制造新的事务，重连后按同一 Job/Event ID 恢复展示。

同版重装只重新校验；升级先保留旧目录快照，验证新目录被目标 Skill provider 识别后再清理。降级需要用户明确选择旧版本。

## 6. 上传和供应链门

沿用旧项目门禁并补充目标适配检查：

- ZIP ≤ 10 MB；限制条目数、单文件和总解压大小。
- 拒绝路径穿越、绝对路径、重复规范化路径、符号/硬链接、设备文件、加密条目和嵌套归档。
- 根目录必须有唯一 `SKILL.md`；名称为 Harness 接受的 kebab-case，版本为不可变语义版本。
- 摘要、slug、version、来源、许可证、上传者和服务端时间进入不可变记录。
- 拒绝 native binary、安装脚本、package lifecycle script 和伪装 Cordis JS 包。
- 工具/平台依赖不满足时标记 `unsupported`，不得声称已启用。
- 发布成功只代表目录可见；安装和执行仍由每台设备上的用户与 Harness 权限边界决定。

## 7. 企业边界

Skill Hub 是用户主动使用的产品目录，不属于 `emate.identity`、`emate.modelPolicy` 或 `emate.audit`。企业管理端可以通过旁路审计看到经过脱敏的发布/安装结果，但不能：

- 静默安装、启用、停用、升级或删除 Skill；
- 把上传内容推送到设备；
- 跳过本地摘要、安全、依赖或审批检查；
- 把 Skill Hub receipt 当成工具执行授权。

## 8. 验收

- 用户 A 发布一个合规 Skill；用户 B 能搜索、查看同一摘要和版本历史并下载。
- B 安装后，Harness `skill-filesystem` 的真实目录出现 Skill；重启后仍存在。
- 重复安装幂等；同 slug/version 不同摘要被拒；失败升级保持旧版。
- 路径穿越、链接、压缩炸弹、JS 插件伪装、摘要不符和缺失许可证均失败关闭。
- 发布不自动安装；企业端无插件启停接口；审计失败不阻断已授权的本地安装事务落盘。
- 用户在聊天中明确提出搜索、下载、安装或发布意图时，Agent 能调用真实 Tool 并完成同一事务；未知 Skill、模糊目标或没有附件时失败关闭，不由前端猜测。
