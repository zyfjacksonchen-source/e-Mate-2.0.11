# @e-mate/dsh-plugin-vision-toolkit

This package is the e-Mate `2.0.9` adapter boundary for `Anionex/dsh-vision-toolkit` commit `29850a83871d4b7a7cc13e251420c5a440e2f69e`.

The upstream `0.1.7` plugin targets DeepSeek Harness `0.1.0-rc.6` and exposes user-editable multimodal provider, endpoint, protocol, model, and credential settings. e-Mate is pinned to Harness `0.1.0-rc.7`, whose model seam does not provide an enterprise-owned multimodal policy binding. Activating the upstream plugin would therefore let local Settings bypass the enterprise model policy.

The adapter fails closed: it registers a real `vision_toolkit_status` Tool and a status-only `vision-tools` Skill, but it does not register the ten upstream execution Tools and does not prepare Python, OCR, or Chromium. Status code `EMATE_VISION_POLICY_SEAM_MISSING` records the exact reason and upstream commit. Managed runtime preparation stays deferred until a separately accepted adapter can receive provider and model selection from an enterprise-owned Harness seam without any user override.

This is an intentional release blocker for OCR and Vision Toolkit acceptance, not a fallback implementation.

The rc.5 Harness service packages are not available from the public npm registry. They are optional peer dependencies and must resolve only from e-Mate's pinned, prebuilt Harness runtime; installing rc.6 service packages would violate the source pin.
