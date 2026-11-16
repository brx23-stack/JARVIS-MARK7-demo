#!/usr/bin/env bash
set -euo pipefail

# Ollama should be installed as a system service on the computer.
# If it is already running, this command is harmless.
if command -v ollama >/dev/null 2>&1; then
  (ollama serve >/tmp/jarvis-ollama.log 2>&1 &) || true
fi

npm run build
npm start
