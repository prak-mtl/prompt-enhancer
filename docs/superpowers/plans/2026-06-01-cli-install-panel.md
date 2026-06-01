# "Use in Claude CLI" Install Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-popup "Use in Claude CLI" panel plus two remote installer scripts so a Chrome-Web-Store user (with no repo checkout) can install the `/enhance` slash command on macOS/Linux or Windows with one copy-paste command.

**Architecture:** Two self-contained remote installers (`cli/install-remote.sh`, `cli/install-remote.ps1`) download the three CLI files from the public GitHub raw URL into `~/.claude/` (temp-then-move so failures never leave a partial install). The popup gains one clickable row → a new `#cli-view` that shows an OS-tabbed one-liner with copy + "View script" links, mirroring the existing `#settings-view` pattern. Purely additive — no existing extension or CLI runtime behaviour changes.

**Tech Stack:** Bash (`curl`, `jq`), PowerShell (`Invoke-WebRequest`), vanilla HTML/CSS/JS Chrome MV3 popup. No build step, no test framework — verification is via `bash -n`/functional shims for scripts, `node --check` + load-unpacked for the popup (consistent with the project's existing "manual verification" stance in `docs/superpowers/specs/2026-05-28-cli-prompt-enhancer-design.md`).

**Source spec:** `docs/superpowers/specs/2026-05-30-cli-install-panel-design.md`

**Branch:** `feature/cli-install-panel` (already checked out — no worktree needed).

**Repo facts the code depends on:**
- Public repo, default branch `main`: `github.com/prak-mtl/prompt-enhancer`
- Raw base URL: `https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli`
- The three files the installers fetch already exist on the branch: `cli/enhance.sh`, `cli/tones.json`, `cli/commands/enhance.md`.

> **Note on a chicken-and-egg caveat:** the one-liners fetch from `main`. They only work end-to-end once this branch is merged to `main`. Until then, the local functional test in Task 1 uses a `curl` PATH shim that serves the repo's own `cli/` files, so the installer logic is fully tested without depending on `main`. This is called out in the spec's Testing section ("once the file is on `main`").

---

## File Structure

| File | New/Modify | Responsibility |
|---|---|---|
| `cli/install-remote.sh` | Create | macOS/Linux remote installer — download 3 files, temp-then-move into `~/.claude/`, `chmod +x`. |
| `cli/install-remote.ps1` | Create | Windows remote installer — same, via `Invoke-WebRequest` into `%USERPROFILE%\.claude\`. |
| `popup.html` | Modify | Add `#open-cli-row` row after API Settings; add `#cli-view`; add CLI-view CSS. |
| `popup.js` | Modify | Hide `#cli-view` in the 3 existing view fns; add `showCliView`, OS detection, tab toggle, copy, back; call `wireCliView()` on load. |
| `docs/superpowers/specs/2026-05-30-cli-install-panel-design.md` | Modify (final) | Flip status to Implemented. |

No shared module is introduced — the popup's CLI logic is small and lives alongside the existing view code (files that change together stay together).

---

## Task 1: `cli/install-remote.sh` — macOS/Linux remote installer

**Files:**
- Create: `cli/install-remote.sh`
- Test (throwaway harness, not committed): `/tmp/pe-test-remote-sh.sh` + a `curl` shim

This task is genuine TDD: the test harness drives a real run of the script through a fake `curl` that serves the repo's own `cli/` files, so we verify the success path (all 3 files land, script is executable) and the no-partial-install failure path — without touching `main`.

- [ ] **Step 1: Write the failing test harness**

Create `/tmp/pe-test-remote-sh.sh` with this exact content (set `REPO` to the absolute repo path):

```bash
#!/usr/bin/env bash
set -uo pipefail
REPO="/Users/pmittal/Desktop/Hackathon/prompt-enhancer"
SCRIPT="$REPO/cli/install-remote.sh"

# ── Build a fake `curl` that serves repo cli/ files locally ──────────────────
SHIM_DIR="$(mktemp -d)"
cat > "$SHIM_DIR/curl" <<'SHIM'
#!/usr/bin/env bash
# Fake curl for testing install-remote.sh. Maps the raw GitHub URL back to the
# local repo cli/ dir. Honors FAIL_ON to simulate a download failure.
url=""; out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;            # ignore -fsSL etc.
    *)  url="$1"; shift ;;
  esac
done
rel="${url##*/main/cli/}"
if [[ -n "${FAIL_ON:-}" && "$rel" == "$FAIL_ON" ]]; then
  echo "fake curl: simulated 404 for $rel" >&2
  exit 22
fi
src="$REPO_CLI/$rel"
[[ -f "$src" ]] || { echo "fake curl: missing $src" >&2; exit 22; }
cp "$src" "$out"
SHIM
chmod +x "$SHIM_DIR/curl"
export REPO_CLI="$REPO/cli"

fail() { echo "FAIL: $1"; exit 1; }

# ── Success path ─────────────────────────────────────────────────────────────
H1="$(mktemp -d)"
PATH="$SHIM_DIR:$PATH" HOME="$H1" bash "$SCRIPT" >/dev/null || fail "success run exited non-zero"
[[ -f "$H1/.claude/commands/enhance.md" ]] || fail "enhance.md not installed"
[[ -f "$H1/.claude/scripts/tones.json" ]]  || fail "tones.json not installed"
[[ -x "$H1/.claude/scripts/enhance.sh" ]]  || fail "enhance.sh not installed/executable"
diff -q "$REPO/cli/enhance.sh" "$H1/.claude/scripts/enhance.sh" >/dev/null || fail "enhance.sh content differs"

# ── Failure path: a mid-download failure must leave NO partial install ───────
H2="$(mktemp -d)"
PATH="$SHIM_DIR:$PATH" HOME="$H2" FAIL_ON="tones.json" bash "$SCRIPT" >/dev/null 2>&1 \
  && fail "expected non-zero exit when a download fails"
[[ ! -f "$H2/.claude/scripts/enhance.sh" ]] || fail "partial install: enhance.sh present after failed run"
[[ ! -f "$H2/.claude/commands/enhance.md" ]] || fail "partial install: enhance.md present after failed run"

echo "PASS"
```

- [ ] **Step 2: Run it to verify it fails (script does not exist yet)**

Run: `bash /tmp/pe-test-remote-sh.sh`
Expected: `FAIL: success run exited non-zero` (the `bash "$SCRIPT"` line errors because `cli/install-remote.sh` doesn't exist).

- [ ] **Step 3: Write `cli/install-remote.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Remote installer for the /enhance Claude Code slash command.
# Downloads the CLI files from the public repo into ~/.claude/ — no clone needed.
# Mirrors cli/install.sh but fetches over HTTPS instead of copying locally.

BASE_URL="https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli"

for cmd in curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing dependency: $cmd. Install it and re-run." >&2
    exit 1
  fi
done

DEST_COMMANDS="$HOME/.claude/commands"
DEST_SCRIPTS="$HOME/.claude/scripts"

mkdir -p "$DEST_COMMANDS" "$DEST_SCRIPTS"

# Download into a temp dir first; move into place only after ALL succeed, so a
# failed download can never leave a partial install. set -e aborts on any
# curl -f failure before the mv block runs.
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "$BASE_URL/enhance.sh"          -o "$TMP_DIR/enhance.sh"
curl -fsSL "$BASE_URL/tones.json"          -o "$TMP_DIR/tones.json"
curl -fsSL "$BASE_URL/commands/enhance.md" -o "$TMP_DIR/enhance.md"

mv "$TMP_DIR/enhance.sh" "$DEST_SCRIPTS/enhance.sh"
mv "$TMP_DIR/tones.json" "$DEST_SCRIPTS/tones.json"
mv "$TMP_DIR/enhance.md" "$DEST_COMMANDS/enhance.md"

chmod +x "$DEST_SCRIPTS/enhance.sh"

cat <<EOF
Installed:
  $DEST_COMMANDS/enhance.md
  $DEST_SCRIPTS/enhance.sh
  $DEST_SCRIPTS/tones.json

Reload Claude Code (or start a new session) and try:
  /enhance write a function that reverses a string

Make sure Ollama is running:
  ollama serve
  ollama pull llama3.2:3b
EOF
```

- [ ] **Step 4: Syntax check**

Run: `bash -n cli/install-remote.sh`
Expected: no output, exit 0.

- [ ] **Step 5: Run the test harness to verify it passes**

Run: `bash /tmp/pe-test-remote-sh.sh`
Expected: `PASS`

- [ ] **Step 6: Commit**

```bash
git add cli/install-remote.sh
git commit -m "feat(cli): add remote bash installer for /enhance"
```

---

## Task 2: `cli/install-remote.ps1` — Windows remote installer

**Files:**
- Create: `cli/install-remote.ps1`

`pwsh` is **not** installed on this machine, so an automated parse check can't be run here. Verification is (a) a guarded parse check that runs only if `pwsh` exists, and (b) a careful manual read against the spec. The real Windows run is a manual check noted in Task 5.

- [ ] **Step 1: Write `cli/install-remote.ps1`**

```powershell
# Remote installer for the /enhance Claude Code slash command (Windows / PowerShell).
# Downloads the CLI files from the public repo into %USERPROFILE%\.claude\ — no clone.
# PowerShell equivalent of cli/install-remote.sh.

$ErrorActionPreference = 'Stop'

$BaseUrl = 'https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli'

$HomeDir      = $env:USERPROFILE
$DestCommands = Join-Path $HomeDir '.claude\commands'
$DestScripts  = Join-Path $HomeDir '.claude\scripts'

New-Item -ItemType Directory -Force -Path $DestCommands | Out-Null
New-Item -ItemType Directory -Force -Path $DestScripts  | Out-Null

# Download into a temp dir first; move into place only after all three succeed,
# so a failed download can never leave a partial install. $ErrorActionPreference
# = 'Stop' makes any Invoke-WebRequest HTTP error throw before the moves run.
$Tmp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("pe-" + [guid]::NewGuid()))
try {
  Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/enhance.sh"          -OutFile (Join-Path $Tmp 'enhance.sh')
  Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/tones.json"          -OutFile (Join-Path $Tmp 'tones.json')
  Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/commands/enhance.md" -OutFile (Join-Path $Tmp 'enhance.md')

  Move-Item -Force (Join-Path $Tmp 'enhance.sh') (Join-Path $DestScripts  'enhance.sh')
  Move-Item -Force (Join-Path $Tmp 'tones.json') (Join-Path $DestScripts  'tones.json')
  Move-Item -Force (Join-Path $Tmp 'enhance.md') (Join-Path $DestCommands 'enhance.md')
}
finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

Write-Host @"
Installed:
  $DestCommands\enhance.md
  $DestScripts\enhance.sh
  $DestScripts\tones.json

Reload Claude Code (or start a new session) and try:
  /enhance write a function that reverses a string

Windows note: /enhance runs enhance.sh (a bash script). Claude Code runs it via
Git Bash, which provides bash + curl. You also need jq:
  winget install jqlang.jq

Make sure Ollama is running:
  ollama serve
  ollama pull llama3.2:3b
"@
```

- [ ] **Step 2: Parse check (guarded — runs only if pwsh exists)**

Run:
```bash
command -v pwsh >/dev/null 2>&1 \
  && pwsh -NoProfile -Command '$null = [ScriptBlock]::Create((Get-Content -Raw cli/install-remote.ps1)); "PARSE OK"' \
  || echo "pwsh not available — skipping parse check (manual review required)"
```
Expected (this machine): `pwsh not available — skipping parse check (manual review required)`.
Expected (a machine with pwsh): `PARSE OK`.

- [ ] **Step 3: Manual review against spec**

Confirm against `2026-05-30-cli-install-panel-design.md` §"2. `cli/install-remote.ps1`":
- `$ErrorActionPreference = 'Stop'` present.
- Home resolved via `$env:USERPROFILE`; dirs `.claude\commands` + `.claude\scripts` created with `-Force`.
- Same base raw URL.
- Temp-then-move ordering (all downloads, then all moves).
- Success text includes the Git Bash + `jq` prerequisite note and the Ollama reminder.

- [ ] **Step 4: Commit**

```bash
git add cli/install-remote.ps1
git commit -m "feat(cli): add remote PowerShell installer for /enhance"
```

---

## Task 3: `popup.html` — CLI row, CLI view, and styles

**Files:**
- Modify: `popup.html` (insert a `.section` after line 493; insert `#cli-view` after line 540; insert CSS before `</style>` at line 377)

No test framework for the popup. Verification is structural (grep for the new ids) plus the load-unpacked manual checks in Task 5.

- [ ] **Step 1: Add the CLI-view CSS**

Insert immediately **after** the `.row-chevron` rule (currently `popup.html:376`) and **before** `</style>` (`popup.html:377`). Anchor on the existing block:

Find:
```css
    .row.row-clickable:hover { background: #fafafa; }
    .row-chevron { font-size: 13px; color: #9ca3af; }
  </style>
```
Replace with:
```css
    .row.row-clickable:hover { background: #fafafa; }
    .row-chevron { font-size: 13px; color: #9ca3af; }

    /* ── CLI View ────────────────────────────── */
    #cli-view { padding: 16px 18px 18px; }

    .cli-tabs { display: flex; gap: 6px; margin-bottom: 12px; }
    .cli-tab {
      flex: 1;
      font-size: 12px;
      font-weight: 600;
      padding: 7px 10px;
      border-radius: 6px;
      cursor: pointer;
      border: 1px solid #e5e7eb;
      background: #fff;
      color: #6b7280;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .cli-tab.active { background: #6366f1; color: #fff; border-color: #6366f1; }

    .cli-cmd-block { display: flex; align-items: stretch; gap: 8px; margin-bottom: 12px; }
    code.cli-cmd {
      flex: 1;
      font-family: 'SFMono-Regular', Consolas, monospace;
      background: #f3f4f6;
      padding: 8px 10px;
      border-radius: 6px;
      font-size: 11px;
      color: #374151;
      word-break: break-all;
      white-space: pre-wrap;
      line-height: 1.5;
    }
    .cli-cmd-block .action-btn { flex-shrink: 0; align-self: flex-start; }

    ol.cli-steps li { color: #6b7280; }

    .cli-note { font-size: 11.5px; color: #6b7280; line-height: 1.5; margin-top: 10px; }
  </style>
```

> Why `ol.cli-steps li { color: #6b7280; }`: the base `ol.setup-steps li` rule is red (`#7f1d1d`, designed for the offline hint). The CLI steps are neutral instructions, so they override to grey.

- [ ] **Step 2: Add the "Use in Claude CLI" row in `#main-view`**

Insert a new `.section` between the API Settings section (closes at `popup.html:493`) and the footer (`popup.html:495`).

Find:
```html
        <span class="row-chevron">›</span>
      </div>
    </div>

    <div class="footer">
```
Replace with:
```html
        <span class="row-chevron">›</span>
      </div>
    </div>

    <div class="section">
      <div class="row row-clickable" id="open-cli-row">
        <div class="row-info">
          <span class="row-label">Use in Claude CLI</span>
          <span class="row-desc">Run /enhance in Claude Code</span>
        </div>
        <span class="row-chevron">›</span>
      </div>
    </div>

    <div class="footer">
```

> The `›` chevron + `row-clickable` lines are duplicated by this anchor; the Edit is still unique because the full multi-line block (chevron → closing divs → footer) appears only once.

- [ ] **Step 3: Add the `#cli-view` block**

Insert between the end of `#settings-view` (`popup.html:540`) and `<script src="popup.js"></script>` (`popup.html:542`).

Find:
```html
      <button class="action-btn" id="settings-back">Back</button>
    </div>
  </div>

  <script src="popup.js"></script>
```
Replace with:
```html
      <button class="action-btn" id="settings-back">Back</button>
    </div>
  </div>

  <!-- ═══ CLI VIEW ══════════════════════════════════════════════════════════ -->
  <div id="cli-view" hidden>
    <p class="wizard-subtitle">Run the Prompt Enhancer inside Claude Code with one command.</p>

    <div class="cli-tabs">
      <button class="cli-tab active" id="cli-tab-unix">macOS / Linux</button>
      <button class="cli-tab" id="cli-tab-win">Windows</button>
    </div>

    <div class="cli-cmd-block" id="cli-cmd-unix-block">
      <code class="cli-cmd" id="cli-cmd-unix">curl -fsSL https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli/install-remote.sh | bash</code>
      <button class="action-btn" id="cli-copy-unix">Copy</button>
    </div>

    <div class="cli-cmd-block" id="cli-cmd-win-block" hidden>
      <code class="cli-cmd" id="cli-cmd-win">irm https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli/install-remote.ps1 | iex</code>
      <button class="action-btn" id="cli-copy-win">Copy</button>
    </div>

    <ol class="setup-steps cli-steps">
      <li>Paste the command in your terminal and run it.</li>
      <li>Restart Claude Code (or start a new session).</li>
      <li>Type <code class="cmd">/enhance &lt;your prompt&gt;</code>.</li>
    </ol>

    <p class="cli-note" id="cli-note-win" hidden>
      Windows: requires Git Bash (or WSL) + <code class="cmd">jq</code> to run, since the engine is a bash script.
    </p>
    <p class="cli-note">Ollama is already covered — the CLI uses the same local Ollama this extension does.</p>

    <div class="settings-actions">
      <a class="action-link" id="cli-view-script" href="#" target="_blank" rel="noopener">View script</a>
      <button class="action-btn" id="cli-back">Back</button>
    </div>
  </div>

  <script src="popup.js"></script>
```

- [ ] **Step 4: Structural verification**

Run:
```bash
grep -c -E 'id="(open-cli-row|cli-view|cli-tab-unix|cli-tab-win|cli-cmd-unix|cli-cmd-win|cli-copy-unix|cli-copy-win|cli-note-win|cli-view-script|cli-back)"' popup.html
```
Expected: `11` (every new id present exactly once).

- [ ] **Step 5: Commit**

```bash
git add popup.html
git commit -m "feat(popup): add Use-in-Claude-CLI row and OS-tabbed install view"
```

---

## Task 4: `popup.js` — wire the CLI view

**Files:**
- Modify: `popup.js` (the three view fns at `popup.js:81-102`; add CLI section after `wireSettingsView` ~`popup.js:471`; add `wireCliView()` call at `popup.js:67`)

- [ ] **Step 1: Make the three existing view functions also hide `#cli-view`**

Find (`popup.js:81-102`):
```javascript
function showWizardView() {
  document.getElementById('wizard-view').hidden = false;
  document.getElementById('main-view').hidden = true;
  document.getElementById('settings-view').hidden = true;
}

function showMainView() {
  document.getElementById('wizard-view').hidden = true;
  document.getElementById('main-view').hidden = false;
  document.getElementById('settings-view').hidden = true;
  updateSettingsSummary();
}

function showSettingsView(returnTo) {
  document.getElementById('wizard-view').hidden = true;
  document.getElementById('main-view').hidden = true;
  const view = document.getElementById('settings-view');
  view.hidden = false;
  view.dataset.returnTo = returnTo;
  populateSettingsFields();
  clearSettingsStatus();
}
```
Replace with:
```javascript
function showWizardView() {
  document.getElementById('wizard-view').hidden = false;
  document.getElementById('main-view').hidden = true;
  document.getElementById('settings-view').hidden = true;
  document.getElementById('cli-view').hidden = true;
}

function showMainView() {
  document.getElementById('wizard-view').hidden = true;
  document.getElementById('main-view').hidden = false;
  document.getElementById('settings-view').hidden = true;
  document.getElementById('cli-view').hidden = true;
  updateSettingsSummary();
}

function showSettingsView(returnTo) {
  document.getElementById('wizard-view').hidden = true;
  document.getElementById('main-view').hidden = true;
  document.getElementById('cli-view').hidden = true;
  const view = document.getElementById('settings-view');
  view.hidden = false;
  view.dataset.returnTo = returnTo;
  populateSettingsFields();
  clearSettingsStatus();
}

function showCliView() {
  document.getElementById('wizard-view').hidden = true;
  document.getElementById('main-view').hidden = true;
  document.getElementById('settings-view').hidden = true;
  document.getElementById('cli-view').hidden = false;
  selectCliTab(detectDefaultOs());
}
```

- [ ] **Step 2: Add the CLI-view logic block**

Insert immediately **after** the end of `wireSettingsView()` (the closing `}` at `popup.js:471`) and **before** `function populateSettingsFields() {` (`popup.js:473`).

Find:
```javascript
}

function populateSettingsFields() {
```
Replace with:
```javascript
}

// ─── CLI view ───────────────────────────────────────────────────────────────

const CLI_RAW_BASE = 'https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli';
const CLI_SCRIPT_URL = {
  unix: `${CLI_RAW_BASE}/install-remote.sh`,
  win:  `${CLI_RAW_BASE}/install-remote.ps1`,
};

function detectDefaultOs() {
  const platform =
    (navigator.userAgentData && navigator.userAgentData.platform) ||
    navigator.platform ||
    navigator.userAgent ||
    '';
  return /win/i.test(platform) ? 'win' : 'unix';
}

function selectCliTab(os) {
  const isWin = os === 'win';
  document.getElementById('cli-tab-win').classList.toggle('active', isWin);
  document.getElementById('cli-tab-unix').classList.toggle('active', !isWin);
  document.getElementById('cli-cmd-win-block').hidden = !isWin;
  document.getElementById('cli-cmd-unix-block').hidden = isWin;
  document.getElementById('cli-note-win').hidden = !isWin;
  document.getElementById('cli-view-script').href = isWin ? CLI_SCRIPT_URL.win : CLI_SCRIPT_URL.unix;
}

async function copyCliCommand(codeId, btn) {
  const text = document.getElementById(codeId).textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied ✓';
  } catch {
    btn.textContent = 'Copy failed';
  }
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
}

function wireCliView() {
  document.getElementById('open-cli-row').addEventListener('click', showCliView);
  document.getElementById('cli-tab-unix').addEventListener('click', () => selectCliTab('unix'));
  document.getElementById('cli-tab-win').addEventListener('click', () => selectCliTab('win'));
  document.getElementById('cli-copy-unix').addEventListener('click', (e) => copyCliCommand('cli-cmd-unix', e.currentTarget));
  document.getElementById('cli-copy-win').addEventListener('click', (e) => copyCliCommand('cli-cmd-win', e.currentTarget));
  document.getElementById('cli-back').addEventListener('click', showMainView);
}

function populateSettingsFields() {
```

> `copyCliCommand` resets the label to the literal `'Copy'` (both buttons are labelled "Copy"), which avoids a double-click capturing `Copied ✓` as the restore text. The `#cli-view-script` anchor is a native `target="_blank"` link whose `href` is set by `selectCliTab`, so no click handler is needed for it.

- [ ] **Step 3: Call `wireCliView()` on load**

Find (`popup.js:66-67`):
```javascript
  await loadConfig();
  wireSettingsView();
```
Replace with:
```javascript
  await loadConfig();
  wireSettingsView();
  wireCliView();
```

- [ ] **Step 4: Syntax check**

Run: `node --check popup.js`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add popup.js
git commit -m "feat(popup): wire CLI view — OS detection, tab toggle, copy, back"
```

---

## Task 5: Verification & coexistence checklist

No code — this confirms the spec's Testing + Coexistence sections. Run the load-unpacked checks manually in Chrome; record results.

**Files:**
- Modify (final step): `docs/superpowers/specs/2026-05-30-cli-install-panel-design.md`

- [ ] **Step 1: Re-run the automated checks together**

Run:
```bash
bash -n cli/install-remote.sh && node --check popup.js && bash /tmp/pe-test-remote-sh.sh
```
Expected: ends with `PASS` (and no syntax errors from the first two).

- [ ] **Step 2: Load unpacked + popup view checks (manual)**

Load the repo as an unpacked extension (`chrome://extensions` → Developer mode → Load unpacked → repo root). Then, per spec Testing → Extension:
- Main view shows the new **Use in Claude CLI ›** row.
- Click it → `#cli-view` appears with the OS-appropriate tab pre-selected (on this Mac: **macOS / Linux**).
- Toggle tabs → the one-liner, the Windows note, and the **View script** target all switch (Windows tab shows the Git Bash/jq note; macOS/Linux hides it).
- **Copy** copies the exact one-liner for the active tab (paste somewhere to confirm); label flips to `Copied ✓` then back to `Copy`.
- **View script** opens the matching raw installer URL (`install-remote.sh` vs `install-remote.ps1`) in a new tab.
- **Back** returns to main view.

- [ ] **Step 3: No view-switching regressions (manual)**

- Wizard view still runs on first load; `wizard-to-settings` link still opens settings; settings **Back** returns correctly.
- Opening CLI view then settings (or wizard) leaves no stale `#cli-view` visible (the `.hidden = true` lines added in Task 4 Step 1 guarantee this).

- [ ] **Step 4: Coexistence — extension enhancement still works (manual)**

Per spec Coexistence + the 2026-05-28 spec's coexistence check: with Ollama running, open the popup and enhance a prompt as usual; confirm no new errors in the service-worker console. The CLI panel adds only a discovery surface — it must not change enhancement behaviour.

- [ ] **Step 5: Flip the spec status to Implemented**

In `docs/superpowers/specs/2026-05-30-cli-install-panel-design.md`, find:
```markdown
**Status:** Approved (pending spec review)
```
Replace with:
```markdown
**Status:** Implemented — `cli/install-remote.sh`, `cli/install-remote.ps1`, and the popup `#cli-view` shipped on `feature/cli-install-panel`. Remote one-liners go live once merged to `main`.
```

- [ ] **Step 6: Final commit**

```bash
git add docs/superpowers/specs/2026-05-30-cli-install-panel-design.md
git commit -m "docs(spec): mark CLI install panel as implemented"
```

---

## Self-Review

**1. Spec coverage** (against `2026-05-30-cli-install-panel-design.md`):
- §Components 1 `install-remote.sh` → Task 1 (deps check, base URL, mkdir, temp-then-move 3 files, `-f` abort, chmod, success text). ✓
- §Components 2 `install-remote.ps1` → Task 2 (`Stop`, `$env:USERPROFILE`, dirs, temp-then-move, no chmod, success text + Windows jq note). ✓
- §Components 3 `popup.html` (new row after API Settings; `#cli-view` with OS toggle, two one-liner blocks + copy buttons, numbered steps, Windows-only note, shared Ollama note, View script + Back; minimal CSS reusing `.action-btn`/`.action-link`/`.settings-actions`/`ol.setup-steps`) → Task 3. ✓
- §Components 4 `popup.js` (row→view show/hide, OS detect via `userAgentData?.platform`→`platform`→`userAgent`, tab toggle switches block+notes+View-script URL, copy with `Copied ✓`/`Copy failed`, View script new tab, Back→main) → Task 4. ✓
- §Error Handling (clipboard fail → `Copy failed`; OS-detect fail → unix default; installer temp-then-move, `-f`/`Stop` abort) → Tasks 1, 2, 4. ✓
- §Testing (`bash -n`, pwsh parse check, temp-HOME install run, simulated failed download, extension load-unpacked checks) → Tasks 1, 2, 5. The temp-`HOME` run is realised via the curl-shim harness (Task 1) so it works before merge to `main`. ✓
- §Coexistence → Task 5 Step 4. ✓
- §Out of Scope items are not implemented (correct). ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows complete content. ✓

**3. Type/identifier consistency:** Element ids match across HTML (Task 3) and JS (Task 4): `open-cli-row`, `cli-view`, `cli-tab-unix`, `cli-tab-win`, `cli-cmd-unix(-block)`, `cli-cmd-win(-block)`, `cli-copy-unix`, `cli-copy-win`, `cli-note-win`, `cli-view-script`, `cli-back`. Function names consistent: `showCliView`, `detectDefaultOs`, `selectCliTab`, `copyCliCommand`, `wireCliView`. The raw base URL string is identical in `install-remote.sh`, the HTML one-liners, and `CLI_RAW_BASE` in JS. ✓
