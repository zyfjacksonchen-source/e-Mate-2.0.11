# @e-mate/dsh-plugin-xin-assistant

e-Mate 的 DSH 原生芯助手 CLI 插件。它复用 DSH `subprocess` 和 `tools`，只暴露 CLI 已声明的只读查询，不开放任意命令或 shell。

插件内置从生产 `v1.1.0` 获取的 `xin_agent_cli.py`，启动时校验 SHA-256，并随包携带纯 Python HTTP 依赖，离线使用应用内 Python，不在用户设备上临时安装依赖。缓存查询需要在 `databasePath` 配置芯助手只读数据卷；MPI 查询继续使用 CLI 自己的只读授权规则。
