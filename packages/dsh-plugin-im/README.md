# @e-mate/dsh-plugin-im

This e-Mate 2.0.7 package is the fail-closed adapter boundary for [`xmanrui/dsh-im`](https://github.com/xmanrui/dsh-im) commit `2eea8a08bcd8ef91e8845de1f300b5715b746938` (`@xmanrui/dsh-im@0.2.0`).

It contributes one truthful `IM 外部连接` card through the existing `emateCapabilities` registry. It installs no upstream runtime, Tool, transport, Router, Session Store or credential surface. The card remains blocked with `EMATE_DSH_IM_RUNTIME_UNVERIFIED` until the licensed channel subset is adapted to the pinned Harness rc.5 API, bound to e-Mate project/general workspaces and accepted with real authorization on macOS and Windows.

QQ is excluded because the upstream QR runtime depends on `@tencent-connect/qqbot-connector@1.2.0`, whose npm metadata declares `UNLICENSED`. The remaining audited upstream channels are Feishu, Weixin, DingTalk, WeCom, Telegram, Discord and WhatsApp; none is reported ready by this package.
