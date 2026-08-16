# @e-mate/dsh-plugin-office-skills

This e-Mate 2.0.7 bundle records four disabled Skill adapters: `documents`, `pdf`, `spreadsheets`, and `presentations`.

It uses the public `ctx.skills.registerProvider` seam and adds no Tool, transport, store, Python environment, Office worker, OCR model, browser, or package installer. The adapters are not model- or user-invocable and the capability reports `blocked / EMATE_OFFICE_EXECUTION_LAYER_UNAVAILABLE`; e-Mate never probes or depends on an accidental host installation.

This is an intentional release blocker for the mandatory Office Computer Use scenarios. It may be lifted only by a separately licensed, macOS/Windows prebuilt execution plugin that uses the pinned Harness Tool/Job/filesystem seams and passes real create/read/edit/export/reopen acceptance for all four formats.

The package becomes a profile layer through its `dsh.bundle.patch` manifest and `cordis.patch.yml`.
