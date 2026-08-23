# @e-mate/dsh-plugin-computer-use

Computer Use is exposed only when the current user request explicitly inserts `@电脑操控`. The visible user message keeps that exact label instead of an internal activation marker. The model cannot enable it on its own, and a grant from a prior turn is not reused. Webpage work uses the CDP browser adapter first.

This package embeds the exact MIT-licensed `Anionex/dsh-computer-use` commit recorded in `SOURCE.md` and adapts its bundle identity to e-Mate 2.0.12 on Harness rc.7. It stays on the native DSH Tool, Skill, Settings, approval, storage, attachment, and subprocess seams.

The native provider is enabled only on macOS 14 or newer. Windows remains supported by e-Mate, but this macOS Accessibility provider is disabled there rather than replaced with an unverified automation path.
