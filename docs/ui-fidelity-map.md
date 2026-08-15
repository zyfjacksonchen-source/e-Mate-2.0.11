# e-Mate 2.0.7 浏览器外壳高保真映射

## 1. 视觉真值与优先级

本文件是 S02/S03/S04 的防漂移合同。出现冲突时按下列优先级处理：

1. 产品名称、浏览器边界和企业边界以 `docs/target-contract.md` 为准。
2. 全局外壳、页面、组件、品牌和设计 Token 以任务
   `019ff91c-47ca-7c11-93bd-863475181a18` 对应的 e-Mate 2.0.4/2.0.5 最终界面为真值；
   落地代码只读取固定 2.0.5 提交中的当前 `desktop/src/v1` 组件、Token 和资产。
3. 聊天消息流、活动组、状态、产物和动效以任务
   `019ff665-d721-79a0-869d-338f086cf529` 的原型与交互稿为真值；它只替换旧 e-Mate
   聊天内容区，不重做全局外壳。
4. 状态、事件、会话、模型、工具、审批和产物数据以固定 DeepSeek Harness 的
   Client Runtime、Slots、Session、Conversation 和 Connection 为唯一真值。

固定参考物：

| 参考物 | 路径 | SHA-256 |
|---|---|---|
| e-Mate 2.0.4/2.0.5 最终界面源码 | `upstream/e-mate-2.0.5/desktop/src/v1`、`desktop/src/styles/tokens.css`，提交 `564a6b6c1d43fb6831dd4a5cd8026e472f063311` | Git 提交固定 |
| 聊天交互原型 | `/Users/mac/.codex/visualizations/2026/08/12/019ff665-d721-79a0-869d-338f086cf529/codex-streaming-chat.html` | `fd734f0026f51e334874cca54adb60f37d7b09cb4e89e98da1841c922996a33e` |
| 聊天标注稿 | `/Users/mac/Documents/Codex/2026-08-12/co-de/outputs/codex-desktop-flow-spec.html` | `3d788b6cf0737579345b9bf840afa1b69593f5ab962e7f0f8443d7c73a9c396a` |
| 聊天标注 PDF | `/Users/mac/Documents/Codex/2026-08-12/co-de/outputs/codex-desktop-flow-spec.pdf` | `a19d804f9bb20ac9e9c37b477d34000c0b575a0ee08e57c84a5ba3472cc12333` |

禁止用临时 mock、Harness 默认鲸鱼品牌或近似组件代替上述真值。仓库中的
`docs/v0.*`、`docs/v1.*` 历史截图，以及任何 2.0.4 之前的界面截图，明确属于禁用样本，
不得参与样式取值、组件选择或 Design QA 对比。只有任务 `019ff91c…` 对应的最终
2.0.4/2.0.5 验收画面可作为截图真值；若该画面与当前固定源码冲突，必须记为阻塞并核实，
不能自行选择旧图或近似实现。

## 2. 复用边界

### 2.1 保持 Harness 的结构

```text
root (ui-layout)
├── sidebar (e-Mate 视觉实现，保留原 slot 名与 owner contract)
│   ├── sidebar.workspaces (Harness 真实 Workspace/Session 列表)
│   ├── sidebar.footer.action (插件动作)
│   └── sidebar.settings (Harness 真实设置入口)
├── conversation (Harness Conversation/Session/Composer)
├── details (Harness 真实工具详情)
└── shell.overlay (登录、首次协议和浏览器页面遮罩)
```

- 不注册第二个 `root`，不复制 Slot Registry，不复制 Session/Conversation Store。
- 不新增 WebSocket、SSE、轮询或自定义消息总线。
- 浏览器调用企业身份服务只用 Harness `ctx.connection.rpc.call('/emate.identity', ...)`。
- 页面路由只投影当前本地 UI 状态；业务对象仍来自 Harness 服务。
- `shell.overlay` 只在登录、协议或独立浏览器页面激活时接管指针，聊天态不拦截底层工作区。

### 2.2 只搬视觉，不搬旧运行态

从最终 e-Mate 2.0.4/2.0.5 UI 源码搬运：

- React DOM 层级、可见文案、CSS Token、间距、尺寸、圆角、边框、响应式规则。
- 官方 e-Mate logo/mark、模型和连接图标等许可证允许的品牌资产。
- LoginPage、Sidebar、HomeDashboard、SkillsWorkspace、SettingsDialog 的浏览器视觉组件。

不得搬运：

- Electron bridge、updater、窗口控制、系统托盘、签名、公证和任意本地路径操作。
- 旧 e-Mate Runtime/Connector/Extension Store、假流式状态或工具名分支。
- `data-desktop-platform`、`-webkit-app-region`、macOS 76px 红绿灯补偿、Windows 148px 窗口按钮补偿。

## 3. 路由逐屏映射

| 浏览器路由 | e-Mate 2.0.5 视觉真值 | Harness 数据/动作真值 | 2.0.7 特殊规则 |
|---|---|---|---|
| `/login` | `v1/components/LoginPage.tsx`、logo、登录卡、帮助/版本信息 | `emate.identity` 登录与租约状态 | 未登录只能访问登录页；浏览器不持有企业凭据或长期令牌 |
| `/agreement` | LoginPage 同一品牌背景和卡片语法 | `emate.identity` 的 `agreements.describe/status/accept` | 登录后首次使用必须逐份阅读、三项显式确认并取得服务器归档 receipt 后放行 |
| `/` | `v1/components/HomeDashboard.tsx` | Harness Workspaces、Sessions、Jobs、Plugin Registry | 只展示真实摘要；没有数据就显示旧项目的空态，不造统计 |
| `/chat/:sessionId` | e-Mate Sidebar、Workspace、Header、Composer 外壳 | Harness Session/Conversation/Events/Jobs/Tools | 内容区按指定聊天原型；URL 中 ID 必须对应真实 Session |
| `/capabilities` | `v1/components/SkillsWorkspace.tsx` | 当前 profile 插件注册表 + `emate.skillHub` + Harness Skill provider | 动态展示八项内置能力并保留“发现/已安装/自定义”Skill Hub；系统插件不计入八项；不按能力 ID 写死聊天逻辑 |
| `/settings` | `v1/components/SettingsDialog.tsx` | Harness Settings、Model Selection、Identity/Connection 元数据 | 浏览器内页/对话框；更新区域只显示版本与 npm 命令，不调用桌面 updater |

浏览器行为：

- 刷新、前进、后退和深链接必须恢复同一可访问状态。
- 无效或无权访问的 Session ID 不伪造会话，回到真实 Home/Session 空态并给出可见提示。
- 登录态失效回 `/login`；已登录但协议未归档回 `/agreement`。
- 关闭标签页不停止本地服务；`e-mate launch` 或桌面快捷方式复用健康实例。

## 4. 全局外壳映射

| 可见区域 | 旧项目来源 | Harness 复用点 | 验收要点 |
|---|---|---|---|
| 品牌行 | `Sidebar.tsx` + e-Mate logo/mark | `sidebar` 单槽实现 | 展开显示 logo，收起显示 mark；不得出现 DeepSeek Harness 字样/鲸鱼标 |
| 新建会话 | Sidebar 新任务按钮 | `ctx.workspaces.startSession()` | 不自己创建会话 ID，不复制启动流程 |
| 会话/项目列表 | Sidebar 视觉规则 | `sidebar.workspaces` | 搜索、项目、会话标题和选择全部是真实 Harness 数据 |
| 能力中心入口 | Sidebar 能力入口 | 浏览器路由投影 + 插件注册表 + Skill Hub | 当前路由有选中态；移动端点击后关闭抽屉 |
| 设置入口 | Sidebar 底部设置 | `sidebar.settings` | 保留目标项目真实设置动作，只改视觉外壳 |
| 中央工作区 | `ex-workspace` 面板 | `conversation` | 8px 外边距、1px 边、面板圆角、无桌面窗口补偿 |
| 工具详情 | 旧项目产物/详情视觉 | `details` + 工具 renderer | 惰性展开；未知工具走 Harness 通用安全 renderer |
| 全局遮罩 | 旧项目对话框/登录语法 | `shell.overlay` | 仅登录、协议、Home、能力中心、设置时接管指针 |

## 5. 聊天高保真合同

### 5.1 状态清单

指定原型的 17 个状态全部需要真实事件夹具或真实运行证据：

1. 用户消息悬停；2. 已复制；3. 消息折叠；4. 活动摘要；5. 图片；6. 已排队；
7. 执行中；8. Shell 展开；9. 审批；10. 失败；11. 重试；12. 完成；
13. 历史折叠；14. 历史展开；15. 全产物；16. 扫光；17. 长文本。

状态只能来自 Harness 已持久事件、实时帧、PendingInteraction、Job 和插件注册元数据：

- 同一 Activity ID 原位更新；新 ID 才新增。
- 重试保留旧失败并以新 attempt 追加。
- 活动组只显示一个 `Working for` / `Worked for`，开始时间真实、结束后冻结。
- 最终答复在活动组外，产物区在答复后；禁止虚假绿色完成卡。
- 审批、阻塞、失败和取消属于 L4，强制可见。
- Shell/浏览器原始输出属于 L3，默认折叠在所属动作内。
- 当前未出现离散进度时才扫光；首 token、工具进度、审批、失败、取消或终态立刻停止。
- 图片等权响应式排列，文件纵向排列；renderer 来自插件注册表。
- 未识别插件使用 Harness 通用 renderer，页面不得崩溃或丢事件。
- 长文本按实际渲染高度超过 160px 折叠，展开前后复用同一 Markdown DOM。
- 编辑用户消息生成追加式分支重试，不改旧事件。

### 5.2 禁止硬编码

中央聊天目录的静态检查必须拒绝：

- 对工具名、插件 ID、能力 ID 的 `if`/`switch`。
- `setTimeout` 伪造 queued/running/completed 状态。
- 在前端制造不存在的 Activity、Job、审批、产物或模型。
- 单独实现 WebSocket/SSE/fetch 消息通道。

## 6. Skill Hub 高保真与目标适配

`SkillsWorkspace.tsx` 的三栏语义保持不变：

- “发现”：八项内置能力及已授权连接，来自当前 profile 的真实注册表。
- “已安装”：本地已安装的社区 Skills，来自 Harness `skill-filesystem` 的真实目录。
- “自定义”：本地 ZIP 安装和“发布到 e-Mate Skill Hub”。

旧项目下列交互必须保留：搜索、市场分类、标签、原始来源、详情、版本历史、上传、下载 ZIP、安装并启用、内容 SHA-256、上传者和就绪状态。上传仍使用旧项目固定的三类市场分类，并保留“同 slug + 版本不可覆盖”。

适配规则：

- 浏览器不直接访问 Hub；统一走 Harness Connection 的 `emate.skillHub` Host adapter。
- Hub ZIP 安装到 `$DSH_HOME/skills/<slug>/`，由目标 `@deepseek-ai/dsh-skill-filesystem` 自动发现。
- 目录替换必须原子化并写安装 receipt；摘要不符、依赖/工具不可用或安全检查失败时不改变现有版本。
- 社区 Skill 的启停不映射成企业管理端插件控制；只能由本机用户操作。
- 上传发布只影响中央目录，不远程安装到任何设备。
- JS Cordis 插件不是 Skill ZIP，不允许伪装上传；若以后支持，必须走目标 dynamic Cordis guard/approval。

## 7. Token 与响应式基线

Token 直接取自：

- `upstream/e-mate-2.0.5/desktop/src/styles/tokens.css`
- `upstream/e-mate-2.0.5/desktop/src/v1/styles/primitives.css`
- `upstream/e-mate-2.0.5/desktop/src/v1/styles/layout.css`
- `upstream/e-mate-2.0.5/desktop/src/v1/styles/features.css`
- `upstream/e-mate-2.0.5/desktop/src/v1/styles/plain-language.css`

浏览器化时只删除桌面窗口规则；其余值发生偏离必须在 Design QA 中逐项说明。

| 宽度 | 结构 | 必测状态 |
|---|---|---|
| 320px | 抽屉侧栏，中央面板占满可用宽度 | 登录、协议、聊天、长文本、能力卡单列 |
| 390px | 抽屉侧栏，44px 触摸目标 | 会话切换、模型选择、审批按钮、产物下载 |
| 768px | 可收起侧栏 | Home、能力中心、设置、聊天详情 |
| 1280px | 固定侧栏 + 中央工作区 | 默认验收视口，全部 17 聊天状态 |
| 1920px | 固定侧栏，内容宽度受 Token 限制 | 长会话、图片并发、Office 多产物 |

所有视口：

- `min-width: 320px`，无横向溢出、裁掉按钮或窗口留白。
- 鼠标目标沿用旧项目 32px；粗指针目标至少 44px。
- 键盘焦点清晰；语义按钮/表单可由辅助技术识别。
- `prefers-reduced-motion` 下停止扫光、呼吸和位移动画。

## 8. Design QA 证据合同

每个高保真切片必须保存：

- 最终 2.0.4/2.0.5 来源截图、实现截图、相同路由/状态/主题/视口；历史截图不进入证据包。
- 同尺寸组合对比图；不能以两张分开查看的截图代替。
- 字体、间距、颜色、图片质量、文案五项显式结论。
- P0/P1/P2 的发现、修复和复验历史。
- `design-qa.md`，最终结果只能是 `passed` 或 `blocked`。

当前切片在全量页面和 17 个聊天状态尚未完成前只能记为 `blocked`，不得因构建或 HTTP
检查通过而宣称高保真验收完成。
