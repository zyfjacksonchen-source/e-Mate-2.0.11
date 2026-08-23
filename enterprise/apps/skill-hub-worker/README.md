# e-Mate Skill Hub Worker

Authenticated Skill Hub control plane for the 2.0.12 DSH Profile component.

- Model Gateway session validation is the only identity authority.
- D1 stores immutable catalog, ownership, mutation, and install receipts.
- The dedicated `emate-skill-hub-packages` R2 bucket stores immutable ZIP bytes by content digest.
- The Desktop client still performs the native DSH parser/readback and owns local atomic install, enable, disable, update, and uninstall.

Production setup uses the checked-in `schema.sql`, an `AUTHOR_KEY` Worker secret of at least 32 random bytes, and the exact D1/R2 bindings in `wrangler.jsonc`. Never bind the Desktop release bucket or the public Session-share bucket.
