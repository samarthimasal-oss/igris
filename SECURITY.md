# Security policy

IGRIS can read files, run allowlisted commands, capture the screen, control input, and automate a browser when you grant those permissions. Please treat security reports with care.

## Reporting

Do **not** open a public issue containing an API key, token, personal path, conversation content, screenshot, or other sensitive data.

Report privately to the repository owner with:

- affected version or commit;
- reproduction steps;
- impact assessment;
- whether a credential or personal datum was exposed.

Rotate any exposed API key immediately in the provider console and remove it from IGRIS.

## Scope

The full threat model, enforced controls, and explicit non-goals are in [docs/SECURITY.md](docs/SECURITY.md).

Highlights:

- Provider keys use Windows DPAPI via Electron `safeStorage` and stay in the main process.
- The renderer is sandboxed and reaches privileged code only through a validated, role-limited IPC bridge.
- Filesystem access is confined to approved workspaces with lexical and real-path checks.
- Terminal commands are parsed without a shell and constrained by an allowlist; this is risk reduction, not a sandbox.
- Browser content runs in a separate sandboxed session; permissions and downloads are denied.
- The installer in this repository is unsigned. Sign it before distributing it widely.

## Supported versions

Security fixes are applied to the current `main` branch and the latest release. There are no long-term support branches.
