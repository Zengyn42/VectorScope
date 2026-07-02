#!/bin/bash
# Simple HTTP server for VectorScope
# Usage: ./serve.sh [port]
PORT=${1:-8095}
echo "VectorScope serving at http://localhost:${PORT}"
cd "$(dirname "$0")"
python3 -m http.server "$PORT"
