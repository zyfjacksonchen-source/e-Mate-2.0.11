---
name: documents
description: Create, read, and safely regenerate DOCX documents with the local e-Mate Office tools.
whenToUse: Use for text-first DOCX reading, authoring, review, and supported edits.
metadata:
  eMateCapability: office
  format: docx
  adapter: clean-room
  state: ready
---

# Documents

Use `office_read` to normalize an existing DOCX and `office_write` to create a new real DOCX. Never overwrite the source.

1. Keep source files unchanged unless the user explicitly requests an in-place edit. Write deliverables inside the active workspace and use a descriptive `.docx` name.
2. `office_write` accepts `{title?, paragraphs:[string|{text,heading?}]}` where heading is 1, 2, or 3.
3. Do not create a renamed text or HTML file pretending to be DOCX.
4. Reading extracts text into the normalized structure; it is not a lossless representation of tables, comments, tracked changes, media, headers, or arbitrary third-party layout.
5. To edit, read, change the normalized JSON, and write a new filename. If the requested edit depends on unsupported layout, stop instead of claiming a lossless edit.
6. Reopen the result with `office_read`; use the installed file viewer for user preview when available.
7. Return only the requested final document. Keep diagnostic renders and temporary conversions out of the deliverables.
