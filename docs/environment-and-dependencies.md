# Environment and dependencies

## User environment

- macOS 13+ on Apple Silicon or Intel, delivered as one Universal DMG.
- Windows 10/11 x64, delivered as one assisted NSIS installer.
- Linux is not a 2.0.16 release target.
- Installers contain their runtime closure. Users do not install Node, npm, pnpm, Yarn, Python, Electron, Xcode, MSVC, or Rust.
- Both installers are unsigned. The official download page publishes immutable URLs and SHA-256 values plus the macOS trust instructions.

## Development environment

- Node 24.x.
- Corepack with exact root `pnpm@11.7.0`.
- Desktop Yarn project and immutable lock under `desktop/`.
- Harness `0.1.0-rc.7@32728743c28911bcd4279f79fe9c43ee7aacfb6d`.
- Desktop reference `anywhere-labs/deepseek-harness-desktop@6074088f5b660206e404b3591fab51fb99c69add`.

Install and test the source with the existing pinned package managers. Build installers only through the Desktop workspace:

```bash
corepack yarn --cwd desktop install --immutable
corepack yarn --cwd desktop check
corepack yarn --cwd desktop dist:mac
corepack yarn --cwd desktop dist:win
```

Run the macOS command on macOS and the Windows command on the signed-in Codex Remote Windows host. CI may run checks but does not replace either native build.
