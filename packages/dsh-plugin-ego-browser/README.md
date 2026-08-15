# @e-mate/dsh-plugin-ego-browser

This e-Mate 2.0.7 bundle registers the pinned ego-browser instructions through the local Skill provider.

Cordis and the Skill service are supplied by the fixed e-Mate local runtime (`0.1.0-rc.5`, commit `47f943859bef60e4160492346772ded9b24f765a`); they are recorded in the manifest rather than declared as installable peer dependencies.

It does not package the ego lite application or browser runtime, create a Tool, or add a transport. macOS remains `setup-required / EGO_BROWSER_RUNTIME_UNVERIFIED`; the Skill is not model- or user-invocable until real platform acceptance passes.

Windows reports `PLAYWRIGHT_MCP_EDGE_UNVERIFIED`. Microsoft Playwright MCP `v0.0.78` with system Edge is the pinned replacement candidate, but this bundle deliberately does not install or mount it: rc.5 provides no Session/project-bound MCP workspace-root path, and real Windows runtime acceptance is pending. Other platforms remain unsupported without a fallback.
