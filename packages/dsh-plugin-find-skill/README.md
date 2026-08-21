# @e-mate/dsh-plugin-find-skill

This package preinstalls the pinned e-Mate adaptation of `dsh-find-skill` for discovery plus one narrow bootstrap path: deployment-allowlisted external-connection Skills may be installed only after native confirmation and are always stored in the DSH global managed root. Legacy allowlisted connector Skills found in the temporary root are promoted on startup. All ordinary community Skill installation, update, enable/disable, upload, and deletion remain exclusively owned by Skill Hub.

The official `skills` CLI is pinned to `1.5.22` for catalog discovery and runs through Desktop's packaged `pnpm`; `latest` is never resolved at runtime. The four e-Mate connector Skills resolve from the immutable `skills-v2.0.9` Git tag.
