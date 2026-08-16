---
name: presentations
description: Blocked presentation workflow receipt; no distributable execution layer is installed.
whenToUse: Use for PowerPoint or PPTX authoring, editing, layout, rendering, and review.
metadata:
  eMateCapability: office
  format: pptx
  adapter: clean-room
  state: blocked
  blockerCode: EMATE_OFFICE_EXECUTION_LAYER_UNAVAILABLE
---

# Presentations

This disabled adapter preserves the requested Codex category name but supplies no presentation runtime. It is not model- or user-invocable in e-Mate 2.0.7.

1. Preserve a source deck and its master/layout hierarchy unless the user explicitly requests an in-place edit or replacement. Keep outputs inside the active workspace.
2. Stop with `EMATE_OFFICE_EXECUTION_LAYER_UNAVAILABLE`. Do not probe the host, install packages, invoke the removed Office worker, or assume PowerPoint, LibreOffice, Python, Node packages, or fonts exist.
3. Never rename images, PDF, or HTML to `.pptx`.
4. For reads, inspect every relevant slide including notes, charts, tables, images, labels, sources, hidden slides, and master/layout relationships.
5. For creation or editing, keep a coherent narrative, readable typography, consistent margins, correct object order, accessible alt text, and one clear visual system. Prefer inherited layouts when editing a supplied deck.
6. Reopen the saved deck and verify slide count, relationships, notes, media, charts, and unresolved placeholders. When a compatible renderer exists, render every slide and inspect full-size output for clipping, overlap, unintended wrapping, missing fonts, broken connectors, and out-of-canvas objects.
7. If rendering is unavailable, report that visual QA is blocked instead of claiming the deck passed. Return only the requested final PPTX.
