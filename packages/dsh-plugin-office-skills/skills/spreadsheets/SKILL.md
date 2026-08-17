---
name: spreadsheets
description: Create, read, and safely regenerate XLSX workbooks with the local e-Mate Office tools.
whenToUse: Use for tabular XLSX authoring, reading, analysis, and supported edits.
metadata:
  eMateCapability: office
  format: xlsx
  adapter: clean-room
  state: ready
---

# Spreadsheets

Use `office_read` to normalize an existing workbook and `office_write` to create a new real XLSX. Never overwrite the source.

1. Preserve an input workbook and its existing style unless the user explicitly requests an in-place edit or redesign. Keep outputs inside the active workspace.
2. `office_write` accepts `{sheets:[{name,rows:[[string|number|boolean|null]]}]}`.
3. Do not rename CSV, JSON, or HTML to `.xlsx`.
4. Keep numeric, boolean, text, and null types intact. Formula results can be read, but the lightweight writer does not calculate formulas or preserve arbitrary charts/macros.
5. To edit, read, change the normalized rows, and write a new filename. Stop if the request depends on macros, charts, pivots, validation, or exact third-party styling.
6. Reopen the saved workbook with `office_read` and compare representative values.
7. When rendering is available, inspect every affected sheet or print range. If it is unavailable, report that visual QA is blocked instead of claiming it passed.
8. Return only the requested workbook or delimited file.
