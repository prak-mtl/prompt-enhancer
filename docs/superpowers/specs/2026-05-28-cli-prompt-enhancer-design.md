# CLI Prompt Enhancer — Design

**Date:** 2026-05-28
**Status:** Implemented — code lives in `cli/` (installs to `~/.claude/`). This doc was reconciled with the shipped implementation on 2026-06-01.

## Goal

Port the Chrome extension's prompt-enhancement flow into Claude Code CLI as a global slash command, so the same Ollama-backed enhancement is available anywhere the user runs Claude. Keep the basic version minimal; design the layout so it can later be repackaged as a Claude Code plugin.

## Constraints

**The Chrome extension and the CLI plugin must both continue to work.** Hard requirements that follow from this:

- **Additive only — no extension files are modified.** `manifest.json`, `background.js`, `popup.js`, `popup.html`, `content.js`, and everything else under the repo root that the extension ships stays untouched. All CLI code lives in a new `cli/` directory; installation writes only into `~/.claude/`, which the extension does not read from or write to. The two tools are independent processes that happen to share an Ollama backend.
- **Behavioral parity on the same input.** Given the same prompt and the same tone, the CLI should produce an enhancement comparable to the extension. That means matching the extension's request shape: default model (`llama3.2:3b`, per `background.js:4`), system-prompt structure (Basic uses its own light-touch prompt; other tones share the "Prompt Architect" template with the tone name interpolated, per `background.js:118-130`), user-message format (`Tone: <tone>. Input: <text>`, per `background.js:132`), `temperature: 0.7`, and `stream: false`. The "Tones" and "Data flow" sections below must reflect these specifics; if any drift, the CLI will produce different output than the extension and "port" becomes inaccurate.
- **Duplicated tone strings are accepted for v1.** The extension hardcodes tone prompts in `background.js`; the CLI stores them in `cli/tones.json`. A future tone edit must be applied to both. A shared source of truth (e.g., the extension reading `cli/tones.json` at build time) is out of scope here — flagged in "Future work."
- **No shared state at runtime.** The CLI does not read `chrome.storage.local`, and the extension does not read `~/.claude/`. Each tool owns its own config (the extension via its settings UI, the CLI via env vars).

Verification that this constraint holds is part of the testing checklist below: after installing the CLI, the extension's popup must still open, enhance a prompt successfully, and show no new errors in the service worker console.

## User flow

The user types their prompt as an argument to the slash command:

```
/enhance explain how OAuth refresh tokens work
```

Claude then:

1. Shows a tone picker via `AskUserQuestion` — three options: **Professional**, **Technical**, **Basic** (grammar-only).
2. Runs the enhancement script with the chosen tone and the raw prompt.
3. Prints the enhanced prompt to the terminal. The user copies/pastes it into a new prompt themselves — there is no auto-replacement or auto-execution.

If Ollama is unreachable, the script exits non-zero with a clear error; the slash command surfaces that error to the user.

## Components

All artifacts live in this repo under a new `cli/` directory. They are installed globally by copying into `~/.claude/`. This keeps the project repo as the source of truth and matches the layout a plugin would use later.

| Path in repo | Installed to | Purpose |
|---|---|---|
| `cli/commands/enhance.md` | `~/.claude/commands/enhance.md` | Slash command definition. Body instructs Claude to run the tone picker, then call the script with `$ARGUMENTS`, then print the result. |
| `cli/enhance.sh` | `~/.claude/scripts/enhance.sh` | Shell script: reads tone via `--tone <name>`, prompt text via stdin, calls Ollama `/api/chat`, prints the assistant's response on stdout. |
| `cli/tones.json` | `~/.claude/scripts/tones.json` | Tone → system-prompt mapping. Three entries to start. |
| `cli/install.sh` | (not installed) | One-shot installer (idempotent): checks for `curl`/`jq`, `mkdir -p`s the target dirs, copies the three files above into `~/.claude/`, and `chmod +x`s the script. |

The slash command markdown references the script by absolute path (`~/.claude/scripts/enhance.sh`) so it works regardless of which directory the CLI was launched from.

## Config

Environment variables only — no config file in the basic version:

- `OLLAMA_URL` (default `http://127.0.0.1:11434` — `127.0.0.1` rather than `localhost` to avoid IPv6 `::1` resolution surprises)
- `OLLAMA_MODEL` (default `llama3.2:3b`, matching `background.js:4`)

If either is unset, the script uses the defaults. Remote-endpoint parity (basic auth, custom headers) from the Chrome extension is **out of scope** for this version — see "Future work."

## Tones

Three tones, mirroring the corresponding entries in `background.js`:

| Tone | System prompt intent |
|---|---|
| **Professional** | Clarity, complete sentences, neutral business tone. No filler. |
| **Technical** | Precise terminology, explicit constraints, structured if multi-part. |
| **Basic** | Grammar and clarity fixes only — preserve voice, do not add detail or rewrite intent. |

The exact system-prompt strings are copied from `background.js` so behavior matches the extension. They live in `cli/tones.json` as `{ "<tone-name>": "<system prompt>" }`.

Note on what actually ships: **Professional and Technical share a single "Prompt Architect" template** that differs only by the tone word (`PROFESSIONAL` / `TECHNICAL`) interpolated into one rule — the "intent" column above describes the goal, not three independently authored prompts. **Basic** is a separate light-touch-editor prompt. This mirrors `background.js:118-130` exactly.

## Data flow

```
user types: /enhance <prompt text>
   │
   ▼
slash command (Claude reads enhance.md)
   │  Claude: AskUserQuestion → tone
   ▼
bash: ~/.claude/scripts/enhance.sh --tone <tone> <<< "<prompt text>"
   │  reads OLLAMA_URL, OLLAMA_MODEL from env (defaults if unset)
   │  reads system prompt for <tone> from tones.json
   │  POST {url}/api/chat with {model, messages: [system, user]}
   ▼
script prints enhanced text on stdout
   │
   ▼
Claude prints the result to the terminal for the user to copy
```

## Error handling

The script handles three failure modes, each with a distinct exit code and message:

1. **Ollama unreachable** (connection refused / timeout) — exit 2, message: `Ollama not reachable at <OLLAMA_URL>. Is it running?`
2. **Model not found** — exit 3, message: `Model <OLLAMA_MODEL> not pulled. Try: ollama pull <OLLAMA_MODEL>`. Detected two ways: an HTTP 404, **or** an HTTP 200 whose JSON `.error` field matches `not found` / `try pulling` (case-insensitive) — Ollama reports a missing model in both shapes depending on version.
3. **Unknown tone** (tone not in `tones.json`) — exit 4, message: `Unknown tone '<tone>'. Available: <keys from tones.json>`

Everything else exits 1 with a message on stderr: bad or missing arguments (including a missing `--tone`), a missing `curl`/`jq` dependency, empty stdin, a missing `tones.json`, an unexpected non-200 HTTP status (e.g. 5xx, with the body printed raw), or a malformed response body that has no `.message.content`. Claude surfaces the error to the user unchanged.

## Testing

- **Unit-ish (script-level):** call `enhance.sh --tone basic <<< "fix this bug"` with Ollama running locally and confirm stdout is non-empty and looks like a rewrite of the input.
- **Error paths:** point `OLLAMA_URL` at a closed port, confirm exit 2 and the expected message. Pass `--tone nonsense`, confirm exit 4.
- **End-to-end:** in Claude CLI, run `/enhance write a function that reverses a string`, pick a tone, confirm the enhanced version prints.
- **Extension still works (coexistence check):** after `cli/install.sh` runs, reload the Chrome extension, open the popup, enhance a prompt against the same local Ollama instance, and confirm there are no new errors in the service worker console. The CLI should not change anything the extension depends on.
- **Parity spot-check:** enhance the same prompt with the same tone via the extension and via `/enhance`. The outputs do not need to be byte-identical (the model is non-deterministic at temperature 0.7), but they should be recognizably the same kind of rewrite. If one returns "Prompt Architect"-style structure and the other returns a casual paraphrase, the request shape has drifted — re-check model, system prompt, user-message format, temperature, and `stream`.

No automated test suite for the basic version — manual verification per the above is sufficient for a single ~140-line bash script.

## Plugin path (later, not in scope here)

The `cli/` directory layout is deliberately close to a Claude Code plugin's shape: `commands/` + scripts + a manifest. To publish as a plugin we would add a `plugin.json` manifest at `cli/plugin.json`, move the install step into the plugin loader, and the slash command would resolve script paths via the plugin root rather than `~/.claude/`. Designing for this now means the basic version doesn't need restructuring later.

## Future work (explicitly out of scope)

- Remote Ollama endpoint with basic auth (parity with the extension's recent feature).
- The other three tones from the extension: Casual, Concise, Detailed.
- Per-project tone defaults via a project-level config file.
- Optional "act on enhanced prompt immediately" mode.
- Publishing as a Claude Code plugin.
