# Implementation status

**Version:** 1.0.0  
**Target:** Windows 10/11 x64  
**State:** Feature-complete for the defined scope; verified with automated tests and a packaged build. Live cloud-provider behavior requires your own API key.

## Requirement coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| Premium 3D desktop assistant | Complete | React Three Fiber core, CSS fallback, obsidian/silver/azure system |
| Distinct accent identities | Complete | Azure, violet, silver; persisted and covered by E2E |
| Full navigation | Complete | Home, Chat, Projects, Computer, Models, Tools, Activity, Settings, History |
| Genuine streaming chat | Complete | Three wire adapters, six provider types (including OpenRouter Free and OpenCode Console) + SSE parser; no simulated fallback |
| Persistent history | Complete | SQLite conversations/messages, summaries, search, export |
| Model management | Complete | Add/edit/test/remove providers, model discovery, default routing |
| Secure API keys | Complete | Windows DPAPI via `safeStorage`; main-process only; masked DTOs |
| Permissioned tools | Complete | 8 permissions, 29 tools, risk levels, confirmations, timeouts |
| Task/activity tracking | Complete | Tasks, steps, tool runs, approvals, diagnostics |
| Cancellation | Complete | Abort controllers, pending-approval rejection, shutdown cancellation |
| Native companion | Complete | Separate transparent always-on-top window, states, quick ask, persistence; mini robot launcher on minimize |
| Browser assistance | Complete | Sandboxed WebContentsView, toolbar, search, YouTube, read/click/fill |
| Coding/filesystem assistant | Complete | Project scan, tree, editor, search, patch, backups, checkpoints |
| Terminal safeguards | Complete | No shell, allowlist, blocked git/npm operations, output caps |
| No fake AI / no local models | Complete | Provider required; explicit “no local model runtime” messaging |
| Windows 10/11 packaging | Complete | NSIS installer built at `release/IGRIS-1.0.0-x64-Setup.exe` |
| Tests | Complete | 79 unit/integration + 8 Electron E2E passing |
| Documentation | Complete | README + architecture, security, testing, status docs |
| Secrets excluded from git | Complete | `.gitignore`; no keys or `.env` files in the tree |

## Verified results

```text
npm run typecheck   PASS
npm test            10 files, 79 tests PASS
npm run test:e2e    8 tests PASS
npm run test:packaged PASS (packaged IGRIS.exe)
npm run pack        PASS -> release/win-unpacked/IGRIS.exe
npm run dist        PASS -> release/IGRIS-1.0.0-x64-Setup.exe
```

OpenCode Console model discovery: PASS against the live gateway catalogue; free-tier models are excluded because OpenCode rejects non-OpenCode clients. A chat request requires account credits or a Go plan.

OpenRouter free-model discovery: PASS against the live catalogue (16 free models at the time of verification). Paid model IDs are rejected by the provider service guard.

Gemini live verification: PASS — `gemini-3.6-flash` streamed “IGRIS online” through the IGRIS chat engine; 46 models were discovered. The key was stored only as a DPAPI-encrypted blob.

Visual QA at 1442×816: no horizontal overflow on any route; bridge present; companion and minimized robot launcher render. Three.js emits a harmless `THREE.Clock` deprecation warning from a dependency.

## Deliberate scope decisions

- **Electron rather than Tauri:** Rust/MSVC toolchains were unavailable; Electron provides native windows, `safeStorage`, `WebContentsView`, and a reliable Windows build with the installed toolchain.
- **Built-in `node:sqlite`:** avoids a native addon and keeps persistence in the main process.
- **Cloud only:** no Ollama, local weights, or hidden fallback. The app refuses to answer without a configured provider.
- **No trading features:** explicitly excluded.
- **Separate browser window:** browser content is isolated from the main renderer and the companion.
- **Unsigned installer:** signing is a distribution decision; no certificate is included.

## Known limitations

1. **No bundled API key.** A live chat test was not possible in this environment. Streaming, adapters, SSE parsing, request building, and error mapping are implemented and unit-tested; the user must connect a provider.
2. **Unsigned build.** Windows SmartScreen may warn. Production distribution should sign the installer.
3. **Windows-specific.** Screen capture, DPAPI, Recycle Bin, and native input are implemented for Windows only.
4. **Terminal allowlist is not a sandbox.** Allowed tools can execute project code (`npm run`, `node -e`, tests, hooks). The permission and confirmations are risk controls, not isolation.
5. **Input control is experimental.** Coordinate clicks and key presses depend on focus, DPI, and display layout.
6. **Browser automation is bounded.** It works on the visible IGRIS browser page; it does not control other browsers, bypass auth/CAPTCHA, or guarantee selector stability on complex sites.
7. **Database is not encrypted.** Only provider keys are encrypted; history and backups rely on Windows account ACLs.
8. **Large files and scans are truncated.** This is intentional to protect context, memory, and latency.

## Future work

- Code signing and automatic updates (with a verified signature chain).
- Encrypted local database option.
- Provider-specific live integration tests in CI using short-lived test keys.
- Multi-monitor screen-region selection and OCR.
- Richer diff review before file writes.
- Per-workspace permission profiles.
- macOS/Linux window and credential abstractions.
- Installer upgrade/uninstall automation.

## Commit and release checklist

- [x] Source builds without TypeScript errors.
- [x] Unit/integration tests pass.
- [x] Electron E2E tests pass.
- [x] Visual QA screenshots reviewed.
- [x] Unpacked build launches.
- [x] NSIS installer builds.
- [x] README and security/architecture/testing docs written.
- [x] `.gitignore` excludes builds, dependencies, test artifacts, screenshots, and secrets.
- [x] Initialized git, created [`samarthimasal-oss/igris`](https://github.com/samarthimasal-oss/igris), committed, pushed `main`, and verified the remote commit.

**Initial release commit:** `c315cd7a09641a33d0337214c607a12f9b32e447`  
**Remote:** `https://github.com/samarthimasal-oss/igris` (public, branch `main`)

The NSIS installer is built locally but intentionally not committed. It is unsigned and is not attached to a GitHub release.
