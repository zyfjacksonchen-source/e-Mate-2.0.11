# Source and compatibility receipt

- Browser provider: native rc.6 `@yuxianglin/dsh-bridge-browser`.
- Upstream: <https://github.com/Lum1104/dsh-browser>, commit `b20ecd51eca800e00fc40bd7973271bf62a1b1d2`.
- Harness runtime: published `@deepseek-ai/dsh@0.1.0-rc.6` package family. The sibling source checkout predates rc.6 and is not claimed as its source commit.
- Host seam: loopback `ctx.connection.rpc.handle` reading `ctx.emateBrowser.status()`.
- Browser seam: `conversation.view` plus `ctx.connection.rpc.call`.
- Explicit exclusions: browser actions, standalone transport, independent Store/Router, model configuration and synthetic browser events.
- Windows blocker: real Windows Chrome/Edge Computer Use has not yet closed `DSH_BROWSER_WINDOWS_ACCEPTANCE_PENDING`.
