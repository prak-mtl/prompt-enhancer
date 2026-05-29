# "Use in Claude CLI" Panel — Design Spec

**Date:** 2026-05-30
**Status:** Approved (pending spec review)

## Goal

From the Chrome extension popup, give users a one-click-copy command that
installs the `/enhance` Claude Code slash command on their machine, pulling the
CLI files directly from the public GitHub repo — without cloning anything.
Supported on **both macOS/Linux (bash) and Windows (PowerShell)**.

The extension can only *show* the command; the browser sandbox cannot write to
`~/.claude/` or run shell commands. The user pastes and runs the command in
their own terminal.

## Background

The repo already ships a CLI plugin under `cli/`:

- `cli/enhance.sh` — the enhancement script (bash; calls Ollama `/api/chat`
  using `curl` + `jq`)
- `cli/tones.json` — tone → system-prompt map
- `cli/commands/enhance.md` — the `/enhance` slash command definition
- `cli/install.sh` — installs the above into `~/.claude/` by **local `cp`**

`install.sh` only works if the user already has the repo checked out. A user who
installed the extension from the Chrome Web Store does not. This feature closes
that gap with remote installers + an in-popup entry point.

The repo is public: `github.com/prak-mtl/prompt-enhancer`, default branch `main`.

## Decisions

- **Entry point:** a new clickable row `Use in Claude CLI ›` in the popup main
  view, opening a dedicated `#cli-view` (mirrors the existing `API Settings`
  row → `#settings-view` pattern).
- **Install method:** remote one-liners (`curl … | bash` for macOS/Linux,
  `irm … | iex` for Windows PowerShell), backed by two new installer scripts
  in `cli/`.
- **OS handling in the panel:** a two-tab toggle — **macOS / Linux** and
  **Windows** — defaulting to the OS detected from the browser, with a fallback
  to macOS/Linux if detection is inconclusive. Each tab shows its own one-liner,
  copy button, and View-script link.
- **Version pin:** pull from `main` (no release tags exist yet). Accepted
  trade-off: old one-liners track the latest `cli/` contents.
- **No manual fallback** in the panel. Trust concern around piping a remote
  script to a shell is handled by a **View script** link to the raw file on
  GitHub, so users can inspect before running.
- **Engine stays bash.** `enhance.sh` is not ported to PowerShell. On Windows
  the PowerShell installer only places the files; running `/enhance` relies on
  the bash environment Claude Code already uses (Git Bash) plus `jq`. This is
  documented as a prerequisite, not solved by this feature.

## Components

### 1. `cli/install-remote.sh` (new) — macOS / Linux

Self-contained remote installer; behaviour mirrors `cli/install.sh` but
downloads instead of copying.

- Shebang `#!/usr/bin/env bash`, `set -euo pipefail`.
- Check deps `curl` and `jq`; exit non-zero with a clear message if missing
  (same shape as `install.sh:7-12`).
- Base raw URL:
  `https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli`
- Create `~/.claude/commands` and `~/.claude/scripts`.
- Download each of the three files with `curl -fsSL` into a temp dir, then move
  into place only after **all** succeed (no partial installs):
  - `cli/enhance.sh`          → `~/.claude/scripts/enhance.sh`
  - `cli/tones.json`          → `~/.claude/scripts/tones.json`
  - `cli/commands/enhance.md` → `~/.claude/commands/enhance.md`
- `-f` makes `curl` fail on HTTP errors; abort on any failure.
- `chmod +x ~/.claude/scripts/enhance.sh`.
- Print the same success / next-steps text as `install.sh:26-38`.

One-liner advertised in the popup (macOS / Linux tab):

```
curl -fsSL https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli/install-remote.sh | bash
```

### 2. `cli/install-remote.ps1` (new) — Windows

PowerShell equivalent. Places the same three files under the Windows home.

- `$ErrorActionPreference = 'Stop'` so any failure aborts.
- Resolve home as `$env:USERPROFILE`; target dirs
  `$HOME\.claude\scripts` and `$HOME\.claude\commands` (created if missing).
- Same base raw URL.
- Download each file with `Invoke-WebRequest -UseBasicParsing` to a temp path,
  then move into place only after all three succeed (no partial installs).
- No `chmod` needed on Windows.
- Print success / next-steps text, including the Windows prerequisite note
  (see below) and the Ollama reminder.

One-liner advertised in the popup (Windows tab):

```
irm https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli/install-remote.ps1 | iex
```

**Windows runtime prerequisite (documented, not auto-installed):** `/enhance`
runs `enhance.sh`, a bash script. Claude Code on Windows executes bash via Git
Bash, which provides `bash` and `curl`; the user additionally needs `jq`
(e.g. `winget install jqlang.jq`). The installer notes this; it does not install
jq itself (avoids admin/winget assumptions).

### 3. `popup.html` (edit)

- **New row** in `#main-view`, immediately after the API Settings row
  (`popup.html:485-493`), reusing `.row.row-clickable` + `.row-chevron`:
  - label `Use in Claude CLI`, desc `Run /enhance in Claude Code`, id
    `open-cli-row`.
- **New view** `#cli-view` (hidden by default), same structural pattern as
  `#settings-view` (`popup.html:506-540`):
  - Intro line: run the Prompt Enhancer inside Claude Code with one command.
  - **OS toggle:** two tab buttons — `macOS / Linux` (id `cli-tab-unix`) and
    `Windows` (id `cli-tab-win`). Active tab styled like a selected control.
  - **Two one-liner blocks**, one per OS (`#cli-cmd-unix`, `#cli-cmd-win`),
    each a read-only code block that wraps long text, with its own **Copy**
    button (`#cli-copy-unix`, `#cli-copy-win`). Only the active tab's block is
    shown. The command text lives in the DOM so JS can read it.
  - Numbered steps (`ol.setup-steps` style already exists):
    1. Paste the command in your terminal and run it.
    2. Restart Claude Code (or start a new session).
    3. Type `/enhance <your prompt>`.
  - Windows-only note (shown when the Windows tab is active): requires Git Bash
    (or WSL) + `jq` to run, since the engine is a bash script.
  - Shared note: Ollama is already covered — the CLI uses the same local Ollama
    this extension does.
  - Action row: **View script** (link, id `cli-view-script`, opens the raw
    installer URL for the active OS) + **Back** (button, id `cli-back`).
- Minimal CSS: code block for the one-liner (monospace, wraps), and a small
  tab-toggle style. Reuse existing `.action-btn`, `.action-link`,
  `.settings-actions`, `.wizard-subtitle`, `ol.setup-steps` where possible.

### 4. `popup.js` (edit)

- Wire `#open-cli-row` click → hide `#main-view`, show `#cli-view` (reuse the
  settings row's show/hide approach).
- On opening `#cli-view`, **detect OS** and select the default tab:
  - Use `navigator.userAgentData?.platform` when available, else
    `navigator.platform` / `navigator.userAgent`; if it matches Windows, default
    to the Windows tab, otherwise the macOS/Linux tab.
- Tab buttons toggle which one-liner block + which notes are visible, and update
  which URL the View-script link targets.
- `#cli-copy-unix` / `#cli-copy-win` → `navigator.clipboard.writeText(<one-liner>)`,
  flip the button label to `Copied ✓` for ~1.5s, then restore. On failure
  (clipboard API unavailable) show `Copy failed`.
- `#cli-view-script` → opens the active OS's raw installer URL in a new tab.
- `#cli-back` → hide `#cli-view`, show `#main-view`.

## Data Flow

```
[popup main view]
   └─ click "Use in Claude CLI ›"
        └─ show #cli-view, auto-select OS tab
             ├─ tab: macOS/Linux → curl one-liner
             ├─ tab: Windows     → irm one-liner (+ Git Bash/jq note)
             ├─ Copy        → clipboard
             └─ View script → GitHub raw installer (new tab)

[user's terminal]
   macOS/Linux:  curl -fsSL …/install-remote.sh | bash
   Windows (PS): irm …/install-remote.ps1 | iex
        └─ downloads enhance.sh, tones.json, enhance.md → ~/.claude/
             └─ /enhance available in Claude Code after restart
```

## Error Handling

- **Extension side:** clipboard write may fail (permissions / older browser) →
  show `Copy failed`, do not crash. OS detection failure → default to the
  macOS/Linux tab. No network calls happen in the popup.
- **Installer side (both):** missing deps / failed download → clear message,
  non-zero exit (PowerShell: `Stop` + non-zero `$LASTEXITCODE`/throw). Temp-then
  -move guarantees no partial install. HTTP 404/5xx counts as failure
  (`curl -f`; PowerShell `Invoke-WebRequest` throws on error status).
- Ollama / model setup is out of scope here — handled by the extension and by
  `enhance.sh`'s own exit codes (2 = unreachable, 3 = model not pulled).

## Out of Scope (YAGNI)

- Auto-installing from the browser (impossible in the sandbox).
- Detecting whether Claude Code is installed.
- Version/tag pinning UI.
- Manual `git clone` fallback text in the panel.
- Porting `enhance.sh` to native PowerShell. (Windows runs it via Git Bash/WSL.)
- Auto-installing `jq` on Windows (documented as a user prerequisite instead).

## Testing

**Installers:**
- `bash -n cli/install-remote.sh` (syntax).
- PowerShell parse check for `cli/install-remote.ps1`
  (`[ScriptBlock]::Create((Get-Content -Raw …))` or `pwsh -NoProfile -Command`
  on a machine with PowerShell; on macOS via `pwsh` if available, else
  syntax-review manually).
- Run `install-remote.sh` with a temp `HOME`
  (`HOME=$(mktemp -d) bash cli/install-remote.sh`) once the file is on `main`;
  confirm the three files land and `~/.claude/scripts/enhance.sh` is executable.
- Simulate a failed download (bad URL) for both installers; confirm no partial
  install.
- Windows manual check: run the `irm … | iex` one-liner in PowerShell, confirm
  files land under `%USERPROFILE%\.claude\`, then `/enhance` resolves in Claude
  Code (with Git Bash + jq present).

**Extension:**
- Load unpacked, open popup → main view shows the new row.
- Click row → `#cli-view` appears with the OS-appropriate tab selected.
- Toggle tabs → correct one-liner, notes, and View-script URL switch.
- Copy copies the exact one-liner for the active tab; View script opens the
  matching raw URL; Back returns to main view.
- Confirm wizard and settings views still behave (no view-switching
  regressions).

## Coexistence

No change to the Chrome extension's enhancement behaviour or to the CLI's
runtime behaviour. This only adds a discovery/onboarding surface in the popup
and download-based installers alongside the existing local installer. All of
`install.sh` (local), `install-remote.sh` (remote bash), and
`install-remote.ps1` (remote PowerShell) remain valid.
