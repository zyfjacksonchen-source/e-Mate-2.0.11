# @e-mate/dsh-plugin-browser-panel

这是 e-Mate 2.0.7 固定本地运行时的失败关闭浏览器面板适配器。

目录声明的 `dsh-browser-panel` 源码仓库与 npm 包均无法验证，因此本包不会复制相似项目、创建浏览器运行时或伪造 ready 状态。它只通过 Harness 自带的 loopback Connection RPC 返回当前会话绑定的真实阻塞状态，并通过 `conversation.view` UI slot 展示该状态。

平台合同：

- macOS 返回 `setup-required / EGO_BROWSER_RUNTIME_UNVERIFIED`，直到真实启动、权限、任务空间隔离、清理、交互与下载验收完成。
- Windows 采用 `@playwright/mcp@0.0.78` 与系统 Edge 作为候选方案，但固定 rc.5 没有 Session/项目绑定的 MCP workspace-root 路径，真实 Windows 验收也未完成，因此只返回 `setup-required / PLAYWRIGHT_MCP_EDGE_UNVERIFIED`。

此包不会安装、启动或调用上述候选，也不会复制其他适配器。
