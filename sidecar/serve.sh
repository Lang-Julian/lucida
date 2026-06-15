#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${LUCIDA_AI_PORT:-8765}"
MODEL="${LUCIDA_AI_MODEL:-mlx-community/Qwen2.5-3B-Instruct-4bit}"
exec "$DIR/.venv/bin/python" -m mlx_lm.server --model "$MODEL" --host 127.0.0.1 --port "$PORT"
