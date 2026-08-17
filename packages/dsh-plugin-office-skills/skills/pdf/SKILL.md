---
name: pdf
description: Create, read, and safely regenerate PDF documents with the local e-Mate Office tools.
whenToUse: Use for text-first PDF reading, generation, extraction, review, and supported edits.
metadata:
  eMateCapability: office
  format: pdf
  adapter: clean-room
  state: ready
---

# PDF

Use `office_read` to extract page text and `office_write` to create a new real PDF with an embedded OFL Chinese font. Never overwrite the source.

1. Preserve the source PDF unless the user explicitly requests an in-place edit. Keep outputs inside the active workspace.
2. `office_write` accepts `{title?,pages:[{lines:string[]}]}`.
3. Never substitute screenshots, Markdown, or a renamed file for a real PDF.
4. Reading extracts text; it does not losslessly represent tables, figures, forms, annotations, signatures, or exact layout.
5. To edit, read, change normalized pages, and write a new filename. Stop for form/signature/layout-preserving edits instead of flattening or fabricating them.
6. Reopen with `office_read`; use the installed file viewer for visual preview when available.
8. Return only the requested final PDF; do not expose temporary page images unless asked.
