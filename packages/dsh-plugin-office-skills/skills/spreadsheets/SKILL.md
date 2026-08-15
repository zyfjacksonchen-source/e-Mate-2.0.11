---
name: spreadsheets
description: Read, create, edit, calculate, and verify XLSX, CSV, and TSV workbooks with a fail-closed host-toolchain check.
whenToUse: Use for spreadsheet authoring, editing, analysis, formulas, charts, or workbook review.
metadata:
  eMateCapability: office
  format: xlsx
  adapter: clean-room
---

# Spreadsheets

Use the pinned Harness filesystem and Bash or PowerShell tools. This skill supplies an operating procedure, not a spreadsheet runtime.

1. Preserve an input workbook and its existing style unless the user explicitly requests an in-place edit or redesign. Keep outputs inside the active workspace.
2. Before the first workbook operation, make one bounded check for an already available implementation that can read and write the requested format. Do not install packages, invoke the removed Office worker, or assume Excel, Python, Node packages, or a formula engine exists.
3. If the requested operation is unavailable, stop with `OFFICE_XLSX_RUNTIME_UNAVAILABLE`. Do not rename CSV, JSON, or HTML to `.xlsx`.
4. Store numbers, dates, currencies, percentages, booleans, and identifiers with their correct value types. Put assumptions in visible cells and use traceable formulas for derived values rather than hard-coded results.
5. For edits, inspect nearby formulas, formats, validations, tables, conditional formats, and chart ranges before changing the smallest affected range. Extend dependent ranges when the requested edit requires it.
6. Reopen the saved workbook, inspect representative values and formulas, and scan for formula errors, broken references, circular references, hidden unexpected sheets, and clipped key content. Recalculate only when an available implementation supports it; otherwise disclose that formula recalculation is blocked.
7. When rendering is available, inspect every affected sheet or print range. If it is unavailable, report that visual QA is blocked instead of claiming it passed.
8. Return only the requested workbook or delimited file.
