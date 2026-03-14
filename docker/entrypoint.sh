#!/usr/bin/env bash
set -euo pipefail

mkdir -p "${MONO_CONFIG_DIR:-/data/home/.mono}"

BOOTSTRAP_PROVIDER="${MONO_BOOTSTRAP_PROVIDER:-}"
BOOTSTRAP_MODEL="${MONO_BOOTSTRAP_MODEL:-}"
BOOTSTRAP_BASE_URL="${MONO_BOOTSTRAP_BASE_URL:-}"
BOOTSTRAP_PROFILE="${MONO_BOOTSTRAP_PROFILE:-default}"
BOOTSTRAP_ALWAYS="${MONO_BOOTSTRAP_ALWAYS:-0}"
CONFIG_PATH="${MONO_CONFIG_DIR:-/data/home/.mono}/config.json"

TELEGRAM_ENABLED="${MONO_TELEGRAM_ENABLED:-0}"
TELEGRAM_BOT_TOKEN="${MONO_TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_BOT_ID="${MONO_TELEGRAM_BOT_ID:-}"
TELEGRAM_DM_POLICY="${MONO_TELEGRAM_DM_POLICY:-pairing}"

canonical_provider="${BOOTSTRAP_PROVIDER,,}"
profile_family="openai-compatible"
profile_transport="openai-compatible"
profile_provider_factory="custom"

case "$canonical_provider" in
  ""|openai)
    canonical_provider="openai"
    profile_provider_factory="openai"
    ;;
  openrouter)
    profile_provider_factory="openrouter"
    ;;
  anthropic)
    profile_family="anthropic"
    profile_transport="anthropic"
    profile_provider_factory="anthropic"
    ;;
  google|gemini)
    canonical_provider="google"
    profile_family="gemini"
    profile_transport="gemini"
    profile_provider_factory="google"
    ;;
esac

telegram_enabled_json="false"
if [[ "$TELEGRAM_ENABLED" == "1" || "$TELEGRAM_ENABLED" == "true" || "$TELEGRAM_ENABLED" == "TRUE" ]]; then
  telegram_enabled_json="true"
fi

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
        "provider": "${canonical_provider}",
        "modelId": "${BOOTSTRAP_MODEL}",
        "baseURL": "${BOOTSTRAP_BASE_URL:-https://api.openai.com/v1}",
        "family": "${profile_family}",
        "transport": "${profile_transport}",
        "providerFactory": "${profile_provider_factory}",
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
    "channels": {
      "telegram": {
        "enabled": ${telegram_enabled_json},
        "dmPolicy": "${TELEGRAM_DM_POLICY}"
      }
    }
  },
  "projects": {}
}
JSON

  if [[ -n "$TELEGRAM_BOT_TOKEN" || -n "$TELEGRAM_BOT_ID" ]]; then
    node -e '
const fs = require("node:fs");
const path = process.argv[1];
const token = process.env.MONO_TELEGRAM_BOT_TOKEN || "";
const botId = process.env.MONO_TELEGRAM_BOT_ID || "";
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));
cfg.mono = cfg.mono || {};
cfg.mono.channels = cfg.mono.channels || {};
cfg.mono.channels.telegram = cfg.mono.channels.telegram || {};
if (token) cfg.mono.channels.telegram.botToken = token;
if (botId) cfg.mono.channels.telegram.botId = botId;
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
' "$CONFIG_PATH"
  fi
fi

exec node /app/packages/cli/dist/bin.js "$@"
