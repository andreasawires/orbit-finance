#!/bin/sh
set -eu

model="${VISION_MODEL:-qwen3-vl:4b-instruct}"

ollama serve &
ollama_pid=$!

stop_ollama() {
  kill "$ollama_pid" 2>/dev/null || true
  wait "$ollama_pid" 2>/dev/null || true
}

trap stop_ollama INT TERM EXIT

until ollama list >/dev/null 2>&1; do
  sleep 1
done

if ! ollama show "$model" >/dev/null 2>&1; then
  echo "Orbit Finance: downloading local model $model"
  ollama pull "$model"
fi

echo "Orbit Finance: local model $model is ready"
wait "$ollama_pid"
