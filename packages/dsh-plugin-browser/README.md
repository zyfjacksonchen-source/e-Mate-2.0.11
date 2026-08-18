# @e-mate/dsh-plugin-browser

e-Mate 2.0.9 对 `Lum1104/dsh-browser` 的 DeepSeek Harness rc.7 适配。

本包只保留真实页面快照、点击、输入、导航、滚动、等待与文本读取能力。浏览器扩展不包含自己的聊天、会话、模型、设置或审批页面；所有 Tool、Session、项目绑定、审批和持久事件继续由 e-Mate 内的固定 Harness rc.7 负责。

浏览器标签页按真实 e-Mate Session 隔离：新会话不会静默复用已被其他会话绑定的标签页；用户点击扩展图标可显式把当前标签页交给下一次浏览器操作。`ask` 权限模式使用 Harness 原生审批和审计事件，默认 `danger-full-access` 按目标项目语义不弹审批、直接执行。

扩展制品位于 `extension/dist`，同一 MV3 制品支持 macOS Chrome 与 Windows Chrome/Edge。未连接扩展时插件失败关闭，不会回退到系统脚本、Playwright 下载或另一个浏览器实现。

当前开发验收可在 `chrome://extensions` 或 `edge://extensions` 中加载该目录。正式开箱安装仍须通过 Chrome Web Store 与 Microsoft Edge Add-ons 审核，因此商店发布和 Windows 实机 Computer Use 是发布门禁，不以开发者模式代替。
