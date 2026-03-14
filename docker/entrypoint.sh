#!/usr/bin/env bash
set -euo pipefail

mkdir -p "${MONO_CONFIG_DIR:-/data/home/.mono}"

BOOTSTRAP_PROVIDER="${MONO_BOOTSTRAP_PROVIDER:-}"
BOOTSTRAP_MODEL="${MONO_BOOTSTRAP_MODEL:-}"
BOOTSTRAP_BASE_URL="${MONO_BOOTSTRAP_BASE_URL:-}"
BOOTSTRAP_PROFILE="${MONO_BOOTSTRAP_PROFILE:-default}"
BOOTSTRAP_ALWAYS="${MONO_BOOTSTRAP_ALWAYS:-0}"
CONFIG_PATH="${MONO_CONFIG_DIR:-/data/home/.mono}/config.json"

should_bootstrap=0
if [[ "$BOOTSTRAP_ALWAYS" == "1" ]]; then
  should_bootstrap=1
elif [[ ! -f "$CONFIG_PATH" && -n "$BOOTSTRAP_PROVIDER" && -n "$BOOTSTRAP_MODEL" ]]; then
  should_bootstrap=1
fi

if [[ "$should_bootstrap" == "1" ]]; then
  mkdir -p "$(dirname "$CONFIG_PATH")"
  cat > "$CONFIG_PATH" <<JSON
{
  "version": 1,
  "mono": {
    "defaultProfile": "${BOOTSTRAP_PROFILE}",
    "profiles": {
      "${BOOTSTRAP_PROFILE}": {
        "provider": "custom-openai",
        "modelId": "${BOOTSTRAP_MODEL}",
        "baseURL": "${BOOTSTRAP_BASE_URL:-https://api.openai.com/v1}",
        "family": "openai-compatible",
        "transport": "openai-compatible",
        "providerFactory": "openai",
        "apiKeyEnv": "MONO_API_KEY",
        "supportsTools": true,
        "supportsReasoning": true,
        "supportsAttachments": true
      }
    },
    "settings": {
      "approvalMode": "default",
      "theme": "system"
    },
    "memory": {
      "enabled": true,
      "provider": "execution"
    },
    "context": {
      "includeProjectTree": true,
      "maxProjectFileBytes": 32768,
      "maxProjectFiles": 12
    },
    "channels": {}
  },
  "projects": {}
}
JSON
fi

exec node /app/packages/cli/dist/bin.js "$@"
