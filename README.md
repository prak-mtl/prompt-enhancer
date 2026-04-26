# AI Prompt Enhancer

A Chrome extension that supercharges your prompts before you send them — running entirely on your local machine via [Ollama](https://ollama.com). No API keys, no cloud, no data leaving your device.

<img width="380" height="371" alt="AI prompt enhancer" src="https://github.com/user-attachments/assets/3d28ddc4-e9ec-4931-98ea-e258794cd3fb" />

---

## How it works

The extension injects an **✨ Enhance** button into any text area or content-editable field on any website. Click it, pick a tone, and the extension rewrites your raw input into a well-structured, high-quality prompt using a local LLM — then drops the result back into the field.

---

## Features

- **Works everywhere** — attaches to textareas, inputs, and content-editable fields on any site (ChatGPT, Claude, Notion, GitHub, etc.)
- **7 tone options** — Professional, Casual, Friendly, Polite, Technical, Creative, Emojified
- **Runs 100% locally** — powered by Ollama (`llama3.2:3b`), zero network calls to external APIs
- **Progressive setup wizard** — walks you through installing Ollama, starting the server, and pulling the model with a real-time progress bar
- **Live Ollama status** — the popup shows a live Online/Offline indicator and polls every 5 seconds so you always know if the server is up
- **Per-site control** — enable or disable the extension globally or just for the current domain
- **Dark/light icon** — toolbar icon automatically switches between dark and light variants based on your OS color scheme
- **Graceful error handling** — if Ollama goes offline mid-session, the enhance button tells you immediately instead of silently failing

---

## Requirements

- Google Chrome (or any Chromium-based browser)
- [Ollama](https://ollama.com/download) installed and running locally
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
| Professional | Emails, reports, business communication |
| Casual | Slack messages, informal chats |
| Friendly | Customer-facing messages, support |
| Polite | Requests, feedback, sensitive topics |
| Technical | Engineering docs, code comments, specs |
| Creative | Storytelling, marketing, brainstorming |
| Emojified | Social posts, fun messages |

---

## Popup controls

| Control | Description |
|---|---|
| **Enable Extension** | Master on/off switch for all sites |
| **Active on this site** | Override for the current domain only (disabled when global is off) |
| **Ollama** status badge | Live indicator — green = running, red = offline with restart instructions |

---

## Project structure

```
prompt-enhancer/
├── manifest.json       # MV3 extension config, permissions, icon declarations
├── background.js       # Service worker — LLM API calls, icon theme switching
├── content.js          # Injected into every page — enhance button, tone menu, positioning
├── content.css         # Styles for the injected UI
├── popup.html          # Extension popup — setup wizard + settings UI
├── popup.js            # Wizard logic, Ollama status polling, toggle state management
└── icons/
    ├── favicon_dark.png   # Default icon (used on light Chrome themes)
    └── favicon_light.png  # Used when OS is in dark mode
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Extension platform | Chrome Manifest V3 |
| LLM runtime | [Ollama](https://ollama.com) |
| Model | `llama3.2:3b` |
| Languages | Vanilla JS, HTML, CSS — zero dependencies |

---

## Privacy

Everything runs locally. Your prompts are sent only to `127.0.0.1:11434` (your own machine). Nothing is logged, stored remotely, or transmitted to any external server.

---

## License

MIT
