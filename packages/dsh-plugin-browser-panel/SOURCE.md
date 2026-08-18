# Source and compatibility receipt

- Browser provider: rc.7 adapter `@e-mate/dsh-plugin-browser`.
- Upstream: <https://github.com/Lum1104/dsh-browser>, commit `01f0b216b1bde88b5f9c6575ce9fb922db6fd8fb`.
- Harness runtime: published `@deepseek-ai/dsh@0.1.0-rc.7` package family.
- Host seam: loopback `ctx.connection.rpc.handle` reading `ctx.emateBrowser.status()`.
- Browser seam: `conversation.view` plus `ctx.connection.rpc.call`.
- Explicit exclusions: browser actions, standalone transport, independent Store/Router, model configuration and synthetic browser events.
- Windows blocker: real Windows Chrome/Edge Computer Use has not yet closed `DSH_BROWSER_WINDOWS_ACCEPTANCE_PENDING`.
