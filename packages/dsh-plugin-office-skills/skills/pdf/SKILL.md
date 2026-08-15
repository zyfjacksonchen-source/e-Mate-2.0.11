---
name: pdf
description: Read, create, fill, edit, and visually verify PDF files with a fail-closed host-toolchain check.
whenToUse: Use for PDF reading, generation, form filling, editing, extraction, rendering, or review.
metadata:
  eMateCapability: office
  format: pdf
  adapter: clean-room
---

# PDF

Use the pinned Harness filesystem and Bash or PowerShell tools. This skill supplies an operating procedure, not a PDF runtime.

1. Preserve the source PDF unless the user explicitly requests an in-place edit. Keep outputs inside the active workspace.
2. Before the first PDF operation, make one bounded check for an already available PDF implementation and, when layout matters, a renderer. Do not install packages, download Poppler, invoke the removed Office worker, or assume Python or any named library exists.
3. If the required operation is unavailable, stop with `OFFICE_PDF_RUNTIME_UNAVAILABLE`. Never substitute screenshots, Markdown, or a renamed file for a real PDF.
4. For reads, inspect the complete relevant pages and retain headings, tables, figures, form values, annotations, footnotes, and source labels needed to answer accurately. Text extraction alone is not layout verification.
5. For creation or editing, use embedded fonts where required, accessible reading order, consistent page geometry, and human-readable links and citations.
6. For AcroForms, preserve interactivity unless the user asks to flatten. Reopen the written file and verify both the canonical field tree and page widgets; a visible appearance is not proof that the stored value changed.
7. When a renderer is available, render and inspect every changed page for clipping, overlap, missing glyphs, stale form appearances, and illegible graphics. If it is unavailable, state that visual QA is blocked instead of claiming success.
8. Return only the requested final PDF; do not expose temporary page images unless asked.
