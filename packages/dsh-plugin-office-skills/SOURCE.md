# Source and clean-room record

- Implementation: original e-Mate code and instructions, MIT licensed.
- Target interface: DeepSeek Harness `@deepseek-ai/dsh-skill@0.1.0-rc.5`, pinned by e-Mate to commit `47f943859bef60e4160492346772ded9b24f765a`.
- Functional reference: the user requested the four Codex office categories (documents, PDF, spreadsheets, presentations).
- No file, script, template, binary, runtime, or prose was copied from the locally installed Codex office skill packages.
- The Apache-2.0 OpenAI PDF skill was not copied or adapted, so its NOTICE is not part of this package. If future work incorporates that source, the Apache license and NOTICE must be added before distribution.

## 2026-08-16 execution-layer audit

- The pinned `standard` Agent preset mounts the target-owned filesystem, Skill, Bash on macOS, PowerShell on Windows, and background Job Tools. The pinned source and package lock contain no DOCX, PDF, XLSX, or PPTX execution Tool or document authoring library.
- The only ZIP library in the target lock is `jszip@3.10.1`, pulled transitively by `@modelcontextprotocol/server-everything`; this package cannot resolve it and a ZIP primitive alone is not an Office reader, writer, renderer, or formula engine.
- The locally installed Codex primary-runtime wrappers are environment-owned and require a Codex-only workspace dependency loader. They are not an e-Mate runtime source: the Documents Skill carries an additional license that forbids extraction, third-party distribution, and derivative distribution, while the other installed wrappers expose no standalone distributable execution package.
- Official `openai/skills` commit `49f948faa9258a0c61caceaf225e179651397431` contains only `skills/.curated/pdf` among the four requested categories. That Skill is Apache-2.0 but instructs the caller to install Python packages and Poppler; it provides no prebuilt execution layer and no DOCX, XLSX, or PPTX implementation.
- Native Microsoft Office, LibreOffice, Python, Poppler, Homebrew, system package managers, and accidental global Node modules are outside the e-Mate installation contract. They cannot make a mandatory built-in capability pass.
- Result: `EMATE_OFFICE_EXECUTION_LAYER_UNAVAILABLE`. The four Skill identities remain registered but non-invocable, no execution Tool is registered, and the capability is blocked until a separately licensed macOS/Windows plugin supplies and validates the complete runtime through the pinned Harness seams.
