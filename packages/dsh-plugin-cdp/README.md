# e-Mate DSH CDP adapter

This ordinary DSH Profile plugin connects only to an explicitly enabled loopback Chrome DevTools endpoint (default `http://127.0.0.1:9222`). It registers session-bound browser Tools through the native DSH Tool, approval, and system-prompt services.

Enable remote debugging in Chrome at `chrome://inspect/#remote-debugging`, accept Chrome's own security prompt, then ask the Agent to run `browser_tabs` or `browser_snapshot`. Full Access does not grant browser control: its `approval/policy: never` rejects mutations unless the CDP plugin has a separate explicit control grant, and it never bypasses Chrome's own remote-debugging security control.

The package contains no extension and does not launch or download another browser.
