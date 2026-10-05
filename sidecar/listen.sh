#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LUCIDA_LISTEN_PORT="${LUCIDA_LISTEN_PORT:-8766}"
export LUCIDA_LISTEN_MODEL="${LUCIDA_LISTEN_MODEL:-mlx-community/whisper-large-v3-turbo}"
exec "$DIR/.venv/bin/python" "$DIR/listen.py"
