# e-Mate DSH CDP adapter

This ordinary DSH Profile plugin connects only to an explicitly enabled loopback Chrome DevTools endpoint (default `http://127.0.0.1:9222`). It registers session-bound browser Tools through the native DSH Tool, approval, and system-prompt services.

Enable remote debugging in Chrome at `chrome://inspect/#remote-debugging` and accept Chrome's own security prompt. The e-Mate Profile enables its independent CDP control grant by default, so the Agent can then use `browser_tabs` or `browser_snapshot` without a browser extension. The user can disable that grant in the capability center. Full Access remains a separate filesystem policy and never bypasses Chrome's own remote-debugging security control.

For webpage reading and operation, CDP is the first path. Computer Use is reserved for a request where the user explicitly inserts `@电脑操控`.

The package contains no extension and does not launch or download another browser.
