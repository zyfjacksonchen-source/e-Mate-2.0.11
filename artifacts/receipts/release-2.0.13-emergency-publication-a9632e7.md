# e-Mate 2.0.13 emergency publication receipt

- Published source: `a9632e787e8843c189cbb79a9725c72461982dcd`
- Protected-main CI: `32971421254` (`success`)
- Desktop release binding: `32974052237` (`success`)
- Profile publication preparation: `32974255196` (`success`; not activated in production by this receipt)
- Base contract: `e-mate-desktop-profile-v7-dsh-b2b1650b01f0`
- Harness: `b2b1650b01f0ee88d81837a9b5c050f9f763f606`

## Public Desktop objects

- macOS: `desktop/releases/v2.0.13/a9632e787e8843c189cbb79a9725c72461982dcd/e-Mate-2.0.13-mac-universal.dmg`
  - bytes: `398555037`
  - SHA-256: `428aa13c86706dda1ca2defacdf0c587212f103313ae0d6498df5daef4251562`
  - public ETag: `9b1cbeddb6be9dbb957b14e44ecf6dc5`
- Windows: `desktop/releases/v2.0.13/a9632e787e8843c189cbb79a9725c72461982dcd/e-Mate-2.0.13-win-x64-Setup.exe`
  - bytes: `281340515`
  - SHA-256: `e8b2cef786464bbcef6291c4b2f94865f7ddb2af863d04f494d229a1a68b6ed9`
  - public ETag: `85e18e8248f9565eb92d8cacb1aad7d8`

## Legacy update pointer

- Key: `desktop/latest.json`
- bytes: `948`
- SHA-256: `1d70004c726e458525205dd370ebea595b3121ffd2afe49d7c65d646c4ac19c4`
- predecessor ETag: `0575b3b10294e3c310921156aecfefde`
- published ETag: `291b5b867ee06b491411f67f155543b9`
- object version: `7e5fc1a730f583c09714f9c5120c7caa`
- public readback: HTTP `200`, version `2.0.13`, exact source and installer identities matched.

## Installed acceptance

- macOS DMG: version `2.0.13`, universal `x86_64 + arm64`, strict deep code-signature verification passed; signature remains permitted ad-hoc/runtime.
- Windows exact installer: remote SHA matched before install; installed UI showed `2.0.13`, existing `242` sessions and selected model remained visible; mailbox ACL fix is included.

## Explicit waiver and closed boundaries

- Performance status at the time of this emergency pointer write: **user-waived / not measured**. This was not a performance pass.
- No signed Desktop admission was fabricated.
- `desktop/manual/v2.0.13/latest.json` was not published because the current website contract requires a real signed performance admission.
- The website `current` symlink was not switched; public index remained `636` bytes with SHA-256 `02ea7f5f44ef41390c41901b3f385754bc333f19be4a9aa0efe582890a7a252c`.
- Profile publication bytes were prepared but production desired-state pointers were not activated by this emergency receipt.
- The one-time Cloudflare Worker and quick tunnel were removed after public readback.

This receipt records an emergency legacy Desktop update publication, not completion of S27-S35 or the main Goal. A later formal performance/admission release must produce a separate receipt and may not rewrite this history.
