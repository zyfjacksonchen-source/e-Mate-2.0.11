# Source and compatibility record

- Repository: `https://github.com/xmanrui/dsh-im.git`
- Audited commit: `2eea8a08bcd8ef91e8845de1f300b5715b746938`
- Audited package: `@xmanrui/dsh-im@0.2.0`
- npm integrity: `sha512-piOMq5sHFrg7ScyPrUneOrRycB4KvGIm+gmY8qknObccviBHQn3v6zGF4M1f4xQos16dCbXzELQoOor+T/nc/w==`
- Upstream license: MIT, copyright 2026 xmanrui.
- e-Mate target: DeepSeek Harness `0.1.0-rc.5`, downstream commit `12d68b6ca05fa538d98f70ed47786c44ca3a7225` (upstream base `47f943859bef60e4160492346772ded9b24f765a`).

The upstream 281 source tests passed under Node 24.19.0 during the audit. Those tests describe the Host RPC shape as rc.6 and do not prove compatibility with the pinned rc.5 build, e-Mate's project/general workspace binding, OS-keystore contract, browser placement or real channel authorization.

No upstream source or build artifact is copied into this package. Activation remains fail-closed until a separately reviewed adapter has a complete licensed runtime closure and passes the target integration and Computer Use gates.
