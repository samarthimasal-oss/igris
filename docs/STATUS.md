# Implementation status

**Version:** 1.0.0  
**Target:** Windows 10/11 x64  
**State:** Feature-complete for the defined scope, including task-scoped Windows desktop and browser control; verified with automated tests and a packaged build. Live cloud-provider behavior requires your own API key.

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
| Permissioned tools | Complete | 10 permissions, 25 tools, risk levels, confirmations, timeouts |
| Task/activity tracking | Complete | Tasks, steps, tool runs, approvals, diagnostics |
| Cancellation | Complete | Abort controllers, pending-approval rejection, shutdown cancellation |
| Mini robot launcher | Complete | Minimize shows a compact draggable robot bubble; restore via click or tray; no companion window |
| Browser assistance | Complete | Default-browser handoff plus a separate managed browser profile for approved control |
| Desktop control | Complete | PowerShell/C# operator, UI Automation, windows, input, screenshots, policy gates |
| Control safety | Complete | One approval per task, 20-minute expiry, 120 actions, HUD, Pause/Stop, global stop hotkey |
| Coding/filesystem assistant | Complete | Project scan, tree, editor, search, patch, backups, checkpoints |
| Terminal safeguards | Complete | No shell, allowlist, blocked git/npm operations, output caps |
| No fake AI / no local models | Complete | Provider required; explicit “no local model runtime” messaging |
| Windows 10/11 packaging | Complete | NSIS installer built at `release/IGRIS-1.0.0-x64-Setup.exe` |
| Tests | Complete | 137 unit/integration (1 skipped) + 9 Electron E2E passing |
| Documentation | Complete | README + architecture, security, testing, status docs |
| Secrets excluded from git | Complete | `.gitignore`; no keys or `.env` files in the tree |

## Verified results

```text
npm run typecheck   PASS
npm test            18 files, 137 passed, 1 skipped
npm run test:e2e    9 tests PASS
npm run test:packaged PASS (packaged IGRIS.exe, operator asset, HUD)
npm run pack        PASS -> release/win-unpacked/IGRIS.exe
npm run dist        PASS -> release/IGRIS-1.0.0-x64-Setup.exe
```

Real Edge control smoke (`IGRIS_BROWSER_SMOKE=1`): PASS against a local HTTP server using the dedicated IGRIS profile.

OpenCode Console model discovery: PASS against the live gateway catalogue; free-tier models are excluded because OpenCode rejects non-OpenCode clients. A chat request requires account credits or a Go plan.

OpenRouter free-model discovery: PASS against the live catalogue (16 free models at the time of verification). Paid model IDs are rejected by the provider service guard.

Gemini live verification: PASS — `gemini-3.6-flash` streamed “IGRIS online” through the IGRIS chat engine; 46 models were discovered. The key was stored only as a DPAPI-encrypted blob.

Visual QA at 1442×816: no horizontal overflow on any route; bridge present; Conversation view with the 3D core renders; minimized robot launcher works. Three.js emits a harmless `THREE.Clock` deprecation warning from a dependency.

## Deliberate scope decisions

- **Electron rather than Tauri:** Rust/MSVC toolchains were unavailable; Electron provides native windows, `safeStorage`, and a reliable Windows build with the installed toolchain.
- **Built-in `node:sqlite`:** avoids a native addon and keeps persistence in the main process.
- **Cloud only:** no Ollama, local weights, or hidden fallback. The app refuses to answer without a configured provider.
- **No trading features:** explicitly excluded.
- **No default-profile browser automation:** web handoff opens the user's own browser, which IGRIS cannot read. Approved browser control uses a separate persistent IGRIS Edge/Chrome profile so the user's daily sessions are never exposed.
- **Unelevated by design:** desktop control uses `SendInput` and UI Automation and refuses across UIPI boundaries rather than requesting elevation.
- **Unsigned installer:** signing is a distribution decision; no certificate is included.

## Known limitations

1. **No bundled API key.** A live chat test was not possible in this environment. Streaming, adapters, SSE parsing, request building, and error mapping are implemented and unit-tested; the user must connect a provider.
2. **Unsigned build.** Windows SmartScreen may warn. Production distribution should sign the installer.
3. **Windows-specific.** Screen vision, voice, DPAPI, Recycle Bin are implemented for Windows only.
4. **Terminal allowlist is not a sandbox.** Allowed tools can execute project code (`npm run`, `node -e`, tests, hooks). The permission and confirmations are risk controls, not isolation.
5. **Desktop control needs PowerShell and an interactive session.** If PowerShell is blocked by policy or antivirus, control tools fail with a clear error. IGRIS cannot operate the lock screen or elevated windows.
6. **Control is task-scoped, not a sandbox.** An approved model can operate any unelevated app and read anything visible. The approval, HUD, 20-minute expiry, action budget, and stop hotkey are mitigations.
7. **Web handoff cannot verify pages.** The managed browser can, but only within its own profile; sites requiring the user's daily login must be signed into the IGRIS profile once.
8. **Database is not encrypted.** Only provider keys are encrypted; history and backups rely on Windows account ACLs.
9. **Large files and scans are truncated.** This is intentional to protect context, memory, and latency.

## Future work

- Code signing and automatic updates (with a verified signature chain).
- Encrypted local database option.
- Provider-specific live integration tests in CI using short-lived test keys.
- OCR and screen-region selection as a fallback when UI Automation is thin.
- Richer control-session audit view and per-session replay.
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
- [x] Implemented and verified task-scoped desktop and browser control on `feature/desktop-control`.
- [x] Rebuilt the installer with the final operator script and HUD; packaged smoke passes.

- **Initial release commit:** `c315cd7a09641a33d0337214c607a12f9b32e447`
- **Remote:** `https://github.com/samarthimasal-oss/igris`
- **Desktop-control branch:** `feature/desktop-control`
- **Installer SHA-256:** `0CAB8F98F81684A6CB7645F4E402A653163D5393AB97A408DEF1354047E8B868`

The NSIS installer is built locally but intentionally not committed. It is unsigned and is not attached to a GitHub release.
