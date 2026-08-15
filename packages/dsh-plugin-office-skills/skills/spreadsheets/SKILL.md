---
name: spreadsheets
description: Blocked spreadsheet workflow receipt; no distributable execution layer is installed.
whenToUse: Use for spreadsheet authoring, editing, analysis, formulas, charts, or workbook review.
metadata:
  eMateCapability: office
  format: xlsx
  adapter: clean-room
  state: blocked
  blockerCode: EMATE_OFFICE_EXECUTION_LAYER_UNAVAILABLE
---

# Spreadsheets

This disabled adapter preserves the requested Codex category name but supplies no spreadsheet runtime. It is not model- or user-invocable in e-Mate 2.0.7.

1. Preserve an input workbook and its existing style unless the user explicitly requests an in-place edit or redesign. Keep outputs inside the active workspace.
2. Stop with `EMATE_OFFICE_EXECUTION_LAYER_UNAVAILABLE`. Do not probe the host, install packages, invoke the removed Office worker, or assume Excel, Python, Node packages, or a formula engine exists.
3. Do not rename CSV, JSON, or HTML to `.xlsx`.
4. Store numbers, dates, currencies, percentages, booleans, and identifiers with their correct value types. Put assumptions in visible cells and use traceable formulas for derived values rather than hard-coded results.
5. For edits, inspect nearby formulas, formats, validations, tables, conditional formats, and chart ranges before changing the smallest affected range. Extend dependent ranges when the requested edit requires it.
6. Reopen the saved workbook, inspect representative values and formulas, and scan for formula errors, broken references, circular references, hidden unexpected sheets, and clipped key content. Recalculate only when an available implementation supports it; otherwise disclose that formula recalculation is blocked.
7. When rendering is available, inspect every affected sheet or print range. If it is unavailable, report that visual QA is blocked instead of claiming it passed.
8. Return only the requested workbook or delimited file.
