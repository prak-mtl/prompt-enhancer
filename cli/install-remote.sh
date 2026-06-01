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
