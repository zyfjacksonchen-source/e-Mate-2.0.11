# @e-mate/dsh-plugin-find-skill

This package preinstalls the pinned e-Mate adaptation of `dsh-find-skill` as a discovery-only Tool. Installation, update, enable/disable, upload, and deletion are owned exclusively by Skill Hub so one immutable version/SHA transaction controls the full lifecycle.

The official `skills` CLI is pinned to `1.5.22` for catalog discovery and runs through Desktop's packaged `pnpm`; `latest` is never resolved at runtime. The four e-Mate connector Skills resolve from the immutable `skills-v2.0.9` Git tag.
