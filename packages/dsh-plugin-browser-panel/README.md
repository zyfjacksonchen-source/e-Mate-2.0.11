# @e-mate/dsh-plugin-browser-panel

本包只把 rc.6 原生 `@yuxianglin/dsh-bridge-browser` 的真实连接状态投影到 Harness 既有 loopback Connection RPC 与 `conversation.view`。它不执行浏览器动作，也不建立第二套 Store、Router、会话、模型或聊天传输。

- macOS：扩展连接后可显示 ready；页面动作仍由真实 `browser_*` Tool 与 Session 事件呈现。
- Windows：使用相同 Chrome/Edge MV3 制品；在真实 Windows Computer Use 完成前保持 `DSH_BROWSER_WINDOWS_ACCEPTANCE_PENDING`。
- 扩展未连接：`DSH_BROWSER_EXTENSION_NOT_CONNECTED`，失败关闭。
- Linux：不在 e-Mate 2.0.7 支持范围。
