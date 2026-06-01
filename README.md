# AI Prompt Enhancer

A Chrome extension that supercharges your prompts before you send them — powered by [Ollama](https://ollama.com) and running on your own machine by default. It now also supports authenticated remote endpoints and a `/enhance` command for Claude Code. Local by default: no API keys, no subscriptions, and your prompts only ever go where you choose to send them.

<img width="380" height="371" alt="AI prompt enhancer" src="https://github.com/user-attachments/assets/3d28ddc4-e9ec-4931-98ea-e258794cd3fb" />

---

## How it works

The extension injects an **✨ Enhance** button into any text area or content-editable field on any website. Click it, pick a tone, and the extension rewrites your raw input into a well-structured, high-quality prompt using an LLM — then drops the result back into the field.

---

## Features

- **Works everywhere** — attaches to textareas, inputs, and content-editable fields on any site (ChatGPT, Claude, Notion, GitHub, etc.)
- **8 tone options** — Basic, Professional, Casual, Friendly, Polite, Technical, Creative, Emojified
- **Local by default** — powered by Ollama (`llama3.2:3b`) on your own machine; no external API calls unless you opt into a remote endpoint
- **Bring your own endpoint** — point it at any Ollama-compatible server, including a remote or self-hosted one behind HTTP Basic auth; works through reverse proxies and WAFs (Caddy/nginx)
- **Use in Claude Code (CLI)** — install a `/enhance` slash command and enhance prompts straight from the terminal, using the same local Ollama
- **Progressive setup wizard** — walks you through installing Ollama, starting the server, and pulling the model with a real-time progress bar
- **Live status monitoring** — the popup shows a live Online/Offline indicator and polls every 5 seconds, and flags authentication failures so you always know if the endpoint is up
- **Per-site control** — enable or disable the extension globally or just for the current domain
- **Dark/light icon** — toolbar icon automatically switches between dark and light variants based on your OS color scheme
- **Graceful error handling** — if the endpoint goes offline mid-session, the enhance button tells you immediately instead of silently failing

---

## Requirements

- Google Chrome (or any Chromium-based browser)
- [Ollama](https://ollama.com/download) running locally **or** access to a remote Ollama-compatible endpoint you configure
- The `llama3.2:3b` model (the setup wizard pulls it for you automatically)

---

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/prak-mtl/prompt-enhancer.git
cd prompt-enhancer
```

### 2. Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `prompt-enhancer` folder

### 3. Run the setup wizard

The extension will open a setup wizard the first time you click the toolbar icon. It checks three things automatically:

| Step | What it checks |
|---|---|
| ① Ollama reachable | Pings `127.0.0.1:11434` |
| ② API ready | Calls `/api/tags` |
| ③ Model available | Checks for `llama3.2:3b`, pulls it if missing (~2 GB) |

If Ollama isn't running, the wizard shows exactly what to do:

```bash
# Install Ollama from https://ollama.com/download, then:
ollama serve
```

Once all steps pass, the extension is ready. Setup state is persisted — the wizard only runs once.

---

## Usage

1. Click into any text field on any website
2. The **✨ Enhance** button appears in the bottom-right corner of the field
3. Click it to open the tone menu
4. Select a tone — the extension sends your text to Ollama and replaces it with the enhanced version

### Tone options

| Tone | Best for |
|---|---|
| Basic | Quick grammar, spelling & clarity fixes — keeps your original voice and length |
| Professional | Emails, reports, business communication |
| Casual | Slack messages, informal chats |
| Friendly | Customer-facing messages, support |
| Polite | Requests, feedback, sensitive topics |
| Technical | Engineering docs, code comments, specs |
| Creative | Storytelling, marketing, brainstorming |
| Emojified | Social posts, fun messages |

---

## Remote & authenticated endpoints

You're not limited to local Ollama. Open the popup → **API Settings** to point the extension at any Ollama-compatible endpoint, including a remote or self-hosted server behind authentication:

1. Enter your **endpoint URL** and **model name**
2. Optionally add a **username** and **password** (sent via HTTP Basic auth)
3. Click **Test** to validate the connection and confirm your model is available, then **Save**

Credentials are stored locally in your browser and sent only to the endpoint you configure. The extension automatically strips browser-only headers (`origin`, `sec-fetch-*`, `sec-ch-ua-*`) that reverse proxies and WAFs like Caddy or nginx often reject, so authenticated endpoints work out of the box. A failed login surfaces as an **Auth Error** in the popup. Switch back to local Ollama anytime with **Reset to Local**.

---

## Use in Claude Code (CLI)

Prefer the terminal? Run the same enhancer as a `/enhance` slash command inside Claude Code.

1. Open the popup → **Use in Claude CLI** and copy the one-line installer for your OS:

   **macOS / Linux**
   ```bash
   curl -fsSL https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli/install-remote.sh | bash
   ```

   **Windows (PowerShell)**
   ```powershell
   irm https://raw.githubusercontent.com/prak-mtl/prompt-enhancer/main/cli/install-remote.ps1 | iex
   ```

2. Restart Claude Code (or start a new session)
3. Type `/enhance <your prompt>`, pick a tone (Professional, Technical, or Basic), and your enhanced prompt comes right back

It uses the same local Ollama as the extension — nothing extra to set up. On Windows the engine is a bash script, so it requires Git Bash (or WSL) plus [`jq`](https://jqlang.github.io/jq/).

---

## Popup controls

| Control | Description |
|---|---|
| **Enable Extension** | Master on/off switch for all sites |
| **Active on this site** | Override for the current domain only (disabled when global is off) |
| **Ollama** status badge | Live indicator — green = running, red = offline (or auth error) with restart instructions |
| **API Settings** | Configure a custom endpoint, model, and optional username/password; Test, Save, or Reset to Local |
| **Use in Claude CLI** | Copy the one-line installer for the `/enhance` command in Claude Code |

---

## Project structure

```
prompt-enhancer/
├── manifest.json       # MV3 extension config, permissions, icon declarations
├── background.js       # Service worker — LLM API calls, auth headers, icon theme switching
├── content.js          # Injected into every page — enhance button, tone menu, positioning
├── content.css         # Styles for the injected UI
├── popup.html          # Extension popup — setup wizard, settings, and CLI views
├── popup.js            # Wizard logic, status polling, settings, CLI panel, toggle state
├── icons/
│   ├── favicon_dark.png    # Default icon (used on light Chrome themes)
│   └── favicon_light.png   # Used when OS is in dark mode
└── cli/
    ├── enhance.sh          # Bash engine — calls Ollama and applies the chosen tone
    ├── install.sh          # Local installer for the /enhance command
    ├── install-remote.sh   # One-line remote installer (macOS/Linux)
    ├── install-remote.ps1  # One-line remote installer (Windows PowerShell)
    ├── tones.json          # CLI tone system prompts
    └── commands/
        └── enhance.md      # /enhance slash-command definition
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Extension platform | Chrome Manifest V3 |
| LLM runtime | [Ollama](https://ollama.com) |
| Model | `llama3.2:3b` |
| CLI integration | `/enhance` command for Claude Code (Bash + `jq`) |
| Languages | Vanilla JS, HTML, CSS — zero dependencies |

---

## Privacy

By default, everything runs locally — your prompts are sent only to `127.0.0.1:11434` on your own machine, with nothing logged, stored remotely, or transmitted to any external server. If you configure a custom remote endpoint, your prompts (and any Basic-auth credentials, which are stored locally in your browser) are sent only to that endpoint — and nowhere else. You're always in control of where your data goes.

---

## License

MIT
