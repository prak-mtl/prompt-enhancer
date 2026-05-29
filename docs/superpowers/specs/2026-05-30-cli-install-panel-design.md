# "Use in Claude CLI" Panel — Design Spec

**Date:** 2026-05-30
**Status:** Approved (pending spec review)

## Goal

From the Chrome extension popup, give users a one-click-copy command that
installs the `/enhance` Claude Code slash command on their machine, pulling the
CLI files directly from the public GitHub repo — without cloning anything.

The extension can only *show* the command; the browser sandbox cannot write to
`~/.claude/` or run shell commands. The user pastes and runs the command in
their own terminal.

## Background

The repo already ships a CLI plugin under `cli/`:

- `cli/enhance.sh` — the enhancement script (calls Ollama `/api/chat`)
- `cli/tones.json` — tone → system-prompt map
- `cli/commands/enhance.md` — the `/enhance` slash command definition
- `cli/install.sh` — installs the above into `~/.claude/` by **local `cp`**

`install.sh` only works if the user already has the repo checked out. A user who
installed the extension from the Chrome Web Store does not. This feature closes
that gap with a remote installer + an in-popup entry point.

The repo is public: `github.com/prak-mtl/prompt-enhancer`, default branch `main`.

## Decisions

- **Entry point:** a new clickable row `Use in Claude CLI ›` in the popup main
  view, opening a dedicated `#cli-view` (mirrors the existing `API Settings`
  row → `#settings-view` pattern).
- **Install method:** remote one-liner (`curl … | bash`) backed by a new
  `cli/install-remote.sh`.
- **Version pin:** pull from `main` (no release tags exist yet). Accepted
  trade-off: old one-liners track the latest `cli/` contents.
- **No manual fallback** in the panel. Trust concern around `curl | bash` is
  handled by a **View script** link to the raw file on GitHub, so users can
  inspect before running.

## Components

### 1. `cli/install-remote.sh` (new)

A self-contained remote installer. Behaviour mirrors `cli/install.sh` but
downloads instead of copying.

- Shebang `#!/usr/bin/env bash`, `set -euo pipefail`.
- Check deps `curl` and `jq`; exit non-zero with a clear message if missing
  (same shape as `install.sh:7-12`).
- Base raw URL:
  `https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli`
- Create `~/.claude/commands` and `~/.claude/scripts`.
- Download each of the three files with `curl -fsSL` into a temp location, then
  move into place:
  - `cli/enhance.sh`        → `~/.claude/scripts/enhance.sh`
  - `cli/tones.json`        → `~/.claude/scripts/tones.json`
  - `cli/commands/enhance.md` → `~/.claude/commands/enhance.md`
- `-f` makes `curl` fail on HTTP errors. If **any** download fails, abort with a
  message and do **not** install partial files (download to temp first, move
  only after all succeed).
- `chmod +x ~/.claude/scripts/enhance.sh`.
- Print the same success / next-steps text as `install.sh:26-38`
  (`/enhance …`, plus the Ollama reminder).

The one-liner advertised in the popup:

```
curl -fsSL https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli/install-remote.sh | bash
```

### 2. `popup.html` (edit)

- **New row** in `#main-view`, immediately after the API Settings row
  (`popup.html:485-493`), reusing `.row.row-clickable` + `.row-chevron`:
  - label `Use in Claude CLI`, desc `Run /enhance in Claude Code`, id
    `open-cli-row`.
- **New view** `#cli-view` (hidden by default), same structural pattern as
  `#settings-view` (`popup.html:506-540`):
  - Intro line: run the Prompt Enhancer inside Claude Code with one command.
  - The one-liner inside a read-only code block, with a **Copy** button
    (id `cli-copy`). Store the command text in the DOM so JS can read it.
  - Numbered steps (`ol.setup-steps` style already exists):
    1. Paste the command in your terminal and run it.
    2. Restart Claude Code (or start a new session).
    3. Type `/enhance <your prompt>`.
  - One-line note: Ollama is already covered — the CLI uses the same local
    Ollama this extension does.
  - Action row: **View script** (link, id `cli-view-script`, opens the raw
    `install-remote.sh` URL) + **Back** (button, id `cli-back`).
- Minimal CSS: a code block for the one-liner (wraps long text, monospace).
  Reuse existing `.action-btn`, `.action-link`, `.settings-actions`,
  `.wizard-subtitle`, `ol.setup-steps` where possible.

### 3. `popup.js` (edit)

- Wire `#open-cli-row` click → hide `#main-view`, show `#cli-view` (reuse the
  same show/hide approach the settings row already uses).
- `#cli-back` click → hide `#cli-view`, show `#main-view`.
- `#cli-copy` click → `navigator.clipboard.writeText(<one-liner>)`, then flip
  the button label to `Copied ✓` for ~1.5s and restore. On failure (clipboard
  API unavailable), fall back to selecting the text / show `Copy failed`.
- `#cli-view-script` → opens the raw GitHub URL in a new tab
  (`window.open(url, '_blank')` or an anchor with `target="_blank"`).

## Data Flow

```
[popup main view]
   └─ click "Use in Claude CLI ›"
        └─ show #cli-view (one-liner + steps)
             ├─ Copy → clipboard
             └─ View script → GitHub raw (new tab)

[user's terminal]
   curl -fsSL …/install-remote.sh | bash
        └─ downloads enhance.sh, tones.json, enhance.md → ~/.claude/
             └─ /enhance available in Claude Code after restart
```

## Error Handling

- **Extension side:** clipboard write may fail (permissions / older browser) →
  show `Copy failed`, do not crash. No network calls happen in the popup.
- **Installer side:** missing `curl`/`jq` → clear message, non-zero exit. Any
  failed download → abort before installing, leaving existing files untouched
  (temp-then-move). `-f` ensures HTTP 404/5xx counts as failure.
- Ollama / model setup is out of scope here — already handled by the extension
  and by `enhance.sh`'s own exit codes (2 = unreachable, 3 = model not pulled).

## Out of Scope (YAGNI)

- Auto-installing from the browser (impossible in the sandbox).
- Detecting whether Claude Code is installed.
- Version/tag pinning UI.
- Manual `git clone` fallback text in the panel.
- Windows-specific (PowerShell) one-liner — bash one-liner targets macOS/Linux
  and WSL, matching the existing `install.sh`.

## Testing

**Installer:**
- `bash -n cli/install-remote.sh` (syntax).
- Run with a temp `HOME` (`HOME=$(mktemp -d) bash cli/install-remote.sh`) once
  the file is pushed to `main`; confirm the three files land and
  `~/.claude/scripts/enhance.sh` is executable. (Before push, can validate the
  download logic against raw URLs of a feature branch.)
- Simulate a failed download (bad URL) and confirm no partial install.

**Extension:**
- Load unpacked, open popup → main view shows the new row.
- Click row → `#cli-view` appears; Copy copies the exact one-liner; View script
  opens the raw URL; Back returns to main view.
- Confirm wizard view and settings view still behave (no regressions to the
  existing view-switching).

## Coexistence

No change to the Chrome extension's enhancement behaviour or to the CLI's
runtime behaviour. This only adds a discovery/onboarding surface in the popup
and a download-based installer alongside the existing local installer. Both
`install.sh` (local) and `install-remote.sh` (remote) remain valid.
