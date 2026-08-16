# Source and compatibility receipt

- Browser provider: `@e-mate/dsh-plugin-browser`.
- Upstream: <https://github.com/Lum1104/dsh-browser>.
- Commit: `01f0b216b1bde88b5f9c6575ce9fb922db6fd8fb`.
- Harness: `@deepseek-ai/dsh@0.1.0-rc.5`, commit `47f943859bef60e4160492346772ded9b24f765a`.
- Host seam: loopback `ctx.connection.rpc.handle` reading `ctx.emateBrowser.status()`.
- Browser seam: `conversation.view` plus `ctx.connection.rpc.call`.
- Explicit exclusions: browser actions, standalone transport, independent Store/Router, model configuration and synthetic browser events.
- Windows blocker: real Windows Chrome/Edge Computer Use has not yet closed `DSH_BROWSER_WINDOWS_ACCEPTANCE_PENDING`.
