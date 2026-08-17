# @e-mate/dsh-plugin-office-skills

Lightweight local Office support for e-Mate 2.0.7 on the target Harness rc.6 profile.

- `office_read` reads a workspace-relative DOCX, XLSX, PPTX, or PDF into bounded normalized JSON.
- `office_write` creates a new real DOCX, XLSX, PPTX, or PDF under `.e-mate/office/`.
- Every operation uses the target Tool and Job registries. Outputs never overwrite a source file.
- The package is pure JavaScript and bundles its exact execution closure and an OFL Chinese font. It does not require Python, LibreOffice, Microsoft Office, native compilation, or a second download.

This intentionally is not a lossless arbitrary Office editor. Tables, macros, charts, tracked changes, forms, signatures, masters, and exact third-party layout are read only where the normalized contract supports them. Requests that require unsupported preservation must fail closed. Preview remains the responsibility of the installed `dsh-file-viewer`; scanned content remains the responsibility of `dsh-vision-toolkit`.
