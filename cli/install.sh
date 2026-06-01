#!/usr/bin/env bash
set -euo pipefail

# Installs the /enhance slash command globally into ~/.claude/.
# Safe to re-run — overwrites the three target files in place.

for cmd in curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing dependency: $cmd. Install it and re-run." >&2
    exit 1
  fi
done

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_COMMANDS="$HOME/.claude/commands"
DEST_SCRIPTS="$HOME/.claude/scripts"

mkdir -p "$DEST_COMMANDS" "$DEST_SCRIPTS"

cp "$SRC_DIR/commands/enhance.md" "$DEST_COMMANDS/enhance.md"
cp "$SRC_DIR/enhance.sh"          "$DEST_SCRIPTS/enhance.sh"
cp "$SRC_DIR/tones.json"          "$DEST_SCRIPTS/tones.json"

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
