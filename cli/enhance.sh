#!/usr/bin/env bash
set -euo pipefail

# Defaults mirror the Chrome extension (background.js:3-4) so output is comparable.
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:3b}"

TONE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tone)
      if [[ $# -lt 2 ]]; then
        echo "--tone requires a value" >&2
        exit 1
      fi
      TONE="$2"
      shift 2
      ;;
    -h|--help)
      cat >&2 <<'USAGE'
Usage: enhance.sh --tone <professional|technical|basic>

Reads the prompt text from stdin, calls Ollama /api/chat, and prints the
enhanced prompt on stdout.

Env vars:
  OLLAMA_URL    default http://127.0.0.1:11434
  OLLAMA_MODEL  default llama3.2:3b

Exit codes:
  0  success
  1  generic error (bad args, malformed response, HTTP 5xx, empty stdin)
  2  Ollama unreachable
  3  model not pulled
  4  unknown tone
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$TONE" ]]; then
  echo "Missing required --tone. Run with --help for usage." >&2
  exit 1
fi

for cmd in curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing dependency: $cmd. Please install it." >&2
    exit 1
  fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TONES_FILE="$SCRIPT_DIR/tones.json"

if [[ ! -f "$TONES_FILE" ]]; then
  echo "tones.json not found at $TONES_FILE" >&2
  exit 1
fi

if ! SYSTEM_PROMPT="$(jq -er --arg t "$TONE" '.[$t]' "$TONES_FILE" 2>/dev/null)"; then
  AVAILABLE="$(jq -r 'keys | join(", ")' "$TONES_FILE")"
  echo "Unknown tone '$TONE'. Available: $AVAILABLE" >&2
  exit 4
fi

PROMPT_TEXT="$(cat)"
if [[ -z "${PROMPT_TEXT//[[:space:]]/}" ]]; then
  echo "No prompt text on stdin." >&2
  exit 1
fi

# Capitalize the tone label so the user payload matches the extension format
# ("Tone: Professional. Input: ...", per background.js:132).
TONE_LABEL="$(printf '%s' "$TONE" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')"
USER_PAYLOAD="Tone: ${TONE_LABEL}. Input: ${PROMPT_TEXT}"

REQUEST_BODY="$(jq -n \
  --arg model "$OLLAMA_MODEL" \
  --arg system "$SYSTEM_PROMPT" \
  --arg user "$USER_PAYLOAD" \
  '{
    model: $model,
    messages: [
      {role: "system", content: $system},
      {role: "user",   content: $user}
    ],
    stream: false,
    options: {temperature: 0.7}
  }')"

HTTP_BODY_FILE="$(mktemp)"
trap 'rm -f "$HTTP_BODY_FILE"' EXIT

URL="${OLLAMA_URL%/}/api/chat"

if ! HTTP_CODE="$(printf '%s' "$REQUEST_BODY" | curl -sS \
  -o "$HTTP_BODY_FILE" \
  -w '%{http_code}' \
  --connect-timeout 5 \
  --max-time 120 \
  -H 'Content-Type: application/json' \
  -X POST \
  --data-binary @- \
  "$URL" 2>/dev/null)"; then
  echo "Ollama not reachable at ${OLLAMA_URL}. Is it running?" >&2
  exit 2
fi

BODY="$(cat "$HTTP_BODY_FILE")"

# Ollama signals "model not pulled" as either HTTP 404 or HTTP 200 with an
# `.error` field whose message mentions "not found" / "try pulling".
if [[ "$HTTP_CODE" == "404" ]] || \
   printf '%s' "$BODY" | jq -e '(.error // "") | test("not found|try pulling"; "i")' >/dev/null 2>&1; then
  echo "Model ${OLLAMA_MODEL} not pulled. Try: ollama pull ${OLLAMA_MODEL}" >&2
  exit 3
fi

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Unexpected response from Ollama (HTTP $HTTP_CODE):" >&2
  printf '%s\n' "$BODY" >&2
  exit 1
fi

if ! ENHANCED="$(printf '%s' "$BODY" | jq -er '.message.content' 2>/dev/null)"; then
  echo "Malformed response from Ollama:" >&2
  printf '%s\n' "$BODY" >&2
  exit 1
fi

printf '%s\n' "$ENHANCED"
