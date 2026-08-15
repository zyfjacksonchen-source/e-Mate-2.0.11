---
name: documents
description: Blocked DOCX workflow receipt; no distributable execution layer is installed.
whenToUse: Use for Word or DOCX reading, authoring, editing, review, and conversion tasks.
metadata:
  eMateCapability: office
  format: docx
  adapter: clean-room
  state: blocked
  blockerCode: EMATE_OFFICE_EXECUTION_LAYER_UNAVAILABLE
---

# Documents

This disabled adapter preserves the requested Codex category name but supplies no document runtime. It is not model- or user-invocable in e-Mate 2.0.7.

1. Keep source files unchanged unless the user explicitly requests an in-place edit. Write deliverables inside the active workspace and use a descriptive `.docx` name.
2. Stop with `EMATE_OFFICE_EXECUTION_LAYER_UNAVAILABLE`. Do not probe the host, install packages, download a runtime, invoke the removed e-Mate Office worker, or assume Python, LibreOffice, Microsoft Office, or a particular library exists.
3. Do not create a renamed text or HTML file pretending to be DOCX.
4. For reads, inspect paragraphs, headings, lists, tables, headers, footers, comments, tracked changes, links, media, and document properties relevant to the request.
5. For creation or editing, preserve semantic Word structures: real heading styles, real numbering, explicit table geometry, accessible labels, stable page dimensions, and consistent typography. Make the smallest requested edit when a source document exists.
6. Validate the resulting OOXML package by reopening it with the same implementation. When a compatible renderer is already available, render every page and inspect for clipping, overlap, missing glyphs, broken tables, and header/footer drift. If no renderer exists, report that visual QA is blocked instead of claiming it passed.
7. Return only the requested final document. Keep diagnostic renders and temporary conversions out of the deliverables.
