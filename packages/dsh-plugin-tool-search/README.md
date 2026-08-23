# e-Mate Tool Search

基于 DSH rc.7 `agent.ctx.tools.restrict()` 的逐会话工具渐进披露组件。标准 Native Tool Mode 初始只展示常用工具与 `tool_search`；搜索命中后，原始 Tool 定义会在下一模型步骤恢复可见。

组件不代理 Tool 调用、不改变权限，也不写自定义 Session 事件。会话恢复只读取 DSH Agent Loop 已持久化的 `request/header.tools`；Code Mode 保持其原生 SDK 披露路径。

同一 Base-v6 已准入热组件还提供独立的 `web-search` 入口：它只向 DSH 原生 `ctx.web` 注册 GPT Responses Provider，逐次读取既有设备级搜索租约，并在上游没有返回原生搜索证据及 URL 引用时失败关闭。它不新增 Tool、会话、传输或凭据存储。
