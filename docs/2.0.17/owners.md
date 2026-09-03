# EM217 ownership and serialization

| Owner | Exclusive scope | Serialization |
|---|---|---|
| SUP | Governance, integration, gates, version contract, release/rollback decisions | Main agent only; EM217-407 follows EM217-501 |
| IMG | Single local image_batch and direct single-image latency ownership in @e-mate/dsh | 101 → 102 → 103 → 104 → 105 → 106 → 107 → 108; QA verifies 108 sanitized evidence |
| GW | Existing gateway journal/admission/usage owners | 201 → 203 → 202 → 204 → 205; proof before gap closure |
| UI | Existing Web client services, projections, conversation slots, Gallery, and shared file import | 301 → 302 → 303 → 304 → 305 → 306; 307 follows 004 + 404 and precedes 501 |
| DESK | Existing Desktop lifecycle and the single Computer Use component | 401 → 402 → 403 → 404 → 405 → 406 → 408 |
| QA | Assertions and sanitized evidence manifests | 501 → 502 → 503 → GUI gates; no release decisions |

WIP is globally capped at 6. The main agent schedules any remaining path overlap exclusively even when dependencies otherwise permit parallel work. Image bytes stay in native Attachment CAS. Desktop remains the only build/package/install/update owner. Computer Use 仅有一个 Tool registry、Settings owner、Profile row、ctx.computerUse backend、approval 与 subprocess lifecycle；Win32 只复用 jing-hy primitives，不采用其插件层。

Tracked evidence is limited to small sanitized specs/manifests/assertions. External immutable evidence uses URI + SHA-256; tracked files contain no secrets, prompt text, logs, screenshots, videos, images, or installers.
