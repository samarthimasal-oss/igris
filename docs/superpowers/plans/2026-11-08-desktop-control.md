# Desktop Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking. The design spec is `docs/DESKTOP-CONTROL.md`.

**Goal:** Add real, permissioned Windows desktop and browser control to IGRIS, integrated with the existing main process, tool registry, approvals, audit, and terminal UI.

**Architecture:** A persistent hidden PowerShell host compiles an in-box C# helper for `SendInput`, UI Automation, windows, and screenshots. `playwright-core` drives a dedicated Edge/Chrome profile. A task-scoped `ControlSessionService` gates three model tools (`request_computer_control`, `desktop`, `browser`) and drives a floating HUD.

**Tech Stack:** Electron 45, TypeScript, React 19, Zod 4, Vitest, Playwright, PowerShell 5.1, C# (in-box .NET Framework), Windows Win32/UIA.

**Spec:** `docs/DESKTOP-CONTROL.md`

## Global Constraints

- IGRIS runs unelevated. Never request elevation or bypass UIPI.
- No Python, no native Node addons.
- One approval per task; session expires after 20 minutes and ends with the task.
- Maximum 30 model turns and 120 actions per control session.
- Screenshots max 1280 px wide; at most 2 retained in model context.
- Hard-block password fields, UAC/elevated windows, credential managers, IGRIS windows, browser downloads/uploads, `file://`/`javascript:`/`data:` URLs.
- Sensitive actions always confirm: close window, shell typing, first-time app launch, checkout/send patterns.
- No secrets in logs, renderer, or tool arguments.
- Preserve all existing features and tests.

## Review Focus

- Stuck modifier/mouse buttons after a crash or stop — `releaseAll` must run on every exit path.
- UIPI/elevated windows — IGRIS must fail clearly, not click blindly.
- DPI/multi-monitor coordinates — physical virtual-desktop pixels end to end.
- Stale UIA/DOM refs — revalidate, never blind-click a vanished element.
- Session leakage — a session must never authorize a different task or scope.

---

### Task 1: Foundation — branch, dependency, shared types

**Files:**
- Modify: `package.json`
- Modify: `src/shared/types.ts`, `src/shared/defaults.ts`, `src/shared/settings.ts`
- Modify: `src/shared/ipc.ts`, `src/preload/index.ts`
- Test: `tests/unit/settings.test.ts` (new), existing settings tests

**Interfaces:**
- Produces: `PermissionKey` includes `desktopControl` and `browserControl`; `ControlSessionState`, `ControlScope`, `ControlEvent`; `control.*` bridge methods.

- [ ] Add `playwright-core` to dependencies.
- [ ] Add permissions to types/defaults/metadata; default false.
- [ ] Add control DTOs to shared types and IPC contract; add `IPC_CONTROL_EVENT`; HUD role allowlist.
- [ ] Add preload `control` methods and `events.onControl`.
- [ ] Raise `maxToolIterations` clamp to 60.
- [ ] Tests: new permissions default false; old settings merge; clamp.
- [ ] Typecheck and commit.

### Task 2: Control session service

**Files:**
- Create: `src/main/control/sessionService.ts`
- Test: `tests/unit/controlSession.test.ts`

**Interfaces:**
- Produces: `create(taskId, goal, scope)`, `getForTask(taskId)`, `assertActive(taskId, scope)`, `pause/resume/stop/endTask/endAll`, `recordAction`, `setCurrentAction`, `activeState()`, `onChange(listener)`.

- [ ] Write failing tests for create, scope, expiry (fake clock), pause, stop, task end, budget, action record, no session.
- [ ] Implement with 20 min TTL, 120 action budget, 30 turn cap.
- [ ] Run tests; commit.

### Task 3: PowerShell operator host

**Files:**
- Create: `src/main/control/operator.ps1`
- Create: `src/main/control/operatorClient.ts`
- Create: `src/main/control/types.ts`
- Test: `tests/unit/operatorProtocol.test.ts` (fake host), `scripts/operator-smoke.mjs`

**Interfaces:**
- Produces: `OperatorClient.start/stop/request/ping/state/listWindows/focusWindow/showWindow/closeWindow/moveMouse/click/drag/scroll/typeText/keyEvent/releaseAll/screenshot/getElements/invokeElement/setElementValue/focusElement`.
- Protocol: newline JSON `{id,cmd,args}` → `{id,ok,data|error}`; startup `{ready:true,version:1}`.

- [ ] Implement C# helper + PS loop; test standalone with `state`, `listWindows`, `screenshot`, `typeText` in a scratch WinForms window.
- [ ] Implement `OperatorClient` with handshake, timeouts, stderr logging, crash restart, release-all.
- [ ] Unit-test framing/timeout/crash with a fake Node script.
- [ ] Real smoke test: host starts, helper compiles, screenshot, window enumeration, UIA, type/read in scratch app.
- [ ] Commit.

### Task 4: Desktop service and policy

**Files:**
- Create: `src/main/control/policy.ts`, `src/main/control/desktopService.ts`
- Test: `tests/unit/controlPolicy.test.ts`, `tests/unit/desktopService.test.ts`

**Interfaces:**
- Produces: `DesktopService.run(action, args, ctx) -> ToolOutcome`; `policy.parseKeyChord`, `policy.windowBlockReason`, `policy.validateBrowserUrl`, `policy.isSensitiveText`.

- [ ] Tests for key chords, blocklists, URL schemes, sensitive text, window resolution, password refusal, self/elevated/credential blocks, close/shell/first-launch confirmations.
- [ ] Implement state/list/screenshot/elements/focus/launch/click/move/drag/scroll/type/key/window/invoke/set_value/wait.
- [ ] Screenshot downscale/JPEG via `nativeImage`; save PNG under `userData/screenshots/<session>/`.
- [ ] Commit.

### Task 5: Browser service

**Files:**
- Create: `src/main/control/browserService.ts`
- Test: `tests/unit/browserService.test.ts`, `tests/integration/browserControl.spec.ts`

**Interfaces:**
- Produces: `BrowserService.run(action, args, ctx)`; `start/stop`; managed profile `<userData>/browser/igris-profile`.

- [ ] Tests: URL validation, password redaction, ref formatting, stale ref error, download block, navigation with local HTTP server.
- [ ] Implement Edge/Chrome launch, snapshot refs, all actions, crash restart, tab management.
- [ ] Real integration: local page → snapshot → click → type → verify; password field blocked.
- [ ] Commit.

### Task 6: Tools and runtime

**Files:**
- Modify: `src/main/tools/registry.ts`, `src/main/tools/toolRuntime.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/unit/controlTools.test.ts`, `tests/unit/toolRuntime.test.ts`

**Interfaces:**
- Produces: `request_computer_control`, `desktop`, `browser`; `ToolContext.confirm`; `forceConfirmation`.

- [ ] Runtime tests: forced approval, sub-action confirmation, denial.
- [ ] Define schemas with `action` discriminated unions; keep tool count at 3.
- [ ] `request_computer_control` checks scope permissions, creates session, returns stop hotkey.
- [ ] `desktop`/`browser` assert session scope; pass confirm callback.
- [ ] Commit.

### Task 7: Chat engine integration

**Files:**
- Modify: `src/main/ai/chatEngine.ts`, `src/main/ai/types.ts`
- Test: `tests/unit/chatControl.test.ts`

**Interfaces:**
- Produces: effective control turn limit 30; image pruning to 2; session end on run finish; updated system prompt.

- [ ] Tests for effective limit, image pruning, session end.
- [ ] Update system prompt: control instructions, remove “no mouse/keyboard”.
- [ ] End session in `finally`; prune images before each turn.
- [ ] Commit.

### Task 8: HUD and IPC

**Files:**
- Create: `src/main/windows/controlHud.ts`
- Create: `src/renderer/hud.html`, `src/renderer/src/hud.tsx`, `src/renderer/src/hud.css`
- Modify: `electron.vite.config.ts`, `src/main/windows/paths.ts`, `src/main/ipc.ts`, `src/main/index.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`
- Test: `tests/e2e/hud.spec.ts`

**Interfaces:**
- Produces: HUD window, `control.state/pause/resume/stop`, global `Ctrl+Alt+Shift+X` stop, broadcast events.

- [ ] HUD window 360×92, always-on-top, bottom-right, role `hud`.
- [ ] HUD UI: goal, action, count/budget, pause/resume/stop.
- [ ] Wire session events to HUD + main; stop cancels task, releases input, ends session.
- [ ] E2E: no HUD without session; HUD shows/hides; buttons call bridge.
- [ ] Commit.

### Task 9: Renderer integration

**Files:**
- Modify: `src/renderer/src/lib/store.ts`, `src/renderer/src/lib/capabilities.ts`
- Modify: `src/renderer/src/pages/HomePage.tsx`, `SettingsPage.tsx`, `ToolsPage.tsx`
- Modify: `src/renderer/src/components/Overlays.tsx`, `src/renderer/src/terminal.css`
- Test: `tests/e2e/smoke.spec.ts`, `tests/e2e/control-ui.spec.ts`

**Interfaces:**
- Produces: control badge/strip, control approval variant, permission toggles, capability groups.

- [ ] Store control state + actions; subscribe to control events.
- [ ] Home control strip with Pause/Stop and live action.
- [ ] Approval modal variant for control requests.
- [ ] Settings toggles/warnings; Tools capability groups.
- [ ] E2E: defaults off, toggle persists, approval copy, HUD.
- [ ] Commit.

### Task 10: Docs, integration suite, packaging

**Files:**
- Modify: `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `README.md`
- Create: `scripts/control-integration.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: real Windows integration suite and final installer.

- [ ] Docs: permissions, sessions, hard blocks, browser profile, UIPI limits, troubleshooting.
- [ ] Integration suite: host, screenshot, windows, UIA, mouse/keyboard in scratch app, Edge profile, navigation, snapshot, session expiry, budgets, audit.
- [ ] Run `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run test:control`, `npm run test:packaged`, `npm run dist`.
- [ ] Manual acceptance: Notepad, browser, stop, denial, password/elevated blocks.
- [ ] Commit, push, report installer hash.
