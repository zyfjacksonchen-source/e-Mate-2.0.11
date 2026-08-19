# Enterprise control-plane baseline

This directory contains the smallest server-side subset needed by e-Mate 2.0.10:
authentication, managed model routing, usage/audit analytics, the existing admin and
usage applications, and their direct contracts. It deliberately excludes the old
Electron desktop, local Agent runtime, and unrelated product packages.

The baseline was recovered read-only from the deployed build source snapshot:

```text
/opt/e-mate/builds/model-catalog-08f2f35-20260803-1749/src
```

The source package identified itself as e-Mate 2.1.47 and Apache-2.0. No Git metadata
or matching public repository was present. `upstream/files.sha256` records the 107
imported baseline files; its SHA-256 is:

```text
5ec2f08e3990ff494bf6e11374c5558db412908e2ced1b39c8d9421a3d82fc54
```

The manifest is provenance evidence, not a current-tree checksum: subsequent e-Mate
2.0.10 changes are expected to differ and remain reviewable in this repository.
