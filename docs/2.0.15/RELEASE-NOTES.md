# e-Mate 2.0.15 release notes

候选前源码冻结稿 — 2.0.15 尚未构建候选、安装、签名或发布。当前公开生产版本仍精确为 2.0.13；2.0.14 从未正式发布。

## Planned user-visible highlights

- 更稳定的首页、导航、设置与输入体验，并统一显示当前产品版本。
- 更可靠的工具发现、定时任务、能力中心、在线分享与手动更新入口。
- 账户页展示真实用量活动，消息可在简洁与详细视图之间切换。
- 图片粘贴、拖放、读取和生成继续复用原生附件与模型能力边界。
- 使用一致的 C03 应用图标，并从未来产品闭包中移除已退役的旧助手载荷。

## Upgrade and migration status

- 源码已冻结在 `c2e7365b71a10e4a54622a70a30b0ae9fe19df90`，但这不是候选或发布字节。
- 未来的同一精确候选必须分别证明 macOS arm64、macOS x64 与 Windows x64 全新安装。
- 2.0.12 与 2.0.13 的真实前任升级、失败健康回滚和重启提交仍待验证；现有公开指针保持 2.0.13，不提前迁移。
- Skill Hub、分享、外部连接、Computer Use 权限和真实账号/服务验收仍待安装态回执。

## Release gates still open

- Build once 候选、精确字节数、SHA-256、版本、架构与来源回执。
- 三目标完整组合与启动、安装态截图、TCC 与真实服务验证。
- macOS 签名或 ad-hoc 事实、Windows x64 安装事实及失败回滚。
- 不可变对象上传、Feed、Profile desired state、官网切换与公开全字节回读。

在以上门禁全部关闭前，不得把本稿称为 RC、installed 或 released。
