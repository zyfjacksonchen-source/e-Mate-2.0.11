# @e-mate/dsh-plugin-office-skills

This e-Mate 2.0.7 bundle registers four instruction-only skills: `documents`, `pdf`, `spreadsheets`, and `presentations`.

It uses the public `ctx.skills.registerProvider` seam and adds no Tool, transport, store, Python environment, Office worker, OCR model, browser, or package installer. Each skill checks the host for an implementation required by the requested operation and fails closed when none exists.

The package becomes a profile layer through its `dsh.bundle.patch` manifest and `cordis.patch.yml`.
