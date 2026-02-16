#!/bin/bash
# Download all-MiniLM-L6-v2 ONNX model files for the PTY RAG pipeline.
#
# Run from the repo root:
#   bash apps/desktop/src-tauri/resources/models/download-model.sh

set -euo pipefail

MODEL_DIR="$(cd "$(dirname "$0")/all-MiniLM-L6-v2" && pwd)"
HF_BASE="https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main"

echo "Downloading all-MiniLM-L6-v2 to $MODEL_DIR..."

# ONNX model (exported via optimum)
if [ ! -f "$MODEL_DIR/model.onnx" ]; then
  echo "  Downloading model.onnx..."
  curl -fSL "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx" \
    -o "$MODEL_DIR/model.onnx"
else
  echo "  model.onnx already exists, skipping."
fi

# Tokenizer
if [ ! -f "$MODEL_DIR/tokenizer.json" ]; then
  echo "  Downloading tokenizer.json..."
  curl -fSL "$HF_BASE/tokenizer.json" -o "$MODEL_DIR/tokenizer.json"
else
  echo "  tokenizer.json already exists, skipping."
fi

# Config (useful for debugging/reference)
if [ ! -f "$MODEL_DIR/config.json" ]; then
  echo "  Downloading config.json..."
  curl -fSL "$HF_BASE/config.json" -o "$MODEL_DIR/config.json"
else
  echo "  config.json already exists, skipping."
fi

echo "Done. Model files are in $MODEL_DIR"
echo ""
echo "Files:"
ls -lh "$MODEL_DIR"
