# Source and licensing record

The adapter and normalized Office contracts are original e-Mate MIT code. No Codex runtime, Microsoft Office, LibreOffice, Python worker, or old e-Mate Office plugin code is copied.

Exact distributable dependencies:

- docx 9.7.1 — MIT
- XLSX is implemented directly with the bundled JSZip and XML primitives; no spreadsheet runtime dependency is added.
- pptxgenjs 4.0.1 — MIT
- pdf-lib 1.17.1 and @pdf-lib/fontkit 1.1.1 — MIT
- pdf2json 4.0.3 — Apache-2.0; its published single-file ESM is copied unchanged into `assets/pdf2json/`
- jszip 3.10.1 — used under MIT
- @xmldom/xmldom 0.9.11 — MIT
- Noto Sans SC Variable 5.3.0 font assets — SIL Open Font License 1.1

The runtime targets DeepSeek Harness 0.1.0-rc.6 Tool, Job, Skill, and capability seams. Unsupported layout-preserving edits are an explicit product boundary, not a hidden system dependency.
