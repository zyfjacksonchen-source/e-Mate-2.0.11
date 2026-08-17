---
name: presentations
description: Create, read, and safely regenerate PPTX presentations with the local e-Mate Office tools.
whenToUse: Use for text-first PPTX authoring, extraction, review, and supported edits.
metadata:
  eMateCapability: office
  format: pptx
  adapter: clean-room
  state: ready
---

# Presentations

Use `office_read` to extract slide text and `office_write` to create a new real PPTX. Never overwrite the source.

1. Preserve a source deck and its master/layout hierarchy unless the user explicitly requests an in-place edit or replacement. Keep outputs inside the active workspace.
2. `office_write` accepts `{slides:[{title?,bullets:string[]}]}`.
3. Never rename images, PDF, or HTML to `.pptx`.
4. Reading extracts ordered slide text; notes, charts, images, masters, animations, and arbitrary third-party layout are not losslessly represented.
5. To edit, read, change the normalized JSON, and write a new filename. Stop if the requested edit depends on unsupported layout rather than claiming preservation.
6. Reopen with `office_read` and verify slide count and text; use the installed file viewer for preview when available.
7. If rendering is unavailable, report that visual QA is blocked instead of claiming the deck passed. Return only the requested final PPTX.
